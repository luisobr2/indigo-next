/**
 * Odoo *external API* client — `/jsonrpc`, the `common`/`object` services.
 *
 * This is deliberately separate from `client.ts`. `client.ts` wraps the
 * *internal* web client endpoints (`/web/session/authenticate`,
 * `/web/dataset/call_kw`) which are session-cookie based and only accept a
 * real password — an Odoo API key is rejected there. The external API at
 * `/jsonrpc` is the one Odoo documents for integrations, and it accepts an
 * API key in place of a password for both `common.authenticate` and
 * `object.execute_kw`. The MCP server's bearer tokens ARE API keys (see
 * src/lib/mcp/token.ts), so MCP calls must go through here, not client.ts.
 *
 * Request shape (both services):
 *   { jsonrpc: "2.0", method: "call",
 *     params: { service, method, args: [...] } }
 *
 * `execute_kw`'s positional args are `[db, uid, apiKey, model, method,
 * positionalArgs, kwargs]` — the record domain goes inside `positionalArgs`
 * (e.g. `[[domain]]` for search_read), and `fields`/`limit`/`order` go in
 * `kwargs`.
 */
const ODOO_URL = process.env.ODOO_URL ?? "http://localhost:8069";
const ODOO_DB = process.env.ODOO_DB ?? "indigo-prod";
const TIMEOUT_MS = parseInt(process.env.ODOO_TIMEOUT_MS ?? "30000", 10);

export class OdooRpcError extends Error {
  /**
   * Odoo's own exception dotted name from `error.data.name` (e.g.
   * "odoo.exceptions.AccessError"), or a local marker ("TIMEOUT" /
   * "NETWORK") for failures that never reached Odoo at all. Lets callers
   * (src/lib/mcp/tools.ts, src/lib/mcp/token.ts) distinguish "permission
   * denied" from "record is gone" from "transient — retry" without
   * re-parsing message text.
   */
  readonly errorName?: string;
  /** HTTP status Odoo responded with, when the failure was `!res.ok`. */
  readonly httpStatus?: number;

  constructor(message: string, opts?: { errorName?: string; httpStatus?: number }) {
    super(message);
    this.name = "OdooRpcError";
    this.errorName = opts?.errorName;
    this.httpStatus = opts?.httpStatus;
  }
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: { name?: string; message?: string; debug?: string };
  };
}

let rpcId = 0;

async function rpcCall<T>(service: string, method: string, args: unknown[]): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${ODOO_URL}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++rpcId,
        method: "call",
        params: { service, method, args },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    // Never reached Odoo at all: our own abort (timeout) or a network-level
    // failure (connection refused, DNS, Odoo restarting). Both are worth a
    // retry, unlike a bad credential or a genuine Odoo-side error below —
    // callers use `errorName` to tell them apart (see MCP token/tool error
    // mapping) instead of guessing from message text.
    if (e instanceof Error && e.name === "AbortError") {
      throw new OdooRpcError(`Odoo request timed out after ${TIMEOUT_MS}ms`, { errorName: "TIMEOUT" });
    }
    throw new OdooRpcError(e instanceof Error ? e.message : "Odoo network error", {
      errorName: "NETWORK",
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new OdooRpcError(`HTTP ${res.status} from Odoo`, { httpStatus: res.status });
  }

  const json = (await res.json()) as JsonRpcResponse<T>;
  if (json.error) {
    // Odoo error payloads can carry a full Python traceback in `data.debug`.
    // Never forward that to MCP callers — surface only the short message
    // (and the exception's dotted name, for callers that want to branch on
    // error kind rather than message text).
    const msg = json.error.data?.message ?? json.error.message ?? "Odoo RPC error";
    throw new OdooRpcError(msg, { errorName: json.error.data?.name });
  }

  return json.result as T;
}

/**
 * Authenticates an Odoo login + API key against the external API.
 * Returns the numeric uid, or null if the credentials are invalid
 * (Odoo returns `false` for that case rather than an error).
 */
export async function rpcAuthenticate(login: string, apiKey: string): Promise<number | null> {
  const result = await rpcCall<number | false>("common", "authenticate", [
    ODOO_DB,
    login,
    apiKey,
    {},
  ]);
  return typeof result === "number" ? result : null;
}

/**
 * Runs a model method (search_read, read, ...) through `object.execute_kw`,
 * authenticated as `uid` with `apiKey`. Odoo applies that user's ACLs and
 * record rules exactly as it would for a session-based call.
 */
export async function rpcExecuteKw<T = unknown>(
  uid: number,
  apiKey: string,
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {},
): Promise<T> {
  return rpcCall<T>("object", "execute_kw", [
    ODOO_DB,
    uid,
    apiKey,
    model,
    method,
    args,
    kwargs,
  ]);
}

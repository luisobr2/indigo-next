/**
 * MCP bearer tokens are `<odoo_login>.<odoo_api_key>`.
 *
 * The token IS an Odoo credential pair, so verification is just an Odoo
 * authentication: the RPC then runs as that real person and Odoo's ACLs and
 * record rules apply unchanged, with no separate permission store to keep in
 * sync. Revoking access = deleting the API key in Odoo.
 *
 * Unlike the panel's own login (src/lib/odoo/client.ts, session-cookie
 * based, real password only), MCP tokens are verified against Odoo's
 * external API (src/lib/odoo/rpc.ts, `/jsonrpc`), which is the endpoint
 * that actually accepts an API key. There is no session cookie in this
 * flow — every subsequent tool call re-authenticates with the same
 * uid + apiKey pair via `execute_kw`.
 */
// Lazy import to allow loading in test environments that don't resolve @/ aliases
async function getRpc() {
  const { rpcAuthenticate, rpcExecuteKw } = await import("@/lib/odoo/rpc");
  return { rpcAuthenticate, rpcExecuteKw };
}

export interface McpIdentity {
  uid: number;
  login: string;
  groups: string[];
  /** Odoo API key, forwarded on every subsequent execute_kw call. */
  apiKey: string;
}

/**
 * The exact `res.groups.full_name` for `base.group_user` ("Access Rights"
 * technically, but Odoo's own category for it is "User types") in this
 * deployment — verified live against indigo-prod rather than assumed, since
 * full_name is "<Category> / <Group>" and the category naming isn't
 * documented anywhere stable. This surface is for the internal team only;
 * dealers authenticate as portal users in this deployment and must never
 * carry this group.
 */
const INTERNAL_USER_GROUP = "User types / Internal User";

/** True if this identity is an internal Odoo user (not a portal/dealer login). */
export function isInternalUser(groups: string[]): boolean {
  return groups.includes(INTERNAL_USER_GROUP);
}

export function parseBearer(header: string | null): { login: string; apiKey: string } | null {
  if (!header) return null;
  const raw = header.trim().replace(/^Bearer\s+/i, "").trim();
  // Split on the LAST dot: Odoo logins are emails and contain dots.
  const idx = raw.lastIndexOf(".");
  if (idx <= 0 || idx === raw.length - 1) return null;
  const login = raw.slice(0, idx);
  const apiKey = raw.slice(idx + 1);
  if (!login || !apiKey) return null;
  return { login, apiKey };
}

interface ResUsersRow {
  groups_id: number[];
}

interface ResGroupsRow {
  name: string;
  full_name?: string;
}

/**
 * A thrown OdooRpcError is "transient" — worth a 503 rather than a 401 —
 * when it never got a real answer from Odoo at all: our own timeout, a
 * network-level failure, or Odoo itself erroring at the HTTP level (5xx).
 * A bad login/API key never throws here (`common.authenticate` returns
 * `false`, see rpcAuthenticate) so anything else thrown is either this, or
 * a genuinely unexpected Odoo-side error we still don't want to mislabel
 * as "bad token" — see verifyMcpToken below for how each branch is used.
 * Duck-typed on `.name`/`.errorName`/`.httpStatus` (set by rpc.ts's
 * OdooRpcError) instead of `instanceof` so this module doesn't need a
 * top-level, always-evaluated import of rpc.ts just for a class reference.
 */
function isTransientOdooError(e: unknown): boolean {
  if (!(e instanceof Error) || e.name !== "OdooRpcError") return false;
  const err = e as Error & { errorName?: string; httpStatus?: number };
  if (err.errorName === "TIMEOUT" || err.errorName === "NETWORK") return true;
  return typeof err.httpStatus === "number" && err.httpStatus >= 500;
}

/**
 * Verifies an MCP bearer token against Odoo and returns the caller's
 * identity, or `null` if the credentials are genuinely invalid (bad key,
 * disabled user, deleted user). Errs closed on ambiguity: `null` becomes an
 * HTTP 401 in the route.
 *
 * Deliberately does NOT swallow a transient failure (Odoo down, timeout,
 * connection refused) into that same `null` — those are rethrown so the
 * route can answer 503 instead of telling someone their token is invalid
 * during an Odoo restart. See isTransientOdooError above.
 */
export async function verifyMcpToken(header: string | null): Promise<McpIdentity | null> {
  const pair = parseBearer(header);
  if (!pair) return null;
  const { rpcAuthenticate, rpcExecuteKw } = await getRpc();

  let uid: number | null;
  try {
    uid = await rpcAuthenticate(pair.login, pair.apiKey);
  } catch (e) {
    if (isTransientOdooError(e)) throw e;
    return null;
  }
  if (!uid) return null;

  try {
    const userRows = await rpcExecuteKw<ResUsersRow[]>(
      uid,
      pair.apiKey,
      "res.users",
      "read",
      [[uid], ["groups_id"]],
      {},
    );
    const user = userRows[0];
    if (!user) return null;

    const groupIds = user.groups_id ?? [];
    let groups: string[] = [];
    if (groupIds.length) {
      const groupRows = await rpcExecuteKw<ResGroupsRow[]>(
        uid,
        pair.apiKey,
        "res.groups",
        "read",
        [groupIds, ["name", "full_name"]],
        {},
      );
      groups = groupRows.map((g) => g.full_name ?? g.name);
    }

    return {
      uid,
      login: pair.login,
      groups,
      apiKey: pair.apiKey,
    };
  } catch (e) {
    if (isTransientOdooError(e)) throw e;
    // Disabled/deleted user between authenticate and this read, or any
    // other unexpected Odoo error reading identity — still "no identity".
    return null;
  }
}

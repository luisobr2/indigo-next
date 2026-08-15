import {
  McpServer,
  createMcpHandler,
  fromJsonSchema,
  type JsonSchemaType,
} from "@modelcontextprotocol/server";

import { verifyMcpToken, isInternalUser, type McpIdentity } from "@/lib/mcp/token";
import { checkRate, clientKeyFromHeaders } from "@/lib/mcp/rate-limit";
import { TOOL_DEFS, runTool } from "@/lib/mcp/tools";

export const runtime = "nodejs";

/** Kill switch: set MCP_ENABLED=true in Coolify to turn the server on.
 *  Absent (or anything other than "true") means DISABLED — the first
 *  production exposure of this endpoint must be a deliberate act, not a
 *  side effect of merging. See .env.example. */
function enabled(): boolean {
  return process.env.MCP_ENABLED === "true";
}

// Compiled once at module scope, not per request: fromJsonSchema() only
// caches internally when the schema carries an `$id` (ours don't), so
// recompiling all 6 tool schemas on every POST was 6 wasted ajv compiles
// per HTTP request for input that never changes between requests — only
// the caller's identity does, and that stays in the per-request handler
// closure below.
const COMPILED_TOOLS = TOOL_DEFS.map((def) => ({
  def,
  // TOOL_DEFS's own ToolDef.inputSchema type declares `properties` as
  // Record<string, unknown> (not the SDK's structural JsonSchemaType), and
  // fromJsonSchema's generic defaults to `unknown` — so both a cast on the
  // input and an explicit output type param are needed for the handler
  // below to see `args: Record<string, unknown>` rather than `unknown`.
  // The runtime value is unaffected either way: it's the same raw JSON
  // Schema object either way.
  inputSchema: fromJsonSchema<Record<string, unknown>>(def.inputSchema as JsonSchemaType),
}));

function buildServer(identity: McpIdentity): McpServer {
  const server = new McpServer({ name: "indigo-decors", version: "1.0.0" });
  for (const { def, inputSchema } of COMPILED_TOOLS) {
    server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema },
      async (args: Record<string, unknown>) => {
        const startedAt = Date.now();
        let ok = true;
        try {
          const data = await runTool(def.name, args ?? {}, identity);
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (e) {
          ok = false;
          const msg = e instanceof Error ? e.message : "[ERROR_ODOO] Error inesperado.";
          return {
            isError: true,
            content: [{ type: "text" as const, text: msg }],
          };
        } finally {
          // One structured line per tool call — the audit trail for a
          // surface whose entire premise is "a person asked an agent to
          // do this". Kept to one greppable JSON line, no multi-line
          // console.table/pretty-printing.
          console.log(
            JSON.stringify({
              ts: new Date().toISOString(),
              uid: identity.uid,
              login: identity.login,
              tool: def.name,
              args: args ?? {},
              ok,
              ms: Date.now() - startedAt,
            }),
          );
        }
      },
    );
  }
  return server;
}

export async function POST(req: Request): Promise<Response> {
  if (!enabled()) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "MCP deshabilitado." }, id: null },
      { status: 503 },
    );
  }

  // Rate limit BEFORE any Odoo call. This endpoint is reachable pre-auth,
  // and verifyMcpToken below always costs an Odoo round-trip (authenticate
  // + a res.groups read) even for a garbage bearer — production Odoo runs
  // single-threaded (workers=0, see CLAUDE.md sec. 7), shared by the
  // panel, the storefront and the dealer portal. A flood here must be
  // rejected in-process, not after it already reached Odoo.
  const rateLimitKey = clientKeyFromHeaders(req.headers);
  const rate = checkRate(rateLimitKey, Date.now());
  if (!rate.ok) {
    const retryAfterSeconds = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        ip: rateLimitKey,
        ok: false,
        reason: "rate_limited",
        retryAfterMs: rate.retryAfterMs,
      }),
    );
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32004, message: "Demasiadas solicitudes. Intenta de nuevo en unos segundos." },
        id: null,
      },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  let verified: McpIdentity | null;
  try {
    verified = await verifyMcpToken(req.headers.get("authorization"));
  } catch {
    // verifyMcpToken only ever throws for a transient Odoo-side failure
    // (timeout, connection refused, 5xx) — never for a genuinely bad
    // credential, which comes back as `null` below. Erring closed (no
    // tools without a verified identity) is right; mislabelling an Odoo
    // outage as "your token is bad" is not — that would send someone to
    // re-mint a fine API key while Odoo is mid-restart.
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32003, message: "[TRANSITORIO] Odoo no responde. Intenta de nuevo en unos segundos." },
        id: null,
      },
      { status: 503 },
    );
  }
  if (!verified) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Token invalido." }, id: null },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="indigo-mcp"' } },
    );
  }
  // Rebound to a `const` of the non-null type: TypeScript won't carry the
  // `!verified` narrowing above into the closure passed to createMcpHandler
  // below, since `verified` is a `let` that (as far as the checker can
  // tell) might be reassigned before that closure runs.
  const identity: McpIdentity = verified;

  // This surface is for the internal team, not dealers — who authenticate
  // as Odoo portal users in this deployment and must never reach it, even
  // though their API key/login pair authenticates cleanly above (that
  // step only proves the credential is real, not who's allowed to hold
  // MCP tools).
  if (!isInternalUser(identity.groups)) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32002, message: "[PERMISO_DENEGADO] Esta cuenta no tiene acceso al servidor MCP." },
        id: null,
      },
      { status: 403 },
    );
  }

  const handler = createMcpHandler(() => buildServer(identity));
  return handler.fetch(req);
}

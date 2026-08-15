import {
  McpServer,
  createMcpHandler,
  fromJsonSchema,
  type JsonSchemaType,
} from "@modelcontextprotocol/server";

import { verifyMcpToken, type McpIdentity } from "@/lib/mcp/token";
import { TOOL_DEFS, runTool } from "@/lib/mcp/tools";

export const runtime = "nodejs";

/** Kill switch: set MCP_ENABLED=false in Coolify to turn the server off
 *  without a deploy. Absent means enabled. */
function enabled(): boolean {
  return process.env.MCP_ENABLED !== "false";
}

function buildServer(identity: McpIdentity): McpServer {
  const server = new McpServer({ name: "indigo-decors", version: "1.0.0" });
  for (const def of TOOL_DEFS) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        // TOOL_DEFS's own ToolDef.inputSchema type declares `properties` as
        // Record<string, unknown> (not the SDK's structural JsonSchemaType),
        // and fromJsonSchema's generic defaults to `unknown` — so both a cast
        // on the input and an explicit output type param are needed for the
        // handler below to see `args: Record<string, unknown>` rather than
        // `unknown`. The runtime value is unaffected either way: it's the
        // same raw JSON Schema object either way.
        inputSchema: fromJsonSchema<Record<string, unknown>>(def.inputSchema as JsonSchemaType),
      },
      async (args: Record<string, unknown>) => {
        try {
          const data = await runTool(def.name, args ?? {}, identity);
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Error";
          return {
            isError: true,
            content: [{ type: "text" as const, text: msg }],
          };
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
  const identity = await verifyMcpToken(req.headers.get("authorization"));
  if (!identity) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Token invalido." }, id: null },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="indigo-mcp"' } },
    );
  }
  const handler = createMcpHandler(() => buildServer(identity));
  return handler.fetch(req);
}

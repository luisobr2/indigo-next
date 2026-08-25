/**
 * RFC 9728 — Protected Resource Metadata.
 *
 * Es la primera puerta que toca un cliente MCP: le dice "este recurso esta
 * protegido, y quien emite sus tokens es aquel". Servido tambien en
 * `/.well-known/oauth-protected-resource/api/mcp`, porque la especificacion
 * manda insertar el path del recurso despues del `.well-known` y los clientes
 * prueban las dos formas (ver los rewrites en next.config.ts).
 */
import { NextResponse } from "next/server";
import { issuerFrom, mcpResource } from "@/lib/mcp/oauth-issuer";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return NextResponse.json(
    {
      resource: mcpResource(req),
      authorization_servers: [issuerFrom(req)],
      bearer_methods_supported: ["header"],
      scopes_supported: ["indigo:mcp"],
      resource_documentation: `${issuerFrom(req)}/api/mcp`,
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}

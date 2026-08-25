/**
 * RFC 8414 — Authorization Server Metadata.
 *
 * El panel es su propio servidor de autorizacion: no hay un Auth0 en el medio,
 * y no hace falta, porque la unica fuente de verdad sobre quien es quien ya es
 * Odoo. Este documento es el que le dice al cliente donde registrarse, donde
 * mandar al usuario y donde canjear el codigo.
 *
 * `code_challenge_methods_supported` es solo S256 a proposito: OAuth 2.1
 * prohibe `plain`, y anunciarlo invitaria a un cliente a usarlo.
 */
import { NextResponse } from "next/server";
import { issuerFrom } from "@/lib/mcp/oauth-issuer";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const issuer = issuerFrom(req);
  return NextResponse.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/api/oauth/authorize`,
      token_endpoint: `${issuer}/api/oauth/token`,
      registration_endpoint: `${issuer}/api/oauth/register`,
      scopes_supported: ["indigo:mcp"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}

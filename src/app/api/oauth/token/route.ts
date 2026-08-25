/**
 * Canje del codigo por un token, y renovacion.
 *
 * No hay autenticacion de cliente (`token_endpoint_auth_method: none`): los
 * clientes MCP son publicos —una app de escritorio no puede guardar un secreto—
 * y por eso PKCE no es opcional aqui. Lo que ata el canje a quien inicio el
 * flujo es el `code_verifier`, no un secreto de cliente.
 */
import { NextResponse } from "next/server";

import {
  ACCESS_TOKEN_TTL_SECONDS,
  issueAccessToken,
  issueRefreshToken,
  readAuthCode,
  readRefreshToken,
  verifyPkce,
} from "@/lib/mcp/oauth";

export const runtime = "nodejs";

function oauthError(code: string, description: string, status = 400) {
  return NextResponse.json(
    { error: code, error_description: description },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function tokenResponse(login: string, apiKey: string, now: number) {
  return NextResponse.json(
    {
      access_token: issueAccessToken({ login, apiKey }, now),
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: issueRefreshToken({ login, apiKey }, now),
      scope: "indigo:mcp",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Acepta form-urlencoded (lo que manda el RFC) y tambien JSON, que es lo que
 *  envian algunos clientes MCP pese a la especificacion. */
async function readBody(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      const j = (await req.json()) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v ?? "")]));
    } catch {
      return {};
    }
  }
  const form = await req.formData();
  return Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, String(v)]));
}

export async function POST(req: Request) {
  const body = await readBody(req);
  const now = Date.now();

  if (body.grant_type === "refresh_token") {
    const cred = readRefreshToken(body.refresh_token, now);
    if (!cred) {
      return oauthError("invalid_grant", "El refresh token no es valido o caduco.");
    }
    // No se comprueba nada contra Odoo aqui: si la clave API que lleva dentro
    // fue revocada, el token nuevo se emitira igual y morira en la primera
    // llamada al MCP, que es donde Odoo la valida. Ir a preguntarle a Odoo en
    // cada renovacion costaria una llamada mas al unico worker que tiene, y no
    // cambiaria el resultado: solo adelantaria el mismo fallo.
    return tokenResponse(cred.login, cred.apiKey, now);
  }

  if (body.grant_type !== "authorization_code") {
    return oauthError(
      "unsupported_grant_type",
      "Solo se admiten authorization_code y refresh_token.",
    );
  }

  const code = readAuthCode(body.code, now);
  if (!code) {
    return oauthError("invalid_grant", "El codigo no es valido o ya caduco.");
  }

  // El codigo esta atado al cliente y al destino con los que se pidio. Sin
  // esto, un codigo interceptado podria canjearse desde otro cliente.
  if (body.client_id && body.client_id !== code.clientId) {
    return oauthError("invalid_grant", "El codigo pertenece a otro cliente.");
  }
  if (body.redirect_uri && body.redirect_uri !== code.redirectUri) {
    return oauthError("invalid_grant", "redirect_uri no coincide con la del codigo.");
  }

  if (!verifyPkce(body.code_verifier ?? "", code.codeChallenge, "S256")) {
    return oauthError("invalid_grant", "code_verifier incorrecto.");
  }

  return tokenResponse(code.login, code.apiKey, now);
}

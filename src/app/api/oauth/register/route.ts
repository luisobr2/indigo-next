/**
 * RFC 7591 — Dynamic Client Registration.
 *
 * Un cliente MCP no se da de alta a mano: la primera vez que alguien conecta
 * Claude Desktop, el propio cliente se registra aqui y se lleva un client_id.
 *
 * No se guarda nada. El client_id ES el registro cifrado (ver ../../../lib/mcp/oauth.ts):
 * lo unico que hay que recordar de un cliente son sus redirect_uris, y las
 * lleva puestas. Sin tabla no hay tabla que crezca, ni que limpiar, ni que se
 * pierda en un despliegue.
 *
 * El endpoint es abierto, como manda el perfil de MCP. Eso NO es una puerta:
 * registrarse no da acceso a nada. Para conseguir un token hay que pasar
 * despues por /authorize y escribir un usuario y una contrasena de Odoo.
 */
import { NextResponse } from "next/server";

import { issueClientId } from "@/lib/mcp/oauth";

export const runtime = "nodejs";

/** Cota al tamano del registro. Como el registro viaja dentro del client_id,
 *  un cliente que declarara cien URIs kilometricas se fabricaria un
 *  identificador enorme que despues tendria que viajar en cada peticion. */
const MAX_URIS = 10;
const MAX_URI_LENGTH = 512;

function badRequest(description: string) {
  return NextResponse.json(
    { error: "invalid_client_metadata", error_description: description },
    { status: 400 },
  );
}

export async function POST(req: Request) {
  let body: { redirect_uris?: unknown; client_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return badRequest("El cuerpo no es JSON valido.");
  }

  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) {
    return badRequest("redirect_uris es obligatorio y no puede venir vacio.");
  }
  if (uris.length > MAX_URIS) {
    return badRequest(`Como maximo ${MAX_URIS} redirect_uris.`);
  }

  const clean: string[] = [];
  for (const u of uris) {
    if (typeof u !== "string" || u.length > MAX_URI_LENGTH) {
      return badRequest("Cada redirect_uri debe ser una cadena razonable.");
    }
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      return badRequest(`redirect_uri invalida: ${u}`);
    }
    // http solo para el bucle local (RFC 8252): un cliente de escritorio abre
    // un servidor en 127.0.0.1 para recibir el codigo. Para cualquier otro
    // host, http significa que el codigo viaja en claro por la red.
    const isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
      return badRequest(
        "Solo se admiten redirect_uris https, o http contra 127.0.0.1 / localhost.",
      );
    }
    clean.push(u);
  }

  const name =
    typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim().slice(0, 60)
      : "MCP client";

  const now = Date.now();
  const clientId = issueClientId({ client_name: name, redirect_uris: clean }, now);

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: name,
      redirect_uris: clean,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      // 0 = no caduca, en el sentido del RFC. Caduca de verdad (un ano, ver
      // issueClientId), pero anunciarlo haria que algunos clientes intentaran
      // renovar por un camino que no implementamos; volver a registrarse les
      // cuesta una llamada y lo hacen solos cuando el id deja de valer.
      client_id_issued_at: Math.floor(now / 1000),
      client_secret_expires_at: 0,
    },
    { status: 201 },
  );
}

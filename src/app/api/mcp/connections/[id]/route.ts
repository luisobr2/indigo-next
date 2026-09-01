/**
 * Desconectar una aplicacion del asistente.
 *
 * Va contra el metodo del addon y no contra `unlink` directo porque Odoo no
 * deja a nadie borrar sus propias claves API: `res.users.apikeys` no da unlink
 * a ningun grupo. El addon acota el borrado a "claves de MCP del que llama"
 * antes de elevar (ver models/res_users_mcp_key.py).
 *
 * Se llama con la SESION de la persona, asi que `env.user` dentro del addon es
 * ella: el limite lo pone Odoo, no este archivo. Aunque alguien manipulara el
 * id de la URL, el filtro del addon no encontraria una clave ajena.
 */
import { NextResponse } from "next/server";

import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id } = await context.params;
    const keyId = Number(id);
    if (!Number.isFinite(keyId)) {
      return NextResponse.json({ error: "Id invalido" }, { status: 400 });
    }

    const ok = await call<boolean>({
      session: s.session,
      model: "res.users",
      method: "indigo_mcp_revoke_key",
      args: [keyId],
      kwargs: {},
    });

    if (!ok) {
      // El addon devuelve false tanto si la clave no existe como si es de otra
      // persona. Se responde igual en los dos casos a proposito: distinguirlos
      // convertiria esto en una forma de averiguar que ids existen.
      return NextResponse.json(
        { error: "Esa conexion ya no existe." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

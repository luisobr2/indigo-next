/**
 * Las conexiones del asistente que tiene ABIERTAS la persona que mira.
 *
 * Es lo que convierte la pantalla del asistente en una pantalla y no en un
 * instructivo: responde "¿estoy conectado?" con datos de la cuenta de quien
 * pregunta, no con una explicacion generica.
 *
 * Lee `res.users.apikeys` como esa persona (no con sudo): Odoo ya permite que
 * cada quien lea las suyas, y hacerlo con su sesion garantiza que nadie vea
 * las de otro aunque este endpoint se equivoque en el filtro.
 */
import { NextResponse } from "next/server";

import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/** Prefijo con el que el flujo OAuth nombra las claves que emite. Tiene que
 *  coincidir con MCP_KEY_PREFIX del addon (models/res_users_mcp_key.py). */
const MCP_KEY_PREFIX = "MCP OAuth";

interface ApiKeyRow {
  id: number;
  name: string;
  create_date: string;
}

export async function GET() {
  try {
    const s = await requireSession();

    const rows = await call<ApiKeyRow[]>({
      session: s.session,
      model: "res.users.apikeys",
      method: "search_read",
      args: [
        [
          ["user_id", "=", s.user.id],
          ["name", "=like", `${MCP_KEY_PREFIX}%`],
        ],
        ["id", "name", "create_date"],
      ],
      kwargs: { order: "create_date desc" },
    });

    return NextResponse.json({
      // El interruptor del servidor. La pantalla lo usa para no explicar como
      // conectarse a algo que esta apagado.
      enabled: process.env.MCP_ENABLED === "true",
      connections: rows.map((r) => ({
        id: r.id,
        // "MCP OAuth - Claude" -> "Claude". El prefijo es contabilidad
        // interna; a quien mira le importa QUE aplicacion es.
        client: r.name.replace(new RegExp(`^${MCP_KEY_PREFIX}\\s*-\\s*`), "").trim() || "Sin nombre",
        createdAt: r.create_date,
      })),
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/** Tipos de aviso, en el orden en que ocurren. Espeja
 *  indigo.order.CLIENT_NOTIFY_KINDS; Odoo vuelve a validarlo, esto solo
 *  evita un viaje de ida y vuelta para un typo. */
const KINDS = [
  "received",
  "production",
  "ready",
  "scheduled",
  "completed",
] as const;
type Kind = (typeof KINDS)[number];

/**
 * GET /api/orders/[id]/notify
 *   → { email, name, source: "order" | "dealer" | "none", dealer_name }
 *
 * Quién recibiría el aviso, para enseñarlo en el formulario ANTES de
 * mandarlo. La resolución la hace Odoo (get_client_notify_recipient) a
 * propósito: si el panel la recalculara leyendo el partner por su cuenta,
 * las dos reglas acabarían divergiendo y la pantalla diría una dirección
 * mientras el correo sale a otra.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await params;
    const orderId = parseInt(idStr, 10);
    if (!Number.isFinite(orderId)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }
    const res = await call({
      session: s.session,
      model: "indigo.order",
      method: "get_client_notify_recipient",
      args: [[orderId]],
      kwargs: {},
    });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Could not read the recipient";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/**
 * POST /api/orders/[id]/notify
 *   body: { kind: Kind, note?: string, email_to?: string }
 *
 * Manda UN aviso al dealer y lo anota en el chatter de la orden. Es el
 * equivalente de las "acciones de pedido" de WooCommerce: el operador
 * elige qué mandar y a quién, en lugar de que el sistema lo decida.
 *
 * Todo el trabajo lo hace indigo.order.action_notify_client(): resuelve el
 * destinatario, renderiza, envía, VERIFICA que el mail salió de verdad y
 * deja la anotación. Esta ruta solo traduce HTTP a esa llamada.
 *
 * Manager / office, la misma puerta que el resto de acciones de la orden.
 * La comprobación de aquí es comodidad de UX: Odoo no la sustituye — el
 * método es callable y quien no tenga permiso de escritura sobre la orden
 * choca contra las ACL igual.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: idStr } = await params;
    const orderId = parseInt(idStr, 10);
    if (!Number.isFinite(orderId)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      kind?: string;
      note?: string;
      email_to?: string;
    };

    const kind = body.kind as Kind | undefined;
    if (!kind || !KINDS.includes(kind)) {
      return NextResponse.json(
        { error: `Invalid notification kind. Valid: ${KINDS.join(", ")}` },
        { status: 400 },
      );
    }

    // Un destinatario escrito a mano se valida aquí antes de gastar un viaje
    // a Odoo: el error más probable de este formulario es un correo mal
    // tecleado, y decirlo al instante es mejor que un round-trip.
    const emailTo = (body.email_to || "").trim();
    if (emailTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) {
      return NextResponse.json(
        { error: `"${emailTo}" does not look like a valid email address.` },
        { status: 400 },
      );
    }

    await call({
      session: s.session,
      model: "indigo.order",
      method: "action_notify_client",
      args: [[orderId], kind],
      kwargs: {
        note: (body.note || "").trim() || null,
        email_to: emailTo || null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    // El texto de UserError de Odoo llega intacto por OdooError.message y ya
    // está escrito para leerse ("La orden IND/... no tiene a quien avisar:
    // ni el cliente ni el dealer tienen correo"), así que se muestra tal cual.
    const msg = e instanceof Error ? e.message : "Could not send the notification";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * POST /api/orders/[id]/send-to-designer
 *   body: { designer_id?: number }
 *
 * Drives indigo.order.action_send_to_designer(): renders the Ficha de
 * orden, attaches it to the order, emails it to the assigned designer,
 * and advances the order to CNC. This is THE fix for Majela's
 * 2026-08-15 request -- see docs/majela/audio-1-digitalizacion.md --
 * the stage itself now answers "is this done?": still in Digitalization
 * = not sent; in CNC = sent.
 *
 * When `designer_id` is passed, it's written first (this doubles as the
 * "designer selector" -- picking someone and pressing Send in one step).
 * Office/manager/admin only, same gate as the Odoo action itself
 * (indigo.order._indigo_assert_can_send_to_designer) -- this route check
 * is a UX convenience, not a substitute; Odoo enforces it again.
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
      designer_id?: number | null;
    };

    if (body.designer_id != null) {
      const designerId = Number(body.designer_id);
      if (!Number.isFinite(designerId)) {
        return NextResponse.json(
          { error: "Invalid designer_id" },
          { status: 400 },
        );
      }
      await call({
        session: s.session,
        model: "indigo.order",
        method: "write",
        args: [[orderId], { designer_id: designerId }],
        kwargs: {},
      });
    }

    await call({
      session: s.session,
      model: "indigo.order",
      method: "action_send_to_designer",
      args: [[orderId]],
      kwargs: {},
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    // Odoo's UserError/AccessError text flows through client.ts's
    // OdooError.message untouched (see json.error.data?.message) -- e.g.
    // "Asigna un disenador antes de enviar la orden a digitalizar." --
    // plain Spanish, safe to show directly, no JSON for her to read.
    const msg =
      e instanceof Error ? e.message : "Error al enviar la orden al diseñador";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

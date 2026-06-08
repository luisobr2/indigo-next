import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * POST /api/orders/:id/assign
 *
 * Assigns painter (single) and/or installers (many) on the order.
 * Triggers Odoo's stage-change hook IF the order is past the painting
 * stage when the assignment lands, so a late assignment still produces
 * the payout chain.
 *
 * Body: { painter_id?: number | null; installer_ids?: number[] }
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await context.params;
    const orderId = Number(idStr);
    if (!Number.isFinite(orderId)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }

    const body = (await req.json()) as {
      painter_id?: number | null;
      installer_ids?: number[];
    };

    const vals: Record<string, unknown> = {};
    if ("painter_id" in body) {
      vals.painter_id = body.painter_id || false;
    }
    if (Array.isArray(body.installer_ids)) {
      // Odoo many2many command: replace with new set.
      vals.installer_ids = [[6, 0, body.installer_ids]];
    }

    if (!Object.keys(vals).length) {
      return NextResponse.json(
        { error: "Nothing to update" },
        { status: 400 },
      );
    }

    await call({
      session: s.session,
      model: "indigo.order",
      method: "write",
      args: [[orderId], vals],
      kwargs: {},
    });

    // Manual chatter so the assignment is visible in the timeline.
    await call({
      session: s.session,
      model: "indigo.order",
      method: "message_post",
      args: [[orderId]],
      kwargs: {
        body: "Painter / installer assignment updated from Next panel.",
        message_type: "comment",
      },
    }).catch(() => undefined);

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

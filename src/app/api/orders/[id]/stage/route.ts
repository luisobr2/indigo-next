import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * POST /api/orders/:id/stage
 *
 * Direct stage write for the Kanban drag-drop. Bypasses the wizard
 * machinery — the user explicitly chose to skip the wizard by dragging
 * the card.
 *
 * The order's tracking + chatter still record the move because Odoo
 * fires the `track_visibility` on `stage_id`. We also leave a manual
 * chatter note so it shows up as a human-readable line.
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

    const body = (await req.json()) as { stage_id?: number };
    const stageId = Number(body.stage_id);
    if (!Number.isFinite(stageId)) {
      return NextResponse.json(
        { error: "stage_id required" },
        { status: 400 },
      );
    }

    await call({
      session: s.session,
      model: "indigo.order",
      method: "write",
      args: [[orderId], { stage_id: stageId }],
      kwargs: {},
    });

    // Manual chatter so the move is easy to spot in the timeline.
    await call({
      session: s.session,
      model: "indigo.order",
      method: "message_post",
      args: [[orderId]],
      kwargs: {
        body: "Stage changed from Kanban drag-drop.",
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

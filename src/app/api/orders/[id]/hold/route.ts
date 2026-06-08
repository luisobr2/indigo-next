import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * POST /api/orders/[id]/hold
 *   body: { reason?: string, release?: boolean }
 *
 * Toggle the order's on_hold flag + record a chatter note with the reason.
 * `release: true` clears the hold.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    const body = await req.json();
    const release = !!body.release;
    const reason = (body.reason ?? "").toString().trim();

    await call({
      session: s.session,
      model: "indigo.order",
      method: "write",
      args: [
        [id],
        {
          on_hold: !release,
          hold_reason: release ? false : reason || false,
        },
      ],
      kwargs: {},
    });

    const note = release
      ? "Order released from hold."
      : reason
        ? `Moved to hold — <b>${reason}</b>`
        : "Moved to hold.";

    await call({
      session: s.session,
      model: "indigo.order",
      method: "message_post",
      args: [[id]],
      kwargs: { body: note },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

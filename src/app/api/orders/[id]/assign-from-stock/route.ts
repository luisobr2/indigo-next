import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * POST /api/orders/:id/assign-from-stock
 *
 * Consumes a stock entry into this order:
 *   - Marks the stock order's `reused_in_order_id` to this id.
 *   - Sets this order's stage to "ready_install" so it skips CNC/Paint.
 *   - Posts a chatter note on both orders linking them.
 *
 * Body: { stockOrderId: number }
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await context.params;
    const targetId = Number(idStr);
    if (!Number.isFinite(targetId)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }
    const body = (await req.json()) as { stockOrderId?: number };
    const stockOrderId = Number(body.stockOrderId);
    if (!Number.isFinite(stockOrderId)) {
      return NextResponse.json({ error: "stockOrderId required" }, { status: 400 });
    }

    // Look up the ready_install stage id once.
    const stages = await call<Array<{ id: number; code: string }>>({
      session: s.session,
      model: "indigo.stage",
      method: "search_read",
      args: [[["code", "=", "ready_install"]], ["id", "code"]],
      kwargs: { limit: 1 },
    });
    const readyStageId = stages[0]?.id;

    // 1. Mark stock entry as consumed.
    await call({
      session: s.session,
      model: "indigo.order",
      method: "write",
      args: [[stockOrderId], { reused_in_order_id: targetId }],
      kwargs: {},
    });

    // 2. Jump target to Ready for Installation (skip production stages).
    if (readyStageId) {
      await call({
        session: s.session,
        model: "indigo.order",
        method: "write",
        args: [[targetId], { stage_id: readyStageId }],
        kwargs: {},
      });
    }

    // 3. Chatter links on both orders.
    const [target] = await call<Array<{ name: string }>>({
      session: s.session,
      model: "indigo.order",
      method: "read",
      args: [[targetId], ["name"]],
      kwargs: {},
    });
    const [stockOrder] = await call<Array<{ name: string }>>({
      session: s.session,
      model: "indigo.order",
      method: "read",
      args: [[stockOrderId], ["name"]],
      kwargs: {},
    });
    await call({
      session: s.session,
      model: "indigo.order",
      method: "message_post",
      args: [[targetId]],
      kwargs: {
        body: `Assigned from Available Stock — pulled door from ${stockOrder?.name ?? `#${stockOrderId}`}. Skipped production, ready for installation.`,
        message_type: "comment",
      },
    }).catch(() => undefined);
    await call({
      session: s.session,
      model: "indigo.order",
      method: "message_post",
      args: [[stockOrderId]],
      kwargs: {
        body: `Consumed by ${target?.name ?? `#${targetId}`}.`,
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

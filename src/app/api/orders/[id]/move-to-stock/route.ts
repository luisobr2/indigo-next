import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * POST /api/orders/:id/move-to-stock
 *
 * Marks the order as `is_stock=true` and stamps stock_at + label + reason.
 * Used by the Cancel modal when the user picks "Move to Available Stock"
 * instead of a hard discard.
 *
 * Body: { label?: string, reason?: string }
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

    const body = (await req.json()) as { label?: string; reason?: string };
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    // Fetch the current client_name so we can preserve it as
    // original_client_name (we don't want it to silently drift if someone
    // edits the order later).
    const [current] = await call<Array<{ client_name: string }>>({
      session: s.session,
      model: "indigo.order",
      method: "read",
      args: [[orderId], ["client_name"]],
      kwargs: {},
    });

    await call({
      session: s.session,
      model: "indigo.order",
      method: "write",
      args: [
        [orderId],
        {
          is_stock: true,
          stock_at: now,
          stock_label: body.label || "",
          stock_reason: body.reason || "",
          original_client_name: current?.client_name ?? "",
          cancelled_at: now,
          cancellation_reason:
            body.reason || "Moved to available stock — finished door retained.",
        },
      ],
      kwargs: {},
    });

    const msg = `Moved to Available Stock${body.label ? ` as "${body.label}"` : ""}.${body.reason ? ` Reason: ${body.reason}` : ""}`;
    await call({
      session: s.session,
      model: "indigo.order",
      method: "message_post",
      args: [[orderId]],
      kwargs: { body: msg, message_type: "comment" },
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

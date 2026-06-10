import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * POST /api/orders/:id/substatus
 *
 * Sets the `<stage>_started_at` / `<stage>_done_at` timestamps that
 * represent the sub-status of an order within a stage. Used by the new
 * stage screens to render the "Ready → In Progress → Completed" tabs.
 *
 * Body shape:
 *   { stage: "digi" | "cnc" | "paint",
 *     action: "start" | "done" | "reset" }
 *   or
 *   { action: "cancel", reason?: string }
 *   or
 *   { action: "restore" } -- clears cancelled_at
 *
 * `done` implies `started_at` too (so an order can jump straight to
 * Completed without going through In Progress).
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    // Sub-status writes (cancel/restore/done timestamps) are an
    // office/manager-only action. Specialists (CNC, Paint, Install)
    // mark their step via the wizard flow which has its own ACL on
    // the Odoo side.
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: idStr } = await context.params;
    const orderId = Number(idStr);
    if (!Number.isFinite(orderId)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }

    const body = (await req.json()) as {
      stage?: "digi" | "cnc" | "paint";
      action: "start" | "done" | "reset" | "cancel" | "restore";
      reason?: string;
    };

    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const vals: Record<string, unknown> = {};
    let chatterMsg = "";

    if (body.action === "cancel") {
      vals.cancelled_at = now;
      if (body.reason) vals.cancellation_reason = body.reason;
      chatterMsg = body.reason
        ? `Order cancelled: ${body.reason}`
        : "Order cancelled.";
    } else if (body.action === "restore") {
      vals.cancelled_at = false;
      vals.cancellation_reason = false;
      chatterMsg = "Cancellation reverted.";
    } else if (body.stage) {
      const prefix = body.stage;
      if (body.action === "start") {
        vals[`${prefix}_started_at`] = now;
        vals[`${prefix}_done_at`] = false;
        chatterMsg = `Sub-status: ${prefix} started.`;
      } else if (body.action === "done") {
        vals[`${prefix}_done_at`] = now;
        vals[`${prefix}_started_at`] = now;
        chatterMsg = `Sub-status: ${prefix} completed.`;
      } else if (body.action === "reset") {
        vals[`${prefix}_started_at`] = false;
        vals[`${prefix}_done_at`] = false;
        chatterMsg = `Sub-status: ${prefix} reset to Ready.`;
      } else {
        return NextResponse.json({ error: "Bad action" }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: "Missing stage" }, { status: 400 });
    }

    await call({
      session: s.session,
      model: "indigo.order",
      method: "write",
      args: [[orderId], vals],
      kwargs: {},
    });

    if (chatterMsg) {
      await call({
        session: s.session,
        model: "indigo.order",
        method: "message_post",
        args: [[orderId]],
        kwargs: { body: chatterMsg, message_type: "comment" },
      }).catch(() => undefined);
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

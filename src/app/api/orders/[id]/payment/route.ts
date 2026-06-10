import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

const ALLOWED_STATES = new Set(["unpaid", "partial", "paid"]);

/**
 * POST /api/orders/:id/payment
 *
 * Updates `payment_state` on an indigo.order. Separate from the generic
 * PUT endpoint because:
 *   - PUT's allow-list deliberately excludes payment_state — only
 *     Billing and the order-detail "Mark as Paid" button should touch it.
 *   - Role check is stricter (manager / office / admin only).
 *   - We write a chatter note so the change is auditable.
 *
 * Body: { state: "unpaid" | "partial" | "paid" }
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
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = (await req.json()) as { state?: string };
    const state = (body.state || "").trim().toLowerCase();
    if (!ALLOWED_STATES.has(state)) {
      return NextResponse.json(
        { error: "state must be unpaid | partial | paid" },
        { status: 400 },
      );
    }
    await call<boolean>({
      session: s.session,
      model: "indigo.order",
      method: "write",
      args: [[id], { payment_state: state }],
      kwargs: {},
    });
    // Plain-text chatter note so the audit trail mentions who marked it
    // — Odoo's mail.thread auto-stamps the author from the session user.
    try {
      await call({
        session: s.session,
        model: "indigo.order",
        method: "message_post",
        args: [[id]],
        kwargs: {
          body: `Payment state set to <strong>${state}</strong>`,
          message_type: "comment",
          subtype_xmlid: "mail.mt_note",
        },
      });
    } catch {
      // Chatter note is best-effort; don't fail the write if it errors.
    }
    return NextResponse.json({ ok: true, state });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error updating payment";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

const escapeHtml = (str: string) =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const HOLD_CAUSES = new Set(["dealer", "client", "other"]);
const HOLD_CAUSE_LABEL: Record<string, string> = {
  dealer: "Dealer",
  client: "Client",
  other: "Other / unclassified",
};

/**
 * POST /api/orders/[id]/hold
 *   body: { reason?: string, release?: boolean, cause?: "dealer" | "client" | "other" }
 *
 * Toggle the order's on_hold flag + record a chatter note with the reason.
 * `release: true` clears the hold. `cause` is REQUIRED when setting a hold
 * (release ignores it) — indigo.order's own constraint rejects an on_hold
 * write with no hold_cause (Majela's 2026-08-15 request, item 3: a hold
 * with no cause can't be counted or colored on the Installations screen),
 * so this checks it up front for a clean 400 instead of a raw Odoo error.
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
    const body = await req.json();
    const release = !!body.release;
    const reason = (body.reason ?? "").toString().trim();
    const cause = (body.cause ?? "").toString().trim();

    if (!release && !HOLD_CAUSES.has(cause)) {
      // Spanish on purpose: this mirrors indigo.order's own Spanish
      // _check_hold_requires_cause ValidationError (models/indigo_order.py)
      // and the hold_order MCP tool's guard, so whichever path a hold
      // request takes, Majela sees the same readable sentence -- never a
      // raw Odoo traceback.
      return NextResponse.json(
        { error: "Selecciona una causa (Dealer / Cliente / Otro) antes de poner la orden en espera." },
        { status: 400 },
      );
    }

    await call({
      session: s.session,
      model: "indigo.order",
      method: "write",
      args: [
        [id],
        {
          on_hold: !release,
          hold_cause: release ? false : cause,
          hold_reason: release ? false : reason || false,
        },
      ],
      kwargs: {},
    });

    const note = release
      ? "Order released from hold."
      : reason
        ? `Moved to hold (${escapeHtml(HOLD_CAUSE_LABEL[cause])}) — <b>${escapeHtml(reason)}</b>`
        : `Moved to hold (${escapeHtml(HOLD_CAUSE_LABEL[cause])}).`;

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

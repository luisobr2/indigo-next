import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

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
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: idStr } = await context.params;
    const orderId = Number(idStr);
    if (!Number.isFinite(orderId)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }

    const body = (await req.json()) as {
      stage_id?: number;
      note?: string;
      source?: string;
    };
    const stageId = Number(body.stage_id);
    if (!Number.isFinite(stageId)) {
      return NextResponse.json(
        { error: "stage_id required" },
        { status: 400 },
      );
    }

    // Verify the stage exists before writing — Odoo's write would silently
    // store a dangling id otherwise.
    const stages = await call<Array<{ id: number; name: string; code: string }>>({
      session: s.session,
      model: "indigo.stage",
      method: "search_read",
      args: [[["id", "=", stageId]], ["id", "name", "code"]],
      kwargs: { limit: 1 },
    });
    const stage = stages[0];
    if (!stage) {
      return NextResponse.json(
        { error: `Stage ${stageId} not found` },
        { status: 404 },
      );
    }

    const noteText = (body.note ?? "").trim();

    // If the user typed a note, append it to the order's `notes` field (a dated
    // log, newest first) so it shows in the prominent "Note" card — that's
    // where Majela looks for the notes she writes when moving an order.
    const writeVals: Record<string, unknown> = { stage_id: stageId };
    if (noteText) {
      const cur = await call<Array<{ notes: string | false }>>({
        session: s.session,
        model: "indigo.order",
        method: "read",
        args: [[orderId], ["notes"]],
        kwargs: {},
      });
      const existing = (cur[0]?.notes || "") as string;
      const dateStr = new Date().toLocaleDateString("en-US");
      const line = `${dateStr} (→ ${stage.name}): ${noteText}`;
      writeVals.notes = existing ? `${line}\n${existing}` : line;
    }
    await call({
      session: s.session,
      model: "indigo.order",
      method: "write",
      args: [[orderId], writeVals],
      kwargs: {},
    });

    // Chatter line — plain text. Odoo turns it into clean HTML; passing our own
    // <b>/<i> tags got double-escaped and showed the raw tags to the user.
    const sourceLabel = body.source ? ` (${body.source})` : "";
    const baseLine = `Sent to ${stage.name}${sourceLabel}.`;
    const chatterBody = noteText ? `${baseLine}\n${noteText}` : baseLine;
    await call({
      session: s.session,
      model: "indigo.order",
      method: "message_post",
      args: [[orderId]],
      kwargs: {
        body: chatterBody,
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

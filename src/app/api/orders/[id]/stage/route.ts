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

    await call({
      session: s.session,
      model: "indigo.order",
      method: "write",
      args: [[orderId], { stage_id: stageId }],
      kwargs: {},
    });

    // Chatter line. Escape user-controlled bits so a note containing
    // `<script>` or a stage name with `<>` can't break out into HTML.
    const escapeHtml = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const stageName = escapeHtml(stage?.name ?? "stage");
    const sourceLabel = body.source ? ` (${escapeHtml(body.source)})` : "";
    const baseLine = `Sent to <b>${stageName}</b>${sourceLabel}.`;
    const chatterBody = body.note
      ? `${baseLine} <br/><i>${escapeHtml(body.note)}</i>`
      : baseLine;
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

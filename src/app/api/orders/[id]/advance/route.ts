import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * Trigger an Odoo stage-advance wizard from the Next UI.
 *
 *   body = {
 *     wizard:  "indigo.painter.done.wizard",
 *     payload: {                                  // wizard field values
 *       note?:      "Optional chatter note",
 *       photo?:     "<base64 photo data, no prefix>",
 *       signature?: "<base64 PNG signature, no prefix>",
 *     }
 *   }
 *
 * Mirror of the buttons in the Odoo order form header: create the
 * wizard with the right payload, then `action_save_and_advance` does
 * the stage move + chatter post + attachments + payouts in one go.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await params;
    const orderId = parseInt(idStr, 10);
    const body = await req.json();
    const wizardModel = body.wizard as string;
    const payload = (body.payload ?? {}) as Record<string, unknown>;

    if (!wizardModel) {
      return NextResponse.json(
        { error: "wizard model required" },
        { status: 400 },
      );
    }

    // Per-line SQF write (used by the digitization wizard). Apply to
    // indigo.order.line BEFORE creating the wizard so the wizard's
    // related fields (total_sqf etc.) reflect the new values.
    const lineSqfs = payload.line_sqfs as Record<string, number> | undefined;
    if (lineSqfs) {
      for (const [lineIdStr, sqf] of Object.entries(lineSqfs)) {
        const lineId = Number(lineIdStr);
        const n = Number(sqf);
        if (!Number.isFinite(lineId) || !Number.isFinite(n)) continue;
        await call({
          session: s.session,
          model: "indigo.order.line",
          method: "write",
          args: [[lineId], { sqf: n }],
          kwargs: {},
        });
      }
      delete payload.line_sqfs;
    }

    const wizardId = await call<number>({
      session: s.session,
      model: wizardModel,
      method: "create",
      args: [{ order_id: orderId, ...payload }],
      kwargs: {},
    });

    await call({
      session: s.session,
      model: wizardModel,
      method: "action_save_and_advance",
      args: [[wizardId]],
      kwargs: {},
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error advancing stage";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

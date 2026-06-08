import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * Settle pending payouts.
 *
 *   POST /api/billing/settle
 *   body: {
 *     mode: "mark-paid" | "consolidate",
 *     payoutIds?: number[],      // for mark-paid: which payouts to flip to state=paid
 *     contractorId?: number,     // for consolidate: who to consolidate for
 *     contractorType?: "painter" | "installer",
 *     periodStart?: string,      // YYYY-MM-DD
 *     periodEnd?: string,
 *   }
 *
 * "mark-paid" is the simple flow: select N draft/approved payouts and
 * flip them to state=paid. Used by the "Pay all pending" button.
 *
 * "consolidate" is the weekly-roll-up flow: calls the existing Odoo
 * wizard to merge draft payouts in a range into a single one.
 */
export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const body = await req.json();
    const mode = body.mode as "mark-paid" | "consolidate";

    if (mode === "mark-paid") {
      const ids = Array.isArray(body.payoutIds) ? body.payoutIds : [];
      if (!ids.length) {
        return NextResponse.json(
          { error: "payoutIds required" },
          { status: 400 },
        );
      }
      await call({
        session: s.session,
        model: "indigo.payout",
        method: "action_mark_paid",
        args: [ids],
        kwargs: {},
      });
      return NextResponse.json({ ok: true, count: ids.length });
    }

    if (mode === "consolidate") {
      const { contractorId, contractorType, periodStart, periodEnd } = body;
      if (!contractorId || !contractorType || !periodStart || !periodEnd) {
        return NextResponse.json(
          { error: "contractorId + type + period required" },
          { status: 400 },
        );
      }
      const wizardId = await call<number>({
        session: s.session,
        model: "indigo.payout.settle.wizard",
        method: "create",
        args: [
          {
            contractor_id: contractorId,
            contractor_type: contractorType,
            period_start: periodStart,
            period_end: periodEnd,
          },
        ],
        kwargs: {},
      });
      const action = await call<{ res_id?: number }>({
        session: s.session,
        model: "indigo.payout.settle.wizard",
        method: "action_consolidate",
        args: [[wizardId]],
        kwargs: {},
      });
      return NextResponse.json({ ok: true, payoutId: action?.res_id });
    }

    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

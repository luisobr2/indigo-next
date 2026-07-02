import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * GET /api/billing/summary
 *
 * Returns a single-shot bundle for the Billing page header:
 *
 *   {
 *     cashIn: {
 *       paid: <sum total_dealer_charge of paid orders this month>,
 *       pending: <sum total_dealer_charge of installed-but-not-yet-invoiced>,
 *     },
 *     cashOut: {
 *       settled: <sum amount of state=paid payouts this month>,
 *       pending: <sum amount of state in (draft, approved) payouts>,
 *     },
 *     counts: { toInvoice, outstanding, pendingPayouts },
 *   }
 */
export async function GET() {
  try {
    const s = await requireSession();
    const now = new Date();
    const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

    // Aggregate sums + counts in Postgres via read_group (groupby=[] → one
    // global aggregate row each), all in parallel. Avoids pulling every row
    // into Node just to sum. Numerically identical to the old search+read+reduce.
    type Agg = Array<{ __count?: number; total_dealer_charge?: number | false; amount?: number | false }>;
    const rg = (model: string, domain: unknown[], field?: string) =>
      call<Agg>({
        session: s.session,
        model,
        method: "read_group",
        args: [domain, field ? [`${field}:sum`] : [], []],
        kwargs: { lazy: false },
      });

    const [paidG, pendingInvG, outstandingG, settledG, pendingPayoutG] = await Promise.all([
      rg("indigo.order", [["payment_state", "=", "paid"], ["date_paid", ">=", monthStart]], "total_dealer_charge"),
      rg("indigo.order", [["stage_id.code", "=", "installed"], ["payment_state", "!=", "paid"]], "total_dealer_charge"),
      // Outstanding = invoiced-but-unpaid only (installed-unpaid is counted in
      // toInvoice, so the KPI matches the Outstanding list — no double count).
      rg("indigo.order", [["payment_state", "in", ["unpaid", "partial"]], ["stage_id.code", "=", "invoiced"]]),
      rg("indigo.payout", [["state", "=", "paid"], ["date", ">=", monthStart]], "amount"),
      rg("indigo.payout", [["state", "in", ["draft", "approved"]]], "amount"),
    ]);

    const num = (v: number | false | undefined) => Number(v) || 0;
    const cnt = (g: Agg) => g[0]?.__count ?? 0;

    return NextResponse.json({
      cashIn: {
        paid: num(paidG[0]?.total_dealer_charge),
        pending: num(pendingInvG[0]?.total_dealer_charge),
      },
      cashOut: {
        settled: num(settledG[0]?.amount),
        pending: num(pendingPayoutG[0]?.amount),
      },
      counts: {
        toInvoice: cnt(pendingInvG),
        outstanding: cnt(outstandingG),
        pendingPayouts: cnt(pendingPayoutG),
      },
      monthStart,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

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

    // ----- Cash IN -----
    const paidIds = await call<number[]>({
      session: s.session,
      model: "indigo.order",
      method: "search",
      args: [
        [
          ["payment_state", "=", "paid"],
          ["date_paid", ">=", monthStart],
        ],
      ],
      kwargs: {},
    });
    const paidOrders = paidIds.length
      ? await call<Array<{ total_dealer_charge: number }>>({
          session: s.session,
          model: "indigo.order",
          method: "read",
          args: [paidIds, ["total_dealer_charge"]],
          kwargs: {},
        })
      : [];

    const pendingInvIds = await call<number[]>({
      session: s.session,
      model: "indigo.order",
      method: "search",
      args: [
        [
          ["stage_id.code", "=", "installed"],
          ["payment_state", "!=", "paid"],
        ],
      ],
      kwargs: {},
    });
    const pendingInv = pendingInvIds.length
      ? await call<Array<{ total_dealer_charge: number }>>({
          session: s.session,
          model: "indigo.order",
          method: "read",
          args: [pendingInvIds, ["total_dealer_charge"]],
          kwargs: {},
        })
      : [];

    // ----- Outstanding (unpaid/partial across ALL stages, not just installed) -----
    const outstandingCount = await call<number>({
      session: s.session,
      model: "indigo.order",
      method: "search_count",
      args: [
        [
          ["payment_state", "in", ["unpaid", "partial"]],
          ["stage_id.code", "in", ["invoiced", "installed"]],
        ],
      ],
      kwargs: {},
    });

    // ----- Cash OUT (payouts) -----
    const settledIds = await call<number[]>({
      session: s.session,
      model: "indigo.payout",
      method: "search",
      args: [
        [
          ["state", "=", "paid"],
          ["date", ">=", monthStart],
        ],
      ],
      kwargs: {},
    });
    const settled = settledIds.length
      ? await call<Array<{ amount: number }>>({
          session: s.session,
          model: "indigo.payout",
          method: "read",
          args: [settledIds, ["amount"]],
          kwargs: {},
        })
      : [];

    const pendingPayoutIds = await call<number[]>({
      session: s.session,
      model: "indigo.payout",
      method: "search",
      args: [[["state", "in", ["draft", "approved"]]]],
      kwargs: {},
    });
    const pendingPayouts = pendingPayoutIds.length
      ? await call<Array<{ amount: number }>>({
          session: s.session,
          model: "indigo.payout",
          method: "read",
          args: [pendingPayoutIds, ["amount"]],
          kwargs: {},
        })
      : [];

    const sum = (rows: Array<{ amount?: number; total_dealer_charge?: number }>, k: "amount" | "total_dealer_charge") =>
      rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);

    return NextResponse.json({
      cashIn: {
        paid: sum(paidOrders, "total_dealer_charge"),
        pending: sum(pendingInv, "total_dealer_charge"),
      },
      cashOut: {
        settled: sum(settled, "amount"),
        pending: sum(pendingPayouts, "amount"),
      },
      counts: {
        toInvoice: pendingInvIds.length,
        outstanding: outstandingCount,
        pendingPayouts: pendingPayoutIds.length,
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

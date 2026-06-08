import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * GET /api/reports
 *
 * Returns a consolidated payload for the Reports page:
 *  - topDealers: leaderboard of dealers by paid revenue last 6 months
 *  - revenue: paid revenue per month last 6 months (same shape as Billing)
 *  - stageAging: active orders count + avg days per stage
 *  - topDesigns: most-ordered designs in the same window
 *  - contractorPerformance: settled payouts grouped by contractor (last 8 weeks)
 *
 * All series are bucketed server-side from raw search_reads — no read_group
 * to stay portable across Odoo versions.
 */
export async function GET() {
  try {
    const s = await requireSession();

    const today = new Date();
    const windowStart = new Date(
      today.getUTCFullYear(),
      today.getUTCMonth() - 5,
      1,
    );
    const windowStartStr =
      `${windowStart.getUTCFullYear()}-${String(windowStart.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const eightWeeksAgo = new Date(today.getTime() - 8 * 7 * 24 * 60 * 60 * 1000);
    const eightWeeksAgoStr = eightWeeksAgo.toISOString().slice(0, 10);

    // --- Pull all orders that fall in the window (any state) ---
    interface OrderRow {
      id: number;
      dealer_id: [number, string] | false;
      line_ids: number[];
      payment_state: "paid" | "partial" | "unpaid";
      date_paid: string | false;
      create_date: string;
      total_dealer_charge: number;
      total_sqf: number;
      door_count: number;
      stage_id: [number, string] | false;
    }
    const orders = await call<OrderRow[]>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [["create_date", ">=", `${windowStartStr} 00:00:00`]],
        [
          "id",
          "dealer_id",
          "line_ids",
          "payment_state",
          "date_paid",
          "create_date",
          "total_dealer_charge",
          "total_sqf",
          "door_count",
          "stage_id",
        ],
      ],
      kwargs: { limit: 10000 },
    });

    // Design lives on order lines, not the order itself.
    // Pull lines for all the orders in one shot and bucket by order_id.
    const allLineIds = orders.flatMap((o) => o.line_ids ?? []);
    interface LineRow {
      id: number;
      order_id: [number, string] | false;
      design_id: [number, string] | false;
    }
    const lines: LineRow[] = allLineIds.length
      ? await call<LineRow[]>({
          session: s.session,
          model: "indigo.order.line",
          method: "read",
          args: [allLineIds, ["id", "order_id", "design_id"]],
          kwargs: {},
        })
      : [];
    const designsByOrder = new Map<number, Array<[number, string]>>();
    for (const l of lines) {
      if (!l.order_id || !l.design_id) continue;
      const orderId = l.order_id[0];
      if (!designsByOrder.has(orderId)) designsByOrder.set(orderId, []);
      designsByOrder.get(orderId)!.push(l.design_id);
    }

    // --- Active orders for stage aging ---
    interface ActiveRow {
      id: number;
      stage_id: [number, string] | false;
      days_in_current_stage: number;
    }
    const activeOrders = await call<ActiveRow[]>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [["stage_id.code", "not in", ["closed", "invoiced"]]],
        ["id", "stage_id", "days_in_current_stage"],
      ],
      kwargs: { limit: 5000 },
    });

    // --- Settled payouts (last 8 weeks) ---
    interface PayoutRow {
      id: number;
      contractor_id: [number, string] | false;
      contractor_type: "painter" | "installer" | "other";
      amount: number;
      state: "draft" | "approved" | "paid";
      date: string;
    }
    const payouts = await call<PayoutRow[]>({
      session: s.session,
      model: "indigo.payout",
      method: "search_read",
      args: [
        [["date", ">=", eightWeeksAgoStr], ["state", "=", "paid"]],
        ["id", "contractor_id", "contractor_type", "amount", "state", "date"],
      ],
      kwargs: { limit: 5000 },
    });

    // ---------- topDealers ----------
    const dealerMap = new Map<number, {
      id: number;
      name: string;
      orderCount: number;
      paidRevenue: number;
      pendingRevenue: number;
      totalSqf: number;
    }>();
    for (const o of orders) {
      if (!o.dealer_id) continue;
      const [id, name] = o.dealer_id;
      let bucket = dealerMap.get(id);
      if (!bucket) {
        bucket = {
          id, name,
          orderCount: 0,
          paidRevenue: 0,
          pendingRevenue: 0,
          totalSqf: 0,
        };
        dealerMap.set(id, bucket);
      }
      bucket.orderCount += 1;
      bucket.totalSqf += Number(o.total_sqf) || 0;
      const v = Number(o.total_dealer_charge) || 0;
      if (o.payment_state === "paid") bucket.paidRevenue += v;
      else bucket.pendingRevenue += v;
    }
    const topDealers = [...dealerMap.values()]
      .sort((a, b) => b.paidRevenue + b.pendingRevenue - (a.paidRevenue + a.pendingRevenue))
      .slice(0, 10)
      .map((d) => ({
        ...d,
        paidRevenue: Math.round(d.paidRevenue * 100) / 100,
        pendingRevenue: Math.round(d.pendingRevenue * 100) / 100,
        totalSqf: Math.round(d.totalSqf * 10) / 10,
      }));

    // ---------- revenue per month ----------
    const monthBuckets = new Map<string, number>();
    for (let i = 0; i < 6; i++) {
      const d = new Date(
        today.getUTCFullYear(),
        today.getUTCMonth() - (5 - i),
        1,
      );
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      monthBuckets.set(key, 0);
    }
    for (const o of orders) {
      if (o.payment_state !== "paid" || !o.date_paid) continue;
      const key = String(o.date_paid).slice(0, 7);
      if (monthBuckets.has(key)) {
        monthBuckets.set(key, (monthBuckets.get(key) ?? 0) + (Number(o.total_dealer_charge) || 0));
      }
    }
    const revenue = [...monthBuckets.entries()].map(([month, value]) => {
      const [y, m] = month.split("-");
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", {
        month: "short",
        year: "2-digit",
      });
      return { month, label, value: Math.round(value * 100) / 100 };
    });

    // ---------- stageAging ----------
    const stageMap = new Map<number, {
      id: number;
      name: string;
      count: number;
      totalDays: number;
    }>();
    for (const o of activeOrders) {
      if (!o.stage_id) continue;
      const [id, name] = o.stage_id;
      let bucket = stageMap.get(id);
      if (!bucket) {
        bucket = { id, name, count: 0, totalDays: 0 };
        stageMap.set(id, bucket);
      }
      bucket.count += 1;
      bucket.totalDays += Number(o.days_in_current_stage) || 0;
    }
    const stageAging = [...stageMap.values()]
      .map((s) => ({
        id: s.id,
        name: s.name,
        count: s.count,
        avgDays: s.count > 0 ? Math.round((s.totalDays / s.count) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // ---------- topDesigns ----------
    // An order can have multiple lines with different designs. We count
    // each (order, design) pair once for orderCount and split sqf/doors
    // evenly across designs within the order — a rough proxy that beats
    // counting the order N times.
    const designMap = new Map<number, {
      id: number;
      name: string;
      orderCount: number;
      doors: number;
      sqf: number;
    }>();
    for (const o of orders) {
      const designs = designsByOrder.get(o.id);
      if (!designs || !designs.length) continue;
      const seen = new Set<number>();
      const share = 1 / designs.length;
      for (const [id, name] of designs) {
        if (seen.has(id)) continue;
        seen.add(id);
        let bucket = designMap.get(id);
        if (!bucket) {
          bucket = { id, name, orderCount: 0, doors: 0, sqf: 0 };
          designMap.set(id, bucket);
        }
        bucket.orderCount += 1;
        bucket.doors += (Number(o.door_count) || 0) * share;
        bucket.sqf += (Number(o.total_sqf) || 0) * share;
      }
    }
    const topDesigns = [...designMap.values()]
      .sort((a, b) => b.orderCount - a.orderCount)
      .slice(0, 10)
      .map((d) => ({
        ...d,
        doors: Math.round(d.doors),
        sqf: Math.round(d.sqf * 10) / 10,
      }));

    // ---------- contractorPerformance ----------
    const contractorMap = new Map<number, {
      id: number;
      name: string;
      type: "painter" | "installer" | "other";
      payoutCount: number;
      paid: number;
    }>();
    for (const p of payouts) {
      if (!p.contractor_id) continue;
      const [id, name] = p.contractor_id;
      let bucket = contractorMap.get(id);
      if (!bucket) {
        bucket = {
          id, name,
          type: p.contractor_type,
          payoutCount: 0,
          paid: 0,
        };
        contractorMap.set(id, bucket);
      }
      bucket.payoutCount += 1;
      bucket.paid += Number(p.amount) || 0;
    }
    const contractorPerformance = [...contractorMap.values()]
      .sort((a, b) => b.paid - a.paid)
      .slice(0, 12)
      .map((c) => ({
        ...c,
        paid: Math.round(c.paid * 100) / 100,
      }));

    return NextResponse.json({
      topDealers,
      revenue,
      stageAging,
      topDesigns,
      contractorPerformance,
      windowStart: windowStartStr,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

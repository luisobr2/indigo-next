import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * GET /api/installers/pay?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * What each installer earned, day by day.
 *
 * Reads indigo.payout, NOT the orders. That distinction is the whole point:
 * an installer is paid by the DAY under their own rule — a floor, a rate per
 * door, a travel bonus — so no amount on this page can be recovered by
 * multiplying doors by a rate. Odoo already computed each day and wrote the
 * adjustment down as a line; this route reports it rather than re-deriving
 * it, which is also why the page can show WHY a day paid what it paid.
 *
 * The sibling /api/installers/dashboard still multiplies doors by a
 * hardcoded 35 for its `paymentDue`. That figure predates the day rule and
 * understates what is owed on any day under the floor — which, measured in
 * production, is 92% of them.
 */

const isYmd = (v: string | null): v is string => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  // Monday-based: getDay() is 0 for Sunday, which belongs to the week before.
  const shift = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - shift);
  x.setHours(0, 0, 0, 0);
  return x;
}

interface PayoutRow {
  id: number;
  name: string;
  contractor_id: [number, string] | false;
  work_date: string | false;
  amount: number;
  state: "draft" | "approved" | "paid" | "cancel";
}

interface LineRow {
  id: number;
  payout_id: [number, string] | false;
  order_id: [number, string] | false;
  line_kind: "work" | "minimum" | "bonus";
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

interface RuleRow {
  id: number;
  partner_id: [number, string] | false;
  rate: number;
  daily_minimum: number;
  bonus_amount: number;
  bonus_unit: "order" | "door";
}

export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    // This page puts every installer's pay side by side. Same gate as the
    // dashboard: specialists must not see each other's compensation.
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;
    const fromParam = sp.get("from");
    const toParam = sp.get("to");
    let startStr: string;
    let endStr: string;
    if (isYmd(fromParam) && isYmd(toParam)) {
      startStr = fromParam <= toParam ? fromParam : toParam;
      endStr = fromParam <= toParam ? toParam : fromParam;
    } else {
      const monday = startOfWeek(sp.get("week") ? new Date(sp.get("week")!) : new Date());
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      startStr = ymd(monday);
      endStr = ymd(sunday);
    }

    const payouts = await call<PayoutRow[]>({
      session: s.session,
      model: "indigo.payout",
      method: "search_read",
      args: [
        [
          ["contractor_type", "=", "installer"],
          ["state", "!=", "cancel"],
          ["work_date", ">=", startStr],
          ["work_date", "<=", endStr],
        ],
        ["id", "name", "contractor_id", "work_date", "amount", "state"],
      ],
      kwargs: { order: "work_date desc, id asc", limit: 500 },
    });

    const payoutIds = payouts.map((p) => p.id);
    const [lines, rules] = await Promise.all([
      payoutIds.length
        ? call<LineRow[]>({
            session: s.session,
            model: "indigo.payout.line",
            method: "search_read",
            args: [
              [["payout_id", "in", payoutIds]],
              ["id", "payout_id", "order_id", "line_kind", "description", "quantity", "rate", "amount"],
            ],
            kwargs: { order: "line_kind, id", limit: 2000 },
          })
        : Promise.resolve([] as LineRow[]),
      call<RuleRow[]>({
        session: s.session,
        model: "indigo.contractor.rate",
        method: "search_read",
        args: [
          [["contractor_type", "=", "installer"], ["active", "=", true]],
          ["id", "partner_id", "rate", "daily_minimum", "bonus_amount", "bonus_unit"],
        ],
        kwargs: { limit: 100 },
      }),
    ]);

    const linesByPayout = new Map<number, LineRow[]>();
    for (const l of lines) {
      if (!Array.isArray(l.payout_id)) continue;
      const arr = linesByPayout.get(l.payout_id[0]) ?? [];
      arr.push(l);
      linesByPayout.set(l.payout_id[0], arr);
    }

    // The rule with no partner is the fallback — everyone without their own.
    const fallback = rules.find((r) => !r.partner_id) ?? null;
    const ruleFor = (partnerId: number) =>
      rules.find((r) => Array.isArray(r.partner_id) && r.partner_id[0] === partnerId) ?? fallback;

    interface Day {
      payoutId: number;
      payoutName: string;
      date: string;
      doors: number;
      installs: number;
      amount: number;
      state: PayoutRow["state"];
      /** Every line, so the page can show WHY the day paid what it paid. */
      lines: Array<{
        kind: LineRow["line_kind"];
        description: string;
        order: string | null;
        quantity: number;
        rate: number;
        amount: number;
      }>;
    }

    const buckets = new Map<
      number,
      {
        installerId: number;
        name: string;
        rule: {
          ratePerDoor: number;
          dailyMinimum: number;
          bonusAmount: number;
          bonusUnit: "order" | "door";
          isOwn: boolean;
        } | null;
        days: Day[];
        doors: number;
        installs: number;
        total: number;
        pending: number;
        settled: number;
        /** Days the floor topped the day up — the shape of the week. */
        daysAtMinimum: number;
      }
    >();

    for (const p of payouts) {
      if (!Array.isArray(p.contractor_id) || !p.work_date) continue;
      const [cid, cname] = p.contractor_id;
      let b = buckets.get(cid);
      if (!b) {
        const r = ruleFor(cid);
        b = {
          installerId: cid,
          name: cname,
          rule: r
            ? {
                ratePerDoor: r.rate,
                dailyMinimum: r.daily_minimum,
                bonusAmount: r.bonus_amount,
                bonusUnit: r.bonus_unit,
                isOwn: Array.isArray(r.partner_id) && r.partner_id[0] === cid,
              }
            : null,
          days: [],
          doors: 0,
          installs: 0,
          total: 0,
          pending: 0,
          settled: 0,
          daysAtMinimum: 0,
        };
        buckets.set(cid, b);
      }

      const pl = linesByPayout.get(p.id) ?? [];
      const work = pl.filter((l) => l.line_kind === "work");
      const doors = work.reduce((a, l) => a + (l.quantity || 0), 0);
      // One install = one order. Lines that lost their order still count as
      // their own stop, same as the Odoo side does for the travel bonus.
      const orderIds = new Set(
        work.filter((l) => Array.isArray(l.order_id)).map((l) => (l.order_id as [number, string])[0]),
      );
      const installs = orderIds.size + work.filter((l) => !Array.isArray(l.order_id)).length;

      b.days.push({
        payoutId: p.id,
        payoutName: p.name,
        date: p.work_date,
        doors,
        installs,
        amount: p.amount,
        state: p.state,
        lines: pl.map((l) => ({
          kind: l.line_kind,
          description: l.description,
          order: Array.isArray(l.order_id) ? l.order_id[1] : null,
          quantity: l.quantity,
          rate: l.rate,
          amount: l.amount,
        })),
      });
      b.doors += doors;
      b.installs += installs;
      b.total += p.amount;
      if (p.state === "paid") b.settled += p.amount;
      else b.pending += p.amount;
      if (pl.some((l) => l.line_kind === "minimum")) b.daysAtMinimum += 1;
    }

    const installers = [...buckets.values()].sort((a, b) => b.total - a.total);
    const summary = {
      installers: installers.length,
      daysWorked: installers.reduce((a, i) => a + i.days.length, 0),
      doors: installers.reduce((a, i) => a + i.doors, 0),
      total: installers.reduce((a, i) => a + i.total, 0),
      pending: installers.reduce((a, i) => a + i.pending, 0),
      settled: installers.reduce((a, i) => a + i.settled, 0),
      daysAtMinimum: installers.reduce((a, i) => a + i.daysAtMinimum, 0),
    };

    return NextResponse.json({ rangeStart: startStr, rangeEnd: endStr, summary, installers });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { resolveRange, daysBetween, MAX_RANGE_DAYS } from "@/lib/installers/pay-data";
import { billingError } from "@/lib/billing/server";

export const runtime = "nodejs";

interface PayoutRow {
  id: number;
  name: string;
  contractor_id: [number, string] | false;
  work_date: string | false;
  amount: number;
  state: "draft" | "approved" | "paid" | "cancel";
}
interface LineRow {
  payout_id: [number, string] | false;
  order_id: [number, string] | false;
  quantity: number;
  rate: number;
  amount: number;
}

export interface DigitizationPerson {
  partnerId: number;
  name: string;
  doors: number;
  total: number;
  pending: number;
  pendingPayoutIds: number[];
  orders: Array<{ id: number; name: string; date: string; doors: number; amount: number; paid: boolean }>;
}

/**
 * GET /api/labor/digitization?from&to: after-hours digitization pay (Amado),
 * by person, from the "digitizer" payouts Odoo writes when he is chosen as
 * an order's designer. Office / managers only, like installer pay.
 */
export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const sp = req.nextUrl.searchParams;
    const { startStr, endStr } = resolveRange(sp.get("from"), sp.get("to"), null);
    if (daysBetween(startStr, endStr) > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: `Range too wide - ${MAX_RANGE_DAYS} days maximum.` }, { status: 400 });
    }
    const payouts = await call<PayoutRow[]>({
      session: s.session,
      model: "indigo.payout",
      method: "search_read",
      args: [
        [
          ["contractor_type", "=", "digitizer"],
          ["state", "!=", "cancel"],
          ["work_date", ">=", startStr],
          ["work_date", "<=", endStr],
        ],
        ["id", "name", "contractor_id", "work_date", "amount", "state"],
      ],
      kwargs: { order: "work_date asc, id asc", limit: 500 },
    });
    const lines = payouts.length
      ? await call<LineRow[]>({
          session: s.session,
          model: "indigo.payout.line",
          method: "search_read",
          args: [[["payout_id", "in", payouts.map((p) => p.id)]], ["payout_id", "order_id", "quantity", "rate", "amount"]],
          kwargs: { limit: 3000 },
        })
      : [];
    const byPayout = new Map<number, LineRow[]>();
    for (const l of lines) {
      if (!Array.isArray(l.payout_id)) continue;
      byPayout.set(l.payout_id[0], [...(byPayout.get(l.payout_id[0]) ?? []), l]);
    }
    const people = new Map<number, DigitizationPerson>();
    for (const p of payouts) {
      if (!Array.isArray(p.contractor_id)) continue;
      const [pid, name] = p.contractor_id;
      const person = people.get(pid) ?? { partnerId: pid, name, doors: 0, total: 0, pending: 0, pendingPayoutIds: [], orders: [] };
      const paid = p.state === "paid";
      for (const l of byPayout.get(p.id) ?? []) {
        person.orders.push({
          id: Array.isArray(l.order_id) ? l.order_id[0] : 0,
          name: Array.isArray(l.order_id) ? l.order_id[1] : "—",
          date: p.work_date || "",
          doors: l.quantity,
          amount: l.amount,
          paid,
        });
        person.doors += l.quantity;
      }
      person.total += p.amount;
      if (!paid) {
        person.pending += p.amount;
        person.pendingPayoutIds.push(p.id);
      }
      people.set(pid, person);
    }
    return NextResponse.json({ people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (e) {
    return billingError(e);
  }
}

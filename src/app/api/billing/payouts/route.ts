import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

interface Payout {
  id: number;
  name: string;
  contractor_id: [number, string] | false;
  contractor_type: "painter" | "installer" | "other";
  date: string;
  period_start: string | false;
  period_end: string | false;
  amount: number;
  state: "draft" | "approved" | "paid" | "cancel";
}

interface PayoutLine {
  id: number;
  payout_id: [number, string] | false;
  order_id: [number, string] | false;
  date_work: string;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

/**
 * Payouts grouped by contractor. Returns:
 *   {
 *     painters: [ { contractorId, name, pending, settled, lines: [...] }, ... ],
 *     installers: [ ... ],
 *   }
 *
 * We pull active (non-cancelled) payouts so the page can show pending
 * AND settled totals per contractor in one card.
 */
export async function GET() {
  try {
    const s = await requireSession();

    const payouts = await call<Payout[]>({
      session: s.session,
      model: "indigo.payout",
      method: "search_read",
      args: [
        [["state", "in", ["draft", "approved", "paid"]]],
        [
          "id",
          "name",
          "contractor_id",
          "contractor_type",
          "date",
          "period_start",
          "period_end",
          "amount",
          "state",
        ],
      ],
      kwargs: { order: "date desc", limit: 200 },
    });

    const payoutIds = payouts.map((p) => p.id);
    const lines: PayoutLine[] = payoutIds.length
      ? await call<PayoutLine[]>({
          session: s.session,
          model: "indigo.payout.line",
          method: "search_read",
          args: [
            [["payout_id", "in", payoutIds]],
            [
              "id",
              "payout_id",
              "order_id",
              "date_work",
              "description",
              "quantity",
              "rate",
              "amount",
            ],
          ],
          kwargs: { order: "date_work desc" },
        })
      : [];

    // Group by contractor
    interface Bucket {
      contractorId: number;
      name: string;
      pending: number;
      settled: number;
      payouts: Array<Payout & { lines: PayoutLine[] }>;
    }
    const bucket = (m: Map<number, Bucket>, p: Payout) => {
      if (!p.contractor_id) return null;
      const cid = p.contractor_id[0];
      let b = m.get(cid);
      if (!b) {
        b = {
          contractorId: cid,
          name: p.contractor_id[1],
          pending: 0,
          settled: 0,
          payouts: [],
        };
        m.set(cid, b);
      }
      const linesForP = lines.filter(
        (l) => Array.isArray(l.payout_id) && l.payout_id[0] === p.id,
      );
      b.payouts.push({ ...p, lines: linesForP });
      if (p.state === "paid") b.settled += p.amount;
      else b.pending += p.amount;
      return b;
    };

    const painters = new Map<number, Bucket>();
    const installers = new Map<number, Bucket>();
    for (const p of payouts) {
      if (p.contractor_type === "painter") bucket(painters, p);
      else if (p.contractor_type === "installer") bucket(installers, p);
    }

    return NextResponse.json({
      painters: [...painters.values()].sort((a, b) => b.pending - a.pending),
      installers: [...installers.values()].sort((a, b) => b.pending - a.pending),
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

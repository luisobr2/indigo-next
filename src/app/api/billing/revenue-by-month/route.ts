import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * GET /api/billing/revenue-by-month
 *
 * Aggregates paid orders by `date_paid` month for the last 6 months.
 *
 * Approach: pull all paid orders inside the window with their date_paid
 * + total_dealer_charge, bucket them server-side. This avoids relying on
 * `read_group` quirks across Odoo versions and gives us a clean shape
 * for the chart.
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

    const records = await call<Array<{ date_paid: string | false; total_dealer_charge: number }>>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [
          ["payment_state", "=", "paid"],
          ["date_paid", ">=", windowStartStr],
        ],
        ["date_paid", "total_dealer_charge"],
      ],
      kwargs: { limit: 5000 },
    });

    // Bucket by YYYY-MM
    const buckets = new Map<string, number>();
    for (let i = 0; i < 6; i++) {
      const d = new Date(
        today.getUTCFullYear(),
        today.getUTCMonth() - (5 - i),
        1,
      );
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      buckets.set(key, 0);
    }
    for (const r of records) {
      if (!r.date_paid) continue;
      const key = String(r.date_paid).slice(0, 7);
      if (buckets.has(key)) {
        buckets.set(key, (buckets.get(key) ?? 0) + (Number(r.total_dealer_charge) || 0));
      }
    }

    const series = [...buckets.entries()].map(([month, value]) => {
      const [y, m] = month.split("-");
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", {
        month: "short",
        year: "2-digit",
      });
      return { month, label, value: Math.round(value * 100) / 100 };
    });

    return NextResponse.json({ series });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

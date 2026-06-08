import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * Orders that have been invoiced but are still partially or fully unpaid.
 *
 * Invariant: orders in `installed` are in /to-invoice, not here.
 * Once they're moved to `invoiced` (by the wizard), if payment isn't
 * `paid`, they show up here as outstanding receivables.
 */
export async function GET() {
  try {
    const s = await requireSession();
    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [
          ["payment_state", "in", ["unpaid", "partial"]],
          ["stage_id.code", "in", ["invoiced", "installed"]],
        ],
        [
          "id",
          "name",
          "dealer_id",
          "client_name",
          "total_dealer_charge",
          "payment_state",
          "date_paid",
          "write_date",
          "create_date",
        ],
      ],
      kwargs: { order: "write_date asc", limit: 100 },
    });
    return NextResponse.json({ records });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

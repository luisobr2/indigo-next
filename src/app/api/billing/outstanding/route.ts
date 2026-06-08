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
export async function GET(req: Request) {
  try {
    const s = await requireSession();
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "25", 10), 500);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const domain = [
      ["payment_state", "in", ["unpaid", "partial"]],
      ["stage_id.code", "in", ["invoiced", "installed"]],
    ];
    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        domain,
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
      kwargs: { order: "write_date asc", limit, offset },
    });
    const total = await call<number>({
      session: s.session,
      model: "indigo.order",
      method: "search_count",
      args: [domain],
      kwargs: {},
    });
    return NextResponse.json({ records, total, limit, offset });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

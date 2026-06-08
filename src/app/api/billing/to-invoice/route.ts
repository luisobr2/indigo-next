import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/** Orders ready for Beatriz to invoice (installed but not yet marked paid). */
export async function GET() {
  try {
    const s = await requireSession();
    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [
          ["stage_id.code", "=", "installed"],
          ["payment_state", "!=", "paid"],
        ],
        [
          "id",
          "name",
          "dealer_id",
          "client_name",
          "total_dealer_charge",
          "total_sqf",
          "door_count",
          "payment_state",
          "create_date",
          "write_date",
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

import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/** Orders ready for Beatriz to invoice (installed but not yet marked paid). */
export async function GET(req: Request) {
  try {
    const s = await requireSession();
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "25", 10), 500);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

    const domain = [
      ["stage_id.code", "=", "installed"],
      ["payment_state", "!=", "paid"],
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
          "total_sqf",
          "door_count",
          "payment_state",
          "create_date",
          "write_date",
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

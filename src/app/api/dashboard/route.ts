import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * Dashboard data — one roundtrip into Odoo that pulls everything
 * the home page needs. The hard work lives in the existing
 * indigo.order.get_dashboard_data() method on the Odoo side, so this
 * route is just a passthrough that applies the user's session.
 */
export async function GET() {
  try {
    const s = await requireSession();
    const data = await call<Record<string, unknown>>({
      session: s.session,
      model: "indigo.order",
      method: "get_dashboard_data",
      args: [],
      kwargs: {},
    });
    // Open-incidences count, computed here so we don't have to change the Odoo
    // method. Guarded so a DB without the column still returns the dashboard.
    let openIncidences = 0;
    try {
      openIncidences = await call<number>({
        session: s.session,
        model: "indigo.order",
        method: "search_count",
        args: [[["incidence", "=", true]]],
        kwargs: {},
      });
    } catch {
      openIncidences = 0;
    }
    // Real SQF waiting in the paint shop. The capacity bar used to estimate it
    // as "orders x 50", and showed the guess as if it were a measurement.
    let paintingSqf = 0;
    try {
      const rows = await call<Array<{ total_sqf: number }>>({
        session: s.session,
        model: "indigo.order",
        method: "search_read",
        args: [[["stage_id.code", "=", "painting"]]],
        kwargs: { fields: ["total_sqf"] },
      });
      paintingSqf = Math.round(rows.reduce((t, r) => t + (r.total_sqf || 0), 0));
    } catch {
      paintingSqf = 0;
    }
    return NextResponse.json({ data: { ...data, openIncidences, paintingSqf } });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error fetching dashboard";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

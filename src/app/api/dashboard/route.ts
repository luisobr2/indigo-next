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
    const data = await call({
      session: s.session,
      model: "indigo.order",
      method: "get_dashboard_data",
      args: [],
      kwargs: {},
    });
    return NextResponse.json({ data });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error fetching dashboard";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

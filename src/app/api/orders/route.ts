import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

const ORDER_FIELDS = [
  "id",
  "name",
  "dealer_id",
  "dealer_ref",
  "client_name",
  "client_phone",
  "client_email",
  "client_address",
  "stage_id",
  "stage_code",
  "on_hold",
  "payment_state",
  "price_per_sqf",
  "total_dealer_charge",
  "total_sqf",
  "total_painter_payout",
  "total_installer_payout",
  "door_count",
  "assigned_user_ids",
  "painter_id",
  "installer_ids",
  "installation_date",
  "expected_completion_date",
  "days_in_current_stage",
  "is_overdue",
  "create_date",
  "write_date",
  "priv_ref",
];

/**
 * GET /api/orders
 *   ?stage=cnc          filter by stage code
 *   ?stages=cnc,painting  multiple stages
 *   ?dealer=12          filter by dealer id
 *   ?q=text             search client_name/name
 *   ?limit=N            default 80
 *   ?offset=N
 */
export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const sp = req.nextUrl.searchParams;

    const domain: unknown[] = [];
    const stage = sp.get("stage");
    const stages = sp.get("stages");
    if (stage) domain.push(["stage_id.code", "=", stage]);
    else if (stages) domain.push(["stage_id.code", "in", stages.split(",")]);

    const dealer = sp.get("dealer");
    if (dealer) domain.push(["dealer_id", "=", Number(dealer)]);

    const onHold = sp.get("on_hold");
    if (onHold === "true") domain.push(["on_hold", "=", true]);

    const q = sp.get("q");
    if (q) {
      domain.push("|", "|");
      domain.push(["name", "ilike", q]);
      domain.push(["client_name", "ilike", q]);
      domain.push(["dealer_ref", "ilike", q]);
    }

    const limit = Math.min(parseInt(sp.get("limit") ?? "80", 10), 500);
    const offset = parseInt(sp.get("offset") ?? "0", 10);
    const order = sp.get("order") ?? "create_date desc";

    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [domain, ORDER_FIELDS],
      kwargs: { limit, offset, order },
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
    const msg = e instanceof Error ? e.message : "Error fetching orders";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST /api/orders — create a new order. */
export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const body = await req.json();
    const id = await call<number>({
      session: s.session,
      model: "indigo.order",
      method: "create",
      args: [body],
      kwargs: {},
    });
    return NextResponse.json({ id });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error creating order";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * Order-level fields carried over to the duplicate. Deliberately EXCLUDES all
 * workflow state — stage, dates, per-stage timestamps, payment, assignments,
 * payouts, incidents — and the order name. The copy starts fresh in New Order
 * with a brand-new sequence number.
 */
const ORDER_COPY_FIELDS = [
  "dealer_id", // m2o -> id
  "dealer_ref",
  "client_name",
  "client_phone",
  "client_email",
  "client_address",
  "priv_ref",
  "customer_po",
  "notes",
] as const;

const ORDER_M2O = new Set<string>(["dealer_id"]);

/** Line-level definition fields (mirror of the add-piece allow-list). */
const LINE_COPY_FIELDS = [
  "design_id", // m2o -> id
  "door_type",
  "color",
  "glass_type",
  "glass_privacy",
  "brand_id", // m2o -> id
  "width",
  "height",
  "width_label",
  "height_label",
  "qty",
  "parts_count",
  "design_tier",
  "custom_price",
  "material",
  "thickness",
  "paint_sides",
] as const;

const LINE_M2O = new Set<string>(["design_id", "brand_id"]);

/** search_read returns m2o as [id, name] (or false). We only want the id. */
function m2oId(v: unknown): number | false {
  return Array.isArray(v) ? (v[0] as number) : false;
}

/**
 * POST /api/orders/:id/duplicate
 * Create a fresh order copying the client, dealer and pieces of the source
 * order. Nothing about the workflow is carried over: the duplicate lands in
 * New Order with a new number, no dates, assignments, payments, payouts or
 * incidents. Returns the new order id.
 */
export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: orderStr } = await context.params;
    const orderId = Number(orderStr);
    if (!Number.isFinite(orderId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const [orders, lines] = await Promise.all([
      call<Array<Record<string, unknown>>>({
        session: s.session,
        model: "indigo.order",
        method: "search_read",
        args: [[["id", "=", orderId]], [...ORDER_COPY_FIELDS]],
        kwargs: { limit: 1 },
      }),
      call<Array<Record<string, unknown>>>({
        session: s.session,
        model: "indigo.order.line",
        method: "search_read",
        args: [[["order_id", "=", orderId]], [...LINE_COPY_FIELDS]],
        kwargs: { order: "sequence, id" },
      }),
    ]);
    if (!orders.length) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const src = orders[0];

    const vals: Record<string, unknown> = {};
    for (const k of ORDER_COPY_FIELDS) {
      const v = src[k];
      if (v === undefined) continue;
      vals[k] = ORDER_M2O.has(k) ? m2oId(v) : v;
    }

    // Nested line creation via Odoo's (0, 0, {...}) command syntax.
    vals.line_ids = lines.map((l) => {
      const lv: Record<string, unknown> = {};
      for (const k of LINE_COPY_FIELDS) {
        const v = l[k];
        if (v === undefined) continue;
        lv[k] = LINE_M2O.has(k) ? m2oId(v) : v;
      }
      return [0, 0, lv];
    });

    const newId = await call<number>({
      session: s.session,
      model: "indigo.order",
      method: "create",
      args: [vals],
      // Skip the "new order" manager email: a duplicate is an internal clone,
      // not a genuinely new incoming order (see _notify_new_order_managers).
      kwargs: { context: { indigo_skip_new_order_notify: true } },
    });
    return NextResponse.json({ id: newId });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error duplicating order";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

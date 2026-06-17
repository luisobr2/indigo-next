import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { validateLineEdit } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Fields the panel may set when adding a piece to an existing order.
 * Mirrors the line PATCH allow-list (minus computed/derived fields).
 */
const CREATABLE_FIELDS = [
  "design_id",
  "door_type",
  "color",
  "glass_type",
  "glass_privacy",
  "brand_id",
  "width",
  "height",
  "width_label",
  "height_label",
  "qty",
  "design_tier",
  "custom_price",
  "material",
  "thickness",
  "paint_sides",
] as const;

/**
 * POST /api/orders/:id/lines — add a new piece (order line) to an order.
 * Used by Edit Order → "Add piece" so multi-door orders can grow after
 * creation (the create modal only seeds the first piece).
 */
export async function POST(
  req: NextRequest,
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

    const body = (await req.json()) as Record<string, unknown>;
    const vals: Record<string, unknown> = {};
    for (const k of CREATABLE_FIELDS) {
      if (k in body) vals[k] = body[k];
    }

    // A real piece needs a design, a type, and positive dimensions/qty.
    if (!vals.design_id) {
      return NextResponse.json({ error: "Pick a design for the new piece." }, { status: 400 });
    }
    if (!vals.door_type) {
      return NextResponse.json({ error: "Pick a door type for the new piece." }, { status: 400 });
    }
    const w = Number(vals.width);
    const h = Number(vals.height);
    const q = Number(vals.qty);
    if (!(w > 0) || !(h > 0) || !Number.isInteger(q) || q < 1) {
      return NextResponse.json(
        { error: "New piece needs width > 0, height > 0 and quantity ≥ 1." },
        { status: 400 },
      );
    }
    const valErr = validateLineEdit(vals);
    if (valErr) {
      return NextResponse.json({ error: valErr }, { status: 400 });
    }

    // Confirm the order exists (and that this session can see it) before
    // attaching a line to it.
    const order = await call<Array<{ id: number }>>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [[["id", "=", orderId]], ["id"]],
      kwargs: { limit: 1 },
    });
    if (!order.length) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    vals.order_id = orderId;
    const newId = await call<number>({
      session: s.session,
      model: "indigo.order.line",
      method: "create",
      args: [vals],
      kwargs: {},
    });

    await call({
      session: s.session,
      model: "indigo.order",
      method: "message_post",
      args: [[orderId]],
      kwargs: {
        body: "Piece added to the order.",
        message_type: "comment",
      },
    }).catch(() => undefined);

    return NextResponse.json({ id: newId });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

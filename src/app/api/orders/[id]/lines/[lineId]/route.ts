import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

const EDITABLE_FIELDS = [
  "design_id",
  "door_type",
  "color",
  "glass_type",
  "glass_privacy",
  "width",
  "height",
  "width_label",
  "height_label",
  "qty",
  "material",
  "thickness",
  "paint_sides",
  "sidelite_margin_left",
  "sidelite_margin_right",
] as const;

/**
 * PATCH /api/orders/:id/lines/:lineId
 *
 * Edits a subset of the line's fields (door_type, color, dims, glass…).
 * Filters the request body against an allow-list so the client can't
 * mass-assign arbitrary Odoo fields.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; lineId: string }> },
) {
  try {
    const s = await requireSession();
    const { id: orderStr, lineId: lineStr } = await context.params;
    const orderId = Number(orderStr);
    const lineId = Number(lineStr);
    if (!Number.isFinite(orderId) || !Number.isFinite(lineId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const vals: Record<string, unknown> = {};
    for (const k of EDITABLE_FIELDS) {
      if (k in body) vals[k] = body[k];
    }
    if (Object.keys(vals).length === 0) {
      return NextResponse.json(
        { error: "No editable fields provided" },
        { status: 400 },
      );
    }

    // Verify the line belongs to this order before writing so the caller
    // can't mutate a sibling line by guessing the id.
    const found = await call<Array<{ id: number }>>({
      session: s.session,
      model: "indigo.order.line",
      method: "search_read",
      args: [
        [["id", "=", lineId], ["order_id", "=", orderId]],
        ["id"],
      ],
      kwargs: { limit: 1 },
    });
    if (!found.length) {
      return NextResponse.json({ error: "Line not found" }, { status: 404 });
    }

    await call({
      session: s.session,
      model: "indigo.order.line",
      method: "write",
      args: [[lineId], vals],
      kwargs: {},
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

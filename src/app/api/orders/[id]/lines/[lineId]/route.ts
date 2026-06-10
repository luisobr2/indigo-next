import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

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
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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

    // Verify the line belongs to this order AND fetch its current
    // values for diffing — the order line model doesn't have
    // tracking=True on its fields yet, so Odoo wouldn't auto-log
    // these changes. We post a chatter line on the parent order with
    // the human-readable diff before the write fires.
    const found = await call<
      Array<Record<string, unknown> & { id: number; design_id: [number, string] | false }>
    >({
      session: s.session,
      model: "indigo.order.line",
      method: "search_read",
      args: [
        [["id", "=", lineId], ["order_id", "=", orderId]],
        [
          "id",
          "design_id",
          "door_type",
          "color",
          "glass_type",
          "glass_privacy",
          "width",
          "height",
          "qty",
          "material",
          "thickness",
          "paint_sides",
        ],
      ],
      kwargs: { limit: 1 },
    });
    if (!found.length) {
      return NextResponse.json({ error: "Line not found" }, { status: 404 });
    }
    const current = found[0];

    // Compose a diff line for chatter. Skip noisy fields like the
    // sidelite margins; users care about door type / color / dims.
    const HUMAN_LABEL: Record<string, string> = {
      design_id: "Design",
      door_type: "Door type",
      color: "Color",
      glass_type: "Glass",
      glass_privacy: "Privacy",
      width: "Width",
      height: "Height",
      qty: "Qty",
      material: "Material",
      thickness: "Thickness",
      paint_sides: "Sides to paint",
    };
    const escapeHtml = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const fmt = (v: unknown) => {
      if (v === null || v === undefined || v === false || v === "") return "—";
      if (Array.isArray(v) && v.length === 2) return escapeHtml(String(v[1]));
      return escapeHtml(String(v));
    };
    const diffs: string[] = [];
    for (const k of Object.keys(vals)) {
      const label = HUMAN_LABEL[k];
      if (!label) continue;
      const before = current[k];
      const after = vals[k];
      // Skip no-ops (the user opened Edit but didn't change this field).
      if (k === "design_id") {
        const beforeId = Array.isArray(before) ? before[0] : before;
        if (beforeId === after) continue;
      } else if (before === after) {
        continue;
      }
      diffs.push(`<b>${escapeHtml(label)}</b>: ${fmt(before)} → ${fmt(after)}`);
    }
    if (diffs.length) {
      await call({
        session: s.session,
        model: "indigo.order",
        method: "message_post",
        args: [[orderId]],
        kwargs: {
          body: `Order line edited:<br/>${diffs.join("<br/>")}`,
          message_type: "comment",
        },
      }).catch(() => undefined);
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

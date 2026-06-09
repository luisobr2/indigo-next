import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

const TOLERANCE_IN = 0.5;

/**
 * GET /api/inventory/matches?order_id=N
 *
 * Returns the stock entries (orders with is_stock=true & not yet reused)
 * whose first line matches the target order's first line on:
 *   design_id (exact)
 *   door_type (exact)
 *   color (exact)
 *   glass_type (exact)
 *   material (exact)
 *   thickness (exact)
 *   width  within ±0.5"
 *   height within ±0.5"
 *
 * Used by the order detail banner: "⚡ N stock matches available".
 */
export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const sp = req.nextUrl.searchParams;
    const targetId = Number(sp.get("order_id"));
    if (!Number.isFinite(targetId)) {
      return NextResponse.json({ error: "order_id required" }, { status: 400 });
    }

    // 1. Read the target order's first line to get the characteristics we
    //    need to match against.
    const targetLines = await call<
      Array<{
        id: number;
        order_id: [number, string] | false;
        design_id: [number, string] | false;
        door_type?: string;
        color?: string;
        glass_type?: string;
        material?: string;
        thickness?: string;
        width?: number;
        height?: number;
      }>
    >({
      session: s.session,
      model: "indigo.order.line",
      method: "search_read",
      args: [
        [["order_id", "=", targetId]],
        [
          "id",
          "order_id",
          "design_id",
          "door_type",
          "color",
          "glass_type",
          "material",
          "thickness",
          "width",
          "height",
        ],
      ],
      kwargs: { limit: 1, order: "id asc" },
    });
    const target = targetLines[0];
    if (!target || !target.design_id || !Array.isArray(target.design_id)) {
      return NextResponse.json({ records: [], target: null });
    }

    const designId = target.design_id[0];
    const targetWidth = Number(target.width || 0);
    const targetHeight = Number(target.height || 0);

    // 2. Find candidate stock-line entries with the same design + door_type
    //    + color + glass + material + thickness, then prune by dimension
    //    tolerance in JS.
    const lineDomain: unknown[] = [["design_id", "=", designId]];
    if (target.door_type) lineDomain.push(["door_type", "=", target.door_type]);
    if (target.color) lineDomain.push(["color", "=", target.color]);
    if (target.glass_type) lineDomain.push(["glass_type", "=", target.glass_type]);
    if (target.material) lineDomain.push(["material", "=", target.material]);
    if (target.thickness) lineDomain.push(["thickness", "=", target.thickness]);

    const candidateLines = await call<
      Array<{
        id: number;
        order_id: [number, string] | false;
        width?: number;
        height?: number;
      }>
    >({
      session: s.session,
      model: "indigo.order.line",
      method: "search_read",
      args: [lineDomain, ["id", "order_id", "width", "height"]],
      kwargs: { limit: 200 },
    });

    const candidateOrderIds = Array.from(
      new Set(
        candidateLines
          .filter((l) => {
            const dw = Math.abs(Number(l.width || 0) - targetWidth);
            const dh = Math.abs(Number(l.height || 0) - targetHeight);
            return dw <= TOLERANCE_IN && dh <= TOLERANCE_IN;
          })
          .map((l) => (l.order_id && Array.isArray(l.order_id) ? l.order_id[0] : 0))
          .filter(Boolean),
      ),
    );
    if (!candidateOrderIds.length) {
      return NextResponse.json({ records: [], target });
    }

    // 3. Filter to stock-active orders.
    const stockOrders = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        [
          ["id", "in", candidateOrderIds],
          ["is_stock", "=", true],
          ["reused_in_order_id", "=", false],
          ["id", "!=", targetId],
        ],
        [
          "id",
          "name",
          "stock_label",
          "stock_at",
          "stock_reason",
          "original_client_name",
          "dealer_id",
          "total_sqf",
        ],
      ],
      kwargs: { order: "stock_at desc" },
    });

    // Hydrate matched line dims for display.
    const byOrder = new Map<number, (typeof candidateLines)[number]>();
    for (const l of candidateLines) {
      const oid = l.order_id && Array.isArray(l.order_id) ? l.order_id[0] : 0;
      if (oid && !byOrder.has(oid)) byOrder.set(oid, l);
    }
    for (const rec of stockOrders) {
      rec.first_line = byOrder.get(rec.id as number) ?? null;
    }

    return NextResponse.json({ records: stockOrders, target, tolerance: TOLERANCE_IN });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

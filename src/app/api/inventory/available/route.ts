import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * GET /api/inventory/available
 *   ?q=text       search nickname / original client / order name
 *   ?design=ID    filter by design code
 *   ?color=white  filter by line color
 *   ?door_type=SD filter by door_type
 *   ?material=acm_white
 *   ?limit=N
 *
 * Returns orders flagged is_stock=true AND not yet reused, hydrated with
 * first_line so the UI can render dimensions / color / glass / material.
 */
export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const sp = req.nextUrl.searchParams;

    const domain: unknown[] = [
      ["is_stock", "=", true],
      ["reused_in_order_id", "=", false],
    ];
    const q = sp.get("q");
    if (q) {
      domain.push("|", "|", "|");
      domain.push(["stock_label", "ilike", q]);
      domain.push(["original_client_name", "ilike", q]);
      domain.push(["client_name", "ilike", q]);
      domain.push(["name", "ilike", q]);
    }

    const fields = [
      "id",
      "name",
      "stock_label",
      "stock_at",
      "stock_reason",
      "original_client_name",
      "dealer_id",
      "total_sqf",
      "door_count",
      "create_date",
      "is_stock",
      "reused_in_order_id",
    ];
    const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10), 500);
    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [domain, fields],
      kwargs: { limit, order: "stock_at desc" },
    });

    // Hydrate first_line per stock entry so the card can show design + dims.
    if (records.length) {
      const orderIds = records.map((r) => r.id as number);
      const lines = await call<
        Array<{
          id: number;
          order_id: [number, string] | false;
          design_id: [number, string] | false;
          door_type?: string;
          color?: string;
          glass_type?: string;
          glass_privacy?: string;
          material?: string;
          thickness?: string;
          width?: number;
          height?: number;
          width_label?: string;
          height_label?: string;
        }>
      >({
        session: s.session,
        model: "indigo.order.line",
        method: "search_read",
        args: [
          [["order_id", "in", orderIds]],
          [
            "id",
            "order_id",
            "design_id",
            "door_type",
            "color",
            "glass_type",
            "glass_privacy",
            "material",
            "thickness",
            "width",
            "height",
            "width_label",
            "height_label",
          ],
        ],
        kwargs: { order: "order_id, id" },
      }).catch(() => []);

      const byOrder = new Map<number, (typeof lines)[number]>();
      for (const l of lines) {
        const oid = l.order_id && Array.isArray(l.order_id) ? l.order_id[0] : 0;
        if (oid && !byOrder.has(oid)) byOrder.set(oid, l);
      }

      // Apply optional filters now that we have the line data.
      const design = sp.get("design");
      const color = sp.get("color");
      const doorType = sp.get("door_type");
      const material = sp.get("material");
      const filtered = records.filter((r) => {
        const ln = byOrder.get(r.id as number);
        r.first_line = ln ?? null;
        if (design && (!ln?.design_id || !Array.isArray(ln.design_id) || ln.design_id[1] !== design)) {
          return false;
        }
        if (color && ln?.color !== color) return false;
        if (doorType && ln?.door_type !== doorType) return false;
        if (material && ln?.material !== material) return false;
        return true;
      });
      return NextResponse.json({ records: filtered });
    }

    return NextResponse.json({ records });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

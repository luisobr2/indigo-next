import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * Server-side, paginated design search for the "New Order" picker.
 *
 * Unlike /families (which returns the whole active catalog for the Catalog
 * page to filter client-side), this endpoint pushes the filter + pagination
 * to Odoo so it scales as the catalog grows. The picker accumulates pages
 * and groups them into families client-side.
 *
 *   GET /api/catalog/designs/search?q=ID29&limit=40&offset=0
 *     -> { records: DesignRow[], total }
 */

interface DesignRow {
  id: number;
  code: string;
  name: string | false;
  door_type: string | false;
  allowed_colors: string | false;
  min_width?: number;
  max_width?: number;
  min_height?: number;
  max_height?: number;
  favorite_user_ids?: number[];
}

const FIELDS_FULL = [
  "id",
  "code",
  "name",
  "door_type",
  "allowed_colors",
  "min_width",
  "max_width",
  "min_height",
  "max_height",
  "favorite_user_ids",
];

const FIELDS_BASE = [
  "id",
  "code",
  "name",
  "door_type",
  "allowed_colors",
];

export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const sp = req.nextUrl.searchParams;

    const q = (sp.get("q") ?? "").trim();
    const limit = Math.min(parseInt(sp.get("limit") ?? "40", 10) || 40, 200);
    const offset = Math.max(parseInt(sp.get("offset") ?? "0", 10) || 0, 0);

    const domain: unknown[] = [["active", "=", true]];
    if (q) {
      // Match on design code OR display name.
      domain.push("|", ["code", "ilike", q], ["name", "ilike", q]);
    }

    let records: DesignRow[];
    try {
      records = await call<DesignRow[]>({
        session: s.session,
        model: "indigo.design",
        method: "search_read",
        args: [domain, FIELDS_FULL],
        kwargs: { order: "code", limit, offset },
      });
    } catch {
      // Old DB without favorite_user_ids / dimension fields.
      records = await call<DesignRow[]>({
        session: s.session,
        model: "indigo.design",
        method: "search_read",
        args: [domain, FIELDS_BASE],
        kwargs: { order: "code", limit, offset },
      });
    }

    const total = await call<number>({
      session: s.session,
      model: "indigo.design",
      method: "search_count",
      args: [domain],
      kwargs: {},
    });

    // hasImage only for THIS page's ids (cheap — bounded by limit).
    let withImage = new Set<number>();
    if (records.length) {
      const ids = records.map((r) => r.id);
      const attachments = await call<Array<{ res_id: number }>>({
        session: s.session,
        model: "ir.attachment",
        method: "search_read",
        args: [
          [
            ["res_model", "=", "indigo.design"],
            ["res_id", "in", ids],
          ],
          ["res_id"],
        ],
        kwargs: { limit: ids.length * 4 },
      }).catch(() => [] as Array<{ res_id: number }>);
      withImage = new Set(attachments.map((a) => a.res_id));
    }

    const me = s.user.id;
    const out = records.map((d) => ({
      id: d.id,
      code: d.code,
      name: typeof d.name === "string" ? d.name : "",
      door_type: (d.door_type as string) || "",
      allowed_colors: (d.allowed_colors as string) || "",
      min_width: Number(d.min_width) || 0,
      max_width: Number(d.max_width) || 0,
      min_height: Number(d.min_height) || 0,
      max_height: Number(d.max_height) || 0,
      hasImage: withImage.has(d.id),
      favorite: (d.favorite_user_ids || []).includes(me),
    }));

    return NextResponse.json({ records: out, total, limit, offset });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

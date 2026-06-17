import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const s = await requireSession();
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 500);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const q = url.searchParams.get("q") ?? "";

    const domain: unknown[] = [];
    if (q) {
      domain.push("|");
      domain.push(["code", "ilike", q]);
      domain.push(["name", "ilike", q]);
    }

    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "indigo.design",
      method: "search_read",
      args: [domain, ["id", "code", "name", "description", "door_type", "active"]],
      kwargs: { order: "code asc", limit, offset, context: { active_test: false } },
    });
    const total = await call<number>({
      session: s.session,
      model: "indigo.design",
      method: "search_count",
      args: [domain],
      kwargs: {},
    });
    return NextResponse.json({ records, total, limit, offset });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/catalog/designs — create a new design.
 *
 * Body: { code, name, door_type?, description? }
 * code is required and must be unique (Odoo enforces via _sql_constraints).
 */
export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await req.json()) as Partial<{
      code: string;
      name: string;
      door_type: string;
      description: string;
      active: boolean;
      allowed_colors: string;
      allowed_glass_types: string;
      allowed_brand_ids: number[];
      min_width: number;
      max_width: number;
      min_height: number;
      max_height: number;
    }>;
    const code = (body.code || "").trim().toUpperCase();
    if (!code) {
      return NextResponse.json({ error: "Code is required." }, { status: 400 });
    }

    // Base fields (always supported). Variation fields are split out so a
    // legacy DB without them can still create the design (mirrors PUT).
    const baseVals: Record<string, unknown> = { code };
    if (body.name) baseVals.name = body.name;
    if (body.door_type) baseVals.door_type = body.door_type;
    if (body.description) baseVals.description = body.description;
    if (body.active !== undefined) baseVals.active = body.active;

    const variationVals: Record<string, unknown> = {};
    if (body.allowed_colors) variationVals.allowed_colors = body.allowed_colors;
    if (body.allowed_glass_types)
      variationVals.allowed_glass_types = body.allowed_glass_types;
    if (body.allowed_brand_ids && body.allowed_brand_ids.length)
      variationVals.allowed_brand_ids = [[6, 0, body.allowed_brand_ids]];
    if (body.min_width) variationVals.min_width = body.min_width;
    if (body.max_width) variationVals.max_width = body.max_width;
    if (body.min_height) variationVals.min_height = body.min_height;
    if (body.max_height) variationVals.max_height = body.max_height;

    let id: number;
    try {
      id = await call<number>({
        session: s.session,
        model: "indigo.design",
        method: "create",
        args: [{ ...baseVals, ...variationVals }],
        kwargs: {},
      });
    } catch (err) {
      // Legacy DB without the variation columns: create with base only so the
      // design still gets made (variations are simply not stored).
      const msg = err instanceof Error ? err.message : "";
      if (!/Invalid field|does not exist/i.test(msg)) throw err;
      id = await call<number>({
        session: s.session,
        model: "indigo.design",
        method: "create",
        args: [baseVals],
        kwargs: {},
      });
    }
    return NextResponse.json({ id });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error";
    if (/unique|duplicate|already exists/i.test(msg)) {
      return NextResponse.json(
        { error: "A design with that code already exists — pick a different code." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

const BASE_FIELDS = ["id", "code", "name", "description", "door_type", "active"];
const VARIATION_FIELDS = [
  "allowed_colors",
  "allowed_glass_types",
  "allowed_brand_ids",
  "min_width",
  "max_width",
  "min_height",
  "max_height",
];

interface Design {
  id: number;
  code: string;
  name: string | false;
  description: string | false;
  door_type: string | false;
  active: boolean;
  allowed_colors?: string | false;
  allowed_glass_types?: string | false;
  allowed_brand_ids?: number[];
  min_width?: number;
  max_width?: number;
  min_height?: number;
  max_height?: number;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await context.params;
    const id = Number(idStr);

    // First try with the full field set (including variation specs). If the
    // Odoo addon hasn't been deployed with those fields yet, fall back to
    // the base fields so the editor still works.
    let records: Design[];
    let supportsVariations = true;
    try {
      records = await call<Design[]>({
        session: s.session,
        model: "indigo.design",
        method: "read",
        args: [[id], [...BASE_FIELDS, ...VARIATION_FIELDS]],
        kwargs: { context: { active_test: false } },
      });
    } catch {
      supportsVariations = false;
      records = await call<Design[]>({
        session: s.session,
        model: "indigo.design",
        method: "read",
        args: [[id], BASE_FIELDS],
        kwargs: { context: { active_test: false } },
      });
    }
    if (!records.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const design = records[0];

    // Usage counter: how many order lines reference this design.
    const usedIn = await call<number>({
      session: s.session,
      model: "indigo.order.line",
      method: "search_count",
      args: [[["design_id", "=", id]]],
      kwargs: {},
    });

    // Latest attachment used as the design image (we store via ir.attachment
    // because the indigo.design DB doesn't have an image column in prod).
    const attachments = await call<Array<{ id: number; mimetype: string }>>({
      session: s.session,
      model: "ir.attachment",
      method: "search_read",
      args: [
        [
          ["res_model", "=", "indigo.design"],
          ["res_id", "=", id],
        ],
        ["id", "mimetype"],
      ],
      kwargs: { order: "create_date desc", limit: 1 },
    });
    const attId = attachments[0]?.id ?? null;
    const imageUrl = attId ? `/api/catalog/designs/${id}/image?v=${attId}` : null;

    // Linked storefront product (visibility state + public URL for the panel).
    const ODOO_URL = process.env.ODOO_URL ?? "http://localhost:8069";
    let product: { id: number; is_published: boolean; website_url: string } | null = null;
    try {
      const prods = await call<
        Array<{ id: number; is_published: boolean; website_url: string }>
      >({
        session: s.session,
        model: "product.template",
        method: "search_read",
        args: [
          [["indigo_design_id", "=", id]],
          ["id", "is_published", "website_url"],
        ],
        kwargs: { limit: 1, order: "id" },
      });
      if (prods.length) {
        const p = prods[0];
        product = {
          id: p.id,
          is_published: !!p.is_published,
          website_url: p.website_url ? `${ODOO_URL}${p.website_url}` : `${ODOO_URL}/shop`,
        };
      }
    } catch {
      product = null;
    }

    return NextResponse.json({ design, usedIn, imageUrl, supportsVariations, product });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: idStr } = await context.params;
    const id = Number(idStr);
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

    const baseVals: Record<string, unknown> = {};
    if (body.code !== undefined) baseVals.code = body.code;
    if (body.name !== undefined) baseVals.name = body.name;
    if (body.door_type !== undefined) baseVals.door_type = body.door_type || false;
    if (body.description !== undefined) baseVals.description = body.description;
    if (body.active !== undefined) baseVals.active = body.active;

    const variationVals: Record<string, unknown> = {};
    if (body.allowed_colors !== undefined)
      variationVals.allowed_colors = body.allowed_colors || false;
    if (body.allowed_glass_types !== undefined)
      variationVals.allowed_glass_types = body.allowed_glass_types || false;
    if (body.allowed_brand_ids !== undefined)
      variationVals.allowed_brand_ids = [[6, 0, body.allowed_brand_ids]];
    if (body.min_width !== undefined) variationVals.min_width = body.min_width;
    if (body.max_width !== undefined) variationVals.max_width = body.max_width;
    if (body.min_height !== undefined) variationVals.min_height = body.min_height;
    if (body.max_height !== undefined) variationVals.max_height = body.max_height;

    if (!Object.keys(baseVals).length && !Object.keys(variationVals).length) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    // Two passes so the base save still succeeds if the Odoo addon
    // doesn't have the variation fields yet (legacy DBs).
    if (Object.keys(baseVals).length) {
      await call({
        session: s.session,
        model: "indigo.design",
        method: "write",
        args: [[id], baseVals],
        kwargs: {},
      });
    }
    if (Object.keys(variationVals).length) {
      try {
        await call({
          session: s.session,
          model: "indigo.design",
          method: "write",
          args: [[id], variationVals],
          kwargs: {},
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (!/Invalid field|does not exist/i.test(msg)) throw err;
        // else: legacy DB, silently drop the variation save.
      }
    }
    return NextResponse.json({ ok: true });
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

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !s.user.isAdmin) {
      return NextResponse.json({ error: "Manager only" }, { status: 403 });
    }
    const { id: idStr } = await context.params;
    const id = Number(idStr);

    // Refuse if the design is referenced by any order line — archive it
    // instead by toggling active=false. This preserves order history.
    const inUse = await call<number>({
      session: s.session,
      model: "indigo.order.line",
      method: "search_count",
      args: [[["design_id", "=", id]]],
      kwargs: {},
    });
    if (inUse > 0) {
      return NextResponse.json(
        {
          error: `Design is used by ${inUse} order line(s). Archive it instead.`,
          inUse,
        },
        { status: 409 },
      );
    }

    await call({
      session: s.session,
      model: "indigo.design",
      method: "unlink",
      args: [[id]],
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

import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { getPublicBaseUrl } from "@/lib/odoo/public-url";

/**
 * POST /api/catalog/designs/:id/publish  body: { published: boolean }
 *
 * Publishes / unpublishes the storefront product(s) linked to this design
 * (product.template.indigo_design_id = id). If publishing and no product exists
 * yet (legacy designs created before auto-publish), one is created. Returns the
 * resulting state so the UI can update the toggle.
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
    const { id: idStr } = await context.params;
    const id = Number(idStr);
    const body = (await req.json()) as { published?: boolean };
    const published = body.published !== false; // default true

    // The design's code/name for a product we may need to create.
    const design = await call<Array<{ code: string; name: string }>>({
      session: s.session,
      model: "indigo.design",
      method: "read",
      args: [[id], ["code", "name"]],
      kwargs: { context: { active_test: false } },
    });
    if (!design.length) {
      return NextResponse.json({ error: "Design not found" }, { status: 404 });
    }

    const prods = await call<number[]>({
      session: s.session,
      model: "product.template",
      method: "search",
      args: [[["indigo_design_id", "=", id]]],
      kwargs: {},
    });

    async function writePublish(ids: number[]) {
      // website_published may not be directly writable on every build → fallback.
      const attempts: Record<string, unknown>[] = [
        { is_published: published, website_published: published },
        { is_published: published },
      ];
      for (const vals of attempts) {
        try {
          await call({
            session: s.session,
            model: "product.template",
            method: "write",
            args: [ids, vals],
            kwargs: {},
          });
          return;
        } catch {
          /* try next */
        }
      }
    }

    let productIds = prods;
    if (prods.length) {
      await writePublish(prods);
    } else if (published) {
      // No product yet — create one (published).
      const baseProd: Record<string, unknown> = {
        name: design[0].name || design[0].code,
        type: "consu",
        list_price: 0,
        sale_ok: true,
        is_indigo_design: true,
        indigo_design_id: id,
      };
      const attempts: Record<string, unknown>[] = [
        { ...baseProd, is_published: true, website_published: true },
        { ...baseProd, is_published: true },
      ];
      let newId: number | null = null;
      for (const vals of attempts) {
        try {
          newId = await call<number>({
            session: s.session,
            model: "product.template",
            method: "create",
            args: [vals],
            kwargs: {},
          });
          break;
        } catch {
          newId = null;
        }
      }
      productIds = newId ? [newId] : [];
    }

    // Read back the resulting URL/state for the first product.
    let product: { id: number; is_published: boolean; website_url: string } | null = null;
    if (productIds.length) {
      const read = await call<
        Array<{ id: number; is_published: boolean; website_url: string }>
      >({
        session: s.session,
        model: "product.template",
        method: "read",
        args: [[productIds[0]], ["id", "is_published", "website_url"]],
        kwargs: {},
      });
      if (read.length) {
        const p = read[0];
        const base = await getPublicBaseUrl(s.session);
        product = {
          id: p.id,
          is_published: !!p.is_published,
          website_url: p.website_url ? `${base}${p.website_url}` : `${base}/shop`,
        };
      }
    }

    return NextResponse.json({ ok: true, published, count: productIds.length, product });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

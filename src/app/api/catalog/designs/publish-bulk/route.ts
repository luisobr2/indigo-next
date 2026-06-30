import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

/**
 * POST /api/catalog/designs/publish-bulk  body: { design_ids: number[]; published: boolean }
 *
 * Publishes / unpublishes every storefront product linked to the given designs
 * (product.template.indigo_design_id IN design_ids) in one write. Used by the
 * catalog grid for per-card and view-wide bulk visibility changes. Returns how
 * many products were affected.
 */
export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await req.json()) as { design_ids?: number[]; published?: boolean };
    const designIds = (body.design_ids || []).filter((n) => Number.isFinite(n));
    const published = body.published !== false;
    if (!designIds.length) {
      return NextResponse.json({ error: "No designs given." }, { status: 400 });
    }

    const prodIds = await call<number[]>({
      session: s.session,
      model: "product.template",
      method: "search",
      args: [[["indigo_design_id", "in", designIds]]],
      kwargs: {},
    });
    if (!prodIds.length) {
      return NextResponse.json({ ok: true, count: 0, published });
    }

    // website_published may not be directly writable on every build → fallback.
    const attempts: Record<string, unknown>[] = [
      { is_published: published, website_published: published },
      { is_published: published },
    ];
    let wrote = false;
    for (const vals of attempts) {
      try {
        await call({
          session: s.session,
          model: "product.template",
          method: "write",
          args: [prodIds, vals],
          kwargs: {},
        });
        wrote = true;
        break;
      } catch {
        /* try next */
      }
    }
    if (!wrote) {
      return NextResponse.json({ error: "Couldn't update visibility." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, count: prodIds.length, published });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

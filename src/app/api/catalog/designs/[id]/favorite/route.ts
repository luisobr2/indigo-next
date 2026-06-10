import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * POST   /api/catalog/designs/:id/favorite   — add to favourites
 * DELETE /api/catalog/designs/:id/favorite   — remove from favourites
 *
 * Toggles the current user in `indigo.design.favorite_user_ids`. No
 * role check — every internal user can keep their own catalog
 * shortlist, including specialists (Mario the painter can favourite
 * the designs he likes drafting).
 */
async function setFavorite(
  context: { params: Promise<{ id: string }> },
  add: boolean,
) {
  const s = await requireSession();
  const { id: idStr } = await context.params;
  const designId = Number(idStr);
  if (!Number.isFinite(designId)) {
    return NextResponse.json({ error: "Invalid design id" }, { status: 400 });
  }
  // Odoo many2many command: (3, id) removes, (4, id) adds.
  const cmd = add ? [4, s.user.id] : [3, s.user.id];
  try {
    await call({
      session: s.session,
      model: "indigo.design",
      method: "write",
      args: [[designId], { favorite_user_ids: [cmd] }],
      kwargs: {},
    });
  } catch (e) {
    // If the field doesn't exist yet (older Odoo), reply gracefully so
    // the UI still lets users browse the catalog.
    const msg = e instanceof Error ? e.message : "Error";
    if (msg.includes("favorite_user_ids")) {
      return NextResponse.json(
        { error: "Favourites not enabled — upgrade indigo_decors module." },
        { status: 503 },
      );
    }
    throw e;
  }
  return NextResponse.json({ ok: true, favorited: add });
}

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return await setFavorite(context, true);
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return await setFavorite(context, false);
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

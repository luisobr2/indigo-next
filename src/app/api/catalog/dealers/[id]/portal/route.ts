import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * PUT /api/catalog/dealers/[id]/portal
 * Body: { password: string }
 *
 * Sets the dealer's portal password, creating the portal user (login = email)
 * if it doesn't exist yet. Manager/office only.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = (await req.json()) as { password?: string };
    const password = (body.password ?? "").trim();
    if (!password) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    const res = await call<{ ok: boolean; login: string; created: boolean }>({
      session: s.session,
      model: "res.partner",
      method: "indigo_dealer_set_password",
      args: [id, password],
      kwargs: {},
    });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

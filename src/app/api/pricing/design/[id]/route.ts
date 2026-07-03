import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * PATCH /api/pricing/design/[id] — set one design's own price.
 * Body: { dealer_price_override: number }  (0 clears it → design uses base)
 * Manager / office / admin only. Auto-saved from the Pricing screen input.
 */
export async function PATCH(
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
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }
    const body = (await req.json()) as { dealer_price_override?: number };
    const price = Number(body.dealer_price_override);
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json(
        { error: "dealer_price_override must be a number >= 0" },
        { status: 400 },
      );
    }
    await call({
      session: s.session,
      model: "indigo.design",
      method: "write",
      args: [[id], { dealer_price_override: Math.round(price * 100) / 100 }],
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

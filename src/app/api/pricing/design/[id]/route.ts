import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * PATCH /api/pricing/design/[id] — set one design's price tier.
 * Body: { dealer_tier: "basic" | "full_partial" }
 * Manager / office / admin only. Used by the auto-saving toggle on the
 * Pricing screen.
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
    const { dealer_tier } = (await req.json()) as { dealer_tier?: string };
    if (dealer_tier !== "basic" && dealer_tier !== "full_partial") {
      return NextResponse.json(
        { error: "dealer_tier must be 'basic' or 'full_partial'" },
        { status: 400 },
      );
    }
    await call({
      session: s.session,
      model: "indigo.design",
      method: "write",
      args: [[id], { dealer_tier }],
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

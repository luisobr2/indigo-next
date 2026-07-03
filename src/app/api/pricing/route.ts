import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * GET /api/pricing
 *   → { matrix: [{id, door_type, tier, price, active}],
 *       designs: [{id, code, name, door_type, dealer_tier}] }
 *
 * The base-price matrix (indigo.design.price) is 4 rows (SD/DD x basic/
 * full_partial). Each design points at a tier via dealer_tier, so the shown
 * price = matrix[door_type][design.dealer_tier].
 */
interface MatrixRow {
  id: number;
  door_type: string;
  tier: string;
  price: number;
  active: boolean;
}
interface DesignRow {
  id: number;
  code: string;
  name: string | false;
  door_type: string | false;
  dealer_price_override: number;
}

export async function GET() {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const [matrix, designs] = await Promise.all([
      call<MatrixRow[]>({
        session: s.session,
        model: "indigo.design.price",
        method: "search_read",
        args: [[], ["id", "door_type", "tier", "price", "active"]],
        kwargs: { order: "door_type, tier" },
      }),
      call<DesignRow[]>({
        session: s.session,
        model: "indigo.design",
        method: "search_read",
        args: [
          [["active", "=", true]],
          ["id", "code", "name", "door_type", "dealer_price_override"],
        ],
        kwargs: { order: "code", limit: 2000 },
      }),
    ]);
    return NextResponse.json({ matrix, designs });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/pricing  — update the base-price matrix.
 * Body: { rows: [{ id: number, price: number }] }
 * Manager / office / admin only.
 */
export async function PUT(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await req.json()) as { rows?: Array<{ id: number; price: number }> };
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const clean = rows
      .filter((r) => Number.isInteger(r.id) && Number.isFinite(r.price) && r.price >= 0)
      .map((r) => ({ id: r.id, price: Math.round(r.price * 100) / 100 }));
    if (!clean.length) {
      return NextResponse.json({ error: "No valid rows" }, { status: 400 });
    }
    // One write per distinct price value (batched over the ids that share it),
    // so 4 rows with the same price collapse to a single call.
    const byPrice = new Map<number, number[]>();
    for (const r of clean) {
      const g = byPrice.get(r.price) ?? [];
      g.push(r.id);
      byPrice.set(r.price, g);
    }
    await Promise.all(
      [...byPrice.entries()].map(([price, ids]) =>
        call({
          session: s.session,
          model: "indigo.design.price",
          method: "write",
          args: [ids, { price }],
          kwargs: {},
        }),
      ),
    );
    return NextResponse.json({ ok: true, updated: clean.length });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

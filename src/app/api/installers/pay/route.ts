import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { buildPayData, MAX_RANGE_DAYS, daysBetween, resolveRange } from "@/lib/installers/pay-data";

export const runtime = "nodejs";

/**
 * GET /api/installers/pay?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Thin: the range parsing and the assembly both live in
 * src/lib/installers/pay-data.ts so the Excel export builds from the very
 * same numbers instead of a second implementation of them.
 */
export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    // Puts every installer's pay side by side -- same gate as the
    // Installations board: specialists must not see each other's money.
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;
    const { startStr, endStr } = resolveRange(sp.get("from"), sp.get("to"), sp.get("week"));
    if (daysBetween(startStr, endStr) > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Range too wide - ${MAX_RANGE_DAYS} days maximum.` },
        { status: 400 },
      );
    }

    return NextResponse.json(await buildPayData({ session: s.session, startStr, endStr }));
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

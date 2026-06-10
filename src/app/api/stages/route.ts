import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * GET /api/stages
 *
 * Returns the full list of indigo.stage records sorted by sequence, so
 * the "Send to..." picker on every screen can build a target list
 * without hitting the per-order detail endpoint.
 */
export async function GET() {
  try {
    const s = await requireSession();
    const records = await call<
      Array<{ id: number; name: string; code: string; sequence: number }>
    >({
      session: s.session,
      model: "indigo.stage",
      method: "search_read",
      args: [[], ["id", "name", "code", "sequence"]],
      kwargs: { order: "sequence", limit: 50 },
    });
    return NextResponse.json({ records });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

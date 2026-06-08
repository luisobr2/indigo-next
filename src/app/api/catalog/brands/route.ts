import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

export async function GET() {
  try {
    const s = await requireSession();
    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "indigo.brand",
      method: "search_read",
      args: [[["active", "=", true]], ["id", "name", "code"]],
      kwargs: { order: "name asc" },
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

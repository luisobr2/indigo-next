import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

export async function GET() {
  try {
    const s = await requireSession();
    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "indigo.design",
      method: "search_read",
      args: [[], ["id", "code", "name", "description", "door_type"]],
      kwargs: { order: "code asc" },
    });
    return NextResponse.json({ records });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const s = await requireSession();
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 500);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const q = url.searchParams.get("q") ?? "";

    const domain: unknown[] = [];
    if (q) {
      domain.push("|");
      domain.push(["code", "ilike", q]);
      domain.push(["name", "ilike", q]);
    }

    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "indigo.design",
      method: "search_read",
      args: [domain, ["id", "code", "name", "description", "door_type"]],
      kwargs: { order: "code asc", limit, offset },
    });
    const total = await call<number>({
      session: s.session,
      model: "indigo.design",
      method: "search_count",
      args: [domain],
      kwargs: {},
    });
    return NextResponse.json({ records, total, limit, offset });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

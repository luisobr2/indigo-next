import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const s = await requireSession();
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200", 10), 1000);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const q = url.searchParams.get("q") ?? "";
    const archived = url.searchParams.get("archived") === "1";

    const domain: unknown[] = [];
    if (q) {
      domain.push("|");
      domain.push(["name", "ilike", q]);
      domain.push(["code", "ilike", q]);
    }

    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "indigo.brand",
      method: "search_read",
      args: [domain, ["id", "name", "code", "active", "notes"]],
      kwargs: {
        order: "name asc",
        limit,
        offset,
        context: { active_test: !archived },
      },
    });
    const total = await call<number>({
      session: s.session,
      model: "indigo.brand",
      method: "search_count",
      args: [domain],
      kwargs: { context: { active_test: !archived } },
    });
    return NextResponse.json({ records, total, limit, offset });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await req.json()) as Partial<{
      name: string;
      code: string;
      notes: string;
    }>;
    const name = (body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const vals: Record<string, unknown> = { name };
    if (body.code) vals.code = body.code.trim().toUpperCase();
    if (body.notes) vals.notes = body.notes;

    const id = await call<number>({
      session: s.session,
      model: "indigo.brand",
      method: "create",
      args: [vals],
      kwargs: {},
    });
    return NextResponse.json({ id });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

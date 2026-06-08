import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

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
      args: [domain, ["id", "code", "name", "description", "door_type", "active"]],
      kwargs: { order: "code asc", limit, offset, context: { active_test: false } },
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

/**
 * POST /api/catalog/designs — create a new design.
 *
 * Body: { code, name, door_type?, description? }
 * code is required and must be unique (Odoo enforces via _sql_constraints).
 */
export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await req.json()) as Partial<{
      code: string;
      name: string;
      door_type: string;
      description: string;
    }>;
    if (!body.code) {
      return NextResponse.json({ error: "code is required" }, { status: 400 });
    }
    const vals: Record<string, unknown> = { code: body.code };
    if (body.name) vals.name = body.name;
    if (body.door_type) vals.door_type = body.door_type;
    if (body.description) vals.description = body.description;

    const id = await call<number>({
      session: s.session,
      model: "indigo.design",
      method: "create",
      args: [vals],
      kwargs: {},
    });
    return NextResponse.json({ id });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

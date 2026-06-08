import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

const FIELDS = ["id", "name", "code", "active", "notes"];

interface Brand {
  id: number;
  name: string;
  code: string | false;
  active: boolean;
  notes: string | false;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await context.params;
    const id = Number(idStr);
    const records = await call<Brand[]>({
      session: s.session,
      model: "indigo.brand",
      method: "read",
      args: [[id], FIELDS],
      kwargs: { context: { active_test: false } },
    });
    if (!records.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const usedIn = await call<number>({
      session: s.session,
      model: "indigo.order.line",
      method: "search_count",
      args: [[["brand_id", "=", id]]],
      kwargs: {},
    });
    return NextResponse.json({ brand: records[0], usedIn });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: idStr } = await context.params;
    const id = Number(idStr);
    const body = (await req.json()) as Partial<{
      name: string;
      code: string;
      notes: string;
      active: boolean;
    }>;
    const vals: Record<string, unknown> = {};
    if (body.name !== undefined) vals.name = body.name;
    if (body.code !== undefined) vals.code = body.code || false;
    if (body.notes !== undefined) vals.notes = body.notes;
    if (body.active !== undefined) vals.active = body.active;
    if (!Object.keys(vals).length) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    await call({
      session: s.session,
      model: "indigo.brand",
      method: "write",
      args: [[id], vals],
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

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !s.user.isAdmin) {
      return NextResponse.json({ error: "Manager only" }, { status: 403 });
    }
    const { id: idStr } = await context.params;
    const id = Number(idStr);

    const inUse = await call<number>({
      session: s.session,
      model: "indigo.order.line",
      method: "search_count",
      args: [[["brand_id", "=", id]]],
      kwargs: {},
    });
    if (inUse > 0) {
      return NextResponse.json(
        {
          error: `Brand is used by ${inUse} order line(s). Archive it instead.`,
          inUse,
        },
        { status: 409 },
      );
    }

    await call({
      session: s.session,
      model: "indigo.brand",
      method: "unlink",
      args: [[id]],
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

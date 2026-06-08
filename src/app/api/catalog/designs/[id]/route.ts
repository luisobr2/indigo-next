import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

const FIELDS = ["id", "code", "name", "description", "door_type", "active"];

interface Design {
  id: number;
  code: string;
  name: string | false;
  description: string | false;
  door_type: string | false;
  active: boolean;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await context.params;
    const id = Number(idStr);
    const records = await call<Design[]>({
      session: s.session,
      model: "indigo.design",
      method: "read",
      args: [[id], FIELDS],
      kwargs: { context: { active_test: false } },
    });
    if (!records.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const design = records[0];

    // Usage counter: how many order lines reference this design.
    const usedIn = await call<number>({
      session: s.session,
      model: "indigo.order.line",
      method: "search_count",
      args: [[["design_id", "=", id]]],
      kwargs: {},
    });

    // Latest attachment used as the design image (we store via ir.attachment
    // because the indigo.design DB doesn't have an image column in prod).
    const attachments = await call<Array<{ id: number; mimetype: string }>>({
      session: s.session,
      model: "ir.attachment",
      method: "search_read",
      args: [
        [
          ["res_model", "=", "indigo.design"],
          ["res_id", "=", id],
        ],
        ["id", "mimetype"],
      ],
      kwargs: { order: "create_date desc", limit: 1 },
    });
    const attId = attachments[0]?.id ?? null;
    const imageUrl = attId ? `/api/catalog/designs/${id}/image?v=${attId}` : null;

    return NextResponse.json({ design, usedIn, imageUrl });
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
      code: string;
      name: string;
      door_type: string;
      description: string;
      active: boolean;
    }>;

    const vals: Record<string, unknown> = {};
    if (body.code !== undefined) vals.code = body.code;
    if (body.name !== undefined) vals.name = body.name;
    if (body.door_type !== undefined) vals.door_type = body.door_type || false;
    if (body.description !== undefined) vals.description = body.description;
    if (body.active !== undefined) vals.active = body.active;

    if (!Object.keys(vals).length) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    await call({
      session: s.session,
      model: "indigo.design",
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

    // Refuse if the design is referenced by any order line — archive it
    // instead by toggling active=false. This preserves order history.
    const inUse = await call<number>({
      session: s.session,
      model: "indigo.order.line",
      method: "search_count",
      args: [[["design_id", "=", id]]],
      kwargs: {},
    });
    if (inUse > 0) {
      return NextResponse.json(
        {
          error: `Design is used by ${inUse} order line(s). Archive it instead.`,
          inUse,
        },
        { status: 409 },
      );
    }

    await call({
      session: s.session,
      model: "indigo.design",
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

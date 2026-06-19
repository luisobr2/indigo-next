import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

async function requireManager() {
  const s = await requireSession();
  const role = deriveRole(s.user.groups);
  if (!role.isManager && !s.user.isAdmin) {
    throw NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return s;
}

/**
 * PUT — branches on the body:
 *   { action: "reset_password", password }
 *   { action: "set_active", active }
 *   otherwise → update { name, email, role }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireManager();
    const { id } = await params;
    const uid = parseInt(id, 10);
    const body = (await req.json()) as Record<string, unknown>;

    let method = "indigo_team_update";
    let args: unknown[] = [uid, { name: body.name, email: body.email, role: body.role }];
    if (body.action === "reset_password") {
      method = "indigo_team_reset_password";
      args = [uid, body.password];
    } else if (body.action === "set_active") {
      method = "indigo_team_set_active";
      args = [uid, !!body.active];
    }

    const res = await call<Record<string, unknown>>({
      session: s.session,
      model: "res.users",
      method,
      args,
      kwargs: {},
    });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

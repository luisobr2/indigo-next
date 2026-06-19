import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/** Only Indigo managers / system admins may manage team users. The Odoo
 *  methods enforce this too (sudo + group check); this is the first gate. */
async function requireManager() {
  const s = await requireSession();
  const role = deriveRole(s.user.groups);
  if (!role.isManager && !s.user.isAdmin) {
    throw NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return s;
}

export async function GET() {
  try {
    const s = await requireManager();
    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "res.users",
      method: "indigo_team_list",
      args: [],
      kwargs: {},
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

export async function POST(req: NextRequest) {
  try {
    const s = await requireManager();
    const body = (await req.json()) as Record<string, unknown>;
    const res = await call<{ id: number }>({
      session: s.session,
      model: "res.users",
      method: "indigo_team_create",
      args: [
        {
          name: body.name,
          login: body.email,
          password: body.password,
          role: body.role,
        },
      ],
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

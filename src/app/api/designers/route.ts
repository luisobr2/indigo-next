import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * GET /api/designers
 *
 * Active users in the Indigo "Disenador" group, for the "Send to
 * designer" picker on the Digitalization screen / order detail page.
 * Gated the same way as /api/orders/[id]/send-to-designer (office /
 * manager / admin) -- this is her picker, not the designer's, and the
 * Odoo method behind it (indigo_list_designers) enforces the same check
 * again server-side.
 */
export async function GET() {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const records = await call<
      Array<{ id: number; name: string; email: string }>
    >({
      session: s.session,
      model: "indigo.order",
      method: "indigo_list_designers",
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

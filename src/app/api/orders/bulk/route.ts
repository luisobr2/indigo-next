import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * POST /api/orders/bulk — bulk actions on selected orders.
 *   { ids: number[], action: "archive" | "unarchive" | "delete" }
 *
 * archive/unarchive flip indigo.order.active (manager or office).
 * delete unlinks the orders (manager / admin only — per the Odoo ACL).
 */
export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    const isManager = role.isManager || s.user.isAdmin;
    const canArchive = isManager || role.isOffice;

    const body = (await req.json()) as { ids?: number[]; action?: string };
    const ids = (body.ids ?? []).filter((n) => Number.isInteger(n));
    const action = body.action;
    if (!ids.length) {
      return NextResponse.json({ error: "No orders selected" }, { status: 400 });
    }

    if (action === "archive" || action === "unarchive") {
      if (!canArchive) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      await call({
        session: s.session,
        model: "indigo.order",
        method: "write",
        args: [ids, { active: action === "unarchive" }],
        kwargs: {},
      });
      return NextResponse.json({ ok: true, count: ids.length });
    }

    if (action === "delete") {
      if (!isManager) {
        return NextResponse.json(
          { error: "Only managers can delete orders." },
          { status: 403 },
        );
      }
      await call({
        session: s.session,
        model: "indigo.order",
        method: "unlink",
        args: [ids],
        kwargs: {},
      });
      return NextResponse.json({ ok: true, count: ids.length });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

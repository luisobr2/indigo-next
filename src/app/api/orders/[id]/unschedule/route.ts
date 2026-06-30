import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

/**
 * POST /api/orders/:id/unschedule
 *
 * Removes an installation from the calendar: clears installation_date and moves
 * the order back to "Ready for Installation" (ready_install) so it returns to
 * the Pending Scheduling list. Installer assignment is kept (so a later
 * reschedule still suggests them). The reverse of /schedule.
 */
export async function POST(
  _req: NextRequest,
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
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }

    const vals: Record<string, unknown> = { installation_date: false };

    // Move it back to "Ready for Installation" so it leaves the calendar and
    // reappears in Pending Scheduling. If the stage can't be resolved, we still
    // clear the date (the important part).
    const stages = await call<Array<{ id: number }>>({
      session: s.session,
      model: "indigo.stage",
      method: "search_read",
      args: [[["code", "=", "ready_install"]], ["id"]],
      kwargs: { limit: 1 },
    });
    if (stages[0]?.id) vals.stage_id = stages[0].id;

    await call({
      session: s.session,
      model: "indigo.order",
      method: "write",
      args: [[id], vals],
      kwargs: {},
    });

    // Leave an audit note in the chatter.
    try {
      await call({
        session: s.session,
        model: "indigo.order",
        method: "message_post",
        args: [[id]],
        kwargs: { body: "Removed from the installation calendar (unscheduled)." },
      });
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

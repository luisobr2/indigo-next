import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * POST /api/orders/:id/schedule
 *
 * Schedule an installation in one step from the Installations panel:
 *   - set installation_date (required)
 *   - optionally (re)assign installer_ids
 *   - move the order to the "Installation Scheduled" stage so it leaves the
 *     "Pending Scheduling" bucket and shows on the weekly board.
 *
 * Body: { installation_date: "YYYY-MM-DD"; installer_ids?: number[] }
 *
 * Restricted to managers/office/admin — same gate as the installations
 * dashboard, since scheduling drives installer payouts.
 */
export async function POST(
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
    const orderId = Number(idStr);
    if (!Number.isFinite(orderId)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }

    const body = (await req.json()) as {
      installation_date?: string;
      installer_ids?: number[];
    };

    const date = (body.installation_date || "").trim();
    // Basic YYYY-MM-DD guard — Odoo would reject a bad value anyway, but a
    // clear 400 beats a 500 from the RPC layer.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "installation_date (YYYY-MM-DD) is required" },
        { status: 400 },
      );
    }

    const vals: Record<string, unknown> = { installation_date: date };
    if (Array.isArray(body.installer_ids)) {
      // Odoo many2many command: replace with the chosen set.
      vals.installer_ids = [[6, 0, body.installer_ids]];
    }

    // Resolve the "Installation Scheduled" stage so the order leaves the
    // pending bucket. If the stage can't be found (renamed/missing) we still
    // set the date + installers and just skip the stage move.
    const stages = await call<Array<{ id: number }>>({
      session: s.session,
      model: "indigo.stage",
      method: "search_read",
      args: [[["code", "=", "install_scheduled"]], ["id"]],
      kwargs: { limit: 1 },
    }).catch(() => [] as Array<{ id: number }>);
    if (stages[0]?.id) {
      vals.stage_id = stages[0].id;
    }

    await call({
      session: s.session,
      model: "indigo.order",
      method: "write",
      args: [[orderId], vals],
      kwargs: {},
    });

    // Human-readable chatter line.
    await call({
      session: s.session,
      model: "indigo.order",
      method: "message_post",
      args: [[orderId]],
      kwargs: {
        body: `Installation scheduled for <b>${date}</b> from Next panel.`,
        message_type: "comment",
      },
    }).catch(() => undefined);

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

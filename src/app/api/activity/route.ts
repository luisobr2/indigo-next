import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * GET /api/activity?limit=20
 *
 * Global recent activity across all orders — used by the dashboard.
 * Pulls `mail.message` records scoped to model `indigo.order` plus the
 * matching order names so the UI can show "IND/2026/0042 · Started CNC".
 */
export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(parseInt(sp.get("limit") ?? "20", 10), 100);

    const messages = await call<
      Array<{
        id: number;
        date: string;
        author_id: [number, string] | false;
        body: string;
        subject: string | false;
        message_type: string;
        res_id: number;
        subtype_id: [number, string] | false;
      }>
    >({
      session: s.session,
      model: "mail.message",
      method: "search_read",
      args: [
        [["model", "=", "indigo.order"], ["res_id", "!=", false]],
        [
          "id",
          "date",
          "author_id",
          "body",
          "subject",
          "message_type",
          "res_id",
          "subtype_id",
        ],
      ],
      kwargs: { limit, order: "date desc" },
    });

    // Resolve order names in one batch read.
    const orderIds = Array.from(new Set(messages.map((m) => m.res_id)));
    const orders = orderIds.length
      ? await call<Array<{ id: number; name: string; stage_id: [number, string] | false }>>({
          session: s.session,
          model: "indigo.order",
          method: "read",
          args: [orderIds, ["id", "name", "stage_id"]],
          kwargs: {},
        })
      : [];
    const byId = new Map(orders.map((o) => [o.id, o]));

    const records = messages.map((m) => {
      const order = byId.get(m.res_id);
      return {
        id: m.id,
        date: m.date,
        author: m.author_id ? m.author_id[1] : "System",
        body: m.body,
        subject: m.subject,
        order_id: m.res_id,
        order_name: order?.name ?? `#${m.res_id}`,
        stage: order?.stage_id ? order.stage_id[1] : "",
      };
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

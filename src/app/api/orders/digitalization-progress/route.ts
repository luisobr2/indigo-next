import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * GET /api/orders/digitalization-progress
 *
 * Majela's daily counter for the Digitalization screen: "de las 8,
 * hiciste 6, te quedan 2" (docs/majela/audio-1-digitalizacion.md). Since
 * sending the Ficha now moves an order OUT of ready_digitalization
 * immediately (into CNC), a "sent" order disappears from the list -- so
 * "sent" can't be read off the list itself, it has to be tracked
 * separately (design_sent_date stamped today, regardless of the order's
 * CURRENT stage). "total" is sent + remaining by construction, matching
 * her own framing exactly (not a snapshot that would just equal
 * "remaining" once orders start leaving).
 */
export async function GET() {
  try {
    const s = await requireSession();
    const now = new Date();
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

    const [remaining, sent] = await Promise.all([
      call<number>({
        session: s.session,
        model: "indigo.order",
        method: "search_count",
        args: [[["stage_id.code", "=", "ready_digitalization"]]],
        kwargs: {},
      }),
      call<number>({
        session: s.session,
        model: "indigo.order",
        method: "search_count",
        args: [
          [
            ["design_sent_date", ">=", fmt(startOfDay)],
            ["design_sent_date", "<", fmt(endOfDay)],
          ],
        ],
        kwargs: {},
      }),
    ]);

    return NextResponse.json({ remaining, sent, total: remaining + sent });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

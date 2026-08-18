import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { shopStartOfDay, shopEndOfDay, toOdooDatetime } from "@/lib/shop-time";

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
    // "Hoy" es hoy EN MIAMI, no en UTC. Este servidor corre en UTC, y Miami
    // va 4-5 horas por detras -- asi que la medianoche UTC cae a las 8 (o 7)
    // de la tarde local. Con el corte en UTC, Majela trabajando a las 20:30
    // veia el contador del dia reiniciarse y todo lo que habia mandado esa
    // tarde desaparecer de la cuenta. Ver src/lib/shop-time.ts.
    const now = new Date();
    const startOfDay = shopStartOfDay(now);
    const endOfDay = shopEndOfDay(now);
    const fmt = toOdooDatetime;

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

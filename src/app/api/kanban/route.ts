import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * GET /api/kanban
 *
 * Returns everything the Kanban screen needs in one roundtrip:
 *  - stages: ordered by sequence (the 13 production stages)
 *  - cards: minimal order fields for the cards, grouped by stage_id
 *
 * Excludes closed/invoiced from the default view to keep the board sane;
 * `?archived=1` includes them so power users can drag old orders back if
 * the closure was a mistake.
 */
export async function GET(req: Request) {
  try {
    const s = await requireSession();
    const url = new URL(req.url);
    const includeArchived = url.searchParams.get("archived") === "1";

    interface Stage {
      id: number;
      name: string;
      code: string;
      sequence: number;
    }
    const stages = await call<Stage[]>({
      session: s.session,
      model: "indigo.stage",
      method: "search_read",
      args: [[], ["id", "name", "code", "sequence"]],
      kwargs: { order: "sequence, id", limit: 50 },
    });

    interface Card {
      id: number;
      name: string;
      stage_id: [number, string] | false;
      dealer_id: [number, string] | false;
      client_name: string;
      door_count: number;
      total_dealer_charge: number;
      days_in_current_stage: number;
      is_overdue: boolean;
      on_hold: boolean;
      payment_state: "paid" | "partial" | "unpaid";
    }
    const domain: unknown[] = includeArchived
      ? []
      : [["stage_id.code", "not in", ["closed", "invoiced"]]];

    const cards = await call<Card[]>({
      session: s.session,
      model: "indigo.order",
      method: "search_read",
      args: [
        domain,
        [
          "id",
          "name",
          "stage_id",
          "dealer_id",
          "client_name",
          "door_count",
          "total_dealer_charge",
          "days_in_current_stage",
          "is_overdue",
          "on_hold",
          "payment_state",
        ],
      ],
      kwargs: { order: "last_stage_change asc, id desc", limit: 1000 },
    });

    return NextResponse.json({ stages, cards });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

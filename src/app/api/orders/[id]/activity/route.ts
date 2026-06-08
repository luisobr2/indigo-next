import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);

    // Pull chatter messages — same source the Odoo backend chatter widget shows.
    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "mail.message",
      method: "search_read",
      args: [
        [
          ["model", "=", "indigo.order"],
          ["res_id", "=", id],
        ],
        [
          "id",
          "date",
          "author_id",
          "body",
          "subject",
          "message_type",
          "subtype_id",
          "tracking_value_ids",
        ],
      ],
      kwargs: { limit: 50, order: "date desc" },
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

import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * GET /api/catalog/designs/:id/images
 *
 * Returns the list of attachment ids+mimetypes for a design.
 * Used by the carousel in the Order Detail page.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await context.params;
    const id = Number(idStr);

    const attachments = await call<
      Array<{ id: number; name: string; mimetype: string; create_date: string }>
    >({
      session: s.session,
      model: "ir.attachment",
      method: "search_read",
      args: [
        [
          ["res_model", "=", "indigo.design"],
          ["res_id", "=", id],
        ],
        ["id", "name", "mimetype", "create_date"],
      ],
      kwargs: { order: "create_date asc" },
    });

    return NextResponse.json({ records: attachments });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

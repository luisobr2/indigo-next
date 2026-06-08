import { NextRequest, NextResponse } from "next/server";
import { call, odooReportUrl, odooImageUrl } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

const FIELDS = [
  "id",
  "name",
  "dealer_id",
  "dealer_ref",
  "client_name",
  "client_phone",
  "client_email",
  "client_address",
  "stage_id",
  "stage_code",
  "on_hold",
  "hold_reason",
  "payment_state",
  "price_per_sqf",
  "total_dealer_charge",
  "total_sqf",
  "total_painter_payout",
  "total_installer_payout",
  "door_count",
  "assigned_user_ids",
  "painter_id",
  "installer_ids",
  "installation_date",
  "expected_completion_date",
  "days_in_current_stage",
  "is_overdue",
  "create_date",
  "write_date",
  "priv_ref",
  "line_ids",
  "notes",
];

const LINE_FIELDS = [
  "id",
  "design_id",
  "door_type",
  "color",
  "color_custom",
  "glass_type",
  "is_privacy_glass",
  "glass_privacy",
  "brand_id",
  "customer_name",
  "width",
  "height",
  "width_label",
  "height_label",
  "qty",
  "sqf",
  "notes_line",
  "sequence",
];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }

    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "indigo.order",
      method: "read",
      args: [[id], FIELDS],
      kwargs: {},
    });
    if (!records.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const order = records[0];

    const lineIds = (order.line_ids ?? []) as number[];
    const lines = lineIds.length
      ? await call<Array<Record<string, unknown>>>({
          session: s.session,
          model: "indigo.order.line",
          method: "read",
          args: [lineIds, LINE_FIELDS],
          kwargs: {},
        })
      : [];

    // Stage history for the progress timeline
    type StageRow = { id: number; name: string; sequence: number; code: string };
    const stages = await call<StageRow[]>({
      session: s.session,
      model: "indigo.stage",
      method: "search_read",
      args: [[], ["id", "name", "sequence", "code"]],
      kwargs: { order: "sequence asc" },
    });

    return NextResponse.json({
      order,
      lines,
      stages,
      labelPdfUrl: odooReportUrl("indigo_decors.report_order_label_doc", id),
      paintSheetPdfUrl: odooReportUrl(
        "indigo_decors.report_painter_sheet_doc",
        id,
      ),
      orderCardPdfUrl: odooReportUrl(
        "indigo_decors.report_order_card_doc",
        id,
      ),
      designImage: lines[0]?.design_id
        ? odooImageUrl(
            "indigo.design",
            ((lines[0].design_id as [number, string])?.[0] ?? 0) as number,
            "image_1024",
          )
        : null,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error fetching order";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    const body = await req.json();
    const ok = await call<boolean>({
      session: s.session,
      model: "indigo.order",
      method: "write",
      args: [[id], body],
      kwargs: {},
    });
    return NextResponse.json({ ok });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error updating order";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

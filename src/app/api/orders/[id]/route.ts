import { NextRequest, NextResponse } from "next/server";
import { call, odooReportUrl } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * Field sets to request from Odoo. The "v2" lists include the new fields
 * Majela's 2026-06-08 mockup review added. We request the full set first
 * and fall back to the base set when the Odoo upgrade hasn't landed yet,
 * so the order detail still works against an old Odoo backend.
 */
const ORDER_FIELDS_BASE = [
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

const ORDER_FIELDS_V2_EXTRA = [
  "digi_started_at",
  "digi_done_at",
  "cnc_started_at",
  "cnc_done_at",
  "paint_started_at",
  "paint_done_at",
  "cancelled_at",
  "cancellation_reason",
];

const LINE_FIELDS_BASE = [
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

const LINE_FIELDS_V2_EXTRA = [
  "material",
  "thickness",
  "paint_sides",
  "sidelite_margin_left",
  "sidelite_margin_right",
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

    // Try the v2 field set first (with cancellation + sub-status
    // timestamps) and fall back to base if the Odoo addon hasn't been
    // upgraded yet. Same trick on the lines below.
    let records: Array<Record<string, unknown>>;
    try {
      records = await call<Array<Record<string, unknown>>>({
        session: s.session,
        model: "indigo.order",
        method: "read",
        args: [[id], [...ORDER_FIELDS_BASE, ...ORDER_FIELDS_V2_EXTRA]],
        kwargs: {},
      });
    } catch {
      records = await call<Array<Record<string, unknown>>>({
        session: s.session,
        model: "indigo.order",
        method: "read",
        args: [[id], ORDER_FIELDS_BASE],
        kwargs: {},
      });
    }
    if (!records.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const order = records[0];

    const lineIds = (order.line_ids ?? []) as number[];
    let lines: Array<Record<string, unknown>> = [];
    if (lineIds.length) {
      try {
        lines = await call<Array<Record<string, unknown>>>({
          session: s.session,
          model: "indigo.order.line",
          method: "read",
          args: [lineIds, [...LINE_FIELDS_BASE, ...LINE_FIELDS_V2_EXTRA]],
          kwargs: {},
        });
      } catch {
        lines = await call<Array<Record<string, unknown>>>({
          session: s.session,
          model: "indigo.order.line",
          method: "read",
          args: [lineIds, LINE_FIELDS_BASE],
          kwargs: {},
        });
      }
    }

    // Stage history for the progress timeline
    type StageRow = { id: number; name: string; sequence: number; code: string };
    const stages = await call<StageRow[]>({
      session: s.session,
      model: "indigo.stage",
      method: "search_read",
      args: [[], ["id", "name", "sequence", "code"]],
      kwargs: { order: "sequence asc" },
    });

    // Enrich installer_ids (Odoo `read` only returns IDs for many2many).
    interface PartnerRow {
      id: number;
      name: string;
    }
    const installerIds = (order.installer_ids ?? []) as number[];
    const installers = installerIds.length
      ? await call<PartnerRow[]>({
          session: s.session,
          model: "res.partner",
          method: "read",
          args: [installerIds, ["id", "name"]],
          kwargs: {},
        })
      : [];

    return NextResponse.json({
      order,
      lines,
      stages,
      installers,
      labelPdfUrl: odooReportUrl("indigo_decors.report_order_label_doc", id),
      paintSheetPdfUrl: odooReportUrl(
        "indigo_decors.report_painter_sheet_doc",
        id,
      ),
      orderCardPdfUrl: odooReportUrl(
        "indigo_decors.report_order_card_doc",
        id,
      ),
      // Image of the first design (proxy endpoint handles missing images
      // with a clean 404 so the order detail can fall back to a placeholder).
      designImage: lines[0]?.design_id
        ? `/api/catalog/designs/${((lines[0].design_id as [number, string])?.[0] ?? 0) as number}/image`
        : null,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error fetching order";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Allow-list of indigo.order fields the panel UI may edit through the
 * PUT endpoint. Excludes anything that should only move through a
 * dedicated action: stage_id (go through /stage), is_stock /
 * cancelled_at (Cancel modal), payment_state (Billing), etc.
 */
const EDITABLE_ORDER_FIELDS = [
  "client_name",
  "client_phone",
  "client_email",
  "client_address",
  "dealer_ref",
  "priv_ref",
  "notes",
  "installation_date",
  "expected_completion_date",
] as const;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    const raw = (await req.json()) as Record<string, unknown>;
    const vals: Record<string, unknown> = {};
    for (const k of EDITABLE_ORDER_FIELDS) {
      if (k in raw) vals[k] = raw[k];
    }
    if (Object.keys(vals).length === 0) {
      return NextResponse.json(
        { error: "No editable fields provided" },
        { status: 400 },
      );
    }
    const ok = await call<boolean>({
      session: s.session,
      model: "indigo.order",
      method: "write",
      args: [[id], vals],
      kwargs: {},
    });
    return NextResponse.json({ ok });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error updating order";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

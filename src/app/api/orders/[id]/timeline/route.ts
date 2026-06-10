import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * GET /api/orders/:id/timeline
 *
 * Returns the date the order entered each stage. Uses two sources:
 *
 *  1. The explicit timestamp fields on indigo.order (cnc_started_at,
 *     paint_done_at, installation_date, cancelled_at…). These are
 *     authoritative when present.
 *  2. The mail.message tracking values for stage_id transitions —
 *     covers stages we don't have a dedicated timestamp for
 *     (design_pending, design_confirmed, ready_install, installed,
 *     invoiced, closed).
 *
 * The endpoint never invents a date: stages the order has not entered
 * come back with date=null.
 */

const STAGE_ORDER = [
  "new",
  "design_pending",
  "design_confirmed",
  "measure_pending",
  "measured",
  "ready_digitalization",
  "cnc",
  "painting",
  "ready_install",
  "install_scheduled",
  "installed",
  "invoiced",
  "closed",
] as const;

const STAGE_LABEL: Record<string, string> = {
  new: "New Order",
  design_pending: "Design Confirmation Pending",
  design_confirmed: "Design Confirmed",
  measure_pending: "Measurement Pending",
  measured: "Measured",
  ready_digitalization: "Ready for Digitalization",
  cnc: "CNC / Router",
  painting: "Painting",
  ready_install: "Ready for Installation",
  install_scheduled: "Installation Scheduled",
  installed: "Installed",
  invoiced: "Invoiced / Paid",
  closed: "Closed",
};

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await context.params;
    const orderId = Number(idStr);
    if (!Number.isFinite(orderId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    // 1. Load the order's explicit timestamps.
    const [order] = await call<
      Array<{
        id: number;
        create_date: string;
        stage_code: string;
        digi_started_at?: string | false;
        digi_done_at?: string | false;
        cnc_started_at?: string | false;
        cnc_done_at?: string | false;
        paint_started_at?: string | false;
        paint_done_at?: string | false;
        cancelled_at?: string | false;
        installation_date?: string | false;
      }>
    >({
      session: s.session,
      model: "indigo.order",
      method: "read",
      args: [
        [orderId],
        [
          "id",
          "create_date",
          "stage_code",
          "digi_started_at",
          "digi_done_at",
          "cnc_started_at",
          "cnc_done_at",
          "paint_started_at",
          "paint_done_at",
          "cancelled_at",
          "installation_date",
        ],
      ],
      kwargs: {},
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // 2. Pull stage transition tracking from chatter. Odoo records every
    //    stage_id change in mail.tracking.value linked to a mail.message.
    //    We read the messages + their tracking values once and bucket by
    //    target stage code.
    interface TrackingVal {
      id: number;
      field_desc: string;
      new_value_char: string | false;
      mail_message_id: [number, string] | false;
    }
    // Match BOTH the English ("Stage") and Spanish ("Etapa") labels so a
    // tenant running Odoo in es_ES doesn't lose the timeline. We OR the
    // two clauses; everything else gets filtered out post-fetch.
    const trackings = await call<TrackingVal[]>({
      session: s.session,
      model: "mail.tracking.value",
      method: "search_read",
      args: [
        [
          ["mail_message_id.model", "=", "indigo.order"],
          ["mail_message_id.res_id", "=", orderId],
          "|",
          ["field_desc", "ilike", "stage"],
          ["field_desc", "ilike", "etapa"],
        ],
        ["id", "field_desc", "new_value_char", "mail_message_id"],
      ],
      kwargs: { order: "id asc" },
    }).catch(() => [] as TrackingVal[]);

    // Need the message dates — read them in one go.
    const msgIds = Array.from(
      new Set(
        trackings
          .map((t) => (t.mail_message_id && Array.isArray(t.mail_message_id) ? t.mail_message_id[0] : 0))
          .filter(Boolean),
      ),
    );
    interface MailMsg {
      id: number;
      date: string;
    }
    const msgs = msgIds.length
      ? await call<MailMsg[]>({
          session: s.session,
          model: "mail.message",
          method: "read",
          args: [msgIds, ["id", "date"]],
          kwargs: {},
        })
      : [];
    const dateOfMsg = new Map(msgs.map((m) => [m.id, m.date]));

    // 3. Map { stage_name (display) → first time we saw a transition to it }.
    const stageNameToCode = new Map<string, string>();
    for (const [code, label] of Object.entries(STAGE_LABEL)) {
      stageNameToCode.set(label.toLowerCase(), code);
      stageNameToCode.set(code.toLowerCase(), code);
    }
    const enteredAt = new Map<string, string>();
    for (const t of trackings) {
      const newName = (t.new_value_char || "").toLowerCase();
      const code = stageNameToCode.get(newName);
      if (!code) continue;
      const msgId = t.mail_message_id && Array.isArray(t.mail_message_id) ? t.mail_message_id[0] : 0;
      const date = dateOfMsg.get(msgId);
      if (!date) continue;
      if (!enteredAt.has(code)) enteredAt.set(code, date);
    }

    // 4. Layer in the explicit fields on top of the tracking-derived
    //    dates. The explicit fields win when both exist.
    const explicit: Record<string, string | false | undefined> = {
      new: order.create_date,
      ready_digitalization: order.digi_started_at,
      cnc: order.cnc_started_at,
      painting: order.paint_started_at,
      installed: order.installation_date,
    };

    const timeline = STAGE_ORDER.map((code) => {
      const explicitDate = explicit[code];
      const trackingDate = enteredAt.get(code);
      const date =
        (typeof explicitDate === "string" && explicitDate) || trackingDate || null;
      const isCurrent = order.stage_code === code;
      return {
        code,
        label: STAGE_LABEL[code],
        date: date ?? null,
        isCurrent,
      };
    });

    // Cancelled flag rides on top of the linear timeline.
    return NextResponse.json({
      timeline,
      cancelled_at: order.cancelled_at || null,
      current_stage_code: order.stage_code,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

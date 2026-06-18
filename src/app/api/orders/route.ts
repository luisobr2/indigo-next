import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

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
  "customer_po",
];

const ORDER_FIELDS_V2_EXTRA = [
  "digi_started_at",
  "digi_done_at",
  "cnc_started_at",
  "cnc_done_at",
  "paint_started_at",
  "paint_done_at",
  "cancelled_at",
];

/**
 * GET /api/orders
 *   ?stage=cnc          filter by stage code
 *   ?stages=cnc,painting  multiple stages
 *   ?dealer=12          filter by dealer id
 *   ?q=text             search client_name/name
 *   ?limit=N            default 80
 *   ?offset=N
 */
export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const sp = req.nextUrl.searchParams;

    const domain: unknown[] = [];
    const stage = sp.get("stage");
    const stages = sp.get("stages");
    if (stage) domain.push(["stage_id.code", "=", stage]);
    else if (stages) domain.push(["stage_id.code", "in", stages.split(",")]);

    const dealer = sp.get("dealer");
    if (dealer) domain.push(["dealer_id", "=", Number(dealer)]);

    const onHold = sp.get("on_hold");
    if (onHold === "true") domain.push(["on_hold", "=", true]);

    const overdue = sp.get("overdue");
    if (overdue === "true") domain.push(["is_overdue", "=", true]);

    const payment = sp.get("payment");
    if (payment) {
      const parts = payment.split(",").filter(Boolean);
      if (parts.length === 1) {
        domain.push(["payment_state", "=", parts[0]]);
      } else if (parts.length > 1) {
        domain.push(["payment_state", "in", parts]);
      }
    }

    // ?substatus=ready|in_progress|completed|on_hold|cancelled
    // Filters within a stage based on the sub-status timestamps. Only
    // meaningful in combination with ?stage=cnc / digitalization / painting.
    //
    // We push these onto a separate `substatusDomain` because they reference
    // v2-only fields. If Odoo errors on them (legacy DB without the upgrade),
    // we retry without and the page still renders.
    const substatus = sp.get("substatus");
    const substatusDomain: unknown[] = [];
    // `on_hold` and `cancelled` are stage-agnostic — apply them whenever
    // substatus is set, regardless of `stage` vs `stages`.
    if (substatus === "on_hold") {
      substatusDomain.push(["on_hold", "=", true]);
    } else if (substatus === "cancelled") {
      substatusDomain.push(["cancelled_at", "!=", false]);
    } else if (substatus && stage) {
      // The remaining substatuses (ready/in_progress/completed) are timestamp-based
      // and require a known stage prefix.
      {
        const prefixMap: Record<string, string> = {
          digitalization: "digi",
          ready_digitalization: "digi",
          cnc: "cnc",
          painting: "paint",
        };
        const prefix = prefixMap[stage];
        if (prefix) {
          if (substatus === "ready") {
            substatusDomain.push([`${prefix}_started_at`, "=", false]);
          } else if (substatus === "in_progress") {
            substatusDomain.push([`${prefix}_started_at`, "!=", false]);
            substatusDomain.push([`${prefix}_done_at`, "=", false]);
          } else if (substatus === "completed") {
            substatusDomain.push([`${prefix}_done_at`, "!=", false]);
          }
        }
      }
    }

    const q = sp.get("q");
    if (q) {
      domain.push("|", "|");
      domain.push(["name", "ilike", q]);
      domain.push(["client_name", "ilike", q]);
      domain.push(["dealer_ref", "ilike", q]);
    }

    const limit = Math.min(parseInt(sp.get("limit") ?? "80", 10), 500);
    const offset = parseInt(sp.get("offset") ?? "0", 10);
    const order = sp.get("order") ?? "create_date desc";

    // Try with v2 fields + substatus domain first. If Odoo errors (legacy DB
    // without the upgrade), fall back to base fields without substatus filter.
    const fullDomain = [...domain, ...substatusDomain];
    let records: Array<Record<string, unknown>>;
    let total: number;
    try {
      records = await call<Array<Record<string, unknown>>>({
        session: s.session,
        model: "indigo.order",
        method: "search_read",
        args: [fullDomain, [...ORDER_FIELDS_BASE, ...ORDER_FIELDS_V2_EXTRA]],
        kwargs: { limit, offset, order },
      });
      total = await call<number>({
        session: s.session,
        model: "indigo.order",
        method: "search_count",
        args: [fullDomain],
        kwargs: {},
      });
    } catch {
      records = await call<Array<Record<string, unknown>>>({
        session: s.session,
        model: "indigo.order",
        method: "search_read",
        args: [domain, ORDER_FIELDS_BASE],
        kwargs: { limit, offset, order },
      });
      total = await call<number>({
        session: s.session,
        model: "indigo.order",
        method: "search_count",
        args: [domain],
        kwargs: {},
      });
    }

    // ?include=lines hydrates each order with its first order-line summary.
    // Used by the Paint screen which needs design_id + paint_sides per row.
    if (sp.get("include") === "lines" && records.length) {
      const orderIds = records.map((r) => r.id as number);
      try {
        const lines = await call<
          Array<{
            id: number;
            order_id: [number, string] | false;
            design_id: [number, string] | false;
            paint_sides?: number;
            material?: string;
            thickness?: string;
            door_type?: string;
            color?: string;
          }>
        >({
          session: s.session,
          model: "indigo.order.line",
          method: "search_read",
          args: [
            [["order_id", "in", orderIds]],
            [
              "id",
              "order_id",
              "design_id",
              "paint_sides",
              "material",
              "thickness",
              "door_type",
              "color",
              "parts_count",
            ],
          ],
          kwargs: { order: "order_id, id" },
        });
        const byOrder = new Map<number, (typeof lines)[number]>();
        for (const l of lines) {
          const oid = l.order_id && Array.isArray(l.order_id) ? l.order_id[0] : 0;
          if (oid && !byOrder.has(oid)) byOrder.set(oid, l);
        }
        for (const rec of records) {
          rec.first_line = byOrder.get(rec.id as number) ?? null;
        }
      } catch {
        // Fallback: retry without v2 line fields.
        const lines = await call<
          Array<{
            id: number;
            order_id: [number, string] | false;
            design_id: [number, string] | false;
            door_type?: string;
            color?: string;
          }>
        >({
          session: s.session,
          model: "indigo.order.line",
          method: "search_read",
          args: [
            [["order_id", "in", orderIds]],
            ["id", "order_id", "design_id", "door_type", "color"],
          ],
          kwargs: { order: "order_id, id" },
        });
        const byOrder = new Map<number, (typeof lines)[number]>();
        for (const l of lines) {
          const oid = l.order_id && Array.isArray(l.order_id) ? l.order_id[0] : 0;
          if (oid && !byOrder.has(oid)) byOrder.set(oid, l);
        }
        for (const rec of records) {
          rec.first_line = byOrder.get(rec.id as number) ?? null;
        }
      }
    }

    return NextResponse.json({ records, total, limit, offset });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error fetching orders";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Allow-list for POST. Same idea as PUT: only the fields the UI is
 * expected to set on creation. Stage / is_stock / cancelled_at / etc.
 * have dedicated endpoints.
 */
const CREATABLE_ORDER_FIELDS = [
  "dealer_id",
  "dealer_ref",
  "client_name",
  "client_phone",
  "client_email",
  "client_address",
  "notes",
  "installation_date",
  "expected_completion_date",
  "priv_ref",
  "customer_po",
  // Nested line creation via Odoo's (0, 0, {...}) syntax.
  "line_ids",
] as const;

/** POST /api/orders — create a new order. */
export async function POST(req: NextRequest) {
  try {
    const s = await requireSession();
    const { deriveRole } = await import("@/lib/odoo/types");
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const raw = (await req.json()) as Record<string, unknown>;
    const vals: Record<string, unknown> = {};
    for (const k of CREATABLE_ORDER_FIELDS) {
      if (k in raw) vals[k] = raw[k];
    }
    if (!vals.client_name) {
      return NextResponse.json(
        { error: "client_name is required" },
        { status: 400 },
      );
    }
    if (!vals.dealer_id) {
      return NextResponse.json(
        { error: "dealer_id is required" },
        { status: 400 },
      );
    }
    const id = await call<number>({
      session: s.session,
      model: "indigo.order",
      method: "create",
      args: [vals],
      kwargs: {},
    });
    return NextResponse.json({ id });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Error creating order";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

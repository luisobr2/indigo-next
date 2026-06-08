import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

export interface NotifItem {
  id: string;
  type:
    | "overdue"
    | "new_order"
    | "pending_invoice"
    | "outstanding"
    | "in_my_stage"
    | "today_install"
    | "payout_draft";
  title: string;
  body?: string;
  href: string;
  severity: "info" | "warning" | "danger" | "success";
  at?: string;
  count?: number;
}

interface OrderRow {
  id: number;
  name: string;
  client_name: string;
  dealer_id: [number, string] | false;
  stage_id: [number, string] | false;
  is_overdue: boolean;
  days_in_current_stage: number;
  installation_date: string | false;
  date_paid: string | false;
  payment_state: string;
  create_date: string;
  total_dealer_charge: number;
}

const ORDER_FIELDS = [
  "id",
  "name",
  "client_name",
  "dealer_id",
  "stage_id",
  "is_overdue",
  "days_in_current_stage",
  "installation_date",
  "date_paid",
  "payment_state",
  "create_date",
  "total_dealer_charge",
];

async function searchOrders(
  session: string,
  domain: unknown[],
  order = "create_date desc",
  limit = 50,
): Promise<OrderRow[]> {
  return call<OrderRow[]>({
    session,
    model: "indigo.order",
    method: "search_read",
    args: [domain, ORDER_FIELDS],
    kwargs: { order, limit },
  });
}

/**
 * GET /api/notifications
 *
 * Role-aware "needs action" inbox for the bell in the header. Returns
 * the items the current user should care about + a total count.
 *
 * The shape is intentionally flat so the dropdown can render a single
 * list. Each item has an icon hint (`type`) and a `href` to navigate.
 */
export async function GET() {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    const isManagerOrOffice = role.isManager || role.isOffice || s.user.isAdmin;

    const items: NotifItem[] = [];

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");

    /* ---------------- Manager / Office ---------------- */
    if (isManagerOrOffice) {
      const overdue = await searchOrders(
        s.session,
        [
          ["is_overdue", "=", true],
          ["stage_id.code", "not in", ["closed", "invoiced"]],
        ],
        "days_in_current_stage desc",
        10,
      );
      for (const o of overdue) {
        items.push({
          id: `overdue:${o.id}`,
          type: "overdue",
          title: `Overdue: ${o.name}`,
          body: `${o.client_name} · ${o.days_in_current_stage}d in ${o.stage_id ? o.stage_id[1] : "stage"}`,
          href: `/orders/${o.id}`,
          severity: "danger",
        });
      }

      const newOrders = await searchOrders(
        s.session,
        [["create_date", ">=", dayAgo]],
        "create_date desc",
        10,
      );
      for (const o of newOrders) {
        items.push({
          id: `new:${o.id}`,
          type: "new_order",
          title: `New order: ${o.name}`,
          body: `${o.client_name} · ${o.dealer_id ? o.dealer_id[1] : ""}`,
          href: `/orders/${o.id}`,
          severity: "info",
          at: o.create_date,
        });
      }

      const toInvoice = await searchOrders(
        s.session,
        [
          ["stage_id.code", "=", "installed"],
          ["payment_state", "!=", "paid"],
        ],
        "write_date asc",
        5,
      );
      if (toInvoice.length > 0) {
        items.push({
          id: "pending-invoice",
          type: "pending_invoice",
          title: `${toInvoice.length} order${toInvoice.length === 1 ? "" : "s"} ready to invoice`,
          body: "Mark them paid in Billing.",
          href: "/billing",
          severity: "warning",
          count: toInvoice.length,
        });
      }

      const outstanding = await searchOrders(
        s.session,
        [
          ["payment_state", "in", ["unpaid", "partial"]],
          ["stage_id.code", "in", ["invoiced", "installed"]],
        ],
        "write_date asc",
        100,
      );
      if (outstanding.length > 0) {
        const total = outstanding.reduce(
          (s, o) => s + (Number(o.total_dealer_charge) || 0),
          0,
        );
        items.push({
          id: "outstanding",
          type: "outstanding",
          title: `${outstanding.length} outstanding receivable${outstanding.length === 1 ? "" : "s"}`,
          body: `${total.toLocaleString("en-US", { style: "currency", currency: "USD" })} pending payment.`,
          href: "/billing",
          severity: "warning",
          count: outstanding.length,
        });
      }
    }

    /* ---------------- Role-specific queues ---------------- */
    interface StageQueue {
      stages: string[];
      label: string;
      href: string;
    }
    const queueByRole: StageQueue | null = role.isDesigner
      ? {
          stages: ["ready_digitalization"],
          label: "Ready for Digitalization",
          href: "/digitalization",
        }
      : role.isPainter
        ? {
            stages: ["painting"],
            label: "Painting",
            href: "/paint",
          }
        : role.isCnc
          ? {
              stages: ["cnc"],
              label: "CNC Queue",
              href: "/cnc-production",
            }
          : null;

    if (queueByRole && !isManagerOrOffice) {
      const queue = await searchOrders(
        s.session,
        [["stage_id.code", "in", queueByRole.stages]],
        "last_stage_change asc",
        20,
      );
      if (queue.length > 0) {
        items.push({
          id: `queue:${queueByRole.stages.join(",")}`,
          type: "in_my_stage",
          title: `${queue.length} order${queue.length === 1 ? "" : "s"} in your queue`,
          body: `${queueByRole.label} — sorted by oldest first.`,
          href: queueByRole.href,
          severity: "info",
          count: queue.length,
        });
        for (const o of queue.slice(0, 5)) {
          items.push({
            id: `q:${o.id}`,
            type: "in_my_stage",
            title: o.name,
            body: `${o.client_name} · ${o.days_in_current_stage}d waiting`,
            href: `/orders/${o.id}`,
            severity: o.is_overdue ? "warning" : "info",
          });
        }
      }
    }

    /* ---------------- Installer ---------------- */
    if (role.isInstaller && !isManagerOrOffice) {
      const today = new Date().toISOString().slice(0, 10);
      const partnerId = s.user.partnerId;
      const todayInstalls = await searchOrders(
        s.session,
        [
          ["installer_ids", "in", [partnerId]],
          ["installation_date", "=", today],
        ],
        "installation_date asc",
        20,
      );
      for (const o of todayInstalls) {
        items.push({
          id: `today:${o.id}`,
          type: "today_install",
          title: `Today: ${o.name}`,
          body: o.client_name,
          href: `/installs/${o.id}`,
          severity: "info",
        });
      }
    }

    /* ---------------- Painter drafts ---------------- */
    if (role.isPainter && !isManagerOrOffice) {
      const draftPayouts = await call<Array<{ id: number; amount: number }>>({
        session: s.session,
        model: "indigo.payout",
        method: "search_read",
        args: [
          [
            ["contractor_id.id", "=", s.user.partnerId],
            ["state", "=", "draft"],
          ],
          ["id", "amount"],
        ],
        kwargs: { limit: 20 },
      });
      if (draftPayouts.length > 0) {
        const total = draftPayouts.reduce(
          (s, p) => s + (Number(p.amount) || 0),
          0,
        );
        items.push({
          id: "payout-drafts",
          type: "payout_draft",
          title: `${draftPayouts.length} draft payout${draftPayouts.length === 1 ? "" : "s"} pending`,
          body: `${total.toLocaleString("en-US", { style: "currency", currency: "USD" })} awaiting approval.`,
          href: "/billing",
          severity: "warning",
          count: draftPayouts.length,
        });
      }
    }

    return NextResponse.json({
      items,
      count: items.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

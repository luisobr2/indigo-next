import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { billingCall, billingError } from "@/lib/billing/server";
import type { InvoiceRow, InvoiceSummary } from "@/lib/billing/invoice";

export const runtime = "nodejs";

/**
 * GET ?from&to&dealer&status&q&qbo: invoices plus the period summary. Each
 * row also carries the client and PO of its orders, which is how the office
 * recognises an invoice in the list.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const filters: Record<string, unknown> = {};
  if (sp.get("from")) filters.date_from = sp.get("from");
  if (sp.get("to")) filters.date_to = sp.get("to");
  if (sp.get("dealer")) filters.dealer_id = Number(sp.get("dealer"));
  if (sp.get("status")) filters.status = sp.get("status");
  if (sp.get("q")) filters.q = sp.get("q");
  // QuickBooks: "problems" (pending, error, doesn't match) or "missing" (issued, not there).
  const qbo = sp.get("qbo");
  if (qbo === "problems" || qbo === "missing") filters.qbo = qbo;
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Only the office or a manager can use invoicing." }, { status: 403 });
    }
    const data = await call<{ rows: InvoiceRow[]; summary: InvoiceSummary }>({
      session: s.session,
      model: "indigo.billing",
      method: "indigo_billing_list",
      args: [filters],
      kwargs: {},
    });
    const names = [...new Set(data.rows.flatMap((r) => r.order_names))];
    if (names.length) {
      const orders = await call<Array<{ name: string; client_name: string | false; customer_po: string | false }>>({
        session: s.session,
        model: "indigo.order",
        method: "search_read",
        args: [[["name", "in", names]]],
        kwargs: { fields: ["name", "client_name", "customer_po"], context: { active_test: false } },
      });
      const byName = new Map(orders.map((o) => [o.name, o]));
      for (const r of data.rows) {
        r.clients = r.order_names
          .map((n) => byName.get(n))
          .filter((o): o is NonNullable<typeof o> => !!o)
          .map((o) => ({ client_name: o.client_name || "", po: o.customer_po || "" }));
      }
    }
    return NextResponse.json({ data });
  } catch (e) {
    return billingError(e);
  }
}

/** POST: create a DRAFT invoice {dealer_id, order_ids, lines, photo_ids, invoice_date?}. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return billingCall("indigo_billing_create_draft", [body ?? {}]);
}

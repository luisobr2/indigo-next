import { NextRequest } from "next/server";
import { billingCall } from "@/lib/billing/server";

export const runtime = "nodejs";

/** GET ?from&to&dealer&status&q&qbo: invoices plus the period summary. */
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
  return billingCall("indigo_billing_list", [filters]);
}

/** POST: create a DRAFT invoice {dealer_id, order_ids, lines, photo_ids, invoice_date?}. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return billingCall("indigo_billing_create_draft", [body ?? {}]);
}

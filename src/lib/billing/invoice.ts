/**
 * Invoicing from the app (Majela's request, 2026-09-28).
 *
 * The invoice itself is an Odoo invoice (`account.move`), created and posted
 * by the `indigo.billing` service in the indigo_decors module. This file holds
 * the shapes the screens share and the little pure logic they need before
 * anything reaches Odoo: the running totals while a draft is being edited,
 * and turning what someone typed in an email box into a list of addresses.
 */

export type LineKind = "door" | "fee" | "free";

export interface DraftLine {
  order_id: number | false;
  order_name?: string;
  kind: LineKind;
  product_code: string;
  product_label: string;
  description: string;
  qty: number;
  price_unit: number;
  taxable: boolean;
}

export interface PreviewPhoto {
  id: number;
  name: string;
  order_id: number;
  order_name: string;
  created: string | false;
  default: boolean;
}

export interface InvoicePreview {
  dealer: {
    id: number;
    name: string;
    emails: string[];
    tax_exempt: boolean;
    template: string;
    address: string;
  };
  order_ids: number[];
  lines: DraftLine[];
  photos: PreviewPhoto[];
  warnings: string[];
  tax_rate: number;
  ready: boolean;
}

export type InvoiceStatus = "Draft" | "Balance due" | "Overdue" | "Paid" | "Cancelled";

export interface InvoiceRow {
  id: number;
  name: string | false;
  state: "draft" | "posted" | "cancel";
  status: InvoiceStatus;
  payment_state: string;
  dealer: [number, string] | false;
  invoice_date: string | false;
  due_date: string | false;
  untaxed: number;
  tax: number;
  total: number;
  residual: number;
  order_names: string[];
  sent_at: string | false;
  /** A draft with this set is an issued invoice being corrected: it has its
   *  number already and keeps it when issued again. Missing on an older Odoo. */
  posted_before?: boolean;
}

export interface InvoiceDetail extends InvoiceRow {
  lines: Array<{
    product_code: string;
    product_label: string;
    description: string;
    qty: number;
    price_unit: number;
    subtotal: number;
    taxable: boolean;
    order_id: number | false;
  }>;
  orders: Array<{ id: number; name: string; client_name: string }>;
  photo_ids: number[];
  payments: Array<{ id: number; date: string; amount: number; memo: string }>;
  sent_to: string | false;
  dealer_emails: string[];
  dealer_address: string;
}

export interface InvoiceSummary {
  count: number;
  drafts: number;
  untaxed: number;
  tax: number;
  total: number;
  open: number;
  collected: number;
}

export interface BillingStatus {
  ready: boolean;
  missing: string[];
  next_number: number;
  tax_rate: number;
  issuer: Record<string, string>;
  terms: string;
  ranges: Array<{ id: number; name: string; min_miles: number; max_miles: number; region: string; fee: number }>;
  templates: Array<{ value: string; label: string }>;
  can_setup: boolean;
}

/** Products the service knows. Free lines use "IND-OTHER". */
export const PRODUCT_OPTIONS: Array<{ code: string; label: string; taxable: boolean }> = [
  { code: "IND-SD", label: "DESIGN SINGLE DOOR", taxable: true },
  { code: "IND-DD", label: "DESIGN DOUBLE DOOR", taxable: true },
  { code: "IND-SL", label: "DESIGN DOOR WITH SIDELITES", taxable: true },
  { code: "IND-FEE-A", label: "INSTALLATION FEE", taxable: false },
  { code: "IND-FEE-B", label: "INSTALLATION FEE B", taxable: false },
  { code: "IND-FEE-C", label: "INSTALLATION FEE C", taxable: false },
  { code: "IND-FEE-D", label: "INSTALLATION FEE D", taxable: false },
  { code: "IND-OTHER", label: "PRODUCTION", taxable: true },
];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Totals for a draft while it is being edited. Tax is rounded per line, the
 * way Odoo computes it by default ("round per line"), so the preview matches
 * the invoice that comes back once it is saved.
 */
export function draftTotals(lines: DraftLine[], taxRate: number) {
  let untaxed = 0;
  let tax = 0;
  for (const l of lines) {
    const amount = round2((Number(l.qty) || 0) * (Number(l.price_unit) || 0));
    untaxed += amount;
    if (l.taxable) tax += round2((amount * (Number(taxRate) || 0)) / 100);
  }
  untaxed = round2(untaxed);
  tax = round2(tax);
  return { untaxed, tax, total: round2(untaxed + tax) };
}

/**
 * Addresses from whatever was typed or pasted: commas, semicolons, spaces or
 * new lines between them, duplicates dropped, anything without an @ ignored.
 */
export function parseEmails(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (text || "").split(/[\s,;]+/)) {
    const e = raw.trim().replace(/^<|>$/g, "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** An empty free line, for "Add line". */
export function freeLine(): DraftLine {
  return {
    order_id: false,
    kind: "free",
    product_code: "IND-OTHER",
    product_label: "PRODUCTION",
    description: "",
    qty: 1,
    price_unit: 0,
    taxable: true,
  };
}

/** Date range presets for the invoice list ("summary by date"). */
export function presetRange(preset: "this-month" | "last-month" | "this-year", today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (preset === "last-month") {
    return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  }
  if (preset === "this-year") {
    return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
  }
  return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
}

/** What the order page gets about the order's invoices. */
export interface OrderBilling {
  ready: boolean;
  /** The live invoice first, voided ones after. */
  invoices: InvoiceRow[];
  /** Installed, with no live invoice: the same rule as "To invoice". */
  can_create: boolean;
}

/**
 * The billing step the order page offers next.
 *
 * Once invoicing runs in the app, a payment goes on the invoice. Marking the
 * order paid by hand would leave the invoice open and the dealer's statement
 * still asking for the money, so "Mark as paid" only stays where there is no
 * invoice in the app to put the payment on: before invoicing is set up
 * (`billing` null) and for orders invoiced in QuickBooks before that.
 */
export type BillingNext =
  | { kind: "create" }
  | { kind: "draft"; invoice: InvoiceRow }
  | { kind: "collect"; invoice: InvoiceRow }
  | { kind: "mark_paid" }
  | { kind: "none" };

export function orderBillingNext(
  stageCode: string,
  paymentState: string,
  billing: OrderBilling | null,
): BillingNext {
  if (stageCode !== "installed" && stageCode !== "invoiced") return { kind: "none" };
  if (!billing || !billing.ready) {
    return paymentState === "paid" ? { kind: "none" } : { kind: "mark_paid" };
  }
  const live = billing.invoices.filter((i) => i.state !== "cancel");
  const draft = live.find((i) => i.state === "draft");
  if (draft) return { kind: "draft", invoice: draft };
  const open = live.find((i) => i.state === "posted" && i.residual > 0.005);
  if (open) return { kind: "collect", invoice: open };
  if (live.length) return { kind: "none" };
  if (billing.can_create) return { kind: "create" };
  if (stageCode === "invoiced" && paymentState !== "paid") return { kind: "mark_paid" };
  return { kind: "none" };
}

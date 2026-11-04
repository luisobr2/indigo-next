/**
 * The invoice of an order as the orders table shows it (Invoice, Balance due
 * and QuickBooks columns, 4-nov-2026). Pure, so print, CSV and the screen say
 * the same thing and it can be tested without a browser.
 */
import { qboBadge } from "../quickbooks/badge.ts";
import type { InvoiceRow } from "./invoice.ts";

/** The billing filters of the orders table (?billing=). */
export const ORDER_BILLING_FILTERS = ["to_invoice", "unpaid", "qbo"] as const;
export type OrderBillingFilter = (typeof ORDER_BILLING_FILTERS)[number];

/** What Odoo's indigo_billing_orders_summary returns for one order. */
export interface OrderBillingCell {
  /** Its live invoice (issued before draft); false when it has none. */
  invoice: InvoiceRow | false;
  /** Installed and not invoiced: the "To invoice" list. */
  to_invoice: boolean;
  /** Invoiced in QuickBooks before the app ("QuickBooks" when no number). */
  outside_ref: string | false;
}

/** The invoice column as text: "#1474 · Open", "To invoice", "QuickBooks #1203". */
export function invoiceCellText(b: OrderBillingCell | null | undefined): string {
  if (!b) return "";
  if (b.invoice) {
    const label = b.invoice.status === "Balance due" ? "Open" : b.invoice.status;
    return b.invoice.name ? `#${b.invoice.name} · ${label}` : "Draft";
  }
  if (b.outside_ref) return b.outside_ref === "QuickBooks" ? "In QuickBooks" : `QuickBooks #${b.outside_ref}`;
  return b.to_invoice ? "To invoice" : "";
}

/** What is still owed on its issued invoice; null when there is no issued one. */
export function balanceDue(b: OrderBillingCell | null | undefined): number | null {
  return b?.invoice && b.invoice.state === "posted" ? b.invoice.residual : null;
}

/** The QuickBooks column as text, empty when there is nothing to say. */
export function qboCellText(b: OrderBillingCell | null | undefined, connected: boolean): string {
  if (!b?.invoice) return "";
  return qboBadge(b.invoice, { showMissing: connected })?.label ?? "";
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceDue, invoiceCellText, qboCellText, type OrderBillingCell } from "./order-row.ts";
import type { InvoiceRow } from "./invoice.ts";

function inv(over: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: 1, name: "1474", state: "posted", status: "Balance due", payment_state: "not_paid",
    dealer: [19, "Locktight"], invoice_date: "2026-11-02", due_date: "2026-11-02",
    untaxed: 420, tax: 21, total: 441, residual: 441, order_names: ["IND/2026/00491"], sent_at: false,
    qbo_state: "none", ...over,
  };
}
const cell = (over: Partial<OrderBillingCell> = {}): OrderBillingCell => ({
  invoice: false, to_invoice: false, outside_ref: false, ...over,
});

test("invoice column says number and status, or what is missing", () => {
  assert.equal(invoiceCellText(cell({ invoice: inv() })), "#1474 · Open");
  assert.equal(invoiceCellText(cell({ invoice: inv({ status: "Paid", residual: 0 }) })), "#1474 · Paid");
  assert.equal(invoiceCellText(cell({ invoice: inv({ name: false, state: "draft", status: "Draft" }) })), "Draft");
  assert.equal(invoiceCellText(cell({ to_invoice: true })), "To invoice");
  assert.equal(invoiceCellText(cell({ outside_ref: "1203" })), "QuickBooks #1203");
  assert.equal(invoiceCellText(cell({ outside_ref: "QuickBooks" })), "In QuickBooks");
  assert.equal(invoiceCellText(cell()), "");
  assert.equal(invoiceCellText(null), "");
});

test("balance due only for an issued invoice", () => {
  assert.equal(balanceDue(cell({ invoice: inv() })), 441);
  assert.equal(balanceDue(cell({ invoice: inv({ residual: 0, status: "Paid" }) })), 0);
  assert.equal(balanceDue(cell({ invoice: inv({ state: "draft", status: "Draft" }) })), null);
  assert.equal(balanceDue(cell({ to_invoice: true })), null);
  assert.equal(balanceDue(undefined), null);
});

test("QuickBooks column flags what isn't there only while connected", () => {
  const issued = cell({ invoice: inv() });
  assert.equal(qboCellText(issued, true), "Not in QuickBooks");
  assert.equal(qboCellText(issued, false), "");
  assert.equal(qboCellText(cell({ invoice: inv({ qbo_state: "synced" }) }), true), "In QuickBooks");
  assert.equal(qboCellText(cell({ invoice: inv({ qbo_state: "error" }) }), false), "QuickBooks error");
  assert.equal(qboCellText(cell({ to_invoice: true }), true), "");
});

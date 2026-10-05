import test from "node:test";
import assert from "node:assert/strict";

import {
  INVOICE_TOOL_DEFS,
  billingRefusal,
  describeLines,
  optionalDate,
  parseInvoiceLines,
  requireEmails,
  requireOrderIds,
  statusWord,
  usd,
  warningsInSpanish,
} from "./invoices.ts";
import { TOOL_DEFS, McpToolError } from "./tools.ts";

const WRITE = ["create_invoice", "update_invoice", "delete_invoice", "issue_invoice", "correct_invoice", "void_invoice", "record_payment", "send_invoice"];
const READ = ["orders_to_invoice", "find_invoices", "get_invoice", "invoice_pdf_link"];

function rejects(fn: () => unknown, code: string) {
  assert.throws(fn, (e: unknown) => e instanceof McpToolError && e.code === code);
}

test("the invoice tools are registered, and only the writes take 'confirm'", () => {
  const names = new Set(TOOL_DEFS.map((t) => t.name));
  for (const n of [...WRITE, ...READ]) assert.ok(names.has(n), `TOOL_DEFS is missing ${n}`);
  for (const def of INVOICE_TOOL_DEFS) {
    const props = def.inputSchema.properties as Record<string, { type?: string }>;
    if (WRITE.includes(def.name)) {
      assert.equal(props.confirm?.type, "string", `${def.name} needs an optional 'confirm'`);
      assert.ok(!def.inputSchema.required?.includes("confirm"), `${def.name} must not require 'confirm'`);
      assert.match(def.description, /Preview-then-confirm/);
    } else {
      assert.equal(props.confirm, undefined, `${def.name} is a read and must not take 'confirm'`);
    }
  }
});

test("only send_invoice emails the dealer, it needs a confirm, and it never sends a draft", () => {
  const senders = INVOICE_TOOL_DEFS.filter((d) => /email/i.test(d.title) || "emails" in (d.inputSchema.properties as object));
  assert.deepEqual(senders.map((d) => d.name), ["send_invoice"]);
  const send = senders[0];
  assert.equal((send.inputSchema.properties as Record<string, { type?: string }>).confirm?.type, "string");
  assert.match(send.description, /draft is never sent/);
  const issue = INVOICE_TOOL_DEFS.find((d) => d.name === "issue_invoice")!;
  assert.match(issue.description, /NOT emailed/);
});

test("invoice_pdf_link is a read: no confirm, one invoice", () => {
  const link = INVOICE_TOOL_DEFS.find((d) => d.name === "invoice_pdf_link")!;
  assert.deepEqual(link.inputSchema.required, ["invoice_id"]);
  assert.equal((link.inputSchema.properties as Record<string, unknown>).confirm, undefined);
  assert.match(link.description, /30 minutes/);
});

test("requireEmails: real addresses only, deduplicated, at most 10", () => {
  assert.deepEqual(requireEmails(["billing@dealer.com", "BILLING@dealer.com", "owner@dealer.com"]), ["billing@dealer.com", "owner@dealer.com"]);
  rejects(() => requireEmails([]), "ENTRADA_INVALIDA");
  rejects(() => requireEmails("billing@dealer.com"), "ENTRADA_INVALIDA");
  rejects(() => requireEmails(["not-an-email"]), "ENTRADA_INVALIDA");
  rejects(() => requireEmails(["a@b.com, c@d.com"]), "ENTRADA_INVALIDA");
  rejects(() => requireEmails(Array.from({ length: 11 }, (_, i) => `p${i}@dealer.com`)), "ENTRADA_INVALIDA");
});

test("usd prints like the invoice", () => {
  assert.equal(usd(1284), "$1,284.00");
  assert.equal(usd(0), "$0.00");
  assert.equal(usd(-35.5), "-$35.50");
});

test("parseInvoiceLines: doors carry the tax, fees never, an exempt dealer none", () => {
  const raw = [
    { product_code: "IND-SD", description: "Maria Williams - R1", price_unit: 600, order_id: 5 },
    { product_code: "IND-FEE-B", description: "Installation Fee Region B", price_unit: 35, order_id: 5 },
    { product_code: "IND-OTHER", description: "Display", price_unit: 120 },
  ];
  const lines = parseInvoiceLines(raw, [5], false);
  assert.deepEqual(lines.map((l) => [l.kind, l.taxable, l.qty]), [["door", true, 1], ["fee", false, 1], ["free", true, 1]]);
  assert.equal(lines[2].order_id, false);
  const exempt = parseInvoiceLines(raw, [5], true);
  assert.deepEqual(exempt.map((l) => l.taxable), [false, false, false]);
});

test("parseInvoiceLines: an explicit taxable wins, and an empty description takes the product's", () => {
  const [line] = parseInvoiceLines([{ product_code: "IND-OTHER", price_unit: 50, taxable: false, description: "  " }], [], false);
  assert.equal(line.taxable, false);
  assert.equal(line.description, "PRODUCTION");
  assert.equal(line.product_label, "PRODUCTION");
});

test("parseInvoiceLines refuses what Odoo would bill wrong", () => {
  rejects(() => parseInvoiceLines([], [1], false), "ENTRADA_INVALIDA");
  rejects(() => parseInvoiceLines({}, [1], false), "ENTRADA_INVALIDA");
  rejects(() => parseInvoiceLines([{ product_code: "SHOP-123", price_unit: 1 }], [1], false), "ENTRADA_INVALIDA");
  rejects(() => parseInvoiceLines([{ product_code: "IND-SD", price_unit: -1 }], [1], false), "ENTRADA_INVALIDA");
  rejects(() => parseInvoiceLines([{ product_code: "IND-SD" }], [1], false), "ENTRADA_INVALIDA");
  rejects(() => parseInvoiceLines([{ product_code: "IND-SD", price_unit: 1, qty: 0 }], [1], false), "ENTRADA_INVALIDA");
  rejects(() => parseInvoiceLines([{ product_code: "IND-SD", price_unit: 1, order_id: 99 }], [1], false), "ENTRADA_INVALIDA");
  rejects(() => parseInvoiceLines([{ product_code: "IND-SD", price_unit: 1, taxable: "yes" }], [1], false), "ENTRADA_INVALIDA");
  rejects(() => parseInvoiceLines(Array.from({ length: 61 }, () => ({ product_code: "IND-SD", price_unit: 1 })), [], false), "ENTRADA_INVALIDA");
});

test("describeLines spells out each line's tax and the totals", () => {
  const lines = parseInvoiceLines(
    [
      { product_code: "IND-DD", description: "Carlos G", price_unit: 600, order_id: 7 },
      { product_code: "IND-FEE-C", description: "Fee C", price_unit: 70, order_id: 7 },
    ],
    [7],
    false,
  );
  const text = describeLines(lines, 7, { 7: "IND/2026/01302" });
  assert.match(text, /DESIGN DOUBLE DOOR · IND\/2026\/01302 · "Carlos G" · 1 x \$600\.00 = \$600\.00 · \+7 %/);
  assert.match(text, /INSTALLATION FEE C .* sin impuesto/);
  assert.match(text, /Subtotal \$670\.00 · Impuesto \$42\.00 · Total \$712\.00/);
});

test("requireOrderIds: a list of ids, deduplicated, at most 20", () => {
  assert.deepEqual(requireOrderIds({ order_ids: [3, 3, 4] }, "create_invoice"), [3, 4]);
  rejects(() => requireOrderIds({}, "create_invoice"), "ENTRADA_INVALIDA");
  rejects(() => requireOrderIds({ order_ids: ["3"] }, "create_invoice"), "ENTRADA_INVALIDA");
  rejects(() => requireOrderIds({ order_ids: Array.from({ length: 21 }, (_, i) => i + 1) }, "create_invoice"), "ENTRADA_INVALIDA");
});

test("optionalDate accepts YYYY-MM-DD and nothing else", () => {
  assert.equal(optionalDate({ d: "2026-09-29" }, "d"), "2026-09-29");
  assert.equal(optionalDate({}, "d"), undefined);
  rejects(() => optionalDate({ d: "29/09/2026" }, "d"), "ENTRADA_INVALIDA");
  rejects(() => optionalDate({ d: "2026-13-45" }, "d"), "ENTRADA_INVALIDA");
});

test("statusWord uses the app's words", () => {
  assert.equal(statusWord("Balance due"), "Open");
  assert.equal(statusWord("Cancelled"), "Void");
  assert.equal(statusWord("Overdue"), "Overdue");
});

test("warningsInSpanish translates the two warnings the preview gives", () => {
  const out = warningsInSpanish([
    "IND/2026/01302 has no distance range (ZIP missing or unknown): the installation fee is set to region A, check it.",
    "Safeguard Impact has no invoice email yet.",
    "something new",
  ]);
  assert.match(out[0], /^IND\/2026\/01302 no tiene rango de distancia/);
  assert.match(out[1], /^Safeguard Impact no tiene correo de facturación/);
  assert.equal(out[2], "something new");
});

test("billingRefusal: a broken rule is RECHAZADO, a role problem PERMISO_DENEGADO, the rest passes through", () => {
  const odoo = (errorName: string, message: string) => Object.assign(new Error(message), { name: "OdooRpcError", errorName });
  const refused = billingRefusal(odoo("odoo.exceptions.UserError", "IND/1 is already on #1366."));
  assert.ok(refused instanceof McpToolError && refused.code === "RECHAZADO");
  assert.match((refused as Error).message, /IND\/1 is already on #1366/);
  const invalid = billingRefusal(odoo("odoo.exceptions.ValidationError", "Quantities must be positive."));
  assert.equal((invalid as McpToolError).code, "RECHAZADO");
  const denied = billingRefusal(odoo("odoo.exceptions.AccessError", "Only the office or a manager can invoice."));
  assert.equal((denied as McpToolError).code, "PERMISO_DENEGADO");
  const other = new Error("boom");
  assert.equal(billingRefusal(other), other);
});

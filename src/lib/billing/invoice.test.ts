import { test } from "node:test";
import assert from "node:assert/strict";
import { draftTotals, parseEmails, presetRange, freeLine, type DraftLine } from "./invoice.ts";

const door = (price: number, qty = 1, taxable = true): DraftLine => ({
  order_id: 1,
  kind: "door",
  product_code: "IND-SD",
  product_label: "DESIGN SINGLE DOOR",
  description: "x",
  qty,
  price_unit: price,
  taxable,
});

test("tax only on taxable lines, like invoice 1357 (300 + 0 fee -> 21 tax, 321 total)", () => {
  const fee: DraftLine = { ...door(0, 1, false), kind: "fee", product_code: "IND-FEE-A" };
  assert.deepEqual(draftTotals([door(300), fee], 7), { untaxed: 300, tax: 21, total: 321 });
});

test("invoice 1009: double door 580 -> 40.60 tax", () => {
  assert.deepEqual(draftTotals([door(580)], 7), { untaxed: 580, tax: 40.6, total: 620.6 });
});

test("an out-of-range fee adds to the total but not to the tax", () => {
  const feeB: DraftLine = { ...door(35, 1, false), kind: "fee" };
  assert.deepEqual(draftTotals([door(300), feeB], 7), { untaxed: 335, tax: 21, total: 356 });
});

test("exempt dealer: nothing taxable, no tax", () => {
  assert.deepEqual(draftTotals([door(600, 1, false), door(300, 1, false)], 7), { untaxed: 900, tax: 0, total: 900 });
});

test("quantities multiply and tax rounds per line", () => {
  assert.deepEqual(draftTotals([door(333.33, 3)], 7), { untaxed: 999.99, tax: 70, total: 1069.99 });
});

test("parseEmails splits on commas, semicolons and spaces, drops junk and duplicates", () => {
  assert.deepEqual(
    parseEmails("a@x.com, b@y.com; A@X.com\n not-an-email  <c@z.org>"),
    ["a@x.com", "b@y.com", "c@z.org"],
  );
  assert.deepEqual(parseEmails(""), []);
});

test("presetRange gives calendar months", () => {
  const d = new Date(2026, 8, 28); // 28 Sep 2026
  assert.deepEqual(presetRange("this-month", d), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(presetRange("last-month", d), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(presetRange("this-year", d), { from: "2026-01-01", to: "2026-12-31" });
});

test("a free line starts taxable with qty 1", () => {
  const l = freeLine();
  assert.equal(l.kind, "free");
  assert.equal(l.qty, 1);
  assert.equal(l.taxable, true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { backfillPlan, backfillSendable, type BackfillRow } from "./backfill.ts";

const row = (over: Partial<BackfillRow>): BackfillRow => ({
  id: 1, name: "1400", dealer: "D", invoice_date: "2026-10-01", total: 321, residual: 321,
  outcome: "missing", qbo_total: false, qbo_balance: false, qbo_customer: false, problem: false, ...over,
});

test("only invoices that can be linked or created are sendable", () => {
  assert.equal(backfillSendable(row({ outcome: "same", qbo_total: 321, qbo_balance: 0 })), true);
  assert.equal(backfillSendable(row({ outcome: "different", qbo_total: 300 })), true);
  assert.equal(backfillSendable(row({ outcome: "missing" })), true);
  assert.equal(backfillSendable(row({ outcome: "missing", problem: "D isn't matched" })), false);
  assert.equal(backfillSendable(row({ outcome: "other_customer", qbo_customer: "X" })), false);
});

test("the plan says what will happen, and that a payment comes back", () => {
  assert.match(backfillPlan(row({ outcome: "same", qbo_total: 321, qbo_balance: 0 })).detail, /payment comes here/);
  assert.doesNotMatch(backfillPlan(row({ outcome: "same", qbo_total: 321, qbo_balance: 321 })).detail, /payment/);
  assert.match(backfillPlan(row({ outcome: "same", qbo_total: 321, qbo_balance: 221 })).detail, /payments there/);
  assert.match(backfillPlan(row({ outcome: "different", qbo_total: 300 })).detail, /\$300\.00/);
  assert.match(backfillPlan(row({ outcome: "other_customer", qbo_customer: "Other Co" })).detail, /Other Co/);
  assert.equal(backfillPlan(row({ outcome: "missing", problem: "D isn't matched" })).detail, "D isn't matched");
  assert.equal(backfillPlan(row({ outcome: "missing" })).label, "Not there");
});

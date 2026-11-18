import test from "node:test";
import assert from "node:assert/strict";
import { recordHref, presetRange, groupByDay, dayHeading, rowTime, auditQuery, shopDay, type AuditRow } from "./activity-log.ts";

const row = (id: number, date: string): AuditRow => ({
  id, date, user_id: 1, user_name: "Ana", module: "orders", action: "write", record_type: "Order",
  res_model: "indigo.order", res_id: 5, res_name: "IND/2026/00005", summary: "", changes: [],
});

test("each logged record links to its page in the panel, when it has one", () => {
  assert.equal(recordHref("indigo.order", 12), "/orders/12");
  assert.equal(recordHref("account.move", 7), "/billing/invoices/7");
  assert.equal(recordHref("res.partner", 3), "/catalog/dealers/3");
  assert.equal(recordHref("indigo.order.line", 9), null);
  assert.equal(recordHref("indigo.order", false), null);
});

test("'Today' is the shop's day: 1 a.m. UTC is still yesterday in Miami", () => {
  const now = new Date("2026-11-18T01:00:00Z");
  assert.equal(shopDay(now), "2026-11-17");
  assert.deepEqual(presetRange("today", now), { from: "2026-11-17", to: "2026-11-17" });
  assert.deepEqual(presetRange("7d", now), { from: "2026-11-11", to: "2026-11-17" });
  assert.deepEqual(presetRange("30d", now), { from: "2026-10-19", to: "2026-11-17" });
  assert.deepEqual(presetRange("all", now), { from: "", to: "" });
});

test("rows group by shop day, in the order they came", () => {
  const groups = groupByDay([
    row(3, "2026-11-18 15:00:00"),
    row(2, "2026-11-18 05:30:00"), // 12:30 a.m. in Miami: still the 18th
    row(1, "2026-11-18 03:00:00"), // 10 p.m. on the 17th in Miami
  ]);
  assert.deepEqual(groups.map((g) => [g.day, g.rows.map((r) => r.id)]), [
    ["2026-11-18", [3, 2]],
    ["2026-11-17", [1]],
  ]);
});

test("headings and times read on the shop clock", () => {
  const now = new Date("2026-11-18T15:00:00Z");
  assert.equal(dayHeading("2026-11-18", now), "Wednesday, November 18");
  assert.equal(dayHeading("2025-12-31", now), "Wednesday, December 31, 2025");
  assert.equal(rowTime(row(1, "2026-11-18 20:07:00")), "3:07 PM");
});

test("the API query leaves out empty filters", () => {
  assert.equal(auditQuery({ module: "orders", q: "", user_id: 0, offset: 50, action: undefined }), "module=orders&offset=50");
});

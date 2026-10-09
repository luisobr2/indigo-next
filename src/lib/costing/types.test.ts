import { test } from "node:test";
import assert from "node:assert/strict";
import { isMonth, monthOf, shiftMonth } from "./types.ts";

test("months move across years and only valid ones pass", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(monthOf(new Date(2026, 9, 9)), "2026-10");
  assert.equal(isMonth("2026-10"), true);
  assert.equal(isMonth("2026-13"), false);
  assert.equal(isMonth("octubre"), false);
  assert.equal(isMonth(null), false);
});

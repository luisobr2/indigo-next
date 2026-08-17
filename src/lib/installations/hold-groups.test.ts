import test from "node:test";
import assert from "node:assert/strict";

import { groupOrdersByHoldCause, holdCounterLabel, HOLD_CAUSE_LABEL, HOLD_CAUSE_COLOR } from "./hold-groups.ts";

test("groups orders by hold_cause and sums door_count per group", () => {
  const orders = [
    { id: 1, hold_cause: "dealer" as const, door_count: 2 },
    { id: 2, hold_cause: "dealer" as const, door_count: 1 },
    { id: 3, hold_cause: "client" as const, door_count: 3 },
    { id: 4, hold_cause: "other" as const, door_count: 1 },
  ];
  const groups = groupOrdersByHoldCause(orders);
  assert.equal(groups.dealer.doorCount, 3);
  assert.equal(groups.dealer.orders.length, 2);
  assert.equal(groups.client.doorCount, 3);
  assert.equal(groups.client.orders.length, 1);
  assert.equal(groups.other.doorCount, 1);
  assert.equal(groups.other.orders.length, 1);
});

test("defaults door_count to 1 when missing (one order = at least one door)", () => {
  const groups = groupOrdersByHoldCause([{ id: 1, hold_cause: "dealer" as const }]);
  assert.equal(groups.dealer.doorCount, 1);
});

test("a missing or unrecognized hold_cause lands in 'other', not lost", () => {
  const groups = groupOrdersByHoldCause([
    { id: 1, hold_cause: false as const, door_count: 2 },
    { id: 2, door_count: 1 }, // hold_cause omitted entirely
  ]);
  assert.equal(groups.other.doorCount, 3);
  assert.equal(groups.other.orders.length, 2);
});

test("every cause is always present in the result, even with zero orders", () => {
  const groups = groupOrdersByHoldCause([]);
  assert.deepEqual(Object.keys(groups).sort(), ["client", "dealer", "other"]);
  assert.equal(groups.dealer.doorCount, 0);
  assert.equal(groups.client.doorCount, 0);
  assert.equal(groups.other.doorCount, 0);
});

test("holdCounterLabel matches Majela's own phrasing: 'Problema del dealer · 7 puertas'", () => {
  assert.equal(holdCounterLabel("dealer", 7), "Problema del dealer · 7 puertas");
  assert.equal(holdCounterLabel("client", 3), "Problema del cliente · 3 puertas");
});

test("holdCounterLabel singularizes 'puerta' for a count of exactly 1", () => {
  assert.equal(holdCounterLabel("client", 1), "Problema del cliente · 1 puerta");
});

test("dealer is blue and client is orange, per Majela's own words -- not swapped, not some other palette", () => {
  assert.match(HOLD_CAUSE_COLOR.dealer, /sky/);
  assert.match(HOLD_CAUSE_COLOR.client, /orange/);
});

test("every cause has a Spanish label distinct from the raw code", () => {
  for (const cause of ["dealer", "client", "other"] as const) {
    assert.notEqual(HOLD_CAUSE_LABEL[cause], cause);
    assert.ok(HOLD_CAUSE_LABEL[cause].length > 0);
  }
});

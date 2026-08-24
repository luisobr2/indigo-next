import test from "node:test";
import assert from "node:assert/strict";

import { planSettle, costPerDoor, type SettleInstaller } from "./settle.ts";

// ---------------------------------------------------------------------
// planSettle decides what a button marks as PAID. Getting it wrong pays
// out money that wasn't owed, or skips a day someone is owed — and neither
// mistake throws.
// ---------------------------------------------------------------------

const day = (over: Partial<SettleInstaller["days"][0]> = {}) => ({
  payoutId: 1,
  status: "completed" as const,
  payoutState: "draft" as const,
  amount: 150,
  ...over,
});

const inst = (days: SettleInstaller["days"]): SettleInstaller => ({
  installerId: 11,
  days,
  doors: 0,
});

test("a plain draft week is fully payable", () => {
  const p = planSettle(inst([day({ payoutId: 1 }), day({ payoutId: 2 })]));
  assert.deepEqual(p.payoutIds, [1, 2]);
  assert.equal(p.amount, 300);
  assert.equal(p.days, 2);
});

test("an approved day is payable too — it's the step before paid", () => {
  const p = planSettle(inst([day({ payoutId: 7, payoutState: "approved" })]));
  assert.deepEqual(p.payoutIds, [7]);
});

test("a day already paid is never touched again", () => {
  const p = planSettle(inst([day({ payoutId: 1, payoutState: "paid" }), day({ payoutId: 2 })]));
  assert.deepEqual(p.payoutIds, [2], "only the unpaid one");
  assert.equal(p.amount, 150);
});

test("a cancelled day is never revived", () => {
  const p = planSettle(inst([day({ payoutId: 9, payoutState: "cancel" })]));
  assert.deepEqual(p.payoutIds, []);
});

test("a SCHEDULED day is never paid — a projection is not a debt", () => {
  // The single most damaging mistake this function could make.
  const p = planSettle(
    inst([
      day({ payoutId: 1 }),
      day({ payoutId: null, status: "scheduled", payoutState: null, amount: 999 }),
    ]),
  );
  assert.deepEqual(p.payoutIds, [1]);
  assert.equal(p.amount, 150, "the projected 999 stays out of the total");
});

test("a completed day with no payout behind it is skipped, not guessed at", () => {
  const p = planSettle(inst([day({ payoutId: null, payoutState: null })]));
  assert.deepEqual(p.payoutIds, []);
  assert.equal(p.days, 0);
});

test("a week with nothing payable plans nothing", () => {
  const p = planSettle(inst([]));
  assert.deepEqual(p.payoutIds, []);
  assert.equal(p.amount, 0);
  assert.equal(p.days, 0);
});

// ---------------------------------------------------------------------
// costPerDoor — the number the daily floor made worth looking at.
// ---------------------------------------------------------------------

test("a thin week costs the floor for every door", () => {
  // Three separate one-door days at the $150 floor.
  const c = costPerDoor({
    days: [
      { status: "completed", doors: 1, amount: 150 },
      { status: "completed", doors: 1, amount: 150 },
      { status: "completed", doors: 1, amount: 150 },
    ],
  });
  assert.equal(c, 150);
});

test("the same doors in one day cost the per-door rate", () => {
  const c = costPerDoor({ days: [{ status: "completed", doors: 6, amount: 210 }] });
  assert.equal(c, 35);
});

test("scheduled days are excluded from both sides of the ratio", () => {
  // Including a projection would quietly change a fact into a forecast.
  const c = costPerDoor({
    days: [
      { status: "completed", doors: 2, amount: 150 },
      { status: "scheduled", doors: 10, amount: 350 },
    ],
  });
  assert.equal(c, 75);
});

test("no doors installed reports null, not zero", () => {
  // "$0 per door" and "no doors" are different statements.
  assert.equal(costPerDoor({ days: [] }), null);
  assert.equal(
    costPerDoor({ days: [{ status: "scheduled", doors: 4, amount: 150 }] }),
    null,
  );
});

test("fractional doors from a shared order still divide cleanly", () => {
  const c = costPerDoor({ days: [{ status: "completed", doors: 1.5, amount: 150 }] });
  assert.equal(c, 100);
});

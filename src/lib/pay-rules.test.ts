import test from "node:test";
import assert from "node:assert/strict";

import { dayAmount, resolveRule, type PayRule } from "./pay-rules.ts";

// ---------------------------------------------------------------------
// Mirror of indigo.contractor.rate.day_amount in the addon. The formula
// lives in two languages because the panel has to ESTIMATE a day that
// Odoo has not computed yet (work still scheduled, not installed). The
// tests below are the contract that keeps the two honest — they use the
// same numbers as the Odoo suite.
// ---------------------------------------------------------------------

const LAZARO: PayRule = {
  partnerId: 11,
  ratePerDoor: 35,
  dailyMinimum: 150,
  bonusAmount: 0,
  bonusUnit: "order",
};

const MANDY: PayRule = {
  partnerId: 12,
  ratePerDoor: 0,
  dailyMinimum: 150,
  bonusAmount: 10,
  bonusUnit: "order",
};

const FALLBACK: PayRule = {
  partnerId: null,
  ratePerDoor: 35,
  dailyMinimum: 150,
  bonusAmount: 0,
  bonusUnit: "order",
};

test("the floor wins on a light day", () => {
  assert.equal(dayAmount(LAZARO, { doors: 2, installs: 1 }), 150);
  // 4 doors is 140 — still under. The break-even is 5, not 2.
  assert.equal(dayAmount(LAZARO, { doors: 4, installs: 2 }), 150);
});

test("the per-door rate wins once the day is big enough", () => {
  assert.equal(dayAmount(LAZARO, { doors: 5, installs: 1 }), 175);
  assert.equal(dayAmount(LAZARO, { doors: 6, installs: 3 }), 210);
});

test("a flat-day rule pays the floor plus one bonus per install", () => {
  assert.equal(dayAmount(MANDY, { doors: 3, installs: 1 }), 160);
  assert.equal(dayAmount(MANDY, { doors: 5, installs: 2 }), 170);
  // Doors never move this rule — the per-door rate is 0 on purpose.
  assert.equal(dayAmount(MANDY, { doors: 12, installs: 1 }), 160);
});

test("the bonus can be counted per door instead", () => {
  assert.equal(dayAmount({ ...MANDY, bonusUnit: "door" }, { doors: 3, installs: 1 }), 180);
});

test("the bonus rides ON TOP of the floor, it does not compete with it", () => {
  // A day that clears the floor still earns its travel money.
  const both: PayRule = { ...LAZARO, bonusAmount: 10 };
  assert.equal(dayAmount(both, { doors: 6, installs: 2 }), 230); // 210 + 20
  assert.equal(dayAmount(both, { doors: 1, installs: 1 }), 160); // 150 + 10
});

test("a day with no work earns nothing — the floor is per day WORKED", () => {
  assert.equal(dayAmount(LAZARO, { doors: 0, installs: 0 }), 0);
  assert.equal(dayAmount(MANDY, { doors: 0, installs: 0 }), 0);
});

test("a missing rule is null, never a silent number", () => {
  // Guessing a rate here is how someone gets paid wrong without anyone
  // noticing. The caller has to decide what to show.
  assert.equal(resolveRule([], 11), null);
  assert.equal(dayAmount(null, { doors: 5, installs: 1 }), null);
});

test("a rule of one's own beats the fallback", () => {
  const rules = [FALLBACK, LAZARO, MANDY];
  assert.equal(resolveRule(rules, 11), LAZARO);
  assert.equal(resolveRule(rules, 12), MANDY);
});

test("someone without their own rule gets the fallback", () => {
  const rules = [FALLBACK, LAZARO];
  assert.equal(resolveRule(rules, 99), FALLBACK);
});

test("fractional doors from a shared order are handled", () => {
  // Two installers on a 3-door order: 1.5 each -> 52.5, under the floor.
  assert.equal(dayAmount(LAZARO, { doors: 1.5, installs: 1 }), 150);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  SHOP_TIME_ZONE,
  shopDateString,
  shopStartOfDay,
  shopEndOfDay,
  toOdooDatetime,
} from "./shop-time.ts";

// ---------------------------------------------------------------------
// The bug this module exists for: Miami is UTC-4 in summer, so UTC
// midnight is 8 PM the PREVIOUS day locally. Majela working at 8:30 PM
// was seeing "today" flip to tomorrow underneath her.
// ---------------------------------------------------------------------

test("8:30 PM in Miami still belongs to the same shop day", () => {
  // 2026-08-18 20:30 EDT == 2026-08-19 00:30 UTC. UTC already says the
  // 19th; Miami is still on the 18th.
  const now = new Date("2026-08-19T00:30:00Z");
  assert.equal(now.getUTCDate(), 19, "sanity: UTC has already rolled over");
  assert.equal(shopDateString(now), "2026-08-18");
});

test("the shop day starts at local midnight, not UTC midnight", () => {
  const now = new Date("2026-08-19T00:30:00Z"); // 8:30 PM Aug 18 in Miami
  const start = shopStartOfDay(now);
  // Midnight on Aug 18 in Miami (EDT, UTC-4) is 04:00Z on Aug 18.
  assert.equal(start.toISOString(), "2026-08-18T04:00:00.000Z");
  assert.ok(start <= now, "the day must have already started");
});

test("an order sent at 8:30 PM Miami falls inside today's window", () => {
  const now = new Date("2026-08-19T00:30:00Z");
  const start = shopStartOfDay(now);
  const end = shopEndOfDay(now);
  assert.ok(start <= now && now < end, "8:30 PM local must count as today");

  // Under the old UTC-midnight logic the window would have started at
  // 2026-08-19T00:00Z, so everything Majela did earlier that afternoon
  // would have dropped out of the count. Prove that work is included.
  const thatAfternoon = new Date("2026-08-18T19:00:00Z"); // 3 PM Miami
  assert.ok(start <= thatAfternoon && thatAfternoon < end);
});

test("the window is exactly 24h on an ordinary day", () => {
  const now = new Date("2026-08-18T15:00:00Z");
  const span = shopEndOfDay(now).getTime() - shopStartOfDay(now).getTime();
  assert.equal(span, 24 * 60 * 60 * 1000);
});

test("start of day is stable at every hour of the same shop day", () => {
  const start = shopStartOfDay(new Date("2026-08-18T04:00:00Z")).toISOString();
  for (let hour = 0; hour < 24; hour++) {
    const instant = new Date(Date.UTC(2026, 7, 18, 4 + hour, 30));
    assert.equal(
      shopStartOfDay(instant).toISOString(),
      start,
      `hour ${hour} of the shop day resolved to a different start`,
    );
  }
});

// ---------------------------------------------------------------------
// DST. Twice a year the local day is 23h or 25h long; a fixed 24h step
// lands on the wrong date.
// ---------------------------------------------------------------------

test("spring forward: the local day is 23 hours, and the boundaries still line up", () => {
  // 2026-03-08 is the US spring-forward date (2 AM -> 3 AM EDT).
  const now = new Date("2026-03-08T12:00:00Z"); // 7 AM Miami, after the jump
  const start = shopStartOfDay(now);
  const end = shopEndOfDay(now);
  assert.equal(shopDateString(now), "2026-03-08");
  assert.equal(start.toISOString(), "2026-03-08T05:00:00.000Z", "midnight EST");
  assert.equal(end.toISOString(), "2026-03-09T04:00:00.000Z", "midnight EDT");
  assert.equal(end.getTime() - start.getTime(), 23 * 60 * 60 * 1000);
});

test("fall back: the local day is 25 hours", () => {
  // 2026-11-01 is the US fall-back date (2 AM -> 1 AM EST).
  const now = new Date("2026-11-01T12:00:00Z");
  const start = shopStartOfDay(now);
  const end = shopEndOfDay(now);
  assert.equal(shopDateString(now), "2026-11-01");
  assert.equal(end.getTime() - start.getTime(), 25 * 60 * 60 * 1000);
});

test("the 1:30 AM instant that exists twice still resolves to that day", () => {
  // On fall-back, 05:30Z and 06:30Z are both "1:30 AM" in Miami.
  for (const iso of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"]) {
    const now = new Date(iso);
    assert.equal(shopDateString(now), "2026-11-01", iso);
    assert.ok(shopStartOfDay(now) <= now, `${iso}: day must have started`);
    assert.ok(now < shopEndOfDay(now), `${iso}: day must not have ended`);
  }
});

test("winter uses EST (UTC-5), summer uses EDT (UTC-4)", () => {
  assert.equal(
    shopStartOfDay(new Date("2026-01-15T18:00:00Z")).toISOString(),
    "2026-01-15T05:00:00.000Z",
  );
  assert.equal(
    shopStartOfDay(new Date("2026-07-15T18:00:00Z")).toISOString(),
    "2026-07-15T04:00:00.000Z",
  );
});

// ---------------------------------------------------------------------
// Formatting for Odoo.
// ---------------------------------------------------------------------

test("toOdooDatetime emits naive UTC in Odoo's format", () => {
  assert.equal(toOdooDatetime(new Date("2026-08-18T04:00:00.000Z")), "2026-08-18 04:00:00");
});

test("the zone is Miami's", () => {
  assert.equal(SHOP_TIME_ZONE, "America/New_York");
});

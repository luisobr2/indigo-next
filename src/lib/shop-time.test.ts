import test from "node:test";
import assert from "node:assert/strict";

import {
  SHOP_TIME_ZONE,
  shopDateString,
  shopStartOfDay,
  shopEndOfDay,
  toOdooDatetime,
  shopRangeBounds,
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

// ---------------------------------------------------------------------
// shopRangeBounds — el rango de fechas del listado de ordenes.
// ---------------------------------------------------------------------

test("un dia suelto abarca desde su medianoche de Miami hasta la siguiente", () => {
  const r = shopRangeBounds("2026-08-25", "2026-08-25")!;
  // Verano: Miami va UTC-4, asi que la medianoche local son las 04:00 UTC.
  assert.equal(r.start, "2026-08-25 04:00:00");
  assert.equal(r.endExclusive, "2026-08-26 04:00:00");
});

test("el pedido de las 21:00 de Miami cae dentro de SU dia, no del siguiente", () => {
  // Este es el bug que el helper existe para evitar: guardado como 01:00 UTC
  // del 26, un rango construido en UTC lo dejaria fuera del 25 -- mientras la
  // tabla lo sigue mostrando en el 25 porque formatea en hora local.
  const r = shopRangeBounds("2026-08-25", "2026-08-25")!;
  const guardado = "2026-08-26 01:00:00"; // 21:00 del 25 en Miami
  assert.ok(guardado >= r.start && guardado < r.endExclusive);
});

test("en invierno el desplazamiento es de 5 horas", () => {
  const r = shopRangeBounds("2026-01-15", "2026-01-15")!;
  assert.equal(r.start, "2026-01-15 05:00:00");
  assert.equal(r.endExclusive, "2026-01-16 05:00:00");
});

test("un rango de varios dias incluye entero el ultimo dia", () => {
  const r = shopRangeBounds("2026-08-01", "2026-08-31")!;
  assert.equal(r.start, "2026-08-01 04:00:00");
  assert.equal(r.endExclusive, "2026-09-01 04:00:00");
  const ultimoInstante = "2026-08-31 23:59:59"; // aun de agosto en Miami
  assert.ok(ultimoInstante < r.endExclusive);
});

test("un rango al reves se ordena en vez de devolver vacio", () => {
  const alReves = shopRangeBounds("2026-08-31", "2026-08-01")!;
  const derecho = shopRangeBounds("2026-08-01", "2026-08-31")!;
  assert.deepEqual(alReves, derecho);
});

test("el cambio de hora de primavera no descuadra los limites", () => {
  // 2026-03-08: el dia local dura 23 h.
  const r = shopRangeBounds("2026-03-08", "2026-03-08")!;
  assert.equal(r.start, "2026-03-08 05:00:00");   // aun EST
  assert.equal(r.endExclusive, "2026-03-09 04:00:00"); // ya EDT
});

test("una fecha con formato invalido devuelve null en vez de un rango absurdo", () => {
  for (const bad of ["", "25/08/2026", "2026-8-5", "ayer", "2026-08-25T10:00"]) {
    assert.equal(shopRangeBounds(bad, "2026-08-25"), null, `deberia rechazar ${bad}`);
    assert.equal(shopRangeBounds("2026-08-25", bad), null, `deberia rechazar ${bad}`);
  }
});

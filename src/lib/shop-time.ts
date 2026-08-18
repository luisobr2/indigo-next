/**
 * The workshop's clock.
 *
 * Indigo Decors is at 2192 NW 26th Ave, Miami FL (see CLAUDE.md), so
 * "today" means today *in Miami* — never in UTC, and never in whatever
 * zone the container happens to run in. The two are not interchangeable:
 * this app's Odoo lives on a VPS whose clock is UTC, and Miami is UTC-4
 * in summer and UTC-5 in winter. A UTC day boundary therefore rolls over
 * at 8 PM (or 7 PM) local — so anyone still working in the evening sees
 * the day's counters reset under them, and anything stamped after that
 * hour is filed under tomorrow.
 *
 * No dependency: Intl carries the IANA database, including the DST rules,
 * so it is both correct and free.
 *
 * Pure and clock-free by design — every function takes `now` as a
 * parameter rather than reading Date.now() internally, so the tests can
 * pin an exact instant (8:30 PM Miami, or 1:30 AM on a DST-transition
 * morning) instead of hoping CI runs at a convenient hour. Kept free of
 * "@/"-aliased imports so `node --test` can import it directly.
 */

/** IANA zone for Miami. Handles EST/EDT and any future rule change. */
export const SHOP_TIME_ZONE = "America/New_York";

/**
 * How far ahead of UTC `timeZone` is at the instant `date`, in ms
 * (negative for the Americas).
 *
 * Works by asking Intl to render the instant as wall-clock fields in the
 * target zone, then reading those same fields back as if they had been
 * UTC. The gap between that and the real instant is the offset.
 */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const field: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") field[part.type] = Number(part.value);
  }
  const asIfUtc = Date.UTC(
    field.year!,
    field.month! - 1,
    field.day!,
    // Intl renders midnight as hour 24 in some ICU versions under
    // hour12:false; normalise so Date.UTC doesn't roll into the next day.
    field.hour! % 24,
    field.minute!,
    field.second!,
  );
  return asIfUtc - date.getTime();
}

/**
 * The calendar date in `timeZone` at instant `now`, as "YYYY-MM-DD".
 * en-CA formats exactly that way, which is also the shape Odoo's date
 * fields use.
 */
export function shopDateString(now: Date, timeZone: string = SHOP_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * The instant at which the shop's current day began — i.e. local midnight
 * in Miami, expressed as a real UTC instant so it can be compared against
 * the UTC datetimes Odoo stores.
 */
export function shopStartOfDay(now: Date, timeZone: string = SHOP_TIME_ZONE): Date {
  const offsetNow = zoneOffsetMs(now, timeZone);
  // Shift into "wall clock read as UTC" space, truncate to midnight, shift
  // back. `wall` is not a real instant — only its Y/M/D fields are used.
  const wall = new Date(now.getTime() + offsetNow);
  const localMidnightAsUtc = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
  );

  const candidate = new Date(localMidnightAsUtc - offsetNow);
  // On the two DST-transition days a year the offset at midnight differs
  // from the offset now, which would put `candidate` an hour off. One
  // correction with the offset AT the candidate settles it; re-deriving
  // again would just oscillate.
  const offsetAtMidnight = zoneOffsetMs(candidate, timeZone);
  if (offsetAtMidnight === offsetNow) return candidate;
  return new Date(localMidnightAsUtc - offsetAtMidnight);
}

/** The start of the shop's NEXT day — the exclusive upper bound of today. */
export function shopEndOfDay(now: Date, timeZone: string = SHOP_TIME_ZONE): Date {
  const start = shopStartOfDay(now, timeZone);
  // Add 25h then re-truncate rather than adding exactly 24h: on a
  // spring-forward day the local day is 23h long and on fall-back it is
  // 25h, so a fixed 24h step lands on the wrong date twice a year.
  return shopStartOfDay(new Date(start.getTime() + 25 * 60 * 60 * 1000), timeZone);
}

/**
 * Formats an instant the way Odoo's RPC layer expects a datetime bound:
 * "YYYY-MM-DD HH:MM:SS", always in UTC (Odoo stores and compares naive
 * UTC datetimes).
 */
export function toOdooDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

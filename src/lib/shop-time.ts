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

/**
 * Los dos extremos, en UTC, de un rango de dias del taller.
 *
 * Recibe dos fechas de calendario tal y como las escribe una persona
 * ("2026-08-25"), que son dias de MIAMI, y devuelve los limites que Odoo
 * necesita para comparar contra sus datetimes UTC.
 *
 * Sin esto el filtro miente justo donde mas se nota: un pedido entrado a las
 * 21:00 de Miami se guarda como la 01:00 UTC del dia SIGUIENTE, asi que un
 * rango construido en UTC lo deja fuera de su propio dia -- mientras la tabla,
 * que si formatea en hora local, lo sigue mostrando en el dia anterior. El
 * filtro y la columna dirian cosas distintas sobre la misma fila.
 *
 * El limite superior es EXCLUSIVO (el arranque del dia siguiente): asi entra
 * todo el dia final hasta las 23:59:59.999 sin depender de la precision con
 * la que Odoo guarde los segundos.
 *
 * Se ancla cada dia al mediodia UTC antes de convertir. A esa hora Miami va
 * por las 07:00 u 08:00, o sea el mismo dia de calendario tanto en invierno
 * como en verano; anclar a medianoche caeria justo en el borde que se
 * pretende resolver.
 */
export function shopRangeBounds(
  from: string,
  to: string,
  timeZone: string = SHOP_TIME_ZONE,
): { start: string; endExclusive: string } | null {
  const noonUtc = (ymd: string): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const a = noonUtc(from);
  const b = noonUtc(to);
  if (!a || !b) return null;
  // Un rango al reves no es un error del usuario que valga la pena rechazar:
  // se ordena y se le da lo que evidentemente queria.
  const [lo, hi] = a.getTime() <= b.getTime() ? [a, b] : [b, a];

  return {
    start: toOdooDatetime(shopStartOfDay(lo, timeZone)),
    endExclusive: toOdooDatetime(shopEndOfDay(hi, timeZone)),
  };
}

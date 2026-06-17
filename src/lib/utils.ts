import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ */
/* Formatters used across the app                                      */
/* ------------------------------------------------------------------ */

const MONEY_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const NUM_FMT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// Date-only formatter pinned to UTC so a plain "YYYY-MM-DD" renders the
// literal day (no timezone off-by-one).
const DATE_FMT_UTC = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Parse a value coming from Odoo into a real Date instant.
 * Odoo serializes datetimes as naive UTC "YYYY-MM-DD HH:MM:SS" (no tz) and
 * dates as "YYYY-MM-DD". `new Date("YYYY-MM-DD HH:MM:SS")` would (wrongly)
 * read it as LOCAL time, shifting the clock by the viewer's offset — so we
 * normalize the datetime form to UTC explicitly.
 */
function odooToInstant(v: string | Date): { d: Date; dateOnly: boolean } {
  if (v instanceof Date) return { d: v, dateOnly: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return { d: new Date(v + "T00:00:00Z"), dateOnly: true };
  }
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(v);
  if (m) return { d: new Date(`${m[1]}T${m[2]}Z`), dateOnly: false };
  return { d: new Date(v), dateOnly: false };
}

export function fmtMoney(v: number | null | undefined): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return MONEY_FMT.format(n);
}

export function fmtNum(v: number | null | undefined): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return NUM_FMT.format(n);
}

export function fmtDate(v: string | Date | null | undefined | false): string {
  if (!v) return "—";
  const { d, dateOnly } = odooToInstant(v);
  if (Number.isNaN(d.getTime())) return "—";
  // Date-only → render the literal day in UTC; datetimes → the local day of
  // that instant.
  return (dateOnly ? DATE_FMT_UTC : DATE_FMT).format(d);
}

export function fmtDateTime(
  v: string | Date | null | undefined | false,
): string {
  if (!v) return "—";
  const { d } = odooToInstant(v);
  if (Number.isNaN(d.getTime())) return "—";
  return DATETIME_FMT.format(d);
}

/**
 * Normalize an Odoo many2one value.
 *
 * Odoo serializes m2o fields as `[id, name]` when populated and `false` when
 * empty. This helper converts both shapes into a plain `{ id, name }` object
 * (or `null`) so callers can do `m2o(o.dealer_id)?.name`.
 */
export function m2o(
  v: [number, string] | false | null | undefined,
): { id: number; name: string } | null {
  if (!v || !Array.isArray(v)) return null;
  return { id: v[0], name: v[1] };
}

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
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return DATE_FMT.format(d);
}

export function fmtDateTime(
  v: string | Date | null | undefined | false,
): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
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

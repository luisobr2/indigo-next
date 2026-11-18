/**
 * Activity log (18-nov-2026): the pure helpers behind /admin/activity-log.
 * The rows themselves are written by Odoo (indigo.audit.log); this file only
 * decides how they read: where a row links to, which days a date preset
 * covers, and how rows group by day — all on the shop's clock, not the
 * viewer's, so "Today" means the same day in Miami for everyone.
 */
import { SHOP_TIME_ZONE } from "./shop-time.ts";

export interface AuditChange {
  field: string;
  label: string;
  old: string;
  new: string;
}

export interface AuditRow {
  id: number;
  /** UTC, "YYYY-MM-DD HH:MM:SS" as Odoo sends it. */
  date: string;
  user_id: number | false;
  user_name: string;
  module: string;
  action: string;
  record_type: string;
  res_model: string;
  res_id: number | false;
  res_name: string;
  summary: string;
  changes: AuditChange[];
}

export interface AuditPage {
  total: number;
  rows: AuditRow[];
  users: Array<{ id: number; name: string }>;
  modules: Array<{ key: string; label: string }>;
  actions: Array<{ key: string; label: string }>;
}

/** The panel page for a logged record, when there is one. */
export function recordHref(model: string, id: number | false): string | null {
  if (!id) return null;
  const base: Record<string, string> = {
    "indigo.order": "/orders",
    "account.move": "/billing/invoices",
    "res.partner": "/catalog/dealers",
    "res.users": "/admin/users",
    "indigo.design": "/catalog/designs",
    "indigo.brand": "/catalog/brands",
  };
  return base[model] ? `${base[model]}/${id}` : null;
}

/** "YYYY-MM-DD" of a moment, in the shop's time zone. */
export function shopDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type DatePreset = "today" | "7d" | "30d" | "all" | "custom";

/** The date range a preset stands for, as the API takes it (both ends included). */
export function presetRange(preset: DatePreset, now: Date = new Date()): { from: string; to: string } {
  const today = shopDay(now);
  if (preset === "today") return { from: today, to: today };
  if (preset === "7d") return { from: addDays(today, -6), to: today };
  if (preset === "30d") return { from: addDays(today, -29), to: today };
  return { from: "", to: "" };
}

/** Odoo's UTC string as a Date. */
export function rowDate(row: Pick<AuditRow, "date">): Date {
  return new Date(row.date.replace(" ", "T") + "Z");
}

/** Rows grouped by shop day, newest first, keeping the order they came in. */
export function groupByDay(rows: AuditRow[]): Array<{ day: string; rows: AuditRow[] }> {
  const out: Array<{ day: string; rows: AuditRow[] }> = [];
  for (const r of rows) {
    const day = shopDay(rowDate(r));
    const last = out[out.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else out.push({ day, rows: [r] });
  }
  return out;
}

/** "Wednesday, November 18" (+ year when it isn't this year). */
export function dayHeading(day: string, now: Date = new Date()): string {
  const d = new Date(`${day}T12:00:00Z`);
  const sameYear = day.slice(0, 4) === shopDay(now).slice(0, 4);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(d);
}

/** "3:07 PM", shop clock. */
export function rowTime(row: Pick<AuditRow, "date">): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: SHOP_TIME_ZONE,
  }).format(rowDate(row));
}

/** Query string for /api/admin/activity-log. Empty filters are left out. */
export function auditQuery(f: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== "" && v !== 0) sp.set(k, String(v));
  }
  return sp.toString();
}

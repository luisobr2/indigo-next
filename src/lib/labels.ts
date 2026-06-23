/**
 * Canonical human labels for Odoo Selection fields.
 *
 * These used to be re-declared (inconsistently) in ~10 files — one mapped
 * "SDL" instead of "sidelite", another omitted "bronze_eco", a third printed
 * the raw code. That drift produced wrong/blank labels on screen. This module
 * is the single source of truth; every screen must import from here.
 *
 * Canonical values:
 *   door_type:     SD | DD | sidelite
 *   color:         white | bronze | bronze_eco | black | custom
 *   payment_state: unpaid | partial | paid
 *
 * The helper functions coerce safely: Odoo returns boolean `false` for empty
 * scalar fields, so a bare `value ?? ""` would render the literal "false".
 */

export const DOOR_TYPE_LABEL: Record<string, string> = {
  SD: "Single Door",
  DD: "Double Door",
  sidelite: "Door with Sidelites",
};

export const COLOR_LABEL: Record<string, string> = {
  white: "White",
  bronze: "Bronze",
  bronze_eco: "Bronze ECO",
  black: "Black",
  custom: "Custom",
};

export const COLOR_HEX: Record<string, string> = {
  white: "#fff",
  bronze: "#a16207",
  bronze_eco: "#854d0e",
  black: "#111",
  custom: "#a78bfa",
};

export const PAYMENT_LABEL: Record<string, string> = {
  unpaid: "Unpaid",
  partial: "Partial",
  paid: "Paid",
};

/**
 * One distinct soft-badge color per production stage (bg + text Tailwind
 * classes). Single source of truth — imported by the orders table, the
 * Send-to pickers, etc. Every one of the 13 stages gets its own hue so they're
 * easy to tell apart at a glance.
 */
export const STAGE_BADGE: Record<string, string> = {
  new: "bg-slate-100 text-slate-700",
  design_pending: "bg-amber-50 text-amber-700",
  design_confirmed: "bg-yellow-50 text-yellow-700",
  measure_pending: "bg-orange-50 text-orange-700",
  measured: "bg-lime-50 text-lime-700",
  ready_digitalization: "bg-cyan-50 text-cyan-700",
  cnc: "bg-violet-50 text-violet-700",
  painting: "bg-pink-50 text-pink-700",
  ready_install: "bg-sky-50 text-sky-700",
  install_scheduled: "bg-blue-50 text-blue-700",
  installed: "bg-emerald-50 text-emerald-700",
  invoiced: "bg-teal-50 text-teal-700",
  closed: "bg-zinc-100 text-zinc-500",
};

/** Stage badge classes for a stage code; unknown → neutral gray. */
export function stageBadge(code: string): string {
  return STAGE_BADGE[code] ?? "bg-slate-100 text-slate-700";
}

const asKey = (v: unknown): string => (typeof v === "string" ? v : "");

/** "SD" → "Single Door". Empty/false → the dash placeholder. */
export function doorTypeLabel(v: unknown, fallback = "—"): string {
  const k = asKey(v);
  return DOOR_TYPE_LABEL[k] ?? (k || fallback);
}

/** "bronze_eco" → "Bronze ECO". Empty/false → the dash placeholder. */
export function colorLabel(v: unknown, fallback = "—"): string {
  const k = asKey(v);
  return COLOR_LABEL[k] ?? (k || fallback);
}

/** Swatch hex for a color code; unknown/empty → neutral gray. */
export function colorDot(v: unknown): string {
  return COLOR_HEX[asKey(v)] ?? "#cbd5e1";
}

/** "unpaid" → "Unpaid". Empty/false → the dash placeholder. */
export function paymentLabel(v: unknown, fallback = "—"): string {
  const k = asKey(v);
  return PAYMENT_LABEL[k] ?? (k || fallback);
}

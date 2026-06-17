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

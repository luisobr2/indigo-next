/**
 * Shared, framework-agnostic value validators used by both the client
 * (edit/create forms) and the API routes (defense in depth). Keep these
 * pure so they can run in the browser and in route handlers.
 */

// Pragmatic email check — not RFC-perfect, but catches the typos that
// matter (missing @, missing domain/TLD, spaces). We only block clearly
// broken addresses; deliverability is verified by the mail server.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** A text field's value. Odoo hands an empty char field back as `false`,
 *  and String(false) is "false" — which read as a (broken) email and
 *  blocked saving any order that had none. */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export interface OrderEditValues {
  client_name?: unknown;
  client_email?: unknown;
}

export interface LineEditValues {
  width?: unknown;
  height?: unknown;
  qty?: unknown;
  custom_price?: unknown;
  design_tier?: unknown;
}

/**
 * Validate an order-header edit. Returns an error string, or null if OK.
 * Only checks fields that are present in `vals` (partial edits are normal).
 */
export function validateOrderEdit(vals: OrderEditValues): string | null {
  if ("client_name" in vals) {
    const name = text(vals.client_name);
    if (!name) return "Client name can't be empty.";
  }
  if ("client_email" in vals) {
    // Optional: empty is fine, only a written address is checked.
    const email = text(vals.client_email);
    if (email && !isValidEmail(email)) {
      return "Email address looks invalid (e.g. name@domain.com).";
    }
  }
  return null;
}

/**
 * Validate an order-line edit. Returns an error string, or null if OK.
 * `label` is used to prefix the message (e.g. "Piece 2: …").
 */
export function validateLineEdit(
  vals: LineEditValues,
  label = "Piece",
): string | null {
  if ("width" in vals) {
    const w = Number(vals.width);
    if (!Number.isFinite(w) || w <= 0) return `${label}: width must be greater than 0.`;
  }
  if ("height" in vals) {
    const h = Number(vals.height);
    if (!Number.isFinite(h) || h <= 0) return `${label}: height must be greater than 0.`;
  }
  if ("qty" in vals) {
    const q = Number(vals.qty);
    if (!Number.isInteger(q) || q < 1) return `${label}: quantity must be a whole number ≥ 1.`;
  }
  if ("custom_price" in vals) {
    const p = Number(vals.custom_price);
    if (!Number.isFinite(p) || p < 0) return `${label}: custom price can't be negative.`;
  }
  return null;
}

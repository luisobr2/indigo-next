/**
 * What an invoice's QuickBooks state means to the office, as one pill: its
 * words, its colour, the longer reason, and whether "Retry" makes sense.
 * Pure, so it can be tested without a browser.
 */
export type QboState = "none" | "pending" | "synced" | "linked" | "mismatch" | "error" | "voided";

export interface QboFields {
  state?: "draft" | "posted" | "cancel";
  qbo_state?: QboState;
  qbo_error?: string | false;
  qbo_total?: number | false;
  qbo_origin?: "indigo" | "manual" | false;
  qbo_synced_at?: string | false;
  qbo_url?: string | false;
}

export type QboTone = "ok" | "info" | "warn" | "bad" | "muted";

export interface QboBadgeInfo {
  label: string;
  tone: QboTone;
  detail: string | null;
  canRetry: boolean;
}

/** States Odoo's qbo_retry accepts. */
export const QBO_RETRYABLE: QboState[] = ["pending", "error", "mismatch"];

/**
 * null = nothing to show (a draft, or QuickBooks not in use). An issued
 * invoice that never went to QuickBooks only shows when `showMissing` is set,
 * i.e. when QuickBooks is connected and its absence means something.
 */
export function qboBadge(row: QboFields, opts: { showMissing?: boolean } = {}): QboBadgeInfo | null {
  const st = row.qbo_state ?? "none";
  const reason = row.qbo_error || null;
  switch (st) {
    case "pending":
      return { label: "QuickBooks: pending", tone: "info", detail: "On its way to QuickBooks, usually within a few minutes.", canRetry: true };
    case "synced":
      return { label: "In QuickBooks", tone: "ok", detail: null, canRetry: false };
    case "linked":
      return {
        label: "In QuickBooks (by hand)",
        tone: "ok",
        detail: "It was already in QuickBooks with this number and the same total, so it was linked instead of copied.",
        canRetry: false,
      };
    case "mismatch":
      return {
        label: "QuickBooks doesn't match",
        tone: "warn",
        detail: reason ?? "QuickBooks has this invoice with different figures.",
        canRetry: true,
      };
    case "error":
      return { label: "QuickBooks error", tone: "bad", detail: reason ?? "It couldn't be sent to QuickBooks.", canRetry: true };
    case "voided":
      return { label: "Voided in QuickBooks", tone: "muted", detail: null, canRetry: false };
    default:
      if (opts.showMissing && row.state === "posted") {
        return {
          label: "Not in QuickBooks",
          tone: "muted",
          detail: "Issued before QuickBooks was connected, so it isn't copied there automatically.",
          canRetry: false,
        };
      }
      return null;
  }
}

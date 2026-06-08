/**
 * Helpers that open Odoo QWeb reports in a new tab. The Odoo backend
 * serves multi-record reports via comma-separated ids in the URL:
 *   /report/pdf/<report_name>/1,2,3
 *
 * Auth: the user's Odoo session cookie is set on the Odoo domain via the
 * authenticate flow, but the BROWSER will NOT send that cookie when we
 * `window.open()` a URL on a different origin (e.g. http://2.25.137.220:8069
 * from app.indigodecors.com). To work around that we hit a same-origin
 * proxy on the Next app that streams the PDF back with the session
 * attached server-side.
 */

const PROXY = "/api/odoo-report";

export interface ReportTarget {
  /** XMLId of the Odoo QWeb report. */
  report: string;
  /** Single id or list of ids to render. */
  ids: number | number[];
  /** Display filename (defaults to report-<ids>.pdf). */
  filename?: string;
}

export function openOdooReport({ report, ids, filename }: ReportTarget) {
  const idsStr = Array.isArray(ids) ? ids.join(",") : String(ids);
  if (!idsStr) return;
  const url = new URL(PROXY, window.location.origin);
  url.searchParams.set("report", report);
  url.searchParams.set("ids", idsStr);
  if (filename) url.searchParams.set("filename", filename);
  window.open(url.toString(), "_blank", "noopener");
}

/** Known reports living in indigo_decors. */
export const REPORTS = {
  orderCard: "indigo_decors.report_order_card_doc",
  orderLabel: "indigo_decors.report_order_label_doc",
  painterSheet: "indigo_decors.report_painter_sheet_doc",
  installationAddresses: "indigo_decors.report_install_addresses_doc",
  payout: "indigo_decors.report_payout_doc",
} as const;

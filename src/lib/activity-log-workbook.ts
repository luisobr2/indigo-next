import ExcelJS from "exceljs";
import { SHOP_TIME_ZONE } from "./shop-time.ts";
import type { AuditPage, AuditRow } from "./activity-log.ts";

/**
 * The Activity log as an Excel workbook (25-nov-2026: replaces the CSV, which
 * opened as one cramped line per action with the changes squeezed into a
 * single cell).
 *
 * Three sheets, from the overview down to the detail:
 *   1. Activity — one row per action, with real date and time cells (shop
 *      clock), autofilter, frozen header and every change on its own line.
 *   2. Changes — one row per changed field, so "who touched the Customer PO"
 *      is a filter away.
 *   3. About — the filters that produced the file, when, and whether it was
 *      cut at the export cap.
 *
 * Pure: it takes the rows Odoo returned and builds the book, so it can be
 * tested without Odoo behind it.
 */

const BRAND = "FF1F4486";
const HEADER_TEXT = "FFFFFFFF";
const BAND = "FFF4F6FB";

export interface WorkbookFilters {
  date_from?: string;
  date_to?: string;
  user?: string;
  module?: string;
  action?: string;
  q?: string;
}

/**
 * A Date whose UTC fields read as the shop's wall clock. Excel stores dates
 * without a zone, so this is what makes 3:07 PM in Miami show as 3:07 PM in
 * the cell no matter where the file is opened.
 */
export function shopWallClock(utc: string): Date {
  const d = new Date(utc.replace(" ", "T") + "Z");
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: SHOP_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return new Date(
    Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second),
  );
}

/** "Customer PO: empty → TARROW 400004", one line per field. */
export function changesText(row: Pick<AuditRow, "changes">): string {
  return row.changes.map((c) => `${c.label}: ${c.old || "empty"} → ${c.new || "empty"}`).join("\n");
}

function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: HEADER_TEXT } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
  row.alignment = { vertical: "middle" };
  row.height = 22;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
}

/** Light band on every other day, so the eye can follow a day down the sheet. */
function bandByDay(sheet: ExcelJS.Worksheet, dayOf: (rowNumber: number) => string) {
  let lastDay = "";
  let shaded = false;
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const day = dayOf(n);
    if (day !== lastDay) {
      shaded = !shaded;
      lastDay = day;
    }
    if (!shaded) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
      });
    }
  });
}

export function buildActivityWorkbook(
  page: Pick<AuditPage, "rows" | "total" | "modules" | "actions">,
  filters: WorkbookFilters,
  generatedAt: Date = new Date(),
): ExcelJS.Workbook {
  const moduleLabel = Object.fromEntries(page.modules.map((m) => [m.key, m.label]));
  const actionLabel = Object.fromEntries(page.actions.map((a) => [a.key, a.label]));
  const wb = new ExcelJS.Workbook();
  wb.creator = "Indigo Decors";
  wb.created = generatedAt;

  // ---------- 1. Activity ----------
  const act = wb.addWorksheet("Activity");
  act.columns = [
    { header: "Date", key: "date", width: 14, style: { numFmt: "ddd mmm d, yyyy" } },
    { header: "Time", key: "time", width: 10, style: { numFmt: "h:mm AM/PM" } },
    { header: "Person", key: "person", width: 24 },
    { header: "Module", key: "module", width: 13 },
    { header: "Action", key: "action", width: 14 },
    { header: "Type", key: "type", width: 12 },
    { header: "Record", key: "record", width: 26 },
    { header: "Summary", key: "summary", width: 48 },
    { header: "Changes (before → after)", key: "changes", width: 60 },
  ];
  styleHeader(act);
  const dayKey: string[] = [];
  for (const r of page.rows) {
    const wall = shopWallClock(r.date);
    const row = act.addRow({
      date: wall,
      time: wall,
      person: r.user_name || "Unknown",
      module: moduleLabel[r.module] ?? r.module,
      action: actionLabel[r.action] ?? r.action,
      type: r.record_type,
      record: r.res_name,
      summary: r.summary,
      changes: changesText(r),
    });
    row.alignment = { vertical: "top", wrapText: true };
    if (r.action === "login_failed" || r.action === "unlink") {
      row.getCell("action").font = { color: { argb: "FFBE123C" }, bold: true };
    }
    dayKey[row.number] = wall.toISOString().slice(0, 10);
  }
  bandByDay(act, (n) => dayKey[n]);

  // ---------- 2. Changes ----------
  const ch = wb.addWorksheet("Changes");
  ch.columns = [
    { header: "Date", key: "date", width: 14, style: { numFmt: "ddd mmm d, yyyy" } },
    { header: "Time", key: "time", width: 10, style: { numFmt: "h:mm AM/PM" } },
    { header: "Person", key: "person", width: 24 },
    { header: "Type", key: "type", width: 12 },
    { header: "Record", key: "record", width: 26 },
    { header: "Field", key: "field", width: 24 },
    { header: "Before", key: "before", width: 36 },
    { header: "After", key: "after", width: 36 },
  ];
  styleHeader(ch);
  const chDay: string[] = [];
  for (const r of page.rows) {
    const wall = shopWallClock(r.date);
    for (const c of r.changes) {
      const row = ch.addRow({
        date: wall,
        time: wall,
        person: r.user_name || "Unknown",
        type: r.record_type,
        record: r.res_name,
        field: c.label,
        before: c.old || "",
        after: c.new || "",
      });
      row.alignment = { vertical: "top", wrapText: true };
      chDay[row.number] = wall.toISOString().slice(0, 10);
    }
  }
  bandByDay(ch, (n) => chDay[n]);

  // ---------- 3. About ----------
  const about = wb.addWorksheet("About");
  about.columns = [
    { header: "", key: "k", width: 22 },
    { header: "", key: "v", width: 60 },
  ];
  const range =
    filters.date_from || filters.date_to
      ? `${filters.date_from || "the beginning"} to ${filters.date_to || "today"}`
      : "All time";
  const lines: Array<[string, string]> = [
    ["Indigo Decors — Activity log", ""],
    ["Generated", new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: SHOP_TIME_ZONE }).format(generatedAt) + " (Miami time)"],
    ["Dates", range],
    ["Person", filters.user || "Everyone"],
    ["Module", filters.module ? moduleLabel[filters.module] ?? filters.module : "All"],
    ["Action", filters.action ? actionLabel[filters.action] ?? filters.action : "All"],
    ["Search", filters.q || "—"],
    ["Actions in this file", String(page.rows.length)],
  ];
  if (page.total > page.rows.length) {
    lines.push(["Note", `Only the newest ${page.rows.length} of ${page.total} actions. Narrow the filters to export the rest.`]);
  }
  about.spliceRows(1, 1);
  for (const [k, v] of lines) about.addRow([k, v]);
  about.getRow(1).font = { bold: true, size: 14, color: { argb: BRAND } };
  about.getColumn(1).font = { bold: true };
  about.getRow(1).getCell(1).font = { bold: true, size: 14, color: { argb: BRAND } };

  return wb;
}

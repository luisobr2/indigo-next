/**
 * Tiny CSV helper. We don't pull a library because the only escape rules
 * we actually need are RFC 4180:
 *   - Wrap fields containing comma / quote / newline in double quotes.
 *   - Escape embedded double quotes by doubling them.
 */
export interface CsvColumn<T> {
  header: string;
  /** Either a property name or a getter from the row. */
  value: (row: T) => string | number | boolean | null | undefined;
}

function escapeField(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => escapeField(c.header)).join(",");
  const body = rows
    .map((r) => columns.map((c) => escapeField(c.value(r))).join(","))
    .join("\n");
  // BOM prefix so Excel auto-detects UTF-8 and renders accents correctly.
  return "﻿" + head + "\n" + body;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Free the blob URL on the next tick so the download has time to fire.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

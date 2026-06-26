// Generic "Print list" helper shared across the table pages (Orders,
// Installations, stage screens, Paint, Billing, ...). Opens a print window with
// a branded landscape table built from a column spec. Returns false if the
// browser blocked the pop-up so the caller can toast.

export interface PrintColumn<T> {
  label: string;
  align?: "left" | "right";
  print: (row: T) => string;
}

export function printTable<T>(opts: {
  title: string;
  subtitle?: string;
  columns: PrintColumn<T>[];
  rows: T[];
  /** Add a leading running-number column. Default true. */
  numbered?: boolean;
  /** Trailing blank columns (header only) to fill in by hand on paper. */
  blankCols?: string[];
  /** Landscape (default) vs portrait. */
  landscape?: boolean;
}): boolean {
  const {
    title,
    subtitle,
    columns,
    rows,
    numbered = true,
    blankCols = [],
    landscape = true,
  } = opts;
  const w = window.open("", "_blank");
  if (!w) return false;
  const esc = (v: unknown) =>
    String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  const head =
    (numbered ? "<th>#</th>" : "") +
    columns.map((c) => `<th${c.align === "right" ? ' class="r"' : ""}>${esc(c.label)}</th>`).join("") +
    blankCols.map((b) => `<th>${esc(b)}</th>`).join("");
  const body = rows
    .map(
      (r, i) =>
        "<tr>" +
        (numbered ? `<td>${i + 1}</td>` : "") +
        columns
          .map((c) => `<td${c.align === "right" ? ' class="r"' : ""}>${esc(c.print(r))}</td>`)
          .join("") +
        blankCols.map(() => `<td class="sd"></td>`).join("") +
        "</tr>",
    )
    .join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>${esc(title)}</title>
    <style>
      body{margin:22px;color:#111;font-family:Arial,Helvetica,sans-serif;}
      h1{font-size:17px;margin:0 0 2px;color:#1f4486;}
      .sub{font-size:11px;color:#555;margin-bottom:12px;}
      table{width:100%;border-collapse:collapse;font-size:10px;}
      th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top;}
      th{background:#1f4486;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      td.r,th.r{text-align:right;white-space:nowrap;}
      td.sd{width:90px;}
      thead{display:table-header-group;}
      tr{page-break-inside:avoid;}
      @page{size:${landscape ? "landscape" : "portrait"};margin:12mm;}
    </style></head><body>
    <h1>${esc(title)}</h1>
    ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ""}
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    <script>window.onload=function(){setTimeout(function(){window.print();},150);};</script>
    </body></html>`);
  w.document.close();
  return true;
}

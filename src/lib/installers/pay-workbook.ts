import ExcelJS from "exceljs";
import type { buildPayData } from "./pay-data";

/**
 * Turns a pay range into a four-sheet workbook.
 *
 * Split out of the route so it can be tested without an Odoo behind it: this
 * file decides what numbers land in someone's spreadsheet, and "it compiled"
 * is not evidence that it puts the right ones there.
 */
export type PayData = Awaited<ReturnType<typeof buildPayData>>;

const MONEY = '"$"#,##0.00';

const MODE_LABEL: Record<string, string> = {
  per_door: "Per Door",
  daily: "Daily Rate",
  guarantee: "Daily Rate (Min. Guarantee)",
};

const KIND_LABEL: Record<string, string> = {
  work: "Work",
  minimum: "Daily minimum",
  bonus: "Travel bonus",
};

/** Header styling, applied identically to every sheet. */
function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4486" } };
  row.alignment = { vertical: "middle" };
  row.height = 20;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

export function buildPayWorkbook(data: PayData, startStr: string, endStr: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Indigo Decors";
  wb.created = new Date();

  // ---------- 1. Summary ----------
  const sum = wb.addWorksheet("Summary");
  sum.columns = [
    { header: "Installer", key: "name", width: 26 },
    { header: "How they're paid", key: "rule", width: 42 },
    { header: "Days worked", key: "days", width: 13 },
    { header: "Doors", key: "doors", width: 10 },
    { header: "Installs", key: "installs", width: 10 },
    { header: "Days at minimum", key: "atMin", width: 17 },
    { header: "Earned", key: "total", width: 14, style: { numFmt: MONEY } },
    { header: "Settled", key: "settled", width: 14, style: { numFmt: MONEY } },
    { header: "Pending", key: "pending", width: 14, style: { numFmt: MONEY } },
    { header: "Scheduled (projected)", key: "sched", width: 20, style: { numFmt: MONEY } },
  ];
  styleHeader(sum);
  for (const i of data.installers) {
    const r = i.rule;
    const rule = !r
      ? "No rule configured"
      : [
          r.ratePerDoor > 0 ? `$${r.ratePerDoor.toFixed(2)}/door` : null,
          r.dailyMinimum > 0
            ? r.ratePerDoor > 0
              ? `min $${r.dailyMinimum.toFixed(2)}/day`
              : `$${r.dailyMinimum.toFixed(2)}/day`
            : null,
          r.bonusAmount > 0
            ? `+$${r.bonusAmount.toFixed(2)}/${r.bonusUnit === "door" ? "door" : "install"}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
    sum.addRow({
      name: i.name,
      rule,
      days: i.days.filter((d) => d.status === "completed").length,
      doors: i.doors,
      installs: i.installs,
      atMin: i.daysAtMinimum,
      total: i.total,
      settled: i.settled,
      pending: i.pending,
      sched: i.scheduledAmount,
    });
  }
  const totalRow = sum.addRow({
    name: "TOTAL",
    days: data.summary.daysWorked,
    doors: data.summary.doors,
    total: data.summary.total,
    settled: data.summary.settled,
    pending: data.summary.pending,
    sched: data.summary.scheduledAmount,
  });
  totalRow.font = { bold: true };
  totalRow.border = { top: { style: "thin" } };

  // ---------- 2. Days ----------
  const days = wb.addWorksheet("Days");
  days.columns = [
    { header: "Date", key: "date", width: 13 },
    { header: "Installer", key: "name", width: 24 },
    { header: "Status", key: "status", width: 12 },
    { header: "Doors", key: "doors", width: 9 },
    { header: "Installs", key: "installs", width: 10 },
    { header: "Work mode", key: "mode", width: 27 },
    { header: "Incidents", key: "inc", width: 11 },
    { header: "Orders", key: "orders", width: 30 },
    { header: "Notes", key: "notes", width: 46 },
    { header: "Amount", key: "amount", width: 14, style: { numFmt: MONEY } },
  ];
  styleHeader(days);
  for (const i of data.installers) {
    for (const d of i.days) {
      const row = days.addRow({
        date: d.date,
        name: i.name,
        status: d.status === "completed" ? "Completed" : "Scheduled",
        doors: d.doors,
        installs: d.installs,
        mode: MODE_LABEL[d.workMode] ?? d.workMode,
        inc: d.incidents || "",
        orders: d.orders.map((o) => o.name).join(", "),
        notes: d.notes.join(" | "),
        amount: d.amount,
      });
      // A projection is not money owed; grey it so nobody sums the two.
      if (d.status === "scheduled") {
        row.font = { italic: true, color: { argb: "FF64748B" } };
      }
    }
  }

  // ---------- 3. Breakdown ----------
  // One row per line Odoo wrote. This is the sheet that answers "why".
  const bd = wb.addWorksheet("Breakdown");
  bd.columns = [
    { header: "Date", key: "date", width: 13 },
    { header: "Installer", key: "name", width: 24 },
    { header: "Payout", key: "payout", width: 18 },
    { header: "Line type", key: "kind", width: 16 },
    { header: "Description", key: "desc", width: 52 },
    { header: "Quantity", key: "qty", width: 11 },
    { header: "Rate", key: "rate", width: 12, style: { numFmt: MONEY } },
    { header: "Amount", key: "amount", width: 14, style: { numFmt: MONEY } },
  ];
  styleHeader(bd);
  for (const i of data.installers) {
    for (const d of i.days) {
      for (const l of d.lines) {
        const row = bd.addRow({
          date: d.date,
          name: i.name,
          payout: d.payoutName ?? "",
          kind: KIND_LABEL[l.kind] ?? l.kind,
          desc: l.description,
          qty: l.quantity,
          rate: l.rate,
          amount: l.amount,
        });
        if (l.kind !== "work") {
          row.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFEF3C7" },
          };
        }
      }
    }
  }

  // ---------- 4. Incidents ----------
  const inc = wb.addWorksheet("Incidents");
  inc.columns = [
    { header: "Date", key: "date", width: 13 },
    { header: "Order", key: "order", width: 20 },
    { header: "Client", key: "client", width: 28 },
    { header: "Type", key: "type", width: 16 },
    { header: "Description", key: "desc", width: 60 },
    { header: "Reported by", key: "by", width: 24 },
  ];
  styleHeader(inc);
  for (const i of data.incidents) {
    inc.addRow({
      date: String(i.date).slice(0, 10),
      order: i.order ?? "",
      client: i.client ?? "",
      type: i.category,
      desc: i.description,
      by: i.reportedBy ?? "",
    });
  }

  // El rango va en las propiedades del archivo: abierto suelto, un mes
  // despues, si no dice de que periodo es no sirve de nada.
  wb.title = `Installer pay ${startStr} to ${endStr}`;
  return wb;
}

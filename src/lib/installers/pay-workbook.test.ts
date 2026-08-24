import test from "node:test";
import assert from "node:assert/strict";

import { buildPayWorkbook, type PayData } from "./pay-workbook.ts";

// ---------------------------------------------------------------------
// This file decides what numbers land in someone's spreadsheet, so "it
// compiled" is not evidence it puts the right ones there. The fixture uses
// the two real agreements: Lazaro at $35/door with a $150 floor, Mandy at a
// flat $150/day plus $10 per install.
// ---------------------------------------------------------------------

const DATA = {
  rangeStart: "2026-08-17",
  rangeEnd: "2026-08-23",
  truncated: false,
  lastActivityDate: "2026-08-21",
  rules: [],
  summary: {
    installers: 2,
    daysWorked: 2,
    daysScheduled: 1,
    doors: 5,
    doorsInstalled: 4,
    total: 310,
    pending: 310,
    settled: 0,
    scheduledAmount: 150,
    daysAtMinimum: 2,
    incidents: 1,
    byMode: { per_door: 0, daily: 3, guarantee: 2 },
  },
  installers: [
    {
      installerId: 11,
      name: "Lazaro",
      rule: { ratePerDoor: 35, dailyMinimum: 150, bonusAmount: 0, bonusUnit: "order", isOwn: true },
      days: [
        {
          key: "p1",
          date: "2026-08-18",
          status: "completed",
          doors: 2,
          installs: 1,
          amount: 150,
          workMode: "guarantee",
          payoutName: "PAY/2026/00001",
          payoutState: "draft",
          orders: [{ id: 1, name: "IND/2026/00001", client: "Perez" }],
          notes: ["All ok"],
          incidents: 0,
          lines: [
            { kind: "work", description: "Installation IND/2026/00001", quantity: 2, rate: 35, amount: 70 },
            { kind: "minimum", description: "Adjust to daily minimum (150.00)", quantity: 1, rate: 80, amount: 80 },
          ],
        },
        {
          key: "s11-2026-08-20",
          date: "2026-08-20",
          status: "scheduled",
          doors: 1,
          installs: 1,
          amount: 150,
          workMode: "guarantee",
          payoutName: null,
          payoutState: null,
          orders: [{ id: 2, name: "IND/2026/00002", client: "Gomez" }],
          notes: [],
          incidents: 0,
          lines: [],
        },
      ],
      doors: 3,
      installs: 2,
      total: 150,
      pending: 150,
      settled: 0,
      scheduledAmount: 150,
      daysAtMinimum: 1,
      incidents: 0,
    },
    {
      installerId: 12,
      name: "Mandy",
      rule: { ratePerDoor: 0, dailyMinimum: 150, bonusAmount: 10, bonusUnit: "order", isOwn: true },
      days: [
        {
          key: "p2",
          date: "2026-08-19",
          status: "completed",
          doors: 2,
          installs: 1,
          amount: 160,
          workMode: "daily",
          payoutName: "PAY/2026/00002",
          payoutState: "draft",
          orders: [{ id: 3, name: "IND/2026/00003", client: "Diaz" }],
          notes: [],
          incidents: 1,
          lines: [
            { kind: "work", description: "Installation IND/2026/00003", quantity: 2, rate: 0, amount: 0 },
            { kind: "minimum", description: "Daily rate", quantity: 1, rate: 150, amount: 150 },
            { kind: "bonus", description: "Bonus per install (gas and tolls)", quantity: 1, rate: 10, amount: 10 },
          ],
        },
      ],
      doors: 2,
      installs: 1,
      total: 160,
      pending: 160,
      settled: 0,
      scheduledAmount: 0,
      daysAtMinimum: 1,
      incidents: 1,
    },
  ],
  incidents: [
    {
      id: 5,
      date: "2026-08-19 14:00:00",
      order: "IND/2026/00003",
      orderId: 3,
      client: "Diaz",
      reportedBy: "Majela",
      category: "install",
      description: "Glass scratched during installation.",
    },
  ],
} as unknown as PayData;

const wb = buildPayWorkbook(DATA, "2026-08-17", "2026-08-23");
const sheet = (n: string) => {
  const s = wb.getWorksheet(n);
  assert.ok(s, `missing sheet ${n}`);
  return s;
};
/** Column values for a sheet, skipping the header row. */
const col = (name: string, key: string) =>
  sheet(name)
    .getColumn(key)
    .values.slice(2)
    .filter((v) => v !== undefined && v !== null);

test("the workbook has the four sheets, summary first", () => {
  assert.deepEqual(
    wb.worksheets.map((w) => w.name),
    ["Summary", "Days", "Breakdown", "Incidents"],
  );
});

test("summary carries one row per installer plus a TOTAL", () => {
  const names = col("Summary", "name");
  assert.deepEqual(names, ["Lazaro", "Mandy", "TOTAL"]);
});

test("the TOTAL row matches the summary, not a re-derived sum", () => {
  // The screen and the file must never disagree; both read the same payload.
  const totals = col("Summary", "total") as number[];
  assert.equal(totals[totals.length - 1], DATA.summary.total);
});

test("each installer's rule is spelled out in words", () => {
  const rules = col("Summary", "rule") as string[];
  assert.match(rules[0], /\$35\.00\/door/);
  assert.match(rules[0], /min \$150\.00\/day/);
  // Mandy has no per-door rate, so the day rate must not be labelled "min".
  assert.match(rules[1], /^\$150\.00\/day/);
  assert.match(rules[1], /\+\$10\.00\/install/);
});

test("Days lists every day, worked and scheduled, with readable modes", () => {
  assert.equal(col("Days", "date").length, 3);
  const modes = col("Days", "mode") as string[];
  assert.ok(modes.includes("Daily Rate (Min. Guarantee)"));
  assert.ok(modes.includes("Daily Rate"));
  assert.deepEqual(col("Days", "status"), ["Completed", "Scheduled", "Completed"]);
});

test("a projected day is visually set apart from money owed", () => {
  // Someone scanning the sheet must not add a plan to a debt.
  const rows = sheet("Days").getRows(2, 3)!;
  const scheduled = rows.find((r) => r.getCell("status").value === "Scheduled")!;
  const completed = rows.find((r) => r.getCell("status").value === "Completed")!;
  assert.equal(scheduled.font?.italic, true);
  assert.notEqual(completed.font?.italic, true);
});

test("Breakdown carries the lines that explain each amount", () => {
  // This is the sheet that answers "why is a 2-door day $150".
  const kinds = col("Breakdown", "kind") as string[];
  assert.deepEqual(kinds, ["Work", "Daily minimum", "Work", "Daily minimum", "Travel bonus"]);
  const amounts = col("Breakdown", "amount") as number[];
  assert.equal(amounts[0] + amounts[1], 150, "70 of doors + 80 of floor = the day");
  assert.equal(amounts[2] + amounts[3] + amounts[4], 160, "0 + 150 + 10 = Mandy's day");
});

test("adjustment lines are highlighted so the eye finds them", () => {
  const row = sheet("Breakdown").getRow(3); // the minimum line
  assert.equal(row.getCell("kind").value, "Daily minimum");
  assert.ok(row.fill, "adjustment rows carry a fill");
});

test("scheduled days contribute no Breakdown rows — nothing was priced yet", () => {
  assert.equal(col("Breakdown", "date").length, 5);
});

test("incidents come across with their order and reporter", () => {
  assert.deepEqual(col("Incidents", "order"), ["IND/2026/00003"]);
  assert.deepEqual(col("Incidents", "by"), ["Majela"]);
  assert.deepEqual(col("Incidents", "date"), ["2026-08-19"]);
});

test("money columns are formatted as money, not bare numbers", () => {
  assert.match(String(sheet("Summary").getColumn("total").style.numFmt), /\$/);
  assert.match(String(sheet("Breakdown").getColumn("amount").style.numFmt), /\$/);
});

test("every sheet freezes its header row", () => {
  for (const w of wb.worksheets) {
    assert.equal(w.views?.[0]?.state, "frozen", `${w.name} should freeze its header`);
  }
});

test("the file says which period it covers", () => {
  // Opened a month later on its own, an untitled sheet of numbers is useless.
  assert.match(String(wb.title), /2026-08-17.*2026-08-23/);
});

test("an empty range still produces a valid workbook", () => {
  const empty = buildPayWorkbook(
    { ...DATA, installers: [], incidents: [], summary: { ...DATA.summary, total: 0, daysWorked: 0, doors: 0 } } as PayData,
    "2026-09-01",
    "2026-09-07",
  );
  assert.equal(empty.worksheets.length, 4);
  assert.deepEqual(
    empty.getWorksheet("Summary")!.getColumn("name").values.slice(2).filter(Boolean),
    ["TOTAL"],
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildActivityWorkbook, changesText, shopWallClock } from "./activity-log-workbook.ts";
import type { AuditRow } from "./activity-log.ts";

const row = (over: Partial<AuditRow>): AuditRow => ({
  id: 1, date: "2026-11-18 20:07:00", user_id: 2, user_name: "Ana Quillon", module: "orders",
  action: "write", record_type: "Order", res_model: "indigo.order", res_id: 5,
  res_name: "IND/2026/00005", summary: "Changed Customer PO, Phone", changes: [], ...over,
});

const page = (rows: AuditRow[], total = rows.length) => ({
  rows, total,
  modules: [{ key: "orders", label: "Orders" }, { key: "session", label: "Sign-in" }],
  actions: [{ key: "write", label: "Changed" }, { key: "login_failed", label: "Failed sign-in" }],
});

test("dates land in the cell on the shop's clock, whatever the viewer's zone", () => {
  // 20:07 UTC on 18-nov = 3:07 PM in Miami
  assert.equal(shopWallClock("2026-11-18 20:07:00").toISOString(), "2026-11-18T15:07:00.000Z");
  // 03:00 UTC on the 18th is still the 17th in Miami
  assert.equal(shopWallClock("2026-11-18 03:00:00").toISOString().slice(0, 10), "2026-11-17");
});

test("each change reads on its own line, before → after", () => {
  assert.equal(
    changesText({ changes: [
      { field: "customer_po", label: "Customer PO", old: "", new: "QUILLON 400001" },
      { field: "phone", label: "Phone", old: "305", new: "" },
    ] }),
    "Customer PO: empty → QUILLON 400001\nPhone: 305 → empty",
  );
});

test("the book has the activity, one row per changed field, and what was exported", () => {
  const wb = buildActivityWorkbook(
    page([
      row({ id: 2, changes: [
        { field: "customer_po", label: "Customer PO", old: "", new: "QUILLON 400001" },
        { field: "phone", label: "Phone", old: "", new: "305-555-0100" },
      ] }),
      row({ id: 1, action: "login_failed", module: "session", record_type: "User", res_name: "nobody@test", summary: "Failed sign-in" }),
    ], 7),
    { date_from: "2026-11-01", date_to: "2026-11-18", module: "orders" },
    new Date("2026-11-25T14:00:00Z"),
  );
  assert.deepEqual(wb.worksheets.map((s) => s.name), ["Activity", "Changes", "About"]);

  const act = wb.getWorksheet("Activity")!;
  assert.equal(act.rowCount, 3);
  assert.equal(act.getRow(1).getCell(1).value, "Date");
  assert.deepEqual(act.views[0], { state: "frozen", ySplit: 1 });
  assert.equal(act.getRow(2).getCell("module").value, "Orders");
  assert.equal(act.getRow(2).getCell("action").value, "Changed");
  assert.match(String(act.getRow(2).getCell("changes").value), /Customer PO: empty → QUILLON 400001\nPhone/);
  assert.ok(act.getRow(2).getCell("date").value instanceof Date);
  assert.equal(act.getRow(3).getCell("action").value, "Failed sign-in");

  assert.equal(wb.getWorksheet("Changes")!.rowCount, 3, "header + two changed fields");

  const about = wb.getWorksheet("About")!;
  const text = about.getSheetValues().flat().filter(Boolean).join(" | ");
  assert.match(text, /2026-11-01 to 2026-11-18/);
  assert.match(text, /Orders/);
  assert.match(text, /Only the newest 2 of 7 actions/);
});

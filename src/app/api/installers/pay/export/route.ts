import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import {
  buildPayData,
  MAX_RANGE_DAYS,
  daysBetween,
  resolveRange,
} from "@/lib/installers/pay-data";
import { buildPayWorkbook } from "@/lib/installers/pay-workbook";

export const runtime = "nodejs";

/**
 * GET /api/installers/pay/export?from=&to=  ->  .xlsx
 *
 * The CSV this replaces was one flat table: a day per row and nothing
 * underneath it. But the question people bring to a payment sheet is "why is
 * this day $150 when it was three doors", and a flat file cannot answer it.
 * The workbook has four sheets, from summary down to the individual lines
 * Odoo wrote when it priced each day.
 *
 * Built server-side on purpose: it assembles from the very same buildPayData()
 * the screen reads -- so an exported total can never disagree with the one on
 * screen -- and exceljs never reaches the browser bundle.
 */
export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    // Same gate as the screen: this file lists every installer's pay.
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;
    const { startStr, endStr } = resolveRange(sp.get("from"), sp.get("to"), sp.get("week"));
    if (daysBetween(startStr, endStr) > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Range too wide - ${MAX_RANGE_DAYS} days maximum.` },
        { status: 400 },
      );
    }

    const data = await buildPayData({ session: s.session, startStr, endStr });
    const wb = buildPayWorkbook(data, startStr, endStr);
    const buf = await wb.xlsx.writeBuffer();

    return new NextResponse(buf as ArrayBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="installer-pay-${startStr}_${endStr}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

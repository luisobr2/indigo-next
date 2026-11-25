import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import type { AuditPage } from "@/lib/activity-log";
import { buildActivityWorkbook } from "@/lib/activity-log-workbook";
import { shopDay } from "@/lib/activity-log";

export const runtime = "nodejs";

/** The newest this many actions go in one file; the About sheet says so when it cuts. */
const EXPORT_CAP = 5000;
const FILTERS = ["date_from", "date_to", "user_id", "module", "action", "q"];

/**
 * GET /api/admin/activity-log/export?<same filters as the page>  ->  .xlsx
 *
 * Built server-side from the same Odoo search the page reads, so the file
 * holds exactly what the screen shows, and exceljs never reaches the browser.
 */
export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !s.user.isAdmin) {
      return NextResponse.json({ error: "Only administrators can export the activity log." }, { status: 403 });
    }
    const sp = req.nextUrl.searchParams;
    const params: Record<string, string | number> = { export: 1, limit: EXPORT_CAP };
    for (const k of FILTERS) {
      const v = sp.get(k);
      if (v) params[k] = v;
    }
    const page = await call<AuditPage>({
      session: s.session,
      model: "indigo.audit.log",
      method: "indigo_audit_search",
      args: [params],
      kwargs: {},
    });
    const userId = Number(sp.get("user_id") || 0);
    const wb = buildActivityWorkbook(page, {
      date_from: sp.get("date_from") || undefined,
      date_to: sp.get("date_to") || undefined,
      user: userId ? page.users.find((u) => u.id === userId)?.name : undefined,
      module: sp.get("module") || undefined,
      action: sp.get("action") || undefined,
      q: sp.get("q") || undefined,
    });
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="activity-log-${shopDay(new Date())}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}

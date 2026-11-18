import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import type { AuditPage } from "@/lib/activity-log";

export const runtime = "nodejs";

/**
 * GET /api/admin/activity-log?date_from&date_to&user_id&module&action&q&offset&limit&export
 *
 * The activity log, filtered and paged by Odoo (indigo.audit.log). Only
 * managers / system admins: it shows what every person did. Odoo checks this
 * too (indigo_audit_search raises AccessError); this is the first gate.
 */
const KEYS = ["date_from", "date_to", "user_id", "module", "action", "q", "offset", "limit", "export", "res_model", "res_id"];

export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !s.user.isAdmin) {
      return NextResponse.json({ error: "Only administrators can see the activity log." }, { status: 403 });
    }
    const sp = req.nextUrl.searchParams;
    const params: Record<string, string> = {};
    for (const k of KEYS) {
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
    return NextResponse.json(page);
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
  }
}

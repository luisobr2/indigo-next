import { NextResponse } from "next/server";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { ICS_TOKEN } from "@/lib/ics-feed";

export const runtime = "nodejs";

/**
 * GET /api/calendar/feed-url
 *
 * Returns the iCalendar subscription token to logged-in managers/office so
 * the calendar dialog can build the subscribe URL at runtime. Keeps the
 * token out of the public client bundle (vs. a NEXT_PUBLIC constant).
 */
export async function GET() {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ token: ICS_TOKEN });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

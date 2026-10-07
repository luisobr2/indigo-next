import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { billingError } from "@/lib/billing/server";

/**
 * One door into the Odoo QuickBooks service (`indigo.qbo`, module
 * indigo_quickbooks), like billingCall for invoicing. Office, managers and
 * admins get through; Odoo checks again (connecting is managers only).
 *
 * When the module isn't installed on that Odoo yet, the model doesn't exist:
 * that comes back as 404 `{ available: false }` so the panel can simply not
 * show QuickBooks, instead of an error.
 */
export async function qboCall<T = unknown>(method: string, args: unknown[] = []): Promise<NextResponse> {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Only the office or a manager can see QuickBooks." }, { status: 403 });
    }
    const data = await call<T>({ session: s.session, model: "indigo.qbo", method, args, kwargs: {} });
    return NextResponse.json({ data });
  } catch (e) {
    if (e instanceof Error && /indigo\.qbo/.test(e.message) && /(doesn't|does not) exist|unknown model|KeyError/i.test(e.message)) {
      return NextResponse.json({ available: false, error: "QuickBooks isn't installed on this server." }, { status: 404 });
    }
    return billingError(e);
  }
}

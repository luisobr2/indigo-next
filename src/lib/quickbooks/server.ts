import { NextResponse } from "next/server";
import { call, OdooError } from "@/lib/odoo/client";
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
    if (e instanceof OdooError) {
      const code = String(e.code ?? "");
      // Model not in this Odoo: Odoo answers KeyError('indigo.qbo') (the
      // exception's name comes in `code`, the model name in the message).
      if (/KeyError$/.test(code) && /indigo\.qbo/.test(e.message)) {
        return NextResponse.json({ available: false, error: "QuickBooks isn't installed on this server." }, { status: 404 });
      }
      // QuickBooks' own errors (not connected, reconnect, a match missing,
      // QuickBooks refused...) are things a person can act on: 400 with the
      // sentence, not a 500.
      if (/QboError$/.test(code)) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
    }
    return billingError(e);
  }
}

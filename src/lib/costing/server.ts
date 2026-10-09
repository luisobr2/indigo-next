import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { billingError } from "@/lib/billing/server";

/**
 * One door into the Odoo cost service (`indigo.costing`), like billingCall.
 * Costs and margins are for the office and managers only; Odoo checks again.
 */
export async function costingCall<T = unknown>(method: string, args: unknown[] = []): Promise<NextResponse> {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Only the office or a manager can see costs." }, { status: 403 });
    }
    const data = await call<T>({ session: s.session, model: "indigo.costing", method, args, kwargs: {} });
    return NextResponse.json({ data });
  } catch (e) {
    return billingError(e);
  }
}

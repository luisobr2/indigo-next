import { NextResponse } from "next/server";
import { call, OdooError } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

/**
 * One door into the Odoo invoicing service (`indigo.billing`).
 *
 * Only the office, a manager or an admin get through; Odoo checks the same
 * again on its side, so this gate only saves a round trip and gives a clean
 * 403. Odoo's own refusals come back with their message: a UserError or a
 * ValidationError is something the person can fix ("pick orders of one
 * dealer"), so it is a 400 with the sentence, not a 500.
 */
export async function billingCall<T = unknown>(method: string, args: unknown[] = []): Promise<NextResponse> {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Only the office or a manager can use invoicing." }, { status: 403 });
    }
    const data = await call<T>({ session: s.session, model: "indigo.billing", method, args, kwargs: {} });
    return NextResponse.json({ data });
  } catch (e) {
    return billingError(e);
  }
}

export function billingError(e: unknown): NextResponse {
  if (e instanceof Response) return e as NextResponse;
  if (e instanceof OdooError) {
    const code = String(e.code || "");
    const status = /AccessError/.test(code) ? 403 : /UserError|ValidationError|MissingError/.test(code) ? 400 : 500;
    return NextResponse.json({ error: e.message }, { status });
  }
  const msg = e instanceof Error ? e.message : "Invoicing error";
  return NextResponse.json({ error: msg }, { status: 500 });
}

export function idParam(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

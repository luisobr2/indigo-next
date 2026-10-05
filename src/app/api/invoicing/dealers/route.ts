import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { billingError } from "@/lib/billing/server";

export const runtime = "nodejs";

interface DealerRow {
  id: number;
  name: string;
  email: string | false;
  indigo_invoice_emails: string | false;
  indigo_tax_exempt: boolean;
}

/**
 * GET: every active dealer and where its invoices go, for Billing -> Dealers.
 * `invoice_emails` is "Send invoices to"; when it's empty the invoice goes to
 * the dealer's main email (`uses_main_email`), the same rule Odoo applies
 * when sending (res.partner._indigo_invoice_recipients).
 */
export async function GET() {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Only the office or a manager can use invoicing." }, { status: 403 });
    }
    const rows = await call<DealerRow[]>({
      session: s.session,
      model: "res.partner",
      method: "search_read",
      args: [
        [["is_indigo_dealer", "=", true], ["active", "=", true]],
        ["id", "name", "email", "indigo_invoice_emails", "indigo_tax_exempt"],
      ],
      kwargs: { order: "name", limit: 500 },
    });
    const split = (raw: string | false) =>
      (raw || "")
        .replace(/;/g, ",")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
    const data = rows.map((r) => {
      const own = split(r.indigo_invoice_emails);
      return {
        id: r.id,
        name: r.name,
        invoice_emails: own.length ? own : split(r.email),
        uses_main_email: !own.length,
        tax_exempt: !!r.indigo_tax_exempt,
      };
    });
    return NextResponse.json({ data });
  } catch (e) {
    return billingError(e);
  }
}

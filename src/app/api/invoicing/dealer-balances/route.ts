import { NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";
import { billingError } from "@/lib/billing/server";
import { shopDateString } from "@/lib/shop-time";
import type { InvoiceRow, InvoiceSummary } from "@/lib/billing/invoice";

export const runtime = "nodejs";

export interface DealerBalance {
  dealerId: number;
  open: number;
  overdue: number;
  invoices: number;
}

/**
 * GET: what each dealer still owes on issued invoices (open balance and the
 * overdue part), for the "To invoice" list on Billing. Majela: "que se vea lo
 * que me falta por cobrar".
 */
export async function GET() {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Only the office or a manager can use invoicing." }, { status: 403 });
    }
    const res = await call<{ rows: InvoiceRow[]; summary: InvoiceSummary }>({
      session: s.session,
      model: "indigo.billing",
      method: "indigo_billing_list",
      args: [{ status: "open" }],
      kwargs: {},
    });
    const today = shopDateString(new Date());
    const by = new Map<number, DealerBalance>();
    for (const r of res.rows) {
      if (!r.dealer || r.state !== "posted" || r.residual <= 0.005) continue;
      const b = by.get(r.dealer[0]) ?? { dealerId: r.dealer[0], open: 0, overdue: 0, invoices: 0 };
      b.open += r.residual;
      b.invoices += 1;
      const due = r.due_date || r.invoice_date;
      if (due && due < today) b.overdue += r.residual;
      by.set(r.dealer[0], b);
    }
    return NextResponse.json({ data: [...by.values()] });
  } catch (e) {
    return billingError(e);
  }
}

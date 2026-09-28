import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession, deriveRole } from "@/lib/odoo/session";
import { billingError, idParam } from "@/lib/billing/server";

export const runtime = "nodejs";

/**
 * GET: the invoice PDF, rendered by Odoo in sudo after its role check. Not
 * through /api/odoo-report, which uses the person's own Odoo rights: the team
 * has no accounting groups in Odoo and doesn't need them.
 * ?download=1 asks the browser to save it instead of showing it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = idParam((await params).id);
    if (!id) return NextResponse.json({ error: "Bad invoice id" }, { status: 400 });
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const pdf = await call<{ filename: string; data: string }>({
      session: s.session,
      model: "indigo.billing",
      method: "indigo_billing_pdf",
      args: [id],
      kwargs: {},
    });
    const bytes = Buffer.from(pdf.data, "base64");
    const disposition = req.nextUrl.searchParams.get("download") ? "attachment" : "inline";
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${pdf.filename.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return billingError(e);
  }
}

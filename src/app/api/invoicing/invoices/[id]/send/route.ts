import { NextRequest, NextResponse } from "next/server";
import { billingCall, idParam } from "@/lib/billing/server";
import { parseEmails } from "@/lib/billing/invoice";

export const runtime = "nodejs";

/**
 * POST {emails: string | string[], message?}: email the invoice PDF (with the
 * installation photos) to one or more addresses. Manual only: automatic
 * notices to dealers stay off by the client's decision.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad invoice id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const raw = Array.isArray(body?.emails) ? body.emails.join(",") : String(body?.emails ?? "");
  const emails = parseEmails(raw);
  if (!emails.length) {
    return NextResponse.json({ error: "Add at least one valid email address." }, { status: 400 });
  }
  return billingCall("indigo_billing_send", [id, emails, body?.message || null]);
}

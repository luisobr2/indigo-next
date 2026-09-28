import { NextRequest, NextResponse } from "next/server";
import { billingCall, idParam } from "@/lib/billing/server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET: the dealer's statement (open balance, overdue, invoices and payments). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad dealer id" }, { status: 400 });
  return billingCall("indigo_billing_dealer_statement", [id]);
}

/** PUT {emails?, tax_exempt?, template?}: the dealer's invoicing settings. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad dealer id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  return billingCall("indigo_billing_dealer_settings", [id, body ?? {}]);
}

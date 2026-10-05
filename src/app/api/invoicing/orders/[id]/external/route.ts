import { NextRequest, NextResponse } from "next/server";
import { billingCall, idParam } from "@/lib/billing/server";

export const runtime = "nodejs";

/**
 * POST {ref?}: an order marked "Invoiced / Paid" by hand was invoiced in
 * QuickBooks — record it (with that invoice's number when known) so the order
 * page stops offering to invoice it again. DELETE undoes it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad order id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const ref = String(body?.ref ?? "").trim().slice(0, 64) || null;
  return billingCall("indigo_billing_mark_external", [id, ref]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad order id" }, { status: 400 });
  return billingCall("indigo_billing_unmark_external", [id]);
}

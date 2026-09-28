import { NextRequest, NextResponse } from "next/server";
import { billingCall, idParam } from "@/lib/billing/server";

export const runtime = "nodejs";

/**
 * GET: the order's invoices for its detail page (live one first, voided
 * after) and whether it can be invoiced now.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad order id" }, { status: 400 });
  return billingCall("indigo_billing_order_invoices", [id]);
}

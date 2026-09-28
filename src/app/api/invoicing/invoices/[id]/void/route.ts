import { NextRequest, NextResponse } from "next/server";
import { billingCall, idParam } from "@/lib/billing/server";

export const runtime = "nodejs";

/**
 * POST {reason?}: void an issued invoice, like "Void" in QuickBooks. It keeps
 * its number and stops counting; its orders go back to "to invoice" so the
 * right one can be made. Refused when payments are recorded on it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad invoice id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const reason = String(body?.reason ?? "").trim().slice(0, 500) || null;
  return billingCall("indigo_billing_void", [id, reason]);
}

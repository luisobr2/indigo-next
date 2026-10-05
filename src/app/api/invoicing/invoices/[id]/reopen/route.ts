import { NextRequest, NextResponse } from "next/server";
import { billingCall, idParam } from "@/lib/billing/server";

export const runtime = "nodejs";

/**
 * POST {reason?}: correct an issued invoice. It goes back to draft KEEPING its
 * number, is edited like any draft, and is issued again with the same number
 * (like editing it in QuickBooks). Payments on it are re-linked when it's
 * issued again.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad invoice id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const reason = String(body?.reason ?? "").trim().slice(0, 500) || null;
  return billingCall("indigo_billing_reopen", [id, reason]);
}

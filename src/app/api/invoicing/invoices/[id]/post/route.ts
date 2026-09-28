import { NextRequest, NextResponse } from "next/server";
import { billingCall, idParam } from "@/lib/billing/server";

export const runtime = "nodejs";

/** POST: issue the invoice (next QuickBooks number) and move its orders to Invoiced. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad invoice id" }, { status: 400 });
  return billingCall("indigo_billing_post", [id]);
}

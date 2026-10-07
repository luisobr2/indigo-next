import { NextResponse } from "next/server";
import { idParam } from "@/lib/billing/server";
import { qboCall } from "@/lib/quickbooks/server";

export const runtime = "nodejs";

/**
 * POST: send this invoice to QuickBooks now (pending, error or doesn't
 * match). For one entered by hand in QuickBooks, it means "I fixed it there":
 * the figures are compared again. Office and managers.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad invoice id" }, { status: 400 });
  return qboCall("qbo_retry", [id]);
}

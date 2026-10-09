import { NextResponse } from "next/server";
import { idParam } from "@/lib/billing/server";
import { costingCall } from "@/lib/costing/server";

export const runtime = "nodejs";

/** GET: what an invoice leaves: invoiced (before tax) against the estimated cost of its orders. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad invoice id" }, { status: 400 });
  return costingCall("indigo_cost_invoice", [id]);
}

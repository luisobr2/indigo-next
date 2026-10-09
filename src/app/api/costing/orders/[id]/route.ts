import { NextResponse } from "next/server";
import { idParam } from "@/lib/billing/server";
import { costingCall } from "@/lib/costing/server";

export const runtime = "nodejs";

/** GET: estimated cost of one order (materials + labor, per SQF, margin). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad order id" }, { status: 400 });
  return costingCall("indigo_cost_order", [id]);
}

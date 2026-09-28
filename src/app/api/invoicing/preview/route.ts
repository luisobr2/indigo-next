import { NextRequest, NextResponse } from "next/server";
import { billingCall } from "@/lib/billing/server";

export const runtime = "nodejs";

/** POST {order_ids}: proposed lines, photos and warnings. Writes nothing. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body?.order_ids)
    ? body.order_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];
  if (!ids.length) return NextResponse.json({ error: "Pick at least one order." }, { status: 400 });
  return billingCall("indigo_billing_preview", [ids]);
}

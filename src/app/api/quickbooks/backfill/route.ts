import { NextRequest, NextResponse } from "next/server";
import { qboCall } from "@/lib/quickbooks/server";

export const runtime = "nodejs";

/** GET: what QuickBooks has for each invoice issued before connecting (read only). */
export async function GET() {
  return qboCall("qbo_backfill_report");
}

/** POST {move_ids}: send those to QuickBooks (managers; Odoo checks). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.move_ids) ? body.move_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
  if (!ids.length) return NextResponse.json({ error: "Pick at least one invoice" }, { status: 400 });
  return qboCall("qbo_backfill_apply", [ids.slice(0, 1000)]);
}

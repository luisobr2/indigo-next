import { NextRequest, NextResponse } from "next/server";
import { costingCall } from "@/lib/costing/server";
import { isMonth } from "@/lib/costing/types";

export const runtime = "nodejs";

/** GET ?month=YYYY-MM: sold, purchases, pay and the result of the month, with the estimate beside it. */
export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  if (!isMonth(month)) return NextResponse.json({ error: "month must look like 2026-10" }, { status: 400 });
  return costingCall("indigo_cost_month", [month]);
}

import { NextRequest, NextResponse } from "next/server";
import { qboCall } from "@/lib/quickbooks/server";

export const runtime = "nodejs";

/** GET ?kind=customers|items|accounts: what exists in QuickBooks, to choose from. */
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  if (kind !== "customers" && kind !== "items" && kind !== "accounts") {
    return NextResponse.json({ error: "kind must be customers, items or accounts" }, { status: 400 });
  }
  return qboCall("qbo_remote_list", [kind]);
}

import { NextRequest, NextResponse } from "next/server";
import { qboCall } from "@/lib/quickbooks/server";

export const runtime = "nodejs";

const KINDS = ["customers", "items", "accounts", "taxcodes"];

/** GET ?kind=customers|items|accounts|taxcodes: what exists in QuickBooks, to choose from. */
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  if (!kind || !KINDS.includes(kind)) {
    return NextResponse.json({ error: `kind must be one of ${KINDS.join(", ")}` }, { status: 400 });
  }
  return qboCall("qbo_remote_list", [kind]);
}

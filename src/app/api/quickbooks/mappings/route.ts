import { NextRequest, NextResponse } from "next/server";
import { qboCall } from "@/lib/quickbooks/server";

export const runtime = "nodejs";

/** GET: dealers and invoice products with their QuickBooks match. */
export async function GET() {
  return qboCall("qbo_mapping_list");
}

/**
 * POST:
 *   { action: "auto" }                                   match by name what's empty
 *   { action: "set", kind, local_id, qbo_id }            choose (qbo_id null = clear)
 *   { action: "create", kind, local_id, income_account_id? }  create it in QuickBooks
 * kind is "dealer" or "product".
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const kind = body?.kind === "dealer" || body?.kind === "product" ? body.kind : null;
  const localId = Number(body?.local_id);
  switch (body?.action) {
    case "auto":
      return qboCall("qbo_mapping_auto");
    case "set":
      if (!kind || !Number.isInteger(localId)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
      return qboCall("qbo_mapping_set", [kind, localId, body.qbo_id ? String(body.qbo_id) : false]);
    case "create":
      if (!kind || !Number.isInteger(localId)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
      return qboCall("qbo_mapping_create_remote", [kind, localId, body.income_account_id ? String(body.income_account_id) : false]);
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}

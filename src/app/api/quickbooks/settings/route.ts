import { NextRequest, NextResponse } from "next/server";
import { qboCall } from "@/lib/quickbooks/server";

export const runtime = "nodejs";

/** POST {auto_close: boolean}: QuickBooks settings (managers only; Odoo checks). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (typeof body?.auto_close !== "boolean") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  return qboCall("qbo_save_settings", [{ auto_close: body.auto_close }]);
}

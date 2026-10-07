import { qboCall } from "@/lib/quickbooks/server";

export const runtime = "nodejs";

/** POST: revoke the connection (managers only; Odoo checks). */
export async function POST() {
  return qboCall("qbo_disconnect");
}

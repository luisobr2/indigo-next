import { qboCall } from "@/lib/quickbooks/server";

export const runtime = "nodejs";

/** GET: is QuickBooks configured on the server, connected, to which company. */
export async function GET() {
  return qboCall("qbo_status");
}

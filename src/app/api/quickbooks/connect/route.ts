import { qboCall } from "@/lib/quickbooks/server";

export const runtime = "nodejs";

/**
 * POST: the Intuit URL to open to connect (managers only; Odoo checks). Intuit
 * then returns to Odoo's /indigo/qbo/callback, which comes back to
 * /settings?qbo=connected|denied|invalid_state|error.
 */
export async function POST() {
  return qboCall("qbo_authorize_url");
}

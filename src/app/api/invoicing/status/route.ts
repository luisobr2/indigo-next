import { NextRequest } from "next/server";
import { billingCall } from "@/lib/billing/server";

export const runtime = "nodejs";

/** GET: is invoicing set up, next number, issuer data, range fees. */
export async function GET() {
  return billingCall("indigo_billing_status");
}

/**
 * POST: set invoicing up (chart of accounts, sales tax, products, numbering).
 * Odoo only lets a manager do it. Idempotent: running it twice changes nothing.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return billingCall("indigo_billing_setup", [body ?? {}]);
}

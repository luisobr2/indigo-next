import { billingCall } from "@/lib/billing/server";

export const runtime = "nodejs";

/** GET: installed orders not on any invoice yet, grouped by dealer. */
export async function GET() {
  return billingCall("indigo_billing_to_invoice");
}

import { NextRequest } from "next/server";
import { billingCall } from "@/lib/billing/server";

export const runtime = "nodejs";

/** PUT: next invoice number, tax rate, issuer data, fee per distance range (manager). */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return billingCall("indigo_billing_save_settings", [body ?? {}]);
}

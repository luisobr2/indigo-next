import { NextRequest, NextResponse } from "next/server";
import { billingCall, idParam } from "@/lib/billing/server";

export const runtime = "nodejs";

const METHODS = new Set(["check", "transfer", "zelle", "card", "cash", "other"]);

/** POST {amount, date?, method, reference?}: record a full or partial payment. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad invoice id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const amount = Number(body?.amount);
  if (!(amount > 0)) {
    return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });
  }
  const method = METHODS.has(body?.method) ? body.method : "other";
  return billingCall("indigo_billing_register_payment", [
    id,
    {
      amount,
      date: body?.date || null,
      method,
      reference: String(body?.reference ?? "").trim() || null,
    },
  ]);
}

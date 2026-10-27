import { NextRequest, NextResponse } from "next/server";
import { billingCall } from "@/lib/billing/server";

export const runtime = "nodejs";

const METHODS = new Set(["check", "transfer", "zelle", "card", "cash", "other"]);
const MAX = 100;

/**
 * POST {ids, date?, method, reference?}: several issued invoices paid at
 * once, each for its whole balance (Majela, 26-oct-2026). All or nothing:
 * Odoo refuses the lot, naming the invoice, if one can't be paid.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body?.ids)
    ? [...new Set<number>(body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))]
    : [];
  if (!ids.length) return NextResponse.json({ error: "Pick the invoices to mark as paid." }, { status: 400 });
  if (ids.length > MAX) return NextResponse.json({ error: `Pick at most ${MAX} invoices at a time.` }, { status: 400 });
  const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  const method = METHODS.has(body?.method) ? body.method : "other";
  return billingCall("indigo_billing_register_payments", [
    ids,
    { date, method, reference: String(body?.reference ?? "").trim() || null },
  ]);
}

import { NextRequest, NextResponse } from "next/server";
import { billingCall, idParam } from "@/lib/billing/server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad invoice id" }, { status: 400 });
  return billingCall("indigo_billing_detail", [id]);
}

/** PUT {lines?, photo_ids?, invoice_date?}: edit a draft. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad invoice id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  return billingCall("indigo_billing_update_draft", [id, body ?? {}]);
}

/** DELETE: remove a draft that was never issued. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad invoice id" }, { status: 400 });
  return billingCall("indigo_billing_delete_draft", [id]);
}

import { NextResponse } from "next/server";
import { idParam } from "@/lib/billing/server";
import { costingCall } from "@/lib/costing/server";

export const runtime = "nodejs";

/** DELETE: remove a purchase bill (and its file). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad expense id" }, { status: 400 });
  return costingCall("indigo_expense_delete", [id]);
}

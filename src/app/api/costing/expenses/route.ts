import { NextRequest, NextResponse } from "next/server";
import { costingCall } from "@/lib/costing/server";
import { isMonth } from "@/lib/costing/types";

export const runtime = "nodejs";

const MAX_BYTES = 9 * 1024 * 1024;

/** GET ?month=YYYY-MM: the purchase bills of the month. */
export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month");
  if (!isMonth(month)) return NextResponse.json({ error: "month must look like 2026-10" }, { status: 400 });
  return costingCall("indigo_expense_list", [month]);
}

/** POST multipart: date, supplier, category, amount, note, file (photo or PDF of the bill). */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  // A body cut at the proxy limit arrives unreadable.
  if (!form) return NextResponse.json({ error: "The bill couldn't be read. Files must be under 9 MB." }, { status: 400 });
  const vals: Record<string, unknown> = {
    date: String(form.get("date") ?? "") || null,
    supplier: String(form.get("supplier") ?? ""),
    category: String(form.get("category") ?? "other"),
    amount: Number(form.get("amount")),
    note: String(form.get("note") ?? ""),
  };
  const file = form.get("file");
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "The file is larger than 9 MB." }, { status: 400 });
    vals.file_name = file.name || "receipt";
    vals.file_b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  }
  return costingCall("indigo_expense_create", [vals]);
}

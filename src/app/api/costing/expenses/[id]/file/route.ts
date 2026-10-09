import { NextResponse } from "next/server";
import { idParam } from "@/lib/billing/server";
import { costingCall } from "@/lib/costing/server";

export const runtime = "nodejs";

/** GET: the photo or PDF of a purchase bill, shown inline. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Bad expense id" }, { status: 400 });
  const res = await costingCall<{ name: string; mimetype: string | false; datas: string }>("indigo_expense_file", [id]);
  if (!res.ok) return res;
  const { data } = (await res.json()) as { data: { name: string; mimetype: string | false; datas: string } };
  const type = data.mimetype || "application/octet-stream";
  // Only photos and PDFs are shown in the browser (never SVG, which can carry
  // script); anything else downloads.
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(type);
  const safeName = data.name.replace(/[^\w.\- ]+/g, "_");
  return new NextResponse(Buffer.from(data.datas, "base64"), {
    headers: {
      "Content-Type": inline ? type : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

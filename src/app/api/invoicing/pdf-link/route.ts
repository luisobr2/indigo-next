import { NextRequest, NextResponse } from "next/server";
import { rpcExecuteKw } from "@/lib/odoo/rpc";
import { readPdfLink } from "@/lib/mcp/oauth";

export const runtime = "nodejs";

function plain(text: string, status: number) {
  return new NextResponse(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * GET ?t=<sealed>: the PDF of ONE invoice, for the download link the AI
 * assistant hands out (MCP tool invoice_pdf_link). No panel session: the
 * sealed token carries who asked, which invoice, and expires in 30 minutes
 * (src/lib/mcp/oauth.ts, issuePdfLink). Odoo renders it with that person's
 * own rights, so the office/manager check still happens there.
 */
export async function GET(req: NextRequest) {
  const link = readPdfLink(req.nextUrl.searchParams.get("t"), Date.now());
  if (!link) {
    return plain("This download link has expired or is not valid. Ask the assistant for a new one.", 410);
  }
  try {
    const pdf = await rpcExecuteKw<{ filename: string; data: string }>(
      link.uid,
      link.apiKey,
      "indigo.billing",
      "indigo_billing_pdf",
      [link.invoiceId],
      {},
    );
    return new NextResponse(Buffer.from(pdf.data, "base64"), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdf.filename.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const err = e as Error & { errorName?: string };
    if (err?.errorName === "odoo.exceptions.AccessError") return plain("This account can no longer download invoices.", 403);
    if (err?.errorName === "odoo.exceptions.UserError") return plain("The invoice no longer exists.", 404);
    return plain("The invoice could not be generated right now. Try again in a moment.", 502);
  }
}

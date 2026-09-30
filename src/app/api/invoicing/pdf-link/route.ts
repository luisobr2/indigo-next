import { NextRequest, NextResponse } from "next/server";
import { rpcExecuteKw } from "@/lib/odoo/rpc";
import { readPdfLink } from "@/lib/mcp/oauth";
import { checkRate, clientKeyFromHeaders } from "@/lib/mcp/rate-limit";

export const runtime = "nodejs";

function plain(text: string, status: number, headers: Record<string, string> = {}) {
  return new NextResponse(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

/** One line per download attempt: who, which invoice, how it went. Never the
 *  `t` value — it carries the person's API key (encrypted, but still). */
function audit(entry: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), route: "invoicing/pdf-link", ...entry }));
}

/**
 * GET ?t=<sealed>: the PDF of ONE invoice, for the download link the AI
 * assistant hands out (MCP tool invoice_pdf_link). No panel session: the
 * sealed token carries who asked, which invoice, and expires in 30 minutes
 * (src/lib/mcp/oauth.ts, issuePdfLink). Odoo renders it with that person's
 * own rights, so the office/manager check still happens there, and revoking
 * their API key revokes the link.
 *
 * Public, so it is rate-limited per IP like /api/mcp (the same budget) before
 * anything else: every valid hit is a PDF render on the shared Odoo.
 */
export async function GET(req: NextRequest) {
  const ip = clientKeyFromHeaders(req.headers);
  const rate = checkRate(ip, Date.now());
  if (!rate.ok) {
    audit({ ip, status: 429 });
    return plain("Too many requests. Try again in a few seconds.", 429, {
      "Retry-After": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))),
    });
  }
  const link = readPdfLink(req.nextUrl.searchParams.get("t"), Date.now());
  if (!link) {
    audit({ ip, status: 410 });
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
    audit({ ip, uid: link.uid, invoiceId: link.invoiceId, status: 200 });
    return new NextResponse(Buffer.from(pdf.data, "base64"), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdf.filename.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const err = e as Error & { errorName?: string };
    const name = err?.errorName ?? "";
    let status = 502;
    let text = "The invoice PDF could not be generated right now. Try again in a moment.";
    if (/AccessDenied/.test(name)) {
      // The API key behind the link was revoked, or the user archived.
      status = 410;
      text = "This download link is no longer valid. Ask the assistant for a new one.";
    } else if (/AccessError/.test(name)) {
      status = 403;
      text = "This account can no longer download invoices.";
    } else if (/UserError/.test(name) && /not found/i.test(err.message || "")) {
      status = 404;
      text = "The invoice no longer exists.";
    }
    audit({ ip, uid: link.uid, invoiceId: link.invoiceId, status, error: name || "unknown" });
    return plain(text, status);
  }
}

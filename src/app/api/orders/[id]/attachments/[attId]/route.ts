import { NextRequest, NextResponse } from "next/server";
import { call, odooConfig } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/**
 * GET /api/orders/:id/attachments/:attId[?download=true]
 *
 * Streams an order attachment back through the Next origin. Direct
 * /web/content links to Odoo are cross-origin from the panel and carry no
 * Odoo session, so the browser gets a 403/404 and shows a broken image.
 * Here we fetch the bytes server-side with the session cookie and relay them.
 *
 * ?download=true → force a download (Content-Disposition: attachment);
 * otherwise the file is shown inline (used for image thumbnails/preview).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attId: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr, attId: attStr } = await params;
    const orderId = parseInt(idStr, 10);
    const attId = parseInt(attStr, 10);
    if (!Number.isFinite(orderId) || !Number.isFinite(attId)) {
      return new NextResponse("Bad request", { status: 400 });
    }

    // Verify the attachment actually belongs to this order — so the route
    // can't be used to read arbitrary attachments by guessing ids.
    const found = await call<Array<{ id: number; name: string; mimetype: string }>>({
      session: s.session,
      model: "ir.attachment",
      method: "search_read",
      args: [
        [
          ["id", "=", attId],
          ["res_model", "=", "indigo.order"],
          ["res_id", "=", orderId],
        ],
        ["id", "name", "mimetype"],
      ],
      kwargs: { limit: 1 },
    });
    if (!found.length) {
      return new NextResponse("Not found", { status: 404 });
    }
    const att = found[0];

    const odooRes = await fetch(`${odooConfig.url}/web/content/${attId}`, {
      headers: { Cookie: `session_id=${s.session}` },
      cache: "no-store",
    });
    if (!odooRes.ok) {
      return new NextResponse("Odoo attachment error", { status: 502 });
    }
    const buf = Buffer.from(await odooRes.arrayBuffer());
    const download = req.nextUrl.searchParams.get("download") === "true";
    const safeName = (att.name || `attachment-${attId}`).replace(/"/g, "");
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": att.mimetype || "application/octet-stream",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

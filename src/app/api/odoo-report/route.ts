import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/odoo/session";
import { odooConfig } from "@/lib/odoo/client";

export const runtime = "nodejs";

/**
 * Stream an Odoo QWeb PDF back to the user, attaching their session
 * cookie server-side. This avoids the cross-origin cookie issue we'd
 * hit if the browser tried to hit Odoo directly.
 *
 *   GET /api/odoo-report?report=indigo_decors.report_painter_sheet_doc&ids=1,2,3
 */
export async function GET(req: NextRequest) {
  try {
    const s = await requireSession();
    const sp = req.nextUrl.searchParams;
    const report = sp.get("report");
    const ids = sp.get("ids");
    const filename = sp.get("filename") ?? "report.pdf";

    if (!report || !ids) {
      return NextResponse.json(
        { error: "report + ids are required" },
        { status: 400 },
      );
    }

    const odooUrl = `${odooConfig.url}/report/pdf/${report}/${ids}`;
    const upstream = await fetch(odooUrl, {
      headers: { Cookie: `session_id=${s.session}` },
      cache: "no-store",
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: `Odoo report error (${upstream.status})`, debug: text.slice(0, 300) },
        { status: upstream.status },
      );
    }

    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        // Don't cache — the report contents change as orders update.
        "Cache-Control": "no-store",
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

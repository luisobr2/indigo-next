import { NextRequest, NextResponse } from "next/server";
import { call, odooConfig } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * GET /api/catalog/designs/:id/image
 *
 * Streams the latest design image attachment back through the Next
 * origin — avoids the cross-origin cookie problem that bites direct
 * <img src=odoo:8069/...> calls.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await context.params;
    const id = Number(idStr);

    const attachments = await call<Array<{ id: number; mimetype: string }>>({
      session: s.session,
      model: "ir.attachment",
      method: "search_read",
      args: [
        [
          ["res_model", "=", "indigo.design"],
          ["res_id", "=", id],
        ],
        ["id", "mimetype"],
      ],
      kwargs: { order: "create_date desc", limit: 1 },
    });
    const att = attachments[0];
    if (!att) {
      return new NextResponse("No image", { status: 404 });
    }

    const odooRes = await fetch(
      `${odooConfig.url}/web/content/${att.id}`,
      {
        headers: { Cookie: `session_id=${s.session}` },
        cache: "no-store",
      },
    );
    if (!odooRes.ok) {
      return new NextResponse("Odoo image error", { status: 502 });
    }
    const buf = Buffer.from(await odooRes.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": att.mimetype || "image/jpeg",
        "Cache-Control": "public, max-age=3600",
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

/**
 * POST /api/catalog/designs/:id/image
 *
 * Multipart upload (file=...). Stores via ir.attachment with
 * res_model=indigo.design + res_id. Replaces previous attachments.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: idStr } = await context.params;
    const id = Number(idStr);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "file field required" },
        { status: 400 },
      );
    }

    // Delete previous attachments for this design so we never keep stale
    // versions around (each design has at most one image).
    const existing = await call<number[]>({
      session: s.session,
      model: "ir.attachment",
      method: "search",
      args: [
        [
          ["res_model", "=", "indigo.design"],
          ["res_id", "=", id],
        ],
      ],
      kwargs: {},
    });
    if (existing.length) {
      await call({
        session: s.session,
        model: "ir.attachment",
        method: "unlink",
        args: [existing],
        kwargs: {},
      });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const datas = buf.toString("base64");

    const attId = await call<number>({
      session: s.session,
      model: "ir.attachment",
      method: "create",
      args: [
        {
          name: `design-${id}-${file.name}`,
          mimetype: file.type || "image/jpeg",
          res_model: "indigo.design",
          res_id: id,
          datas,
        },
      ],
      kwargs: {},
    });

    return NextResponse.json({ ok: true, attachmentId: attId });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/catalog/designs/:id/image
 *
 * Removes the design image (all attachments for this design).
 */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: idStr } = await context.params;
    const id = Number(idStr);

    const existing = await call<number[]>({
      session: s.session,
      model: "ir.attachment",
      method: "search",
      args: [
        [
          ["res_model", "=", "indigo.design"],
          ["res_id", "=", id],
        ],
      ],
      kwargs: {},
    });
    if (existing.length) {
      await call({
        session: s.session,
        model: "ir.attachment",
        method: "unlink",
        args: [existing],
        kwargs: {},
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

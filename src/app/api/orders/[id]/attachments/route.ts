import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { odooConfig } from "@/lib/odoo/client";

export const runtime = "nodejs";

interface AttachmentDto {
  id: number;
  name: string;
  mimetype: string;
  url: string;
}

/**
 * GET: list attachments for the order (res_model='indigo.order',res_id=<id>).
 * POST: upload (multipart form). The browser sends a File, we base64 it
 * and call ir.attachment.create through the Odoo ORM, which auto-applies
 * security and triggers any post-create flows.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    const records = await call<Array<Record<string, unknown>>>({
      session: s.session,
      model: "ir.attachment",
      method: "search_read",
      args: [
        [
          ["res_model", "=", "indigo.order"],
          ["res_id", "=", id],
        ],
        ["id", "name", "mimetype", "create_date", "create_uid"],
      ],
      kwargs: { order: "create_date desc", limit: 50 },
    });

    const dtos: AttachmentDto[] = records.map((r) => ({
      id: r.id as number,
      name: String(r.name ?? ""),
      mimetype: String(r.mimetype ?? ""),
      url: `${odooConfig.url}/web/content/${r.id}?download=true`,
    }));

    return NextResponse.json({ records: dtos });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  _ctx: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const sp = req.nextUrl.searchParams;
    const attId = Number(sp.get("att"));
    if (!Number.isFinite(attId)) {
      return NextResponse.json({ error: "att=N required" }, { status: 400 });
    }
    await call({
      session: s.session,
      model: "ir.attachment",
      method: "unlink",
      args: [[attId]],
      kwargs: {},
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);

    const form = await req.formData();
    const file = form.get("file");
    const note = form.get("note");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "file field required" },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const datas = buf.toString("base64");

    const attId = await call<number>({
      session: s.session,
      model: "ir.attachment",
      method: "create",
      args: [
        {
          name: file.name,
          mimetype: file.type || "application/octet-stream",
          res_model: "indigo.order",
          res_id: id,
          datas,
        },
      ],
      kwargs: {},
    });

    // Post a chatter note so it shows up in the activity feed.
    const body = note
      ? `Attachment uploaded: <b>${file.name}</b><br/>${note}`
      : `Attachment uploaded: <b>${file.name}</b>`;
    await call({
      session: s.session,
      model: "indigo.order",
      method: "message_post",
      args: [[id]],
      kwargs: { body, attachment_ids: [attId] },
    });

    return NextResponse.json({ id: attId });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

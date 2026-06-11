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

/** Per-file upload cap. Mirrors the client-side check in the order
 *  modal and the stage QuickPhotoUpload — keeps memory + Odoo payloads
 *  bounded. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/**
 * Minimal HTML escape for user-controlled strings interpolated into
 * Odoo chatter bodies. Without this, an attacker (or careless dealer)
 * could upload a file named like `<img src=x onerror=...>` and inject
 * markup that runs when other users view the order timeline.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        {
          error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — max ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB per file.`,
        },
        { status: 413 },
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

    // Post a chatter note so it shows up in the activity feed. Escape
    // both file.name and the optional note so weird filenames or paste
    // content can't inject markup into other users' timelines.
    const safeName = escapeHtml(file.name);
    const safeNote =
      typeof note === "string" && note.trim() ? escapeHtml(note) : "";
    const body = safeNote
      ? `Attachment uploaded: <b>${safeName}</b><br/>${safeNote}`
      : `Attachment uploaded: <b>${safeName}</b>`;
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

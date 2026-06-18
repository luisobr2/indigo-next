import { NextRequest, NextResponse } from "next/server";
import { call, odooConfig } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * Apply a "cover" image (base64) to a design AND to the storefront product
 * linked to it, so the picture chosen in the catalog editor is the one the
 * public shop/PDP actually shows.
 *
 * - indigo.design has an `image` field (NOT `image_1920`) — writing the
 *   non-existent `image_1920` was a silent no-op (the old bug).
 * - product.template.image_1920 is what website_sale renders. We push the
 *   bytes onto every product linked to this design via indigo_design_id.
 *
 * Returns how many storefront products were updated (0 if the design isn't
 * linked to any product yet).
 */
async function applyCover(
  session: string,
  designId: number,
  datas: string,
): Promise<number> {
  // 1) Design's own representative image (panel fallback / exports).
  await call({
    session,
    model: "indigo.design",
    method: "write",
    args: [[designId], { image: datas }],
    kwargs: {},
  }).catch(() => undefined);

  // 2) Propagate to the storefront product(s) linked to this design.
  const productIds = await call<number[]>({
    session,
    model: "product.template",
    method: "search",
    args: [[["indigo_design_id", "=", designId]]],
    kwargs: {},
  }).catch(() => [] as number[]);
  if (productIds.length) {
    await call({
      session,
      model: "product.template",
      method: "write",
      args: [productIds, { image_1920: datas }],
      kwargs: {},
    }).catch(() => undefined);
  }
  return productIds.length;
}

/**
 * GET /api/catalog/designs/:id/image
 *
 * Streams the latest design image attachment back through the Next
 * origin — avoids the cross-origin cookie problem that bites direct
 * <img src=odoo:8069/...> calls.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await context.params;
    const id = Number(idStr);

    const sp = req.nextUrl.searchParams;
    // ?att=N pins a specific attachment id.
    // ?color=black|white|bronze[_eco] picks the attachment whose name
    // contains that color (case-insensitive) so the Order Detail can
    // show the variant matching the ordered color. Falls back to the
    // most-recent attachment when nothing matches.
    const attParam = sp.get("att");
    const colorParam = sp.get("color")?.toLowerCase().trim() || "";
    // ?type=SD|DD|sidelite — for flexible designs (CUSTOM) that carry both
    // single- and double-door images, pick the one matching the ordered type.
    const typeParam = (sp.get("type") || "").toUpperCase().trim();
    const typeTok = { SD: "sd", DD: "dd", SIDELITE: "sidelite" }[typeParam] || "";

    let att: { id: number; mimetype: string } | undefined;
    if (attParam) {
      const ids = await call<Array<{ id: number; mimetype: string }>>({
        session: s.session,
        model: "ir.attachment",
        method: "search_read",
        args: [
          [
            ["id", "=", Number(attParam)],
            ["res_model", "=", "indigo.design"],
            ["res_id", "=", id],
          ],
          ["id", "mimetype"],
        ],
        kwargs: { limit: 1 },
      });
      att = ids[0];
    } else {
      // When a color is requested, scan ALL attachments and pick the one
      // whose name matches first (substring on lowercase). bronze_eco
      // must be checked before plain "bronze" so the eco variant wins
      // when both exist.
      const attachments = await call<
        Array<{ id: number; name: string; mimetype: string }>
      >({
        session: s.session,
        model: "ir.attachment",
        method: "search_read",
        args: [
          [
            ["res_model", "=", "indigo.design"],
            ["res_id", "=", id],
          ],
          ["id", "name", "mimetype"],
        ],
        kwargs: { order: "create_date desc" },
      });

      const segsOf = (n: string) =>
        (n || "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
      const hasType = (a: { name: string }) =>
        !typeTok || segsOf(a.name).includes(typeTok);
      if (colorParam) {
        // Honor bronze_eco -> bronze ECO -> bronze priority by trying the
        // most specific tokens first.
        const tokens = colorParam.includes("eco")
          ? ["bronze_eco", "bronze eco", "eco"]
          : [colorParam, colorParam.replace("_", " ")];
        const hasColor = (a: { name: string }) =>
          tokens.some((t) => (a.name || "").toLowerCase().includes(t));
        // Prefer an attachment matching BOTH the requested type and color
        // (CUSTOM has CUSTOM-DD-black vs CUSTOM-SD-black); fall back to
        // color-only, then to type-only.
        att =
          attachments.find((a) => hasType(a) && hasColor(a)) ||
          attachments.find((a) => hasColor(a)) ||
          undefined;
      }
      // Type-only match when no color was given (or nothing matched color).
      if (!att && typeTok) att = attachments.find((a) => hasType(a));
      // Fallback: most-recent attachment.
      if (!att) att = attachments[0];
    }
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
 * Multipart upload. Form fields:
 *   file       — required, the binary
 *   color      — optional: white | bronze | bronze_eco | black | custom
 *   makeCover  — optional: "1" to copy bytes into indigo.design.image_1920
 *
 * Each call ADDS a new ir.attachment (does NOT replace existing ones)
 * so a design can carry one image per color variant. The color is
 * embedded in the attachment name (e.g. ID15-DD-black.jpg) so the GET
 * endpoint can serve the right variant when `?color=` is requested.
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
    const color = (form.get("color") as string | null)?.toLowerCase().trim() || "";
    const makeCover = (form.get("makeCover") as string | null) === "1";
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "file field required" },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const datas = buf.toString("base64");

    // Build a deterministic name that carries the color so the variant
    // filter can find it. e.g. "ID15-DD-black.jpg".
    const ext = (file.name.match(/\.(\w+)$/)?.[1] || "jpg").toLowerCase();
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const safeBase = baseName.replace(/-(white|bronze|bronze[_ ]eco|black)$/i, "");
    const name = color
      ? `${safeBase}-${color}.${ext}`
      : `${safeBase}.${ext}`;

    const attId = await call<number>({
      session: s.session,
      model: "ir.attachment",
      method: "create",
      args: [
        {
          name,
          mimetype: file.type || "image/jpeg",
          res_model: "indigo.design",
          res_id: id,
          datas,
        },
      ],
      kwargs: {},
    });

    // If this is the cover, push the bytes onto the design's image AND the
    // linked storefront product(s) so the public shop shows this picture.
    let coveredProducts = 0;
    if (makeCover) {
      coveredProducts = await applyCover(s.session, id, datas);
    }

    return NextResponse.json({
      ok: true,
      attachmentId: attId,
      name,
      coveredProducts,
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
 * PATCH /api/catalog/designs/:id/image
 *
 * Body: { attId: number, color?: string, makeCover?: boolean }
 *
 * Retags an existing attachment so the color-aware GET serves it for
 * the right order. If makeCover=true we also stream the bytes into
 * indigo.design.image_1920.
 */
export async function PATCH(
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
    const body = (await req.json()) as {
      attId?: number;
      color?: string;
      makeCover?: boolean;
    };
    const attId = Number(body.attId);
    if (!Number.isFinite(attId)) {
      return NextResponse.json({ error: "attId required" }, { status: 400 });
    }
    const color = (body.color || "").toLowerCase().trim();

    // Read current name + mimetype + datas if we need them.
    const [current] = await call<
      Array<{ id: number; name: string; mimetype: string }>
    >({
      session: s.session,
      model: "ir.attachment",
      method: "read",
      args: [[attId], ["id", "name", "mimetype"]],
      kwargs: {},
    });
    if (!current) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    // Compose a new name: strip any existing color suffix and append the
    // new one. Empty color means "unspecified" (cover/default).
    const ext = current.name.match(/\.(\w+)$/)?.[1] || "jpg";
    const base = current.name
      .replace(/\.[^.]+$/, "")
      .replace(/-(white|bronze|bronze[_ ]eco|black)$/i, "");
    const newName = color ? `${base}-${color}.${ext}` : `${base}.${ext}`;
    await call({
      session: s.session,
      model: "ir.attachment",
      method: "write",
      args: [[attId], { name: newName }],
      kwargs: {},
    });

    let coveredProducts = 0;
    if (body.makeCover) {
      // Pull the bytes from Odoo and push them onto the design + linked
      // storefront product(s).
      const odooRes = await fetch(`${odooConfig.url}/web/content/${attId}`, {
        headers: { Cookie: `session_id=${s.session}` },
        cache: "no-store",
      });
      if (odooRes.ok) {
        const buf = Buffer.from(await odooRes.arrayBuffer());
        const datas = buf.toString("base64");
        coveredProducts = await applyCover(s.session, id, datas);
      }
    }

    return NextResponse.json({ ok: true, name: newName, coveredProducts });
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
 *   ?att=N    delete ONE attachment by id
 *   ?all=1    delete every attachment for the design (legacy "nuke" path)
 */
export async function DELETE(
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
    const sp = req.nextUrl.searchParams;
    const attParam = sp.get("att");
    const wipeAll = sp.get("all") === "1";

    if (attParam) {
      // Single-attachment delete. Verify it belongs to this design so the
      // caller can't unlink random attachments by guessing ids.
      const found = await call<Array<{ id: number }>>({
        session: s.session,
        model: "ir.attachment",
        method: "search_read",
        args: [
          [
            ["id", "=", Number(attParam)],
            ["res_model", "=", "indigo.design"],
            ["res_id", "=", id],
          ],
          ["id"],
        ],
        kwargs: { limit: 1 },
      });
      if (!found.length) {
        return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
      }
      await call({
        session: s.session,
        model: "ir.attachment",
        method: "unlink",
        args: [[Number(attParam)]],
        kwargs: {},
      });
      return NextResponse.json({ ok: true });
    }

    if (wipeAll) {
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
    }

    return NextResponse.json(
      { error: "Pass ?att=N to delete one image, or ?all=1 to wipe every image." },
      { status: 400 },
    );
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

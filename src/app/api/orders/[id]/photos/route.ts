import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

/** Tope por foto. Una foto de movil ronda 3-5 MB; 12 deja margen sin dejar
 *  que alguien suba un vídeo renombrado. */
const MAX_BYTES_POR_FOTO = 12 * 1024 * 1024;
/** Tope por llamada. Mas que esto y la peticion tarda tanto que el instalador
 *  cree que se colgo y la repite, duplicando los adjuntos. */
const MAX_FOTOS = 12;

/**
 * POST /api/orders/[id]/photos
 *   body: { photos: string[] (base64 sin prefijo), names?: string[] }
 *   → { ids: number[] }
 *
 * Crea los ir.attachment de las fotos de una instalacion y devuelve sus ids,
 * para que el asistente de etapa los reciba en photo_ids.
 *
 * Van por una ruta aparte y NO dentro del payload del asistente a proposito:
 * el asistente se crea con un solo RPC, y meter ahi varios base64 de fotos de
 * movil convertiria esa llamada en decenas de MB.
 *
 * Se crean SIN res_model/res_id. Es el asistente quien las cuelga de la orden
 * al guardar, asi que si el instalador cierra el dialogo sin confirmar, las
 * fotos no aparecen colgadas de una instalacion que nunca se marco.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const { id: idStr } = await params;
    const orderId = parseInt(idStr, 10);
    if (!Number.isFinite(orderId)) {
      return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      photos?: unknown;
      names?: unknown;
    };
    const photos = Array.isArray(body.photos) ? body.photos : [];
    const names = Array.isArray(body.names) ? body.names : [];

    if (!photos.length) {
      return NextResponse.json({ error: "No photos to upload" }, { status: 400 });
    }
    if (photos.length > MAX_FOTOS) {
      return NextResponse.json(
        { error: `Too many photos at once (max ${MAX_FOTOS}). Upload them in two goes.` },
        { status: 400 },
      );
    }
    for (const p of photos) {
      if (typeof p !== "string" || !p) {
        return NextResponse.json({ error: "Invalid photo data" }, { status: 400 });
      }
      // base64 pesa ~4/3 del binario; se compara sobre el binario estimado.
      if ((p.length * 3) / 4 > MAX_BYTES_POR_FOTO) {
        return NextResponse.json(
          { error: "One of the photos is too large. Try again with a smaller one." },
          { status: 400 },
        );
      }
    }

    // Nombre: el del archivo si vino, y si no uno con indice. El indice
    // importa — sin el, varias fotos de la misma orden salen con el mismo
    // nombre y en la caja de adjuntos no hay forma de distinguirlas.
    const sello = new Date().toISOString().slice(0, 10);
    const vals = photos.map((datas, i) => {
      const dado = typeof names[i] === "string" ? (names[i] as string).trim() : "";
      return {
        name: dado || `install_${sello}_${i + 1}.jpg`,
        type: "binary",
        datas,
      };
    });

    const ids = await call<number[]>({
      session: s.session,
      model: "ir.attachment",
      method: "create",
      args: [vals],
      kwargs: {},
    });

    return NextResponse.json({ ids: Array.isArray(ids) ? ids : [ids] });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : "Could not upload the photos";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

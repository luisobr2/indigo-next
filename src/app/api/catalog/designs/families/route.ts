import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";

export const runtime = "nodejs";

interface DesignRow {
  id: number;
  code: string;
  name: string | false;
  door_type: string | false;
  active: boolean;
  allowed_colors: string | false;
  favorite_user_ids?: number[];
  min_width?: number;
  max_width?: number;
  min_height?: number;
  max_height?: number;
}

interface DesignVariant {
  id: number;
  code: string;
  door_type: string;
  hasImage: boolean;
  favorite: boolean;
  /** Whether the linked storefront product is published (visible on the web). */
  published: boolean;
  /** Design dimension range (inches). 0 = no constraint. Used to
   *  prefill the New Order width/height when the design defines a size. */
  min_width: number;
  max_width: number;
  min_height: number;
  max_height: number;
}

interface FamilyOut {
  family: string;
  // Variants sorted by door_type so SD always renders before DD.
  variants: DesignVariant[];
  /** Union of `allowed_colors` from all variants. */
  colors: string[];
  /** "favorite" on the family means: any of the variants is favourited. */
  favorite: boolean;
}

/**
 * Compute the family code for a design code.
 *
 *   ID01-SD       -> ID01
 *   ID29-DD       -> ID29
 *   TD-SD-W06     -> TD-SD-W06   (standalone — no recognisable family)
 *   ARCH          -> ARCH        (no suffix)
 *
 * The rule: strip a trailing `-SD` / `-DD` / `-SDL` only when there's an
 * obvious family code in front (so we don't accidentally collapse two
 * unrelated codes). Falls back to the full code.
 */
function familyOf(code: string): string {
  const m = code.match(/^(.+)-(SD|DD|SDL)$/i);
  if (m && m[1].length >= 2) return m[1];
  return code;
}

/**
 * GET /api/catalog/designs/families
 *
 * Returns the catalog grouped by family + favourites + colour union for
 * the new catalog page. Each family bundles its SD / DD / sidelite
 * variants and tells the UI which ones have an image (so the card can
 * render two thumbnails side-by-side when both configs exist).
 */
export async function GET(_req: NextRequest) {
  try {
    const s = await requireSession();
    const records = await call<DesignRow[]>({
      session: s.session,
      model: "indigo.design",
      method: "search_read",
      args: [
        [["active", "=", true]],
        [
          "id",
          "code",
          "name",
          "door_type",
          "active",
          "allowed_colors",
          "favorite_user_ids",
          "min_width",
          "max_width",
          "min_height",
          "max_height",
        ],
      ],
      kwargs: { order: "code", limit: 500 },
    }).catch(async () => {
      // Old DB without favorite_user_ids? Fall back to base fields.
      return await call<DesignRow[]>({
        session: s.session,
        model: "indigo.design",
        method: "search_read",
        args: [
          [["active", "=", true]],
          ["id", "code", "name", "door_type", "active", "allowed_colors"],
        ],
        kwargs: { order: "code", limit: 500 },
      });
    });

    // Resolve which records have an image — `indigo.design.image_1920`
    // returns base64 from search_read which would explode the payload,
    // so we read a cheap boolean via attachments + image_1920 != false
    // in a separate call. For now use ir.attachment as a proxy and let
    // the client cope if the cover image lives only in image_1920.
    let attachmentDesignIds = new Set<number>();
    if (records.length) {
      const attachments = await call<Array<{ res_id: number }>>({
        session: s.session,
        model: "ir.attachment",
        method: "search_read",
        args: [
          [
            ["res_model", "=", "indigo.design"],
            ["res_id", "in", records.map((d) => d.id)],
          ],
          ["res_id"],
        ],
        kwargs: { limit: 5000 },
      }).catch(() => [] as Array<{ res_id: number }>);
      attachmentDesignIds = new Set(attachments.map((a) => a.res_id));
    }

    // Which designs have a PUBLISHED storefront product (visible on the web).
    const publishedDesignIds = new Set<number>();
    if (records.length) {
      const prods = await call<
        Array<{ indigo_design_id: [number, string] | false; is_published: boolean }>
      >({
        session: s.session,
        model: "product.template",
        method: "search_read",
        args: [
          [["indigo_design_id", "in", records.map((d) => d.id)]],
          ["indigo_design_id", "is_published"],
        ],
        kwargs: { limit: 5000 },
      }).catch(() => [] as Array<{ indigo_design_id: [number, string] | false; is_published: boolean }>);
      for (const p of prods) {
        const did = Array.isArray(p.indigo_design_id) ? p.indigo_design_id[0] : 0;
        if (did && p.is_published) publishedDesignIds.add(did);
      }
    }

    const me = s.user.id;

    // Group by family code.
    const families = new Map<string, FamilyOut>();
    for (const d of records) {
      const family = familyOf(d.code);
      const colors = (d.allowed_colors || "")
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      const variant: DesignVariant = {
        id: d.id,
        code: d.code,
        door_type: (d.door_type as string) || "",
        hasImage: attachmentDesignIds.has(d.id),
        favorite: (d.favorite_user_ids || []).includes(me),
        published: publishedDesignIds.has(d.id),
        min_width: Number(d.min_width) || 0,
        max_width: Number(d.max_width) || 0,
        min_height: Number(d.min_height) || 0,
        max_height: Number(d.max_height) || 0,
      };
      const entry = families.get(family);
      if (entry) {
        entry.variants.push(variant);
        for (const c of colors) {
          if (!entry.colors.includes(c)) entry.colors.push(c);
        }
        if (variant.favorite) entry.favorite = true;
      } else {
        families.set(family, {
          family,
          variants: [variant],
          colors,
          favorite: variant.favorite,
        });
      }
    }

    // Order variants inside each family (SD, DD, sidelite, then others).
    const VARIANT_ORDER: Record<string, number> = {
      SD: 0,
      DD: 1,
      sidelite: 2,
    };
    for (const f of families.values()) {
      f.variants.sort(
        (a, b) =>
          (VARIANT_ORDER[a.door_type] ?? 99) -
          (VARIANT_ORDER[b.door_type] ?? 99),
      );
    }

    return NextResponse.json({
      families: Array.from(families.values()),
      // Summary stats for the KPI tiles up top.
      summary: {
        totalDesigns: families.size,
        totalVariations: records.length,
        availableColors: Array.from(
          new Set(
            records.flatMap((d) =>
              (d.allowed_colors || "")
                .split(",")
                .map((c) => c.trim().toLowerCase())
                .filter(Boolean),
            ),
          ),
        ),
        availableConfigs: Array.from(
          new Set(records.map((d) => d.door_type).filter(Boolean) as string[]),
        ),
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

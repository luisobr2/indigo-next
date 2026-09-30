import { call } from "@/lib/odoo/client";
import type { PaintShop } from "@/lib/stages";

/**
 * The painters, as Odoo keeps them since the two painting stages
 * (2026-09-29): whoever has their OWN painter pay rule with a paint shop
 * (Settings → Contractor rates → Painters). Michel paints in Michel's stage,
 * Elio and Mandy in Indigo's. The rule also holds their rate per SQF.
 *
 * Empty when nothing is configured yet, or when Odoo is older than the
 * method: callers then fall back to "users in the Painter group", which is
 * what the list used to be.
 */
export interface ConfiguredPainter {
  id: number; // res.partner id, what indigo.order.painter_id holds
  name: string;
  shop: PaintShop;
  rate: number;
}

export async function loadConfiguredPainters(session: string): Promise<ConfiguredPainter[]> {
  try {
    const rows = await call<ConfiguredPainter[]>({
      session,
      model: "indigo.order",
      method: "indigo_painters_list",
      args: [],
      kwargs: {},
    });
    // Michel's shop first: it is the default painter wherever one is guessed.
    return [...rows].sort((a, b) => (a.shop === b.shop ? a.name.localeCompare(b.name) : a.shop === "michel" ? -1 : 1));
  } catch {
    return [];
  }
}

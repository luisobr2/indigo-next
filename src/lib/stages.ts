/**
 * The two painting stages (Majela's request, 2026-09-29): Michel's shop and
 * Indigo's own, side by side between CNC and Ready for Installation.
 *
 *   painting         -> "Painting – Michel" (the stage that always existed)
 *   painting_indigo  -> "Painting – Indigo"  (Elio and Mandy paint there)
 *
 * Anything that used to ask `code === "painting"` asks isPaintStage(code)
 * instead, so a door in Indigo's stage counts as "in painting" everywhere.
 */

export const PAINT_STAGES = ["painting", "painting_indigo"] as const;
export type PaintStage = (typeof PAINT_STAGES)[number];
export type PaintShop = "michel" | "indigo";

export const PAINT_SHOP_OF_STAGE: Record<PaintStage, PaintShop> = {
  painting: "michel",
  painting_indigo: "indigo",
};

export const PAINT_STAGE_OF_SHOP: Record<PaintShop, PaintStage> = {
  michel: "painting",
  indigo: "painting_indigo",
};

export const PAINT_SHOP_LABEL: Record<PaintShop, string> = {
  michel: "Michel",
  indigo: "Indigo",
};

export function isPaintStage(code: string | false | null | undefined): code is PaintStage {
  return code === "painting" || code === "painting_indigo";
}

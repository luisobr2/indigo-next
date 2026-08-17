/**
 * Groups on-hold orders by `hold_cause` for the Installations screen — the
 * dealer/client split from Majela's 2026-08-15 request (item 3): "cómo
 * clasificar ... cuáles puertas tienen problema con el dealer y cuáles con
 * el cliente", plus a count per cause at the top ("problemas con el
 * dealer, siete puertas"). Before hold_cause existed, `on_hold` was a bare
 * boolean with a free-text `hold_reason` — impossible to count or color.
 *
 * Kept pure (no Odoo/RPC import) so the bucketing/counting logic — the part
 * a refactor of the dashboard API route could quietly break — has a direct
 * unit test (see hold-groups.test.ts) instead of depending on a live Odoo.
 */

export type HoldCause = "dealer" | "client" | "other";

export interface HoldOrderInput {
  id: number;
  hold_cause?: HoldCause | false | null;
  /** Doors on this order. Falsy/missing counts as 1 (one order = at least
   *  one door) so a row is never silently dropped from the count. */
  door_count?: number;
}

export interface HoldGroup<T> {
  cause: HoldCause;
  doorCount: number;
  orders: T[];
}

const CAUSES: HoldCause[] = ["dealer", "client", "other"];

/**
 * A row with no recognizable hold_cause shouldn't exist post-migration —
 * indigo.order requires a cause whenever on_hold is true (see
 * indigo_order.py's _check_hold_requires_cause) — but if one ever slips
 * through (a stale read, a future path we haven't audited), it must still
 * land somewhere VISIBLE rather than vanish from every counter.
 */
function normalizeCause(raw: HoldOrderInput["hold_cause"]): HoldCause {
  return raw === "dealer" || raw === "client" ? raw : "other";
}

export function groupOrdersByHoldCause<T extends HoldOrderInput>(
  orders: T[],
): Record<HoldCause, HoldGroup<T>> {
  const groups = Object.fromEntries(
    CAUSES.map((cause) => [cause, { cause, doorCount: 0, orders: [] as T[] }]),
  ) as Record<HoldCause, HoldGroup<T>>;
  for (const order of orders) {
    const group = groups[normalizeCause(order.hold_cause)];
    group.orders.push(order);
    group.doorCount += order.door_count || 1;
  }
  return groups;
}

/** Spanish labels she'd recognize — mirrors indigo.order's hold_cause
 *  selection labels in the Odoo backend (models/indigo_order.py). */
export const HOLD_CAUSE_LABEL: Record<HoldCause, string> = {
  dealer: "Problema del dealer",
  client: "Problema del cliente",
  other: "Sin clasificar",
};

/** Blue for a dealer-caused hold, orange for a client-caused one — her own
 *  words in the 2026-08-15 audio ("azul" / "naranja"). Do not swap or
 *  invent a different palette; 'other' gets a neutral, deliberately
 *  un-alarming gray since it means "needs to be classified", not a cause. */
export const HOLD_CAUSE_COLOR: Record<HoldCause, string> = {
  dealer: "border-sky-200 bg-sky-50 text-sky-800",
  client: "border-orange-200 bg-orange-50 text-orange-800",
  other: "border-slate-200 bg-slate-100 text-slate-600",
};

/**
 * "Problema del dealer · 7 puertas" — literal phrasing from her own audio
 * ("problemas con el dealer, siete puertas"), on purpose: color alone isn't
 * enough for someone who can't easily tell blue from orange, so the label
 * has to carry the meaning on its own.
 */
export function holdCounterLabel(cause: HoldCause, doorCount: number): string {
  return `${HOLD_CAUSE_LABEL[cause]} · ${doorCount} puerta${doorCount === 1 ? "" : "s"}`;
}

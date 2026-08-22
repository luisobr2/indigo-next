/**
 * How a contractor's day is priced, on the panel side.
 *
 * The authority is Odoo: `indigo.contractor.rate.day_amount` computes every
 * day that actually happened, writes the adjustment down as a payout line,
 * and that is what gets paid. This module exists for the one thing Odoo
 * cannot answer — work that is SCHEDULED but not installed yet, which has no
 * payout because nothing has been earned. The Installations board estimates
 * those days, and an estimate that used a different formula than the payment
 * would be worse than no estimate at all.
 *
 * So: same formula, same field names, same tests (see pay-rules.test.ts,
 * which uses the numbers from the Odoo suite). If one side changes, the
 * other has to.
 *
 * NOTHING here carries a default rate. A missing rule returns null and the
 * caller decides what to show — inventing a number is exactly how the old
 * hardcoded 35 quietly understated what was owed on 92% of days.
 */

export interface PayRule {
  /** null = the fallback rule, used by anyone without one of their own. */
  partnerId: number | null;
  ratePerDoor: number;
  dailyMinimum: number;
  bonusAmount: number;
  bonusUnit: "order" | "door";
}

export interface DayWork {
  doors: number;
  /** Stops made that day — one per order. Travel money is per stop. */
  installs: number;
}

/**
 * What one worked day pays under `rule`, or null if there is no rule.
 *
 *   max(dailyMinimum, ratePerDoor × doors) + bonusAmount × (installs | doors)
 *
 * A day with no work earns nothing: the floor is a guarantee for a day
 * WORKED, not for a day on the calendar.
 */
export function dayAmount(rule: PayRule | null, work: DayWork): number | null {
  if (!rule) return null;
  const doors = work.doors || 0;
  const installs = work.installs || 0;
  if (doors <= 0 && installs <= 0) return 0;

  const base = Math.max(rule.dailyMinimum || 0, (rule.ratePerDoor || 0) * doors);
  const count = rule.bonusUnit === "door" ? doors : installs;
  return base + (rule.bonusAmount || 0) * count;
}

/** The rule for `partnerId`: their own if it exists, else the fallback. */
export function resolveRule(rules: PayRule[], partnerId: number): PayRule | null {
  return (
    rules.find((r) => r.partnerId === partnerId) ??
    rules.find((r) => r.partnerId === null) ??
    null
  );
}

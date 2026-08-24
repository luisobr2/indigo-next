/**
 * Which of an installer's days a "mark week as paid" should actually touch,
 * and what a week cost per door.
 *
 * Pure on purpose. Picking the wrong ids here marks money paid that wasn't,
 * or silently skips a day someone is owed — neither shows up as a crash, so
 * it needs tests rather than a careful read.
 *
 * NOTE ON CONSOLIDATING. Odoo also has a settle wizard that merges a period
 * into one payout. It is deliberately NOT used from this screen: the merged
 * record carries a period instead of a work_date, and this page selects by
 * work_date — so settling a week that way would make the week vanish from
 * the very screen you settled it on. Marking each day paid keeps the week
 * legible, day by day, with its breakdown intact.
 */

export interface SettleDay {
  payoutId: number | null;
  status: "completed" | "scheduled";
  payoutState: "draft" | "approved" | "paid" | "cancel" | null;
  amount: number;
}

export interface SettleInstaller {
  installerId: number;
  days: SettleDay[];
  doors: number;
}

export interface SettlePlan {
  payoutIds: number[];
  /** What is about to be marked paid — shown before the button commits. */
  amount: number;
  days: number;
}

/**
 * Days that can still be paid: worked (a projection is not a debt), backed by
 * a real payout, and not already paid or cancelled.
 */
export function planSettle(installer: SettleInstaller): SettlePlan {
  const payable = installer.days.filter(
    (d) =>
      d.status === "completed" &&
      d.payoutId !== null &&
      (d.payoutState === "draft" || d.payoutState === "approved"),
  );
  return {
    payoutIds: payable.map((d) => d.payoutId as number),
    amount: payable.reduce((a, d) => a + d.amount, 0),
    days: payable.length,
  };
}

/**
 * What each installed door cost this period, all-in.
 *
 * The number the day rule made worth looking at: with a flat per-door rate a
 * thin day and a full one cost the same per door, but under a daily floor a
 * one-door day costs the whole floor. Three doors spread over three days runs
 * $150 a door; six doors in one day runs $35. Same rate, same person —
 * different scheduling.
 *
 * Only worked days count on both sides; null when nothing was installed,
 * because "$0 per door" and "no doors" are not the same statement.
 */
export function costPerDoor(installer: {
  days: Array<{ status: "completed" | "scheduled"; doors: number; amount: number }>;
}): number | null {
  const worked = installer.days.filter((d) => d.status === "completed");
  const doors = worked.reduce((a, d) => a + d.doors, 0);
  if (doors <= 0) return null;
  return worked.reduce((a, d) => a + d.amount, 0) / doors;
}

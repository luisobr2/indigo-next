/**
 * Invoices issued before QuickBooks was connected: what Odoo found in
 * QuickBooks for each (qbo_backfill_report) and what sending it will do.
 * Pure, so it can be tested without a browser.
 */
export type BackfillOutcome = "same" | "different" | "other_customer" | "missing";

export interface BackfillRow {
  id: number;
  name: string;
  dealer: string;
  invoice_date: string | false;
  total: number;
  residual: number;
  outcome: BackfillOutcome;
  qbo_total: number | false;
  qbo_balance: number | false;
  qbo_customer: string | false;
  problem: string | false;
}

export interface BackfillReport {
  rows: BackfillRow[];
  counts: Record<BackfillOutcome | "blocked", number>;
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Can it be sent? Not when the number belongs to another customer, or when it can't be created. */
export function backfillSendable(r: BackfillRow): boolean {
  if (r.outcome === "other_customer") return false;
  if (r.outcome === "missing" && r.problem) return false;
  return true;
}

export function backfillPlan(r: BackfillRow): { label: string; tone: "ok" | "warn" | "bad" | "info"; detail: string } {
  const hasTotal = typeof r.qbo_total === "number" && r.qbo_total > 0;
  const paidThere = hasTotal && r.qbo_balance === 0;
  const partlyThere = hasTotal && typeof r.qbo_balance === "number" && r.qbo_balance > 0 && r.qbo_balance < (r.qbo_total as number);
  switch (r.outcome) {
    case "same":
      return {
        label: "Already there",
        tone: "ok",
        detail: `Same total: it will be linked, not copied.${
          paidThere ? " It's paid there: the payment comes here too." : partlyThere ? " It has payments there: they come here too." : ""
        }`,
      };
    case "different":
      return {
        label: "Different total",
        tone: "warn",
        detail: `QuickBooks has ${typeof r.qbo_total === "number" ? usd(r.qbo_total) : "another total"}: it will be linked and marked "doesn't match" for you to check.`,
      };
    case "other_customer":
      return {
        label: "Number taken",
        tone: "bad",
        detail: `QuickBooks uses #${r.name} for ${r.qbo_customer || "another customer"}: left alone. Check the numbering.`,
      };
    default:
      return r.problem
        ? { label: "Can't send yet", tone: "bad", detail: String(r.problem) }
        : { label: "Not there", tone: "info", detail: "It will be created in QuickBooks with the same number." };
  }
}

/**
 * Costs per door (the estimate, with Majela's fixed rates) and per month
 * (the real figures: sales against purchases and pay). Shapes of what the
 * Odoo service `indigo.costing` returns.
 */
export interface CostRate {
  key: string;
  label: string;
  value: number;
}

export interface CostLine {
  group: "material" | "labor";
  label: string;
  detail: string;
  amount: number;
}

export interface OrderCost {
  order_id: number;
  name: string;
  sqf: number;
  doors: number;
  lines: CostLine[];
  materials: number;
  labor: number;
  total: number;
  per_sqf: number;
  price: number;
  margin: number;
}

export interface InvoiceProfit {
  revenue: number;
  cost: number;
  margin: number;
  margin_pct: number;
  orders: Array<{ order_id: number; name: string; total: number }>;
}

export const EXPENSE_CATEGORIES = [
  { value: "acm", label: "ACM" },
  { value: "paint", label: "Paint" },
  { value: "glue", label: "Glue" },
  { value: "labor", label: "Labor" },
  { value: "service", label: "Outside service" },
  { value: "other", label: "Other" },
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["value"];

export interface Expense {
  id: number;
  date: string;
  supplier: string;
  category: ExpenseCategory;
  amount: number;
  note: string;
  attachment_id: number | false;
  attachment_name: string | false;
  by: string;
}

export interface MonthCosts {
  month: string;
  sold: number;
  invoices: number;
  doors: number;
  sqf: number;
  purchases: Record<ExpenseCategory, number>;
  purchases_total: number;
  people: { installer: number; digitizer: number; painter: number };
  people_total: number;
  spent: number;
  result: number;
  estimate: number;
  estimate_result: number;
}

/** "2026-10" for a date, in the shop's calendar month as the caller sees it. */
export function monthOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return monthOf(d);
}

export function isMonth(v: string | null): v is string {
  return !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

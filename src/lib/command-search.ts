/**
 * Ctrl+K search (25-nov-2026): the pure part — which menu pages match what was
 * typed, how API hits become rows, and which key press opens it. The
 * component (src/components/command-palette.tsx) only draws and navigates.
 */

export type PaletteKind = "page" | "order" | "invoice" | "dealer" | "design" | "action";

export interface DoorLine {
  design: string | false;
  design_id: number | false;
  door_type: string | false;
  color: string | false;
  qty: number;
}

/** What the preview pane shows for the highlighted row. */
export type PaletteDetail =
  | { kind: "order"; client: string; dealer: string; stage: string; po: string; phone: string; address: string; installDate: string; doors: DoorLine[] }
  | { kind: "invoice"; dealer: string; amount: number; due: number; status: string; date: string; clients: string }
  | { kind: "dealer"; phone: string; email: string; city: string }
  | { kind: "design"; code: string; name: string; doorType: string; imageUrl: string };

export interface PaletteItem {
  kind: PaletteKind;
  key: string;
  title: string;
  subtitle?: string;
  href: string;
  detail?: PaletteDetail;
}

export interface SearchHits {
  orders: Array<{
    id: number; name: string; client_name: string | false; dealer: string | false; stage: string | false;
    customer_po: string | false; client_phone?: string | false; client_address?: string | false;
    installation_date?: string | false; doors?: DoorLine[];
  }>;
  invoices: Array<{
    id: number; name: string; partner: string | false; amount_total: number; payment_state: string | false; state: string;
    amount_residual?: number; invoice_date?: string | false; clients?: string;
  }>;
  dealers: Array<{ id: number; name: string; phone?: string | false; email?: string | false; city?: string | false }>;
  designs?: Array<{ id: number; code: string; name: string | false; door_type: string | false }>;
}

/** The tabs over the results; "all" shows everything. */
export const SCOPES: Array<{ key: "all" | PaletteKind; label: string }> = [
  { key: "all", label: "All" },
  { key: "order", label: "Orders" },
  { key: "invoice", label: "Invoices" },
  { key: "dealer", label: "Dealers" },
  { key: "design", label: "Designs" },
  { key: "page", label: "Pages" },
];

/** Lower case, no accents: "Diseño" and "diseno" are the same search. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Menu pages that match, best first: the label starts with it, then a word does, then it's inside. */
export function matchPages(
  pages: Array<{ href: string; label: string; section?: string }>,
  query: string,
  limit = 6,
): PaletteItem[] {
  const q = normalize(query);
  if (!q) return [];
  const scored: Array<{ score: number; item: PaletteItem }> = [];
  for (const p of pages) {
    const label = normalize(p.label);
    let score = -1;
    if (label.startsWith(q)) score = 3;
    else if (label.split(/\s+/).some((w) => w.startsWith(q))) score = 2;
    else if (label.includes(q)) score = 1;
    if (score < 0) continue;
    scored.push({ score, item: { kind: "page", key: `page:${p.href}`, title: p.label, subtitle: p.section, href: p.href } });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.item);
}

export const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const DOOR_TYPE: Record<string, string> = { SD: "Single door", DD: "Double door", sidelite: "With sidelites" };

/** "SD" -> "Single door"; anything unknown passes through. */
export function doorTypeLabel(t: string | false | undefined): string {
  return t ? DOOR_TYPE[t] ?? t : "";
}

/** "2026-12-03" -> "Thu, Dec 3" (a date, no clock: no time zone to get wrong). */
export function shortDate(d: string | false | undefined): string {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return "";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, day)));
}

function invoiceStatus(i: { state: string; payment_state: string | false }): string {
  if (i.state === "draft") return "Draft";
  if (i.payment_state === "paid" || i.payment_state === "in_payment") return "Paid";
  if (i.payment_state === "partial") return "Partly paid";
  return "Open";
}

/** API hits as rows: orders, then invoices, dealers and designs. */
export function hitsToItems(hits: Partial<SearchHits>): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const o of hits.orders ?? []) {
    out.push({
      kind: "order",
      key: `order:${o.id}`,
      title: [o.name, o.client_name].filter(Boolean).join(" · "),
      subtitle: [o.dealer, o.stage, o.customer_po ? `PO ${o.customer_po}` : ""].filter(Boolean).join(" · "),
      href: `/orders/${o.id}`,
      detail: {
        kind: "order",
        client: o.client_name || "",
        dealer: o.dealer || "",
        stage: o.stage || "",
        po: o.customer_po || "",
        phone: o.client_phone || "",
        address: o.client_address || "",
        installDate: shortDate(o.installation_date),
        doors: o.doors ?? [],
      },
    });
  }
  for (const i of hits.invoices ?? []) {
    const status = invoiceStatus(i);
    out.push({
      kind: "invoice",
      key: `invoice:${i.id}`,
      title: `Invoice ${i.state === "draft" || !i.name || i.name === "/" ? "(draft)" : i.name}`,
      subtitle: [i.partner, money.format(i.amount_total || 0), status].filter(Boolean).join(" · "),
      href: `/billing/invoices/${i.id}`,
      detail: {
        kind: "invoice",
        dealer: i.partner || "",
        amount: i.amount_total || 0,
        due: i.amount_residual ?? 0,
        status,
        date: shortDate(i.invoice_date),
        clients: i.clients || "",
      },
    });
  }
  for (const d of hits.dealers ?? []) {
    out.push({
      kind: "dealer",
      key: `dealer:${d.id}`,
      title: d.name,
      subtitle: ["Dealer", d.city].filter(Boolean).join(" · "),
      href: `/catalog/dealers/${d.id}`,
      detail: { kind: "dealer", phone: d.phone || "", email: d.email || "", city: d.city || "" },
    });
  }
  for (const g of hits.designs ?? []) {
    out.push({
      kind: "design",
      key: `design:${g.id}`,
      title: [g.code, g.name].filter(Boolean).join(" · "),
      subtitle: doorTypeLabel(g.door_type) || "Design",
      href: `/catalog/designs/${g.id}`,
      detail: { kind: "design", code: g.code, name: g.name || "", doorType: doorTypeLabel(g.door_type), imageUrl: `/api/catalog/designs/${g.id}/image` },
    });
  }
  return out;
}

/** How many rows of each kind, for the counts on the tabs. */
export function countByKind(items: PaletteItem[]): Record<string, number> {
  const c: Record<string, number> = { all: items.length };
  for (const i of items) c[i.kind] = (c[i.kind] ?? 0) + 1;
  return c;
}

/** Tab / Shift+Tab: next scope that has results (or "all"), wrapping around. */
export function nextScope(current: string, counts: Record<string, number>, back = false): string {
  const keys = SCOPES.map((s) => s.key).filter((k) => k === "all" || (counts[k] ?? 0) > 0);
  const i = Math.max(0, keys.indexOf(current as (typeof keys)[number]));
  const n = keys.length;
  return keys[(i + (back ? n - 1 : 1)) % n];
}

/**
 * Phones are stored in half a dozen formats ("+1 305-555-0142",
 * "(305) 555-0142", "1 (305)…"). Typing only the digits found 1 in 20 of them
 * in production; an ilike pattern with a wildcard between digits finds them
 * all. Null when the query has fewer than 4 digits or isn't mostly a number.
 */
export function phonePattern(query: string): string | null {
  const digits = query.replace(/\D/g, "");
  if (digits.length < 4 || digits.length < query.replace(/\s/g, "").length - 2) return null;
  return digits.split("").join("%");
}

/**
 * "544" or "00544" → the order IND/YYYY/00544 itself, so it comes first instead
 * of drowning among the 100+ orders whose PO or phone also contains "544".
 * Null unless the query is a bare order number.
 */
export function orderNumberSuffix(query: string): string | null {
  const q = query.trim();
  if (!/^\d{1,5}$/.test(q)) return null;
  return "/" + q.padStart(5, "0");
}

/** Last places opened from the box, newest first, without repeats. */
export function pushRecent(recent: PaletteItem[], item: PaletteItem, max = 6): PaletteItem[] {
  return [item, ...recent.filter((r) => r.key !== item.key)].slice(0, max);
}

/** Ctrl+K on Windows/Linux, ⌘K on a Mac. */
export function isPaletteShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey?: boolean; shiftKey?: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
}

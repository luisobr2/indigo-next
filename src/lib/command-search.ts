/**
 * Ctrl+K search (25-nov-2026): the pure part — which menu pages match what was
 * typed, how API hits become rows, and which key press opens it. The
 * component (src/components/command-palette.tsx) only draws and navigates.
 */

export type PaletteKind = "page" | "order" | "invoice" | "dealer";

export interface PaletteItem {
  kind: PaletteKind;
  key: string;
  title: string;
  subtitle?: string;
  href: string;
}

export interface SearchHits {
  orders: Array<{ id: number; name: string; client_name: string | false; dealer: string | false; stage: string | false; customer_po: string | false }>;
  invoices: Array<{ id: number; name: string; partner: string | false; amount_total: number; payment_state: string | false; state: string }>;
  dealers: Array<{ id: number; name: string }>;
}

/** Lower case, no accents: "Diseño" and "diseno" are the same search. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
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

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** API hits as rows: orders, then invoices, then dealers. */
export function hitsToItems(hits: Partial<SearchHits>): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const o of hits.orders ?? []) {
    out.push({
      kind: "order",
      key: `order:${o.id}`,
      title: [o.name, o.client_name].filter(Boolean).join(" · "),
      subtitle: [o.dealer, o.stage, o.customer_po ? `PO ${o.customer_po}` : ""].filter(Boolean).join(" · "),
      href: `/orders/${o.id}`,
    });
  }
  for (const i of hits.invoices ?? []) {
    const status = i.state === "draft" ? "Draft" : i.payment_state === "paid" ? "Paid" : i.payment_state === "partial" ? "Partly paid" : "Open";
    out.push({
      kind: "invoice",
      key: `invoice:${i.id}`,
      title: `Invoice ${i.state === "draft" || !i.name || i.name === "/" ? "(draft)" : i.name}`,
      subtitle: [i.partner, money.format(i.amount_total || 0), status].filter(Boolean).join(" · "),
      href: `/billing/invoices/${i.id}`,
    });
  }
  for (const d of hits.dealers ?? []) {
    out.push({ kind: "dealer", key: `dealer:${d.id}`, title: d.name, subtitle: "Dealer", href: `/catalog/dealers/${d.id}` });
  }
  return out;
}

/** Ctrl+K on Windows/Linux, ⌘K on a Mac. */
export function isPaletteShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey?: boolean; shiftKey?: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";
}

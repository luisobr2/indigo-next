import test from "node:test";
import assert from "node:assert/strict";
import {
  countByKind,
  doorTypeLabel,
  hitsToItems,
  nextScope,
  shortDate,
  isPaletteShortcut,
  matchPages,
  normalize,
  orderNumberSuffix,
  phonePattern,
  pushRecent,
  type PaletteItem,
} from "./command-search.ts";

test("a phone typed as bare digits matches any stored format", () => {
  const p = phonePattern("3055550142")!;
  assert.equal(p, "3%0%5%5%5%5%0%1%4%2");
  // the ilike pattern, read as a regex, matches the formats seen in production
  const re = new RegExp(p.replace(/%/g, ".*"));
  for (const stored of ["+1 305-555-0142", "(305) 555-0142", "1 (305) 555-0142", "+1 (305)555-0142"]) {
    assert.match(stored, re, stored);
  }
  assert.equal(phonePattern("0142"), "0%1%4%2", "last four digits are enough");
  assert.equal(phonePattern("305-555-0142"), "3%0%5%5%5%5%0%1%4%2");
  assert.equal(phonePattern("123"), null, "too short to be a phone");
  assert.equal(phonePattern("Garcia 1234"), null, "a name with a number is not a phone");
});

test("a bare number goes straight to that order", () => {
  assert.equal(orderNumberSuffix("544"), "/00544");
  assert.equal(orderNumberSuffix(" 00544 "), "/00544");
  assert.equal(orderNumberSuffix("1381"), "/01381");
  assert.equal(orderNumberSuffix("149281"), null, "six digits is a PO, not an order number");
  assert.equal(orderNumberSuffix("VELEZ 1"), null);
});

test("recent places: newest first, no repeats, capped", () => {
  const it = (n: number): PaletteItem => ({ kind: "order", key: `order:${n}`, title: `#${n}`, href: `/orders/${n}` });
  let r = [it(1), it(2), it(3)];
  r = pushRecent(r, it(2));
  assert.deepEqual(r.map((x) => x.key), ["order:2", "order:1", "order:3"]);
  r = pushRecent(r, it(9), 3);
  assert.deepEqual(r.map((x) => x.key), ["order:9", "order:2", "order:1"]);
});

const PAGES = [
  { href: "/orders", label: "Orders" },
  { href: "/design-approval", label: "Design Approval" },
  { href: "/digitalization", label: "Digitalization" },
  { href: "/installations", label: "Installations" },
  { href: "/admin/activity-log", label: "Activity log", section: "Administration" },
];

test("accents and case don't matter", () => {
  assert.equal(normalize("  DiSeÑo "), "diseno");
});

test("pages: label start beats a word start beats anywhere", () => {
  assert.deepEqual(matchPages(PAGES, "di").map((p) => p.href), ["/digitalization"]);
  assert.deepEqual(matchPages(PAGES, "app").map((p) => p.href), ["/design-approval"]);
  assert.deepEqual(matchPages(PAGES, "log").map((p) => p.href), ["/admin/activity-log"]);
  assert.deepEqual(matchPages(PAGES, "ation").map((p) => p.href), ["/digitalization", "/installations"]);
  assert.equal(matchPages(PAGES, "log")[0].subtitle, "Administration");
  assert.deepEqual(matchPages(PAGES, "   "), []);
});

test("hits become rows that link to their page", () => {
  const items = hitsToItems({
    orders: [{ id: 7, name: "IND/2026/00007", client_name: "Ada Quillon", dealer: "Dealer A", stage: "CNC / Router", customer_po: "QUILLON 400001" }],
    invoices: [
      { id: 3, name: "1501", partner: "Dealer A", amount_total: 623.5, payment_state: "not_paid", state: "posted" },
      { id: 4, name: "/", partner: "Dealer B", amount_total: 10, payment_state: "not_paid", state: "draft" },
    ],
    dealers: [{ id: 9, name: "Dealer A" }],
  });
  assert.deepEqual(items.map((i) => i.href), ["/orders/7", "/billing/invoices/3", "/billing/invoices/4", "/catalog/dealers/9"]);
  assert.equal(items[0].title, "IND/2026/00007 · Ada Quillon");
  assert.equal(items[0].subtitle, "Dealer A · CNC / Router · PO QUILLON 400001");
  assert.equal(items[1].subtitle, "Dealer A · $623.50 · Open");
  assert.equal(items[2].title, "Invoice (draft)");
});

test("Ctrl+K and Cmd+K open it; plain K or Ctrl+Shift+K don't", () => {
  assert.ok(isPaletteShortcut({ key: "k", ctrlKey: true, metaKey: false }));
  assert.ok(isPaletteShortcut({ key: "K", ctrlKey: false, metaKey: true }));
  assert.ok(!isPaletteShortcut({ key: "k", ctrlKey: false, metaKey: false }));
  assert.ok(!isPaletteShortcut({ key: "k", ctrlKey: true, metaKey: false, shiftKey: true }));
});

test("each row carries what the preview pane shows", () => {
  const items = hitsToItems({
    orders: [{
      id: 7, name: "IND/2026/00007", client_name: "Ada Quillon", dealer: "Dealer A", stage: "CNC / Router",
      customer_po: "QUILLON 400001", client_phone: "305-555-0100", client_address: "1 Main St, Miami FL 33101",
      installation_date: "2026-12-03",
      doors: [{ design: "ID70", design_id: 70, door_type: "DD", color: "black", qty: 1 }],
    }],
    invoices: [{ id: 3, name: "1501", partner: "Dealer A", amount_total: 623.5, amount_residual: 123.5, payment_state: "partial", state: "posted", invoice_date: "2026-11-20", clients: "Ada Quillon" }],
    dealers: [{ id: 9, name: "Dealer A", phone: "305", email: "a@dealer.test", city: "Doral" }],
    designs: [{ id: 70, code: "ID70", name: "Wave", door_type: "DD" }],
  });
  assert.deepEqual(items.map((i) => i.kind), ["order", "invoice", "dealer", "design"]);
  const order = items[0].detail!;
  assert.equal(order.kind, "order");
  if (order.kind === "order") {
    assert.equal(order.installDate, "Thu, Dec 3");
    assert.equal(order.doors[0].design, "ID70");
  }
  const inv = items[1].detail!;
  assert.ok(inv.kind === "invoice" && inv.due === 123.5 && inv.status === "Partly paid");
  assert.equal(items[2].subtitle, "Dealer · Doral");
  assert.equal(items[3].href, "/catalog/designs/70");
  assert.equal(items[3].subtitle, "Double door");
  const d = items[3].detail!;
  assert.ok(d.kind === "design" && d.imageUrl === "/api/catalog/designs/70/image");
});

test("labels and dates read like the rest of the panel", () => {
  assert.equal(doorTypeLabel("SD"), "Single door");
  assert.equal(doorTypeLabel("sidelite"), "With sidelites");
  assert.equal(shortDate("2026-11-26"), "Thu, Nov 26");
  assert.equal(shortDate(false), "");
});

test("tabs: counts per kind, and Tab skips the empty ones", () => {
  const items = hitsToItems({
    orders: [{ id: 1, name: "A", client_name: false, dealer: false, stage: false, customer_po: false }],
    dealers: [{ id: 2, name: "B" }],
  });
  const counts = countByKind(items);
  assert.deepEqual(counts, { all: 2, order: 1, dealer: 1 });
  assert.equal(nextScope("all", counts), "order");
  assert.equal(nextScope("order", counts), "dealer");
  assert.equal(nextScope("dealer", counts), "all");
  assert.equal(nextScope("all", counts, true), "dealer");
});

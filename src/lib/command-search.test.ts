import test from "node:test";
import assert from "node:assert/strict";
import {
  hitsToItems,
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

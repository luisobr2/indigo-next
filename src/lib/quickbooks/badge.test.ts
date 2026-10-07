import { test } from "node:test";
import assert from "node:assert/strict";
import { qboBadge, QBO_RETRYABLE, type QboState } from "./badge.ts";

test("nothing to show for drafts or when QuickBooks isn't used", () => {
  assert.equal(qboBadge({ state: "draft", qbo_state: "none" }), null);
  assert.equal(qboBadge({ state: "posted" }), null);
  assert.equal(qboBadge({ state: "posted", qbo_state: "none" }), null);
});

test("an issued invoice outside QuickBooks shows only when asked", () => {
  const b = qboBadge({ state: "posted", qbo_state: "none" }, { showMissing: true });
  assert.equal(b?.label, "Not in QuickBooks");
  assert.equal(b?.canRetry, false);
  assert.equal(qboBadge({ state: "draft", qbo_state: "none" }, { showMissing: true }), null);
});

test("each state has its words and colour", () => {
  const expected: Record<Exclude<QboState, "none">, [string, string]> = {
    pending: ["QuickBooks: pending", "info"],
    synced: ["In QuickBooks", "ok"],
    linked: ["In QuickBooks (by hand)", "ok"],
    mismatch: ["QuickBooks doesn't match", "warn"],
    error: ["QuickBooks error", "bad"],
    voided: ["Voided in QuickBooks", "muted"],
  };
  for (const [st, [label, tone]] of Object.entries(expected)) {
    const b = qboBadge({ state: "posted", qbo_state: st as QboState });
    assert.equal(b?.label, label, st);
    assert.equal(b?.tone, tone, st);
  }
});

test("errors and mismatches carry Odoo's reason and can be retried", () => {
  const e = qboBadge({ state: "posted", qbo_state: "error", qbo_error: "Dealer isn't matched" });
  assert.equal(e?.detail, "Dealer isn't matched");
  assert.equal(e?.canRetry, true);
  const m = qboBadge({ state: "posted", qbo_state: "mismatch", qbo_error: false });
  assert.match(m?.detail ?? "", /different/);
});

test("Retry is offered exactly where Odoo accepts it", () => {
  for (const st of ["pending", "synced", "linked", "mismatch", "error", "voided"] as QboState[]) {
    assert.equal(qboBadge({ state: "posted", qbo_state: st })?.canRetry, QBO_RETRYABLE.includes(st), st);
  }
});

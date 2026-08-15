import test from "node:test";
import assert from "node:assert/strict";

import {
  issueConfirmToken,
  verifyConfirmToken,
  normalizeArgs,
  CONFIRM_TOKEN_TTL_MS,
} from "./confirm.ts";

const SECRET = "x".repeat(32);
const OTHER_SECRET = "y".repeat(32);
const TOOL = "advance_order";
const UID = 7;
const ARGS = { order_id: 412, outcome: "painting_done", note: "listo" };
const NOW = 1_700_000_000_000;

// ---------------------------------------------------------------------
// normalizeArgs — key-order independence, the property the whole
// argument-binding guarantee rests on.
// ---------------------------------------------------------------------

test("normalizeArgs is independent of object key order", () => {
  assert.equal(
    normalizeArgs({ a: 1, b: 2, order_id: 412 }),
    normalizeArgs({ order_id: 412, b: 2, a: 1 }),
  );
});

test("normalizeArgs is independent of key order in nested objects too", () => {
  assert.equal(
    normalizeArgs({ line_sqf: { "3": 10, "1": 5 } }),
    normalizeArgs({ line_sqf: { "1": 5, "3": 10 } }),
  );
});

test("normalizeArgs preserves array order (order is meaningful there)", () => {
  assert.notEqual(normalizeArgs({ installer_ids: [1, 2] }), normalizeArgs({ installer_ids: [2, 1] }));
});

test("normalizeArgs distinguishes genuinely different values", () => {
  assert.notEqual(normalizeArgs({ order_id: 412 }), normalizeArgs({ order_id: 413 }));
});

// ---------------------------------------------------------------------
// Round trip — the baseline "a valid confirm executes" property.
// ---------------------------------------------------------------------

test("a token issued for tool+args+uid verifies for the exact same tool+args+uid", () => {
  const token = issueConfirmToken(TOOL, ARGS, UID, SECRET, NOW);
  const decision = verifyConfirmToken(token, TOOL, ARGS, UID, SECRET, NOW);
  assert.deepEqual(decision, { ok: true });
});

test("verification does not depend on object key order between issue and verify", () => {
  const token = issueConfirmToken(TOOL, { order_id: 412, outcome: "cnc_done" }, UID, SECRET, NOW);
  const decision = verifyConfirmToken(token, TOOL, { outcome: "cnc_done", order_id: 412 }, UID, SECRET, NOW);
  assert.deepEqual(decision, { ok: true });
});

// ---------------------------------------------------------------------
// Argument binding — "a token replayed with different arguments is
// rejected." This is the core anti-replay property the design calls for.
// ---------------------------------------------------------------------

test("a token is rejected when replayed with a different order_id", () => {
  const token = issueConfirmToken(TOOL, { order_id: 412, outcome: "cnc_done" }, UID, SECRET, NOW);
  const decision = verifyConfirmToken(token, TOOL, { order_id: 999, outcome: "cnc_done" }, UID, SECRET, NOW);
  assert.deepEqual(decision, { ok: false, reason: "mismatch" });
});

test("a token is rejected when replayed with a different outcome", () => {
  const token = issueConfirmToken(TOOL, { order_id: 412, outcome: "cnc_done" }, UID, SECRET, NOW);
  const decision = verifyConfirmToken(token, TOOL, { order_id: 412, outcome: "painting_done" }, UID, SECRET, NOW);
  assert.deepEqual(decision, { ok: false, reason: "mismatch" });
});

test("a token is rejected when replayed with an extra field added", () => {
  const token = issueConfirmToken(TOOL, { order_id: 412 }, UID, SECRET, NOW);
  const decision = verifyConfirmToken(token, TOOL, { order_id: 412, note: "sneaked in" }, UID, SECRET, NOW);
  assert.deepEqual(decision, { ok: false, reason: "mismatch" });
});

test("a token minted for one tool is rejected when presented for a different tool", () => {
  const token = issueConfirmToken("assign_order", ARGS, UID, SECRET, NOW);
  const decision = verifyConfirmToken(token, "advance_order", ARGS, UID, SECRET, NOW);
  assert.deepEqual(decision, { ok: false, reason: "mismatch" });
});

test("a token minted for one identity is rejected when presented by a different uid", () => {
  const token = issueConfirmToken(TOOL, ARGS, UID, SECRET, NOW);
  const decision = verifyConfirmToken(token, TOOL, ARGS, 99, SECRET, NOW);
  assert.deepEqual(decision, { ok: false, reason: "mismatch" });
});

test("a token signed with a different secret is rejected", () => {
  const token = issueConfirmToken(TOOL, ARGS, UID, OTHER_SECRET, NOW);
  const decision = verifyConfirmToken(token, TOOL, ARGS, UID, SECRET, NOW);
  assert.deepEqual(decision, { ok: false, reason: "mismatch" });
});

test("a token with a tampered signature is rejected", () => {
  const token = issueConfirmToken(TOOL, ARGS, UID, SECRET, NOW);
  const [expPart] = token.split(".");
  const decision = verifyConfirmToken(`${expPart}.deadbeef`, TOOL, ARGS, UID, SECRET, NOW);
  assert.deepEqual(decision, { ok: false, reason: "mismatch" });
});

// ---------------------------------------------------------------------
// Expiry — "an expired token is rejected."
// ---------------------------------------------------------------------

test("a token is valid right up to its expiry instant, and expired the instant after", () => {
  const token = issueConfirmToken(TOOL, ARGS, UID, SECRET, NOW);
  const expiry = NOW + CONFIRM_TOKEN_TTL_MS;
  assert.deepEqual(verifyConfirmToken(token, TOOL, ARGS, UID, SECRET, expiry - 1), { ok: true });
  assert.deepEqual(verifyConfirmToken(token, TOOL, ARGS, UID, SECRET, expiry), { ok: false, reason: "expired" });
});

test("a long-expired token is rejected as expired, not as a mismatch", () => {
  const token = issueConfirmToken(TOOL, ARGS, UID, SECRET, NOW);
  const wayLater = NOW + CONFIRM_TOKEN_TTL_MS + 60_000;
  assert.deepEqual(verifyConfirmToken(token, TOOL, ARGS, UID, SECRET, wayLater), { ok: false, reason: "expired" });
});

test("tampering with the visible expiry to extend it invalidates the signature instead of extending it", () => {
  const token = issueConfirmToken(TOOL, ARGS, UID, SECRET, NOW);
  const [, mac] = token.split(".");
  const forgedExp = NOW + CONFIRM_TOKEN_TTL_MS + 10 * 60_000; // far future
  const forgedExpPart = Buffer.from(String(forgedExp), "utf8").toString("base64url");
  const forged = `${forgedExpPart}.${mac}`;
  // Presented "now" is within the forged (extended) window but past the
  // real one — if the forged exp were trusted, this would verify.
  const checkAt = NOW + CONFIRM_TOKEN_TTL_MS + 1_000;
  assert.deepEqual(verifyConfirmToken(forged, TOOL, ARGS, UID, SECRET, checkAt), { ok: false, reason: "mismatch" });
});

// ---------------------------------------------------------------------
// Malformed input — must never throw, only report "invalid".
// ---------------------------------------------------------------------

test("malformed tokens are rejected as invalid without throwing", () => {
  for (const raw of ["", ".", "nodot", ".onlysig", "onlyexp."]) {
    assert.doesNotThrow(() => verifyConfirmToken(raw, TOOL, ARGS, UID, SECRET, NOW));
    const decision = verifyConfirmToken(raw, TOOL, ARGS, UID, SECRET, NOW);
    assert.equal(decision.ok, false, `expected rejection for ${JSON.stringify(raw)}`);
  }
});

test("a non-string token is rejected as invalid without throwing", () => {
  // @ts-expect-error deliberately wrong type — an MCP client could still send this over JSON-RPC
  const decision = verifyConfirmToken(undefined, TOOL, ARGS, UID, SECRET, NOW);
  assert.deepEqual(decision, { ok: false, reason: "invalid" });
});

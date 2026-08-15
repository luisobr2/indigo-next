import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { signPayload, verifyPayload, requireSessionSecret } from "./session-cookie.ts";
import { SESSION_LIFETIME_MS } from "../session-cookie-edge.ts";

const SECRET = "x".repeat(32);
const OTHER = "y".repeat(32);
const PAYLOAD = { session: "abc123", user: { id: 2, name: "José", groups: ["Indigo Decors / Manager"] } };
const PURPOSE = "session";
const OTHER_PURPOSE = "session-original";
// Fixed instant instead of Date.now() so every test here is deterministic.
const NOW = 1_700_000_000_000;

test("round-trips a payload", () => {
  // The signed body now also carries `exp` — verifyPayload hands it back
  // as part of the payload, so the round-trip includes it too.
  const signed = signPayload(PAYLOAD, SECRET, PURPOSE, NOW);
  assert.deepEqual(verifyPayload(signed, SECRET, PURPOSE, NOW), {
    ...PAYLOAD,
    exp: NOW + SESSION_LIFETIME_MS,
  });
});

test("rejects a tampered body", () => {
  const raw = signPayload(PAYLOAD, SECRET, PURPOSE, NOW);
  const [body, sig] = raw.split(".");
  const forged = Buffer.from(JSON.stringify({ ...PAYLOAD, user: { ...PAYLOAD.user, isAdmin: true } }), "utf8")
    .toString("base64url");
  assert.notEqual(forged, body);
  assert.equal(verifyPayload(`${forged}.${sig}`, SECRET, PURPOSE, NOW), null);
});

test("rejects a tampered signature", () => {
  const raw = signPayload(PAYLOAD, SECRET, PURPOSE, NOW);
  const [body] = raw.split(".");
  assert.equal(verifyPayload(`${body}.deadbeef`, SECRET, PURPOSE, NOW), null);
});

test("rejects a cookie signed with a different secret", () => {
  assert.equal(verifyPayload(signPayload(PAYLOAD, OTHER, PURPOSE, NOW), SECRET, PURPOSE, NOW), null);
});

test("rejects the legacy unsigned cookie", () => {
  // Everyone gets logged out on deploy. That is the intended migration.
  assert.equal(verifyPayload(JSON.stringify(PAYLOAD), SECRET, PURPOSE, NOW), null);
});

test("rejects malformed input without throwing", () => {
  for (const raw of ["", ".", "nodot", ".onlysig"]) {
    assert.equal(verifyPayload(raw, SECRET, PURPOSE, NOW), null, `expected null for ${JSON.stringify(raw)}`);
  }
});

test("requireSessionSecret refuses a missing or weak secret", () => {
  const saved = process.env.SESSION_SECRET;
  try {
    delete process.env.SESSION_SECRET;
    assert.throws(() => requireSessionSecret(), /SESSION_SECRET/);
    process.env.SESSION_SECRET = "tooshort";
    assert.throws(() => requireSessionSecret(), /SESSION_SECRET/);
    process.env.SESSION_SECRET = SECRET;
    assert.equal(requireSessionSecret(), SECRET);
  } finally {
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
  }
});

// ---------------------------------------------------------------------
// Finding A: the signed payload now expires, and expiry is checked with a
// `now` supplied by the caller rather than read from the clock internally.
// ---------------------------------------------------------------------

test("a payload is valid right up to its expiry instant, and expired the instant after", () => {
  const raw = signPayload(PAYLOAD, SECRET, PURPOSE, NOW);
  const expiry = NOW + SESSION_LIFETIME_MS;
  assert.notEqual(verifyPayload(raw, SECRET, PURPOSE, expiry - 1), null);
  assert.equal(verifyPayload(raw, SECRET, PURPOSE, expiry), null);
});

test("an expired payload is rejected exactly like a missing one: null, never a throw", () => {
  const raw = signPayload(PAYLOAD, SECRET, PURPOSE, NOW);
  const wayLater = NOW + SESSION_LIFETIME_MS + 1_000;
  assert.doesNotThrow(() => verifyPayload(raw, SECRET, PURPOSE, wayLater));
  assert.equal(verifyPayload(raw, SECRET, PURPOSE, wayLater), null);
});

test("a payload signed before `exp` existed (no exp field) is treated as expired, not valid-forever", () => {
  // Simulates a cookie already sitting in someone's browser at deploy time,
  // signed by the previous format. Hand-built because signPayload always
  // stamps an exp now — there is no way to produce this shape through it.
  const body = Buffer.from(JSON.stringify(PAYLOAD), "utf8").toString("base64url");
  const mac = createHmac("sha256", SECRET).update(`${PURPOSE}:${body}`).digest("base64url");
  assert.equal(verifyPayload(`${body}.${mac}`, SECRET, PURPOSE, NOW), null);
});

// ---------------------------------------------------------------------
// Finding B: purpose is bound into the MAC, so a value signed for one
// cookie's purpose must not verify for the other's.
// ---------------------------------------------------------------------

test("a payload signed for one purpose fails verification under a different purpose", () => {
  const raw = signPayload(PAYLOAD, SECRET, PURPOSE, NOW);
  assert.equal(verifyPayload(raw, SECRET, OTHER_PURPOSE, NOW), null);
  // Sanity: the same raw value still verifies under its real purpose.
  assert.notEqual(verifyPayload(raw, SECRET, PURPOSE, NOW), null);
});

test("purpose separation holds both ways: neither cookie's signature verifies as the other's", () => {
  const forSession = signPayload(PAYLOAD, SECRET, PURPOSE, NOW);
  const forImpersonationBackup = signPayload(PAYLOAD, SECRET, OTHER_PURPOSE, NOW);
  assert.equal(verifyPayload(forSession, SECRET, OTHER_PURPOSE, NOW), null);
  assert.equal(verifyPayload(forImpersonationBackup, SECRET, PURPOSE, NOW), null);
});

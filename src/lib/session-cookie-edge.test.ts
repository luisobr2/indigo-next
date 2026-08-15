import test from "node:test";
import assert from "node:assert/strict";

import { decodeUnverified, isFresh, decodeFreshUnverified } from "./session-cookie-edge.ts";

/** Build a cookie body the way the signer does, without needing node:crypto. */
function body(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

test("decodes the payload out of a signed cookie", () => {
  const raw = `${body({ user: { name: "Majela" } })}.anysignature`;
  assert.deepEqual(decodeUnverified(raw), { user: { name: "Majela" } });
});

test("does not care whether the signature is valid — that is the Node side's job", () => {
  const raw = `${body({ a: 1 })}.obviously-wrong`;
  assert.deepEqual(decodeUnverified(raw), { a: 1 });
});

test("survives non-ASCII payloads", () => {
  // Real names and role labels carry accents and enye.
  const payload = { user: { name: "José Ramírez", groups: ["Diseñador"] } };
  assert.deepEqual(decodeUnverified(`${body(payload)}.sig`), payload);
});

test("returns null for the legacy unsigned cookie", () => {
  // Old format was raw JSON. It must NOT be accepted as a decodable payload.
  assert.equal(decodeUnverified('{"user":{"name":"Majela"}}'), null);
});

test("returns null for malformed input", () => {
  for (const raw of ["", ".", "nodot", ".onlysig", "!!!.sig"]) {
    assert.equal(decodeUnverified(raw), null, `expected null for ${JSON.stringify(raw)}`);
  }
});

// ---------------------------------------------------------------------
// isFresh — pure expiry check, `now` always supplied by the caller.
// ---------------------------------------------------------------------

test("isFresh: a payload with exp in the future is fresh", () => {
  assert.equal(isFresh({ exp: 1000 }, 500), true);
});

test("isFresh: a payload is no longer fresh at or after its exp", () => {
  assert.equal(isFresh({ exp: 1000 }, 1000), false);
  assert.equal(isFresh({ exp: 1000 }, 1500), false);
});

test("isFresh: a payload with no exp field is treated as expired, not valid-forever", () => {
  // Mirrors a cookie signed before the exp field existed.
  assert.equal(isFresh({ user: { name: "Majela" } }, 0), false);
});

test("isFresh: non-object payloads (including null, from a failed decode) are never fresh", () => {
  assert.equal(isFresh(null, 0), false);
  assert.equal(isFresh("a string", 0), false);
  assert.equal(isFresh(42, 0), false);
});

// ---------------------------------------------------------------------
// decodeFreshUnverified — the composed "usable identity right now" check
// the Edge middleware uses (proxy.ts, installer-guard.ts).
// ---------------------------------------------------------------------

test("decodeFreshUnverified returns the payload when well-formed and unexpired", () => {
  const payload = { user: { name: "Majela" }, exp: 1000 };
  assert.deepEqual(decodeFreshUnverified(`${body(payload)}.sig`, 500), payload);
});

test("decodeFreshUnverified returns null once the payload has expired", () => {
  const payload = { user: { name: "Majela" }, exp: 1000 };
  assert.equal(decodeFreshUnverified(`${body(payload)}.sig`, 1000), null);
});

test("decodeFreshUnverified returns null for a legacy payload with no exp, even though it decodes fine", () => {
  const raw = `${body({ user: { name: "Majela" } })}.sig`;
  assert.notEqual(decodeUnverified(raw), null); // decodeUnverified alone doesn't care
  assert.equal(decodeFreshUnverified(raw, 0), null); // but the fresh check does
});

test("decodeFreshUnverified returns null for malformed input, without throwing", () => {
  for (const raw of ["", ".", "nodot", ".onlysig", "!!!.sig"]) {
    assert.equal(decodeFreshUnverified(raw, 0), null, `expected null for ${JSON.stringify(raw)}`);
  }
});

import test from "node:test";
import assert from "node:assert/strict";

import { decodeUnverified } from "./session-cookie-edge.ts";

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

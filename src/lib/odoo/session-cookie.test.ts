import test from "node:test";
import assert from "node:assert/strict";

import { signPayload, verifyPayload, requireSessionSecret } from "./session-cookie.ts";

const SECRET = "x".repeat(32);
const OTHER = "y".repeat(32);
const PAYLOAD = { session: "abc123", user: { id: 2, name: "José", groups: ["Indigo Decors / Manager"] } };

test("round-trips a payload", () => {
  assert.deepEqual(verifyPayload(signPayload(PAYLOAD, SECRET), SECRET), PAYLOAD);
});

test("rejects a tampered body", () => {
  const raw = signPayload(PAYLOAD, SECRET);
  const [body, sig] = raw.split(".");
  const forged = Buffer.from(JSON.stringify({ ...PAYLOAD, user: { ...PAYLOAD.user, isAdmin: true } }), "utf8")
    .toString("base64url");
  assert.notEqual(forged, body);
  assert.equal(verifyPayload(`${forged}.${sig}`, SECRET), null);
});

test("rejects a tampered signature", () => {
  const raw = signPayload(PAYLOAD, SECRET);
  const [body] = raw.split(".");
  assert.equal(verifyPayload(`${body}.deadbeef`, SECRET), null);
});

test("rejects a cookie signed with a different secret", () => {
  assert.equal(verifyPayload(signPayload(PAYLOAD, OTHER), SECRET), null);
});

test("rejects the legacy unsigned cookie", () => {
  // Everyone gets logged out on deploy. That is the intended migration.
  assert.equal(verifyPayload(JSON.stringify(PAYLOAD), SECRET), null);
});

test("rejects malformed input without throwing", () => {
  for (const raw of ["", ".", "nodot", ".onlysig"]) {
    assert.equal(verifyPayload(raw, SECRET), null, `expected null for ${JSON.stringify(raw)}`);
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

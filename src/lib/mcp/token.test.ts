import test from "node:test";
import assert from "node:assert/strict";

import { parseBearer } from "./token.ts";

test("splits a bearer into login and api key on the LAST dot", () => {
  // Odoo logins are emails, so the login itself contains dots.
  assert.deepEqual(parseBearer("Bearer majela@indigodecors.com.abc123key"), {
    login: "majela@indigodecors.com",
    apiKey: "abc123key",
  });
});

test("accepts the raw value without the Bearer prefix", () => {
  assert.deepEqual(parseBearer("a@b.co.key"), { login: "a@b.co", apiKey: "key" });
});

test("rejects anything that is not a login/key pair", () => {
  for (const raw of [null, "", "Bearer ", "Bearer nodot", "Bearer .onlykey", "Bearer login."]) {
    assert.equal(parseBearer(raw), null, `expected null for ${JSON.stringify(raw)}`);
  }
});

test("trims surrounding whitespace", () => {
  assert.deepEqual(parseBearer("  Bearer   a@b.co.key  "), { login: "a@b.co", apiKey: "key" });
});

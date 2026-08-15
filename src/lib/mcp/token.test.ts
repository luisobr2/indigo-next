import test from "node:test";
import assert from "node:assert/strict";

import { parseBearer, isInternalUser } from "./token.ts";

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

// ---------------------------------------------------------------------
// isInternalUser — the gate that keeps this surface internal-team-only.
// The exact full_name string was verified live against indigo-prod's
// res.groups (base.group_user's category there is "User types", not the
// "Access Rights" a docs skim might suggest) rather than assumed.
// ---------------------------------------------------------------------

test("isInternalUser is true when the exact Odoo full_name is present", () => {
  assert.equal(isInternalUser(["User types / Internal User"]), true);
});

test("isInternalUser is true among a realistic full group list", () => {
  assert.equal(
    isInternalUser([
      "Extra Rights / Contact Creation",
      "User types / Internal User",
      "Indigo Decors / Office / Administracion",
    ]),
    true,
  );
});

test("isInternalUser is false for a portal/dealer-only group list", () => {
  assert.equal(isInternalUser(["User types / Portal"]), false);
});

test("isInternalUser is false for an empty group list", () => {
  assert.equal(isInternalUser([]), false);
});

test("isInternalUser does not match on a partial/similar-looking name", () => {
  assert.equal(isInternalUser(["Internal User"]), false);
  assert.equal(isInternalUser(["Access Rights / Internal User"]), false);
});

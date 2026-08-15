import test from "node:test";
import assert from "node:assert/strict";

import { installerRedirect, isOnlyInstaller } from "./installer-guard.ts";
import { deriveRole } from "./odoo/types.ts";
import { SESSION_LIFETIME_MS } from "./session-cookie-edge.ts";

const INSTALLER = ["Indigo Decors / Installer (internal)"];
const MANAGER = ["Indigo Decors / Manager"];
// Fixed instant instead of Date.now() so these tests are deterministic.
const NOW = 1_700_000_000_000;

/** Same encoding as signPayload, minus the signature (which Edge ignores). */
function cookie(groups: string[], exp: number = NOW + SESSION_LIFETIME_MS): string {
  const payload = {
    session: "s",
    user: { id: 1, login: "x", name: "X", partnerId: 1, isAdmin: false, groups },
    exp,
  };
  return `${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.sig`;
}

test("a pure installer is redirected to /installs from a management page", () => {
  assert.equal(installerRedirect("/installations", cookie(INSTALLER), NOW), "/installs");
});

test("a manager is never redirected", () => {
  assert.equal(installerRedirect("/installations", cookie(MANAGER), NOW), null);
});

test("the installer's own area is left alone", () => {
  assert.equal(installerRedirect("/installs", cookie(INSTALLER), NOW), null);
  assert.equal(installerRedirect("/installs/42", cookie(INSTALLER), NOW), null);
});

test("API routes are never redirected", () => {
  assert.equal(installerRedirect("/api/orders", cookie(INSTALLER), NOW), null);
});

test("a missing or unreadable cookie lets the request pass", () => {
  assert.equal(installerRedirect("/installations", undefined, NOW), null);
  assert.equal(installerRedirect("/installations", "garbage", NOW), null);
  // Legacy unsigned cookie: no longer decodable, must not crash.
  assert.equal(installerRedirect("/installations", '{"user":{"groups":[]}}', NOW), null);
});

test("isOnlyInstaller is false when the installer also has another role", () => {
  assert.equal(isOnlyInstaller(deriveRole([...INSTALLER, ...MANAGER])), false);
  assert.equal(isOnlyInstaller(deriveRole(INSTALLER)), true);
});

// ---------------------------------------------------------------------
// Finding A, at the Edge routing layer: an expired payload must not be
// treated as a usable identity here either — same as a missing cookie.
// ---------------------------------------------------------------------

test("an expired cookie lets the request pass, same as a missing one (no redirect to /installs)", () => {
  const expired = cookie(INSTALLER, NOW - 1);
  assert.equal(installerRedirect("/installations", expired, NOW), null);
});

test("a cookie signed before exp existed (no exp field) is treated as expired here too", () => {
  const payload = {
    session: "s",
    user: { id: 1, login: "x", name: "X", partnerId: 1, isAdmin: false, groups: INSTALLER },
  };
  const legacy = `${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.sig`;
  assert.equal(installerRedirect("/installations", legacy, NOW), null);
});

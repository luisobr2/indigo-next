import test from "node:test";
import assert from "node:assert/strict";

import { installerRedirect, isOnlyInstaller } from "./installer-guard.ts";
import { deriveRole } from "./odoo/types.ts";

const INSTALLER = ["Indigo Decors / Installer (internal)"];
const MANAGER = ["Indigo Decors / Manager"];

/** Same encoding as signPayload, minus the signature (which Edge ignores). */
function cookie(groups: string[]): string {
  const payload = { session: "s", user: { id: 1, login: "x", name: "X", partnerId: 1, isAdmin: false, groups } };
  return `${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.sig`;
}

test("a pure installer is redirected to /installs from a management page", () => {
  assert.equal(installerRedirect("/installations", cookie(INSTALLER)), "/installs");
});

test("a manager is never redirected", () => {
  assert.equal(installerRedirect("/installations", cookie(MANAGER)), null);
});

test("the installer's own area is left alone", () => {
  assert.equal(installerRedirect("/installs", cookie(INSTALLER)), null);
  assert.equal(installerRedirect("/installs/42", cookie(INSTALLER)), null);
});

test("API routes are never redirected", () => {
  assert.equal(installerRedirect("/api/orders", cookie(INSTALLER)), null);
});

test("a missing or unreadable cookie lets the request pass", () => {
  assert.equal(installerRedirect("/installations", undefined), null);
  assert.equal(installerRedirect("/installations", "garbage"), null);
  // Legacy unsigned cookie: no longer decodable, must not crash.
  assert.equal(installerRedirect("/installations", '{"user":{"groups":[]}}'), null);
});

test("isOnlyInstaller is false when the installer also has another role", () => {
  assert.equal(isOnlyInstaller(deriveRole([...INSTALLER, ...MANAGER])), false);
  assert.equal(isOnlyInstaller(deriveRole(INSTALLER)), true);
});

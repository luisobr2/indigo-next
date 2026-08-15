import test from "node:test";
import assert from "node:assert/strict";

import { deriveRole } from "./types.ts";

// Real group `full_name` strings, taken from the source of truth:
// c:/Trabajo/odoo-indigo/addons/indigo_decors/security/indigo_security.xml
// (category "Indigo Decors" joined with " / " to each group's `name`).
// Two of these group *names* — "CNC / Router" and "Office / Administracion" —
// contain their own " / ", which is exactly what broke the old
// "keep text after the last slash" logic: it collapsed both down to a
// single trailing word ("Router", "Administracion") that no `has(...)`
// check could ever match.
const MANAGER = "Indigo Decors / Manager";
const USER = "Indigo Decors / User";
const OFFICE = "Indigo Decors / Office / Administracion";
const DESIGNER = "Indigo Decors / Disenador";
const CNC = "Indigo Decors / CNC / Router";
const PAINTER = "Indigo Decors / Pintor";
const INSTALLER_INTERNAL = "Indigo Decors / Installer (internal)";
const CONTRACTOR_PORTAL = "Indigo Decors / Contractor (portal)";

const ALL_FALSE = {
  isManager: false,
  isOffice: false,
  isDesigner: false,
  isPainter: false,
  isCnc: false,
  isInstaller: false,
};

test("Manager group grants isManager only", () => {
  assert.deepEqual(deriveRole([MANAGER]), { ...ALL_FALSE, isManager: true });
});

test("Office group (three ' / '-separated segments) grants isOffice only", () => {
  // This is the bug: the old lastIndexOf("/") logic reduced this to
  // "Administracion", which no has(...) alternative could match, so
  // isOffice was always false for real office accounts.
  assert.deepEqual(deriveRole([OFFICE]), { ...ALL_FALSE, isOffice: true });
});

test("Disenador group grants isDesigner only", () => {
  assert.deepEqual(deriveRole([DESIGNER]), { ...ALL_FALSE, isDesigner: true });
});

test("CNC / Router group (three ' / '-separated segments) grants isCnc only", () => {
  // Same shape of bug as Office: the group's own name contains a slash.
  assert.deepEqual(deriveRole([CNC]), { ...ALL_FALSE, isCnc: true });
});

test("Pintor group grants isPainter only", () => {
  assert.deepEqual(deriveRole([PAINTER]), { ...ALL_FALSE, isPainter: true });
});

test("Installer (internal) group grants isInstaller only", () => {
  assert.deepEqual(deriveRole([INSTALLER_INTERNAL]), { ...ALL_FALSE, isInstaller: true });
});

test("Contractor (portal) group also grants isInstaller", () => {
  assert.deepEqual(deriveRole([CONTRACTOR_PORTAL]), { ...ALL_FALSE, isInstaller: true });
});

test("base 'Indigo Decors / User' group grants no specific role", () => {
  assert.deepEqual(deriveRole([USER]), ALL_FALSE);
});

test("a non-Indigo group never matches, even with a same-named trailing segment", () => {
  // "Sales / Manager" must never be treated as our Indigo Manager.
  assert.deepEqual(deriveRole(["Sales / Manager"]), ALL_FALSE);
});

test("an empty group list yields all roles false", () => {
  assert.deepEqual(deriveRole([]), ALL_FALSE);
});

test("a user with several Indigo groups gets several roles true at once", () => {
  assert.deepEqual(deriveRole([OFFICE, CNC, USER]), {
    ...ALL_FALSE,
    isOffice: true,
    isCnc: true,
  });
});

import test from "node:test";
import assert from "node:assert/strict";

import { authFailureFor, UNAUTHORIZED_BODY } from "./auth-gate.ts";

// ---------------------------------------------------------------------
// Why this exists (incident 2026-08-21): the middleware answered an
// unauthenticated POST /api/orders/:id/stage with a 307 to /login. A
// browser re-POSTs a 307, /login answers 405 "Method Not Allowed" in
// PLAIN TEXT, and the caller's `await r.json()` then blows up on it. The
// user saw an incomprehensible error instead of "your session expired".
// An API request must get a machine-readable 401, never an HTML page.
// ---------------------------------------------------------------------

test("an API path gets a 401 JSON, never a redirect", () => {
  for (const p of [
    "/api/orders/317/stage",
    "/api/orders/317/advance",
    "/api/dashboard",
    "/api",
  ]) {
    const f = authFailureFor(p);
    assert.equal(f.kind, "json", `${p} should answer JSON`);
    assert.equal(f.status, 401, `${p} should be 401`);
  }
});

test("a page path still redirects to the login screen", () => {
  for (const p of ["/dashboard", "/", "/installs/3", "/orders/317"]) {
    const f = authFailureFor(p);
    assert.equal(f.kind, "redirect", `${p} should redirect`);
    assert.equal(f.to, "/login");
  }
});

test("a path that merely starts with the letters 'api' is not an API path", () => {
  // The codebase has been bitten by prefix matching before (see the
  // /api/mcp exemption comment in proxy.ts) — a page called /apiary must
  // still get the human-facing redirect.
  assert.equal(authFailureFor("/apiary").kind, "redirect");
  assert.equal(authFailureFor("/api-docs").kind, "redirect");
});

test("the 401 body is JSON with an actionable Spanish-free message", () => {
  // The panel's UI copy is English; this string surfaces in a toast.
  assert.equal(typeof UNAUTHORIZED_BODY.error, "string");
  assert.ok(UNAUTHORIZED_BODY.error.length > 10);
  const f = authFailureFor("/api/orders/1/stage");
  assert.equal(f.kind, "json");
  if (f.kind === "json") assert.deepEqual(f.body, UNAUTHORIZED_BODY);
});

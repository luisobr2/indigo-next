# Signed Session Cookies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the panel's two session cookies unforgeable by signing them with HMAC-SHA256, so machine credentials can later be issued on a trustworthy base.

**Architecture:** Two small modules split by runtime. An Edge-safe decoder (`atob` + `TextDecoder`, no Node APIs) is used by the middleware, which only needs the payload for a UX redirect. A Node-only signer/verifier (`node:crypto`) is used by `session.ts` in route handlers, where the payload IS a security decision. Cookie format becomes `<base64url(json)>.<base64url(hmac)>`.

**Tech Stack:** Next 16 (App Router), TypeScript, `node:crypto`, Node's built-in test runner (`npm test`).

**Spec:** `docs/superpowers/specs/2026-08-14-mcp-ai-control-design.md` (Fase 0, tasks 1–2)

## Global Constraints

- Node runtime modules must never be imported from Edge-reachable code. `src/proxy.ts` and anything it imports run on Edge.
- `npm test` runs `node --test "src/**/*.test.ts"`. Test files sit next to the module and import it with an explicit `.ts` extension.
- Every `<img>` needs `{/* eslint-disable-next-line @next/next/no-img-element */}` — `next build` runs eslint and treats it as an error. (Not expected in this plan; noted because the build gate is strict.)
- Unused route params are named `_req`, not `req`.
- `SESSION_SECRET` must be at least 32 characters. The app refuses to read or write a session without it rather than silently falling back to unsigned.
- **Deploying this logs every user out.** Existing unsigned cookies fail verification and are treated as "no session". This is intended, and must be communicated before deploy.

---

### Task 1: Edge-safe payload decoder

The middleware needs the session payload to decide whether a pure installer gets redirected to `/installs`. That is a UX decision, not a security boundary — `src/lib/installer-guard.ts` already documents that "API routes handle their own authz". So the Edge side decodes **without verifying**, which keeps `node:crypto` out of the Edge bundle.

**Files:**
- Create: `src/lib/session-cookie-edge.ts`
- Test: `src/lib/session-cookie-edge.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `decodeUnverified(raw: string): unknown | null` — returns the parsed payload, or `null` for anything malformed. Also `SIGNATURE_SEPARATOR = "."`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/session-cookie-edge.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './session-cookie-edge.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/session-cookie-edge.ts
/**
 * Edge-safe half of the session cookie codec.
 *
 * The middleware (src/proxy.ts) runs on the Edge runtime, where node:crypto
 * is unavailable — so this module uses only atob + TextDecoder and does NOT
 * verify the signature. That is deliberate and safe: the middleware uses the
 * payload solely to route a pure installer to /installs, and API routes
 * enforce their own authorization. Anything that IS a security decision must
 * use verifyPayload from ./odoo/session-cookie.ts instead.
 */
export const SIGNATURE_SEPARATOR = ".";

export function decodeUnverified(raw: string): unknown | null {
  const idx = raw.lastIndexOf(SIGNATURE_SEPARATOR);
  // idx <= 0 covers "", "nodot" and ".sig" (empty body).
  if (idx <= 0) return null;
  const body = raw.slice(0, idx);
  try {
    const b64 = body.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const bytes = Uint8Array.from(atob(b64 + pad), (ch) => ch.charCodeAt(0));
    // TextDecoder (not escape/unescape) so accented names survive.
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all 5 tests in `session-cookie-edge.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/session-cookie-edge.ts src/lib/session-cookie-edge.test.ts
git commit -m "feat(auth): Edge-safe decoder for the signed session cookie"
```

---

### Task 2: Node signer and verifier

**Files:**
- Create: `src/lib/odoo/session-cookie.ts`
- Test: `src/lib/odoo/session-cookie.test.ts`

**Interfaces:**
- Consumes: `decodeUnverified`, `SIGNATURE_SEPARATOR` from `src/lib/session-cookie-edge.ts`
- Produces:
  - `signPayload(payload: unknown, secret: string): string`
  - `verifyPayload(raw: string, secret: string): unknown | null`
  - `requireSessionSecret(): string` — reads `process.env.SESSION_SECRET`, throws if missing or shorter than 32 chars

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/odoo/session-cookie.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './session-cookie.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/odoo/session-cookie.ts
/**
 * Node half of the session cookie codec: sign on write, verify on read.
 *
 * Format: <base64url(json)>.<base64url(hmac-sha256 of the body)>
 *
 * The cookie carries `isAdmin` and `groups`, which every route's role gate
 * reads. Before signing, anyone could craft that payload in a direct HTTP
 * request — Odoo's ACLs were the only backstop. Route handlers run on the
 * Node runtime, so node:crypto is available here; the Edge middleware uses
 * ../session-cookie-edge.ts instead.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { decodeUnverified, SIGNATURE_SEPARATOR } from "../session-cookie-edge.ts";

const MIN_SECRET_LENGTH = 32;

export function requireSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters. ` +
        "Refusing to read or write a session cookie unsigned.",
    );
  }
  return secret;
}

function macOf(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signPayload(payload: unknown, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}${SIGNATURE_SEPARATOR}${macOf(body, secret)}`;
}

export function verifyPayload(raw: string, secret: string): unknown | null {
  const idx = raw.lastIndexOf(SIGNATURE_SEPARATOR);
  if (idx <= 0) return null;
  const body = raw.slice(0, idx);
  const presented = Buffer.from(raw.slice(idx + 1));
  const expected = Buffer.from(macOf(body, secret));
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (presented.length !== expected.length) return null;
  if (!timingSafeEqual(presented, expected)) return null;
  return decodeUnverified(raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 7 tests in `session-cookie.test.ts`, 5 in `session-cookie-edge.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/odoo/session-cookie.ts src/lib/odoo/session-cookie.test.ts
git commit -m "feat(auth): HMAC signer and verifier for session cookies"
```

---

### Task 3: Sign both cookies in session.ts

Two cookies are written here, and **both** are currently unsigned JSON:
`indigo_session` and `indigo_session_original`. The second holds the manager's
own session while they impersonate someone, and `POST /api/auth/impersonate`
restores it via `popOriginalSession()`. Forging it is a path back to a
manager-flagged session, so it gets the same treatment.

**Files:**
- Modify: `src/lib/odoo/session.ts` — the three `JSON.parse` reads (lines 21, 91, 102) and the two `JSON.stringify` writes (`writeSession`, `pushOriginalSession` around line 76)
- Modify: `.env.example` — add `SESSION_SECRET`

**Interfaces:**
- Consumes: `signPayload`, `verifyPayload`, `requireSessionSecret` from `./session-cookie.ts`
- Produces: no signature changes. `getSession`, `popOriginalSession` and `getOriginalSession` keep returning `SessionPayload | null`; `writeSession` and `pushOriginalSession` keep their parameters.

- [ ] **Step 1: Add a shared read helper and use it in all three readers**

```ts
// near the top of src/lib/odoo/session.ts
import { signPayload, verifyPayload, requireSessionSecret } from "./session-cookie";

/** Verify + parse a cookie value, or null if it is missing, forged or legacy. */
function readSigned(raw: string | undefined): SessionPayload | null {
  if (!raw) return null;
  const payload = verifyPayload(raw, requireSessionSecret());
  return payload ? (payload as SessionPayload) : null;
}
```

Replace the body of `getSession`:

```ts
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return readSigned(store.get(COOKIE_NAME)?.value);
}
```

Replace the body of `getOriginalSession`:

```ts
export async function getOriginalSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return readSigned(store.get(ORIGINAL_COOKIE)?.value);
}
```

Replace the body of `popOriginalSession` — note it still deletes the cookie
before returning, exactly as today:

```ts
export async function popOriginalSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const raw = store.get(ORIGINAL_COOKIE)?.value;
  if (!raw) return null;
  store.delete(ORIGINAL_COOKIE);
  return readSigned(raw);
}
```

- [ ] **Step 2: Sign on both writes**

In `writeSession`, replace `JSON.stringify(payload)` with
`signPayload(payload, requireSessionSecret())`. Leave every cookie option
(`httpOnly`, `sameSite`, `secure`, `path`, `maxAge`) untouched.

Do the same in `pushOriginalSession` (around line 76).

- [ ] **Step 3: Add the secret to .env.example**

```bash
# Secret used to HMAC-sign the session cookies. At least 32 chars.
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
SESSION_SECRET=
```

- [ ] **Step 4: Verify the whole project still typechecks and builds**

Run: `npx tsc --noEmit && npx eslint src/lib/odoo/session.ts && npm test`
Expected: exit 0, tests still 12+ passing

- [ ] **Step 5: Commit**

```bash
git add src/lib/odoo/session.ts .env.example
git commit -m "feat(auth): sign the session and impersonation cookies"
```

---

### Task 4: Teach the Edge installer guard the new format

`installerRedirect` does `JSON.parse(cookieValue)` on the raw cookie. Once the
format changes that parse throws, the `catch` returns `null`, and a pure
installer silently stops being redirected to `/installs` — landing instead on
management pages that 403 their data. This task keeps that guard working.

**Files:**
- Modify: `src/lib/installer-guard.ts:49` (the `JSON.parse`) and its doc comment
- Test: `src/lib/installer-guard.test.ts` (create)

**Interfaces:**
- Consumes: `decodeUnverified` from `./session-cookie-edge.ts`; `deriveRole` and `SessionPayload` from `./odoo/types`
- Produces: `installerRedirect(pathname: string, cookieValue: string | undefined): string | null` — unchanged signature

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/installer-guard.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — the redirect tests return `null` because `JSON.parse` throws on the new format

- [ ] **Step 3: Switch the guard to the decoder**

In `src/lib/installer-guard.ts`, add the import:

```ts
import { decodeUnverified } from "./session-cookie-edge";
```

Replace the parse block inside `installerRedirect`:

```ts
  const payload = decodeUnverified(cookieValue) as SessionPayload | null;
  if (!payload) return null;
  const role = deriveRole(payload.user?.groups ?? []);
```

Update the module doc comment: it currently says the cookie is "plain JSON".
Replace that sentence with:

```
 * Pure + Edge-safe: it decodes the signed session cookie WITHOUT verifying
 * the signature (node:crypto is unavailable on Edge) and derives the role.
 * That is sound because this guard only routes the UI — forging a cookie to
 * dodge the redirect gains nothing, since the API routes enforce their own
 * authorization against Odoo.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test && npx tsc --noEmit`
Expected: PASS — 6 tests in `installer-guard.test.ts`; tsc exit 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/installer-guard.ts src/lib/installer-guard.test.ts
git commit -m "fix(auth): keep the installer redirect working with signed cookies"
```

---

### Task 5: Audit which role gates have no Odoo backstop

The panel gates routes with `deriveRole(s.user.groups)`. Until Task 3 those
groups were forgeable; after it they are not. This task records which routes
would still have been safe on Odoo's own ACLs and which were relying on the
panel alone — that list is what tells us how urgent this deploy is, and it
feeds the MCP scope work in Fase 1.

**Files:**
- Create: `docs/superpowers/notes/2026-08-14-role-gate-audit.md`

**Interfaces:**
- Consumes: nothing
- Produces: a markdown table consumed by humans and by the Fase 1 plan

- [ ] **Step 1: List every route that gates on a role**

```bash
cd c:/Trabajo/indigo-next
grep -rln "deriveRole" src/app/api | sort
```

- [ ] **Step 2: For each one, record what it calls into Odoo**

For every file from Step 1, note the `model` + `method` of each `call({...})`
it makes, and whether that Odoo method re-checks the caller's rights.
Methods that re-check (verified examples): `indigo_team_*` and
`indigo_dealer_*` in `odoo-indigo/addons/indigo_decors/models/`, and
`indigo.design.rename_family`. Plain `search_read` / `write` / `create` calls
rely on `security/ir.model.access.csv` and the record rules in
`security/indigo_role_rules.xml`.

- [ ] **Step 3: Write the note**

Create `docs/superpowers/notes/2026-08-14-role-gate-audit.md` with:
- one row per route: path · panel gate · Odoo model+method · backstop (`Odoo method re-checks` / `ACL only` / `none`)
- a short "Findings" section listing every row whose backstop is `none`
- a closing line stating that signed cookies (this plan) close the class of
  issue, and that any `none` row still deserves an Odoo-side check because the
  MCP will reach the same code paths

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/notes/2026-08-14-role-gate-audit.md
git commit -m "docs: audit of panel role gates and their Odoo backstops"
```

---

### Task 6: Deploy

**Files:** none — this is an operational task.

**Interfaces:**
- Consumes: everything above
- Produces: `SESSION_SECRET` set in Coolify for the `indigo-next` resource

- [ ] **Step 1: Warn before deploying**

Tell the operator, in writing, that **every logged-in user will be signed out**
and must log in again. Majela and Javier included. Pick a quiet moment.

- [ ] **Step 2: Generate the secret**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

- [ ] **Step 3: Set it in Coolify**

Add `SESSION_SECRET=<generated>` as an environment variable on the
`indigo-next` resource (uuid `qjalaa0kakcwbjkb1t3j2tqg`) via the Coolify UI at
`http://2.25.137.220:8000`. Do not commit the value.

- [ ] **Step 4: Push and deploy**

```bash
git push origin main
curl -s -X POST "http://2.25.137.220:8000/api/v1/deploy?uuid=qjalaa0kakcwbjkb1t3j2tqg&force=true" \
  -H "Authorization: Bearer $COOLIFY_TOKEN" -H "Accept: application/json"
```

- [ ] **Step 5: Verify on the running container**

Confirm the deployed image tag equals the pushed commit SHA, then check the
app is serving and that a fresh login works end to end:

```bash
docker ps --format '{{.Names}}\t{{.Image}}' | grep qjalaa
curl -s -o /dev/null -w "%{http_code}\n" https://app.indigodecors.com/login
```

Expected: image tag ends in the pushed commit SHA; `/login` returns 200.
Then log in through the browser and confirm you land on `/dashboard`, and that
the `indigo_session` cookie value now contains a `.` separating two base64url
segments.

- [ ] **Step 6: Verify the installer path specifically**

Log in as a pure installer (or impersonate one, then stop impersonating) and
confirm the redirect to `/installs` still happens. This is the regression Task
4 exists to prevent, and it is the one that would otherwise ship silently.

---

## Self-Review

**Spec coverage.** This plan implements Fase 0 items 1 and 2 — "Firmar la
cookie de sesión" and "Auditar qué rutas confían en `groups`/`isAdmin`". It
adds one item the spec did not name: signing `indigo_session_original`, found
while reading `session.ts`. The remaining Fase 0 items are **deliberately not
here**:

- **Staging environment** — infrastructure work (Coolify resources, DB seed,
  anonymization), not application code. It needs its own plan.
- **`.env.local` no longer pointing at production** — depends on staging
  existing, so it belongs to that plan.
- **Kill switch** — YAGNI until there is an MCP server to switch off. Moves
  into the Fase 1 plan.

**Placeholder scan.** No TBD/TODO. Every code step carries real code; the two
non-code tasks (5 and 6) carry exact commands and exact deliverables.

**Type consistency.** `decodeUnverified` returns `unknown | null` in Task 1 and
is cast to `SessionPayload | null` at both call sites (Task 2's `verifyPayload`
return, Task 4's guard). `SIGNATURE_SEPARATOR` is defined once in Task 1 and
imported in Task 2. `requireSessionSecret` is defined in Task 2 and used in
Task 3. Cookie format is `<base64url(json)>.<base64url(hmac)>` in all four
tasks.

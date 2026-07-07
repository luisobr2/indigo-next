# Dealer Portal Password — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager/office set a dealer's portal password directly from the Next.js admin dealer page, creating the portal account on the fly if it doesn't exist.

**Architecture:** New Odoo `res.partner` methods (`indigo_dealer_portal_info`, `indigo_dealer_set_password`) do the privileged work via `sudo()` after a manager/office guard, mirroring the existing `indigo_team_*` pattern. The Next.js BFF exposes them through the dealer GET (status) and a new `PUT .../portal` route (set password). The dealer detail page gains an "Acceso portal" card.

**Tech Stack:** Odoo 17 (Python), Next.js 16 (App Router, TypeScript), react-query, sonner.

## Global Constraints

- Password minimum length: **6 characters** (enforced in Odoo, mirrored in UI).
- Access to set/read dealer password is gated to **manager + office** (or system admin), matching `PUT /api/catalog/dealers/[id]`.
- Dealer portal login is always the dealer's `email`; a dealer with no email cannot get portal access.
- No JS test framework exists in `indigo-next` — Next.js tasks are gated by `npx tsc --noEmit` + `npx eslint` (both must pass) plus a described manual drive. Odoo task uses the real Odoo test runner (`TransactionCase`).
- Two repos: Odoo code in `c:\Trabajo\odoo-indigo`, Next.js code in `c:\Trabajo\indigo-next`. Commit in the repo whose files a task touches.

---

### Task 1: Odoo — dealer portal methods + tests

**Files:**
- Modify: `c:\Trabajo\odoo-indigo\addons\indigo_decors\models\indigo_dealer.py`
- Create: `c:\Trabajo\odoo-indigo\addons\indigo_decors\tests\test_indigo_dealer_portal.py`
- Modify: `c:\Trabajo\odoo-indigo\addons\indigo_decors\tests\__init__.py`

**Interfaces:**
- Produces (called by Task 2 via JSON-RPC on model `res.partner`):
  - `indigo_dealer_portal_info(partner_id: int) -> {"has_user": bool, "login": str|False, "active": bool}`
  - `indigo_dealer_set_password(partner_id: int, password: str) -> {"ok": True, "login": str, "created": bool}`

- [ ] **Step 1: Register the new test module**

In `tests/__init__.py`, add the import (keep existing imports):

```python
from . import test_indigo_dealer_portal
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_indigo_dealer_portal.py`:

```python
# -*- coding: utf-8 -*-
from odoo.tests import TransactionCase, tagged
from odoo.exceptions import ValidationError


@tagged("indigo", "indigo_dealer_portal", "post_install", "-at_install")
class TestIndigoDealerPortal(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.Partner = cls.env["res.partner"]
        cls.Users = cls.env["res.users"]

    def test_set_password_creates_portal_user(self):
        dealer = self.Partner.create({
            "name": "Portal Dealer",
            "is_indigo_dealer": True,
            "email": "portaldealer@test.example",
        })
        res = self.env["res.partner"].indigo_dealer_set_password(dealer.id, "secret123")
        self.assertTrue(res["ok"])
        self.assertTrue(res["created"])
        self.assertEqual(res["login"], "portaldealer@test.example")
        user = self.Users.with_context(active_test=False).search(
            [("partner_id", "=", dealer.id)], limit=1
        )
        self.assertTrue(user, "portal user should be created")
        self.assertTrue(user.has_group("base.group_portal"))
        self.assertTrue(user.active)

    def test_set_password_idempotent_second_call_updates(self):
        dealer = self.Partner.create({
            "name": "Portal Dealer 2",
            "email": "portaldealer2@test.example",
        })
        self.env["res.partner"].indigo_dealer_set_password(dealer.id, "secret123")
        res2 = self.env["res.partner"].indigo_dealer_set_password(dealer.id, "newpass456")
        self.assertFalse(res2["created"], "second call must reuse the existing user")
        users = self.Users.with_context(active_test=False).search(
            [("partner_id", "=", dealer.id)]
        )
        self.assertEqual(len(users), 1, "must not create a duplicate user")

    def test_set_password_requires_email(self):
        dealer = self.Partner.create({"name": "No Email Dealer"})
        with self.assertRaises(ValidationError):
            self.env["res.partner"].indigo_dealer_set_password(dealer.id, "secret123")

    def test_set_password_min_length(self):
        dealer = self.Partner.create({
            "name": "Short Pw Dealer",
            "email": "shortpw@test.example",
        })
        with self.assertRaises(ValidationError):
            self.env["res.partner"].indigo_dealer_set_password(dealer.id, "123")

    def test_portal_info_reports_status(self):
        dealer = self.Partner.create({
            "name": "Info Dealer",
            "email": "infodealer@test.example",
        })
        before = self.env["res.partner"].indigo_dealer_portal_info(dealer.id)
        self.assertFalse(before["has_user"])
        self.env["res.partner"].indigo_dealer_set_password(dealer.id, "secret123")
        after = self.env["res.partner"].indigo_dealer_portal_info(dealer.id)
        self.assertTrue(after["has_user"])
        self.assertEqual(after["login"], "infodealer@test.example")
        self.assertTrue(after["active"])
```

- [ ] **Step 3: Run the test to verify it fails**

Run (local dev Odoo docker is already up: containers `indigo-odoo` + `indigo-db`,
DB is **`indigo-prod`**). Flags matter: `MSYS_NO_PATHCONV=1` (Git Bash mangles
the `/etc/...` path), `--no-http` (the running server already holds port 8069),
`-u indigo_decors` (syncs the DB schema to the bind-mounted code):

```bash
cd c:/Trabajo/odoo-indigo
MSYS_NO_PATHCONV=1 docker exec indigo-odoo odoo -c /etc/odoo/odoo.conf \
  -d indigo-prod -u indigo_decors --no-http --test-enable \
  --test-tags /indigo_decors:TestIndigoDealerPortal --stop-after-init 2>&1 | \
  grep -iE "TestIndigoDealerPortal|[0-9]+ failed|error\(s\)|Initiating shutdown"
```

Expected: FAIL/ERROR — `AttributeError: 'res.partner' object has no attribute 'indigo_dealer_set_password'` (shows as `1 failed` or `error(s)`).

- [ ] **Step 4: Implement the methods**

In `models/indigo_dealer.py`, update the imports at the top of the file:

```python
# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, ValidationError, UserError
```

Remove the now-redundant inline `from odoo.exceptions import UserError` inside
`action_indigo_create_portal_user` (it's imported at module level now).

Add these methods to the `ResPartner` class (after `action_indigo_create_portal_user`):

```python
    # ---- Dealer portal access (called from the Next.js admin) ------------
    def _indigo_assert_dealer_admin(self):
        u = self.env.user
        if not (
            u._is_admin()
            or u.has_group("indigo_decors.group_indigo_manager")
            or u.has_group("indigo_decors.group_indigo_office")
        ):
            raise AccessError(
                _("Only Indigo managers or office can manage dealer access.")
            )

    @api.model
    def indigo_dealer_portal_info(self, partner_id):
        """Portal-access status for a dealer partner (for the Next.js admin)."""
        self._indigo_assert_dealer_admin()
        partner = self.sudo().browse(int(partner_id))
        if not partner.exists():
            raise ValidationError(_("Dealer not found."))
        user = (
            self.env["res.users"]
            .sudo()
            .with_context(active_test=False)
            .search([("partner_id", "=", partner.id)], limit=1)
        )
        return {
            "has_user": bool(user),
            "login": user.login if user else False,
            "active": bool(user.active) if user else False,
        }

    @api.model
    def indigo_dealer_set_password(self, partner_id, password):
        """Create the dealer's portal user if missing, then set its password."""
        self._indigo_assert_dealer_admin()
        password = (password or "").strip()
        if len(password) < 6:
            raise ValidationError(_("Password must be at least 6 characters."))
        partner = self.sudo().browse(int(partner_id))
        if not partner.exists():
            raise ValidationError(_("Dealer not found."))
        if not partner.email:
            raise ValidationError(
                _("The dealer needs an email before portal access can be created.")
            )
        Users = self.env["res.users"].sudo().with_context(active_test=False)
        user = Users.search([("partner_id", "=", partner.id)], limit=1)
        created = False
        if not user:
            clash = Users.search([("login", "=", partner.email)], limit=1)
            if clash:
                raise ValidationError(
                    _("A different user already exists with login %s.") % partner.email
                )
            portal = self.env.ref("base.group_portal")
            user = Users.with_context(no_reset_password=True).create({
                "name": partner.name,
                "login": partner.email,
                "partner_id": partner.id,
                "groups_id": [(6, 0, [portal.id])],
            })
            created = True
        user.write({"password": password, "active": True})
        return {"ok": True, "login": user.login, "created": created}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd c:/Trabajo/odoo-indigo
MSYS_NO_PATHCONV=1 docker exec indigo-odoo odoo -c /etc/odoo/odoo.conf \
  -d indigo-prod -u indigo_decors --no-http --test-enable \
  --test-tags /indigo_decors:TestIndigoDealerPortal --stop-after-init 2>&1 | \
  grep -iE "TestIndigoDealerPortal|[0-9]+ failed|error\(s\)|Initiating shutdown"
```

Expected: PASS — `0 failed, 0 error(s) of 5 tests`.
Then restart the live server so port-8069 Odoo picks up the new methods (needed
for Tasks 2-3 manual drives): `docker restart indigo-odoo`.

- [ ] **Step 6: Commit**

```bash
cd c:/Trabajo/odoo-indigo
git checkout -b feat/dealer-portal-password
git add addons/indigo_decors/models/indigo_dealer.py \
        addons/indigo_decors/tests/test_indigo_dealer_portal.py \
        addons/indigo_decors/tests/__init__.py
git commit -m "feat(dealer): set/create portal password from admin

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Next.js — dealer portal API (GET status + PUT set password)

**Files:**
- Modify: `c:\Trabajo\indigo-next\src\app\api\catalog\dealers\[id]\route.ts`
- Create: `c:\Trabajo\indigo-next\src\app\api\catalog\dealers\[id]\portal\route.ts`

**Interfaces:**
- Consumes (Task 1, JSON-RPC on `res.partner`): `indigo_dealer_portal_info(id)`, `indigo_dealer_set_password(id, password)`.
- Produces (used by Task 3):
  - `GET /api/catalog/dealers/[id]` response gains `portal: { has_user: boolean; login: string|false; active: boolean } | null`.
  - `PUT /api/catalog/dealers/[id]/portal` body `{ password: string }` → `{ ok: boolean; login: string; created: boolean }` or `{ error: string }`.

- [ ] **Step 1: Extend the dealer GET to include portal status**

In `src/app/api/catalog/dealers/[id]/route.ts`, inside `GET`, replace the final
`return NextResponse.json({ dealer: records[0], orders });` with:

```ts
    // Portal-access status — only for users who can manage it (managers/office).
    // Fetching it for others would trip the Odoo guard and 500 the whole page.
    const role = deriveRole(s.user.groups);
    let portal:
      | { has_user: boolean; login: string | false; active: boolean }
      | null = null;
    if (role.isManager || role.isOffice || s.user.isAdmin) {
      portal = await call<{
        has_user: boolean;
        login: string | false;
        active: boolean;
      }>({
        session: s.session,
        model: "res.partner",
        method: "indigo_dealer_portal_info",
        args: [id],
        kwargs: {},
      });
    }

    return NextResponse.json({ dealer: records[0], orders, portal });
```

(`deriveRole` and `call` are already imported in this file.)

- [ ] **Step 2: Create the PUT portal route**

Create `src/app/api/catalog/dealers/[id]/portal/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { call } from "@/lib/odoo/client";
import { requireSession } from "@/lib/odoo/session";
import { deriveRole } from "@/lib/odoo/types";

export const runtime = "nodejs";

/**
 * PUT /api/catalog/dealers/[id]/portal
 * Body: { password: string }
 *
 * Sets the dealer's portal password, creating the portal user (login = email)
 * if it doesn't exist yet. Manager/office only.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const s = await requireSession();
    const role = deriveRole(s.user.groups);
    if (!role.isManager && !role.isOffice && !s.user.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = (await req.json()) as { password?: string };
    const password = (body.password ?? "").trim();
    if (!password) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    const res = await call<{ ok: boolean; login: string; created: boolean }>({
      session: s.session,
      model: "res.partner",
      method: "indigo_dealer_set_password",
      args: [id, password],
      kwargs: {},
    });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Typecheck + lint**

```bash
cd c:/Trabajo/indigo-next
npx tsc --noEmit
npx eslint "src/app/api/catalog/dealers/[id]/route.ts" "src/app/api/catalog/dealers/[id]/portal/route.ts"
```

Expected: both exit 0 (no output).

- [ ] **Step 4: Manual drive (real Odoo session required)**

With the dev server running (`npm run dev`) and logged in as a manager in the
browser, copy the `indigo_session` cookie and run (replace `<COOKIE>` and a real
dealer id `<ID>`):

```bash
curl -s -X PUT --cookie "indigo_session=<COOKIE>" \
  -H "Content-Type: application/json" \
  -d '{"password":"testpass123"}' \
  "http://localhost:4000/api/catalog/dealers/<ID>/portal"
```

Expected: JSON `{"ok":true,"login":"<dealer-email>","created":true|false}`.
Then `GET /api/catalog/dealers/<ID>` should include `"portal":{"has_user":true,...}`.

- [ ] **Step 5: Commit**

```bash
cd c:/Trabajo/indigo-next
git checkout -b feat/dealer-portal-password
git add "src/app/api/catalog/dealers/[id]/route.ts" "src/app/api/catalog/dealers/[id]/portal/route.ts"
git commit -m "feat(dealers): portal status in GET + PUT set-password route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Next.js — "Acceso portal" card on the dealer page

**Files:**
- Modify: `c:\Trabajo\indigo-next\src\app\(app)\catalog\dealers\[id]\page.tsx`

**Interfaces:**
- Consumes (Task 2): `data.portal` shape and `PUT /api/catalog/dealers/[id]/portal`.

- [ ] **Step 1: Add the icons to the existing import**

In `page.tsx`, change the lucide import line to add `KeyRound, Eye, EyeOff`:

```ts
import { ArrowLeft, Building2, Mail, Phone, MapPin, Save, KeyRound, Eye, EyeOff } from "lucide-react";
```

- [ ] **Step 2: Type the query response with `portal`**

Update the `useQuery` generic and the `fetchJson` generic (both occurrences)
from `{ dealer: DealerDto; orders: DealerOrder[] }` to include portal:

```ts
  const { data, isLoading, isError, error, refetch } = useQuery<{
    dealer: DealerDto;
    orders: DealerOrder[];
    portal: { has_user: boolean; login: string | false; active: boolean } | null;
  }>({
    queryKey: ["dealer", idStr],
    queryFn: () =>
      fetchJson<{
        dealer: DealerDto;
        orders: DealerOrder[];
        portal: { has_user: boolean; login: string | false; active: boolean } | null;
      }>(`/api/catalog/dealers/${id}`),
    enabled: !isNew,
    retry: 1,
  });
```

- [ ] **Step 3: Add portal state + handler**

After the existing `const [busy, setBusy] = useState(false);` line, add:

```ts
  const [portalPw, setPortalPw] = useState("");
  const [showPortalPw, setShowPortalPw] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);

  async function setDealerPassword() {
    const pw = portalPw.trim();
    if (pw.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    setPortalBusy(true);
    const promise = fetch(`/api/catalog/dealers/${id}/portal`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    })
      .then(async (r) => {
        const j = (await r.json()) as {
          ok?: boolean;
          login?: string;
          created?: boolean;
          error?: string;
        };
        if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo fijar la contraseña");
        setPortalPw("");
        qc.invalidateQueries({ queryKey: ["dealer", idStr] });
        return j;
      })
      .finally(() => setPortalBusy(false));

    toast.promise(promise, {
      loading: "Fijando contraseña…",
      success: (j) =>
        j.created
          ? `Acceso creado — login: ${j.login}`
          : `Contraseña fijada — login: ${j.login}`,
      error: (e) => (e instanceof Error ? e.message : "Falló"),
    });
  }
```

- [ ] **Step 4: Render the card**

In the JSX, immediately after the closing `</section>` of the "Recent orders"
block (the `{!isNew && data && ( <section> ... </section> )}` for orders) and
still inside the `grid` div, add:

```tsx
        {!isNew && data && (
          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="mb-1 font-semibold text-slate-800">Acceso portal</h2>
            <p className="mb-4 text-xs text-slate-500">
              {data.portal?.has_user ? (
                <>
                  Acceso {data.portal.active ? "activo" : "inactivo"} · login:{" "}
                  <span className="font-mono">{data.portal.login}</span>
                </>
              ) : data.dealer.email ? (
                <>
                  Sin acceso — al fijar la clave se creará con login{" "}
                  <span className="font-mono">{data.dealer.email as string}</span>
                </>
              ) : (
                "Sin acceso — agregá un email y guardá antes de fijar la clave."
              )}
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-sm">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <KeyRound size={12} /> Nueva contraseña
                </span>
                <div className="relative">
                  <Input
                    type={showPortalPw ? "text" : "password"}
                    value={portalPw}
                    onChange={(e) => setPortalPw(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    disabled={!data.dealer.email}
                    className="h-10 w-64 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPortalPw((v) => !v)}
                    aria-label={showPortalPw ? "Ocultar" : "Ver"}
                    tabIndex={-1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    {showPortalPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
              <Button
                type="button"
                onClick={setDealerPassword}
                disabled={portalBusy || !data.dealer.email || portalPw.trim().length < 6}
              >
                <KeyRound size={14} />
                {portalBusy ? "Guardando…" : "Fijar contraseña"}
              </Button>
            </div>
            {!data.dealer.email && (
              <p className="mt-2 text-xs text-amber-700">
                Agregá un email primero y guardá.
              </p>
            )}
          </section>
        )}
```

- [ ] **Step 5: Typecheck + lint**

```bash
cd c:/Trabajo/indigo-next
npx tsc --noEmit
npx eslint "src/app/(app)/catalog/dealers/[id]/page.tsx"
```

Expected: both exit 0.

- [ ] **Step 6: Manual drive**

`npm run dev`, log in as a manager, open a dealer at `/catalog/dealers/<id>`.
Verify: the "Acceso portal" card shows; typing a 6+ char password and clicking
"Fijar contraseña" shows the success toast with the login; reload shows
"Acceso activo · login: …". Then log out and log in at `/login` as that dealer
(email + the password you set) → lands on the dealer portal.

- [ ] **Step 7: Commit**

```bash
cd c:/Trabajo/indigo-next
git add "src/app/(app)/catalog/dealers/[id]/page.tsx"
git commit -m "feat(dealers): 'Acceso portal' card to set dealer password

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Deployment notes (after merge)

- **Odoo** (`odoo-indigo`): push, deploy via Coolify, then upgrade the module and
  restart so the new Python methods load:
  `docker exec <odoo-container> odoo -c /etc/odoo/odoo.conf -d indigo-prod -u indigo_decors --stop-after-init`
  then `docker restart <odoo-container>` (per repo CLAUDE.md deploy workflow).
- **Next.js** (`indigo-next`): deploy via its normal pipeline. No env changes.
- Order matters: deploy Odoo first (the API calls the new methods); a stale Odoo
  would 500 the `PUT .../portal` and the dealer GET's portal fetch.

## Self-review notes

- **Spec coverage:** Odoo methods (Task 1) ✓, GET status + PUT route (Task 2) ✓,
  UI card with create-on-set + email guard (Task 3) ✓, manager+office gating
  (Tasks 1–2) ✓, min-6 password (Tasks 1 & 3) ✓, edge cases email/collision/
  archived-reactivate (Task 1 code + tests) ✓.
- **Method names** consistent across tasks: `indigo_dealer_set_password`,
  `indigo_dealer_portal_info`; return keys `ok`/`login`/`created`/`has_user`/
  `active` used identically in Odoo, API, and UI.

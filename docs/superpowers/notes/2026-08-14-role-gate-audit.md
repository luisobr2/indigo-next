# Role-gate audit: which panel checks have an Odoo backstop

Date: 2026-08-14
Scope: every route file under `src/app/api/**/route.ts` that imports
`deriveRole` (`grep -rln "deriveRole" src/app/api`, 42 files). For each
gated HTTP handler, this records the Odoo `model`/`method` the handler
calls into and whether Odoo itself would have refused the action for a
caller whose *real* Odoo groups don't match what the panel gate checks.

## How the panel talks to Odoo (context for every row below)

`src/lib/odoo/client.ts` forwards the **real, logged-in Odoo session
cookie** on every `call()` — it does not use a service/admin account. So
`ACL only` rows are a genuine check against the actual caller's Odoo
groups, not a rubber stamp. The three backstop categories:

- **Odoo method re-checks** — the method itself verifies the caller's
  Indigo role (`_indigo_assert_manager`, `_indigo_assert_dealer_admin`,
  the inline check in `indigo.design.rename_family`) and raises
  `AccessError` before doing anything. A forged panel role gains
  nothing.
- **ACL only** — a plain `search_read`/`read`/`write`/`create`/`unlink`
  gated by whatever `security/ir.model.access.csv` (indigo_decors) or
  Odoo's own base-module CSV, plus `security/indigo_role_rules.xml` /
  `indigo_portal_rules.xml`, grant the caller's actual groups. Real
  protection, but only as strict as that row.
- **none** — nothing server-side would have stopped a forged panel
  role: either the call runs under `sudo()` (bypasses ACL *and* record
  rules), or the ACL is provably broader than what the panel gate
  implies.

Two ACL facts below are load-bearing and were verified against the
actual Odoo 17.0 source (`odoo/odoo` GitHub, branch `17.0`,
`odoo/addons/base/security/ir.model.access.csv` and
`addons/product/security/ir.model.access.csv`), not assumed:

- `res.partner` write/create requires `base.group_partner_manager`.
  `group_indigo_manager` and `group_indigo_office` both imply it
  (`security/indigo_security.xml`); the other Indigo role groups do
  not. So dealer writes are genuinely manager/office-only.
- `res.users` write/create requires `base.group_erp_manager`
  (Settings/Technical admin), which **no** `indigo_decors` group
  implies — not even Manager. `product.template` write/create requires
  `base.group_system` or `sales_team.group_sale_manager`, likewise not
  implied by any Indigo group. See the Findings note on both.

Also load-bearing: `security/ir.model.access.csv` grants
`group_indigo_user` (the base group every Indigo role — Designer, CNC,
Painter, Office, Installer-internal, Manager — implies) **write=1** on
both `indigo.order` and `indigo.order.line`, while `create`/`unlink`
stay manager/office-only. Combined with the record rules in
`indigo_role_rules.xml` (which scope by the order's *current*
`stage_id.code`, evaluated before the write — not by the new values
being written), this means any internal employee can already write
arbitrary fields — including `stage_id` itself — on any order sitting
in their own stage-visible slice, regardless of what the panel's role
gate says. That single ACL fact is why most `indigo.order`
write-only routes below are `none`.

## Table

One row per gated HTTP handler (method + path). Handlers in a matched
file that carry no role check at all are listed too, marked
"not gated", so the table matches the Step 1 grep 1:1.

| Route | Panel gate | Odoo model + method | Backstop |
|---|---|---|---|
| GET /api/admin/users | Manager/Admin | `res.users.indigo_team_list` | Odoo method re-checks |
| POST /api/admin/users | Manager/Admin | `res.users.indigo_team_create` | Odoo method re-checks |
| PUT /api/admin/users/[id] | Manager/Admin | `res.users.indigo_team_update` / `indigo_team_reset_password` / `indigo_team_set_active` | Odoo method re-checks |
| POST /api/auth/impersonate | Manager/Admin | Odoo controller `/indigo/impersonate` (not a model `call()` — a JSON controller, `auth="user"`) | Odoo method re-checks (controller re-verifies manager/admin, `controllers/impersonate.py`) |
| DELETE /api/auth/impersonate | none (any session) | no Odoo call — restores a stashed cookie locally | N/A — no Odoo call is made |
| GET /api/auth/me | not gated — `deriveRole` only shapes the response body, no 403 branch | none | N/A |
| POST /api/billing/settle (mode=mark-paid) | Manager/Office/Admin | `indigo.payout.write` via `action_mark_paid` | ACL only — `indigo.payout`: `group_indigo_user` r1w0c0u0, **no office row**, `group_indigo_manager` r1w1c1u1. Real backstop, and stricter than the panel gate (Office is allowed by the panel but has no write ACL here) |
| POST /api/billing/settle (mode=consolidate) | Manager/Office/Admin | `indigo.payout.settle.wizard.create` + `action_consolidate` | ACL only — ACL row exists **only** for `group_indigo_manager` (no office/user row at all). `action_consolidate` itself has no role check, but the ACL alone is manager-only — stricter than the panel gate |
| GET /api/calendar/feed-url | Manager/Office/Admin | none — returns a static `ICS_TOKEN` constant | **none** — no Odoo call at all; the panel gate is the only thing gating disclosure of this token |
| GET /api/calendar | Manager/Office/Admin | `indigo.order.search_read` | ACL only — record-rule scoped per the caller's real role |
| GET /api/catalog/brands | not gated | `indigo.brand.search_read` / `search_count` | ACL only (read=1 for all internal roles — no gate needed) |
| POST /api/catalog/brands | Manager/Office/Admin | `indigo.brand.create` | ACL only — `group_indigo_user` c0, **no office row**, `group_indigo_manager` c1. Stricter than the panel gate |
| GET /api/catalog/brands/[id] | not gated | `indigo.brand.read`, `indigo.order.line.search_count` | ACL only |
| PUT /api/catalog/brands/[id] | Manager/Office/Admin | `indigo.brand.write` | ACL only — same as POST, manager-only in practice |
| DELETE /api/catalog/brands/[id] | Manager/Admin | `indigo.brand.unlink` | ACL only — `unlink`=1 only for manager. Matches the gate |
| PUT /api/catalog/dealers/[id]/portal | Manager/Office/Admin | `res.partner.indigo_dealer_set_password` | Odoo method re-checks (`_indigo_assert_dealer_admin`) |
| GET /api/catalog/dealers/[id] | not gated (base read); the nested `portal` block is only *requested* when `role.isManager\|\|isOffice\|\|isAdmin` | `res.partner.read`, `indigo.order.search`/`read`; conditionally `res.partner.indigo_dealer_portal_info` | Odoo method re-checks (the portal-info sub-call; base dealer/orders read is ACL only, `res.partner` read=1 for all internal roles) |
| PUT /api/catalog/dealers/[id] | Manager/Office/Admin | `res.partner.write` | ACL only — verified: requires `base.group_partner_manager`, implied only by `group_indigo_manager`/`group_indigo_office`. Genuine, matching backstop |
| GET /api/catalog/dealers | not gated | `res.partner.search_read` | ACL only (read=1 for all internal roles) |
| POST /api/catalog/dealers | Manager/Office/Admin | `res.partner.create` | ACL only — same `group_partner_manager` requirement as PUT above. Genuine match |
| GET /api/catalog/designs/[id]/image | not gated | `ir.attachment.search_read`, proxies `/web/content/{id}` | ACL only |
| POST /api/catalog/designs/[id]/image | Manager/Office/Admin | `ir.attachment.create`; `indigo.design.write`; `product.template.search`/`write` | **Ambiguous** — base `ir.attachment` ACL grants `group_user` full r/w/c/u (all internal roles), but Odoo's `ir.attachment` model layers an additional check for attachments tied to `res_model`/`res_id` that (in stock Odoo) delegates to write-access on the linked record. Whether that delegation is active on this deployment isn't verifiable from source alone — flagging rather than asserting. The `indigo.design.write` half is ACL-only and matches (office write=1); the `product.template.write` half is affected by the `base.group_system`/`sales_team.group_sale_manager` gap noted in Findings |
| PATCH /api/catalog/designs/[id]/image | Manager/Office/Admin | `ir.attachment.read`/`write`; conditionally `product.template` via `applyCover` | Ambiguous (attachment) / ACL only (design, product.template) — same caveats as POST |
| DELETE /api/catalog/designs/[id]/image | Manager/Office/Admin | `ir.attachment.search_read`/`search`/`unlink` | Ambiguous — same `ir.attachment` caveat as POST |
| POST /api/catalog/designs/[id]/publish | Manager/Office/Admin | `indigo.design.read`; `product.template.search`/`write`/`create` | ACL only, but see Findings — `product.template` write/create needs `base.group_system` or `sales_team.group_sale_manager`, neither implied by any `indigo_decors` group |
| GET /api/catalog/designs/[id] | not gated | `indigo.design.read`, `indigo.order.line.search_count`, `ir.attachment.search_read`, `product.template.search_read` | ACL only |
| PUT /api/catalog/designs/[id] | Manager/Office/Admin | `indigo.design.write` | ACL only — office write=1. Genuine match |
| DELETE /api/catalog/designs/[id] | Manager/Admin | `indigo.order.line.search_count`, `indigo.design.unlink` | ACL only — unlink=1 only for manager. Genuine match |
| POST /api/catalog/designs/publish-bulk | Manager/Office/Admin | `product.template.search`/`write` | ACL only — same `product.template` gap as above |
| POST /api/catalog/designs/rename-family | Manager/Office/Admin | `indigo.design.rename_family` (primary path) | Odoo method re-checks (`models/indigo_design.py` — manager/office/admin check before any write) |
| — same route, legacy fallback | Manager/Office/Admin | `indigo.design.read`/`search_read`/`write`; `product.template.search_read`/`write` (only runs if `rename_family` is missing — pre-upgrade Odoo, not current prod) | ACL only — same as PUT/publish-bulk above |
| GET /api/catalog/designs | not gated | `indigo.design.search_read`/`search_count` | ACL only |
| POST /api/catalog/designs | Manager/Office/Admin | `indigo.design.create`; `product.template.create` | ACL only — `indigo.design` create=0 for office (manager-only in practice, panel is looser than ACL); `product.template.create` has the same `group_system`/`sale_manager` gap |
| GET /api/installers/dashboard | Manager/Office/Admin | `indigo.order.search_read` ×3, `indigo.order.line.search_read`, `res.partner.read`, `res.groups.search_read`, `res.users.search_read`, `indigo.order.search_count` | ACL only — record-rule scoped to the caller's real role |
| POST /api/installers | Manager/Office/Admin | `res.groups.search_read`, `res.users.search_read`, `res.users.create` | ACL only — verified: `res.users` create requires `base.group_erp_manager`, which **no** Indigo group implies, not even Manager. Stricter than the panel gate implies (see Findings — operational note, not a forgery risk) |
| GET /api/notifications | not gated — role only selects which item buckets to include, no 403 | `indigo.order.search_read` (several domains), `indigo.payout.search_read` | N/A (not a deny gate); the domains use the caller's own `partnerId` from the signed session, not client input |
| POST /api/orders/[id]/advance (wizard=indigo.invoiced.paid.wizard) | Manager/Office/Admin | `indigo.invoiced.paid.wizard.create` + `action_save_and_advance` | **none** — see Findings (the file's own comment says so) |
| POST /api/orders/[id]/advance (wizard=indigo.installed.wizard, caller not privileged) | must be `role.isInstaller` AND assigned installer on that order | `indigo.order.search_read` (assignment check) then `indigo.installed.wizard.create` + `action_save_and_advance` | **none** for the wizard call itself — assignment check is app-side against the real `partnerId` (now tamper-proof), but `action_save_and_advance` has no Odoo-side re-check and runs under `sudo()` |
| POST /api/orders/[id]/advance (other wizards: sqf-entry, cnc-done, painter-done, measurement-entry) | **not gated at all** — no role check precedes these | `indigo.order.line.write` (line_sqfs/line_dims); wizard `.create` + `action_save_and_advance` | **none** — not part of the forgery question (nothing to forge, since there's no gate), but flagged because it means any authenticated employee can already drive any order through any stage wizard today, forgery or not |
| POST /api/orders/[id]/assign-from-stock | Manager/Office/Admin | `indigo.order.write` ×2, `.read`, `.message_post` | **none** |
| POST /api/orders/[id]/assign | Manager/Office/Admin | `indigo.order.write`, `.message_post` | **none** |
| POST /api/orders/[id]/duplicate | Manager/Office/Admin | `indigo.order.search_read`, `indigo.order.line.search_read`, `indigo.order.create` (nested line create) | ACL only — create=0 for plain user, matches the gate |
| POST /api/orders/[id]/hold | Manager/Office/Admin | `indigo.order.write`, `.message_post` | **none** |
| POST /api/orders/[id]/lines | Manager/Office/Admin | `indigo.order.search_read`, `indigo.order.line.create`, `indigo.order.message_post` | ACL only — line create=0 for plain user, office/manager=1. Matches |
| PATCH /api/orders/[id]/lines/[lineId] | Manager/Office/Admin | `indigo.order.line.search_read`, `.write`, `indigo.order.message_post` | **none** — line write=1 for plain user too |
| DELETE /api/orders/[id]/lines/[lineId] | Manager/Office/Admin | `indigo.order.line.search_read`, `.unlink`, `indigo.order.message_post` | ACL only — line unlink=0 for plain user, office/manager=1. Matches |
| POST /api/orders/[id]/move-to-stock | Manager/Office/Admin | `indigo.order.read`, `.write`, `.message_post` | **none** |
| POST /api/orders/[id]/note | Manager/Office/Admin | `indigo.order.read`, `.write` ×2, `.message_post` | **none** |
| GET /api/orders/[id] | not gated | `indigo.order.read`, `indigo.order.line.read`, `indigo.stage.search_read`, `res.partner.read` | ACL only |
| PUT /api/orders/[id] | Manager/Office/Admin | `indigo.order.write` | **none** |
| POST /api/orders/[id]/payment | Manager/Office/Admin | `indigo.order.write`, `.message_post` | **none** — the route's own comment claims a "stricter" check than PUT, but the Odoo-side permission for `payment_state` is the same broad `indigo.order` write ACL as every other field |
| POST /api/orders/[id]/schedule | Manager/Office/Admin | `indigo.stage.search_read`, `indigo.order.write`, `.message_post` | **none** |
| POST /api/orders/[id]/stage | Manager/Office/Admin | `indigo.stage.search_read`, `indigo.order.read`, `.write`, `.message_post` | **none** — and notably the record rule only checks the order's *current* stage before the write, not the target `stage_id`, so a real Designer/CNC/Painter forging Manager could jump an order they can already see straight to Closed/Invoiced in one call |
| POST /api/orders/[id]/substatus | Manager/Office/Admin | `indigo.order.write`, `.message_post` | **none** — route comment claims specialists use "the wizard flow which has its own ACL on the Odoo side"; per the `/advance` finding above, the wizards have no such ACL (they `sudo()`) |
| POST /api/orders/[id]/unschedule | Manager/Office/Admin | `indigo.stage.search_read`, `indigo.order.write`, `.message_post` | **none** |
| GET /api/orders/auto-assign | Manager/Office/Admin | `res.users.search_read`, `res.groups.search_read`, `indigo.order.search_read` ×2 | ACL only — record-rule scoped |
| POST /api/orders/auto-assign | Manager/Office/Admin | `res.users.search_read`, `res.groups.search_read`, `indigo.order.search_read` ×2, `.write` ×2 (bulk) | **none** for the writes (same `indigo.order` write gap, bulk over every matching order) |
| GET /api/orders | not gated | `indigo.order.search_read`/`search_count`, `indigo.order.line.search_read` | ACL only |
| POST /api/orders | Manager/Office/Admin | `indigo.order.create` | ACL only — create=0 for plain user. Matches |
| POST /api/orders/bulk (archive/unarchive) | Manager/Office/Admin (`canArchive`) | `indigo.order.write` | **none** |
| POST /api/orders/bulk (cancel) | Manager/Office/Admin | `indigo.order.write` | **none** |
| POST /api/orders/bulk (delete) | Manager/Admin only | `indigo.order.unlink` | ACL only — unlink=1 only for manager. Matches (this one the code comment gets right: "per the Odoo ACL") |
| GET /api/pricing | Manager/Office/Admin | `indigo.design.price.search_read`, `indigo.design.search_read` | **none** — `indigo.design.price` ACL grants read=1 to `group_indigo_user` (every internal role); the panel restricts viewing the price matrix to manager/office but Odoo would serve it to anyone logged in |
| PUT /api/pricing | Manager/Office/Admin | `indigo.design.price.write` | ACL only — write=0 for plain user, 1 for office/manager. Matches |
| PATCH /api/pricing/design/[id] | Manager/Office/Admin | `indigo.design.write` | ACL only — office write=1. Matches |
| GET /api/settings | not gated by the panel (no 403 branch) | `ir.config_parameter.indigo_get_capacities`, `indigo.contractor.rate.search_read` | Odoo method re-checks — the capacities call throws `AccessError` for non-manager/office real users, which fails the whole handler (caught by the outer try/catch → 500) before any data reaches the response |
| PUT /api/settings | Manager/Office/Admin | `ir.config_parameter.indigo_set_capacities`; `indigo.contractor.rate.create`/`write`/`unlink` | Odoo method re-checks (capacities) + ACL only (rates — `group_indigo_user` r1w0c0u0, **no office row**, manager only w1c1u1; stricter than the panel gate) |

## Findings — every `none` row, and why it matters

**1. Stage-advance wizards run under `sudo()` with zero role re-check —
the single biggest gap.** `POST /api/orders/[id]/advance` is the entry
point for all six stage wizards
(`odoo-indigo/addons/indigo_decors/wizards/indigo_stage_wizards.py` and
`indigo_measurement_entry_wizard.py`). Every `action_save_and_advance`
does `self.order_id.sudo()` and nothing else — no `_indigo_assert_*`,
no group check. `sudo()` bypasses **both** the model ACL and every
record rule. On top of that, the wizard models' own ACL rows
(`indigo_sqf_entry_wizard`, `indigo_cnc_done_wizard`,
`indigo_painter_done_wizard`, `indigo_installed_wizard`,
`indigo_invoiced_paid_wizard`, `indigo_measurement_entry_wizard`) all
grant full `r/w/c/u` to `group_indigo_user` — the base group every
single internal role implies. So:
  - The panel's `SENSITIVE_WIZARDS` check (money-moving
    `indigo.invoiced.paid.wizard`) and the installer-assignment check
    (`indigo.installed.wizard`) are the *only* things stopping a
    forged role from invoicing/marking-paid an arbitrary order, or
    closing out an install that isn't the caller's.
  - The other four wizards (SQF entry, CNC done, painter done,
    measurement entry) aren't even panel-gated — any authenticated
    session, any role, can drive any order through any of those
    stages today. That's a pre-existing gap independent of cookie
    forgery, but it means the "role gate" the rest of this audit is
    about was never the only thing standing between a compromised
    session and a stage change here.
  - The route's own source comment already flags this for the money
    wizard: *"Money wizards are office/manager only (Odoo ACLs alone
    don't stop an internal contractor from invoicing here)."* Verified
    correct, and it generalizes to all six wizards.

**2. Plain `indigo.order`/`indigo.order.line` writes are broader than
the panel implies — most of the `/orders/[id]/*` action routes.**
`ir.model.access.csv` grants `group_indigo_user` **write=1** on both
`indigo.order` and `indigo.order.line` (only `create`/`unlink` are
manager/office-gated). Combined with the stage-scoped record rules in
`indigo_role_rules.xml` — which check the record's domain membership
*before* the write, not the values being written — this means: a real
Designer, CNC operator, Painter, or internal Installer can already
write to any order sitting in their own stage-visible slice. A forged
Manager/Office panel role adds nothing there that Odoo didn't already
allow for that specific slice of orders. This is why `assign`,
`assign-from-stock`, `hold`, `move-to-stock`, `note`, the generic order
`PUT`, `payment`, `schedule`, `substatus`, `unschedule`, bulk
`archive`/`unarchive`/`cancel`, and the per-line `PATCH` are all
`none`. The Kanban drag-drop `POST /orders/[id]/stage` is the sharpest
version of this: the record rule only checks the order's *current*
stage, not the destination `stage_id`, so a real Designer (visible
domain: `ready_digitalization`, `cnc`) could push one of their own
orders straight to `Closed` or `Invoiced` in a single write.
`create`/`unlink`-only actions (new order, new line, duplicate, delete)
do NOT have this gap — `create`/`unlink` are genuinely manager/office
(or manager-only) at the ACL layer.

**2b. `POST /api/orders/auto-assign` is the same `indigo.order` write
gap, but batched — worth its own line, not a footnote on 2.** The
write half of this route (`args: [orphans.map((o) => o.id), {
painter_id: ... }]` / `{ installer_ids: ... }`) is the identical
`indigo.order.write` ACL gap from Finding 2 above, so it's `none` for
the same reason. What makes it worth calling out separately is blast
radius: every other `none` row in Finding 2 writes **one order per
call**; `auto-assign` writes **every orphaned order matching a stage
domain, in a single call** (`search_read` with no `limit` below 5000,
then one batched `write` over all matching ids). A forged Manager role
held by a real Designer/CNC/Painter/Installer wouldn't be limited to
their own stage-visible slice here in the way it is for a single-order
action — it's still bounded by that same record-rule domain, but the
domain now applies to a `search`, not a hand-picked target, so it
silently reassigns painter/installer on the caller's entire visible
backlog at once rather than one order they specifically chose.

**3. `GET /api/pricing` — panel hides the price matrix from
specialists; Odoo doesn't.** `indigo.design.price` grants `read=1` to
`group_indigo_user`. Any internal employee could `search_read` the
full base-price matrix directly; the panel's manager/office gate on
this endpoint is cosmetic.

**4. `GET /api/calendar/feed-url` — no Odoo call at all.** This route
returns a static app-level secret (`ICS_TOKEN`) used to build the
public iCalendar subscription URL. There is no model/method backstop
possible here by construction — the panel role check was always the
only thing gating disclosure of that token.

## Additional observations (not `none`, but worth flagging)

- **`res.users.create` in `POST /api/installers` is likely stricter
  than anyone intended.** Verified against Odoo 17.0's own
  `addons/base/security/ir.model.access.csv`: `res.users`
  create/write requires `base.group_erp_manager` (the
  Settings/Technical-admin group). No `indigo_decors` group implies
  it — not even `group_indigo_manager`. That means this call likely
  fails with `AccessError` for a real Indigo Manager who isn't also a
  system administrator, independent of the forgery question. Worth
  confirming against prod with an actual non-admin manager account —
  if it's broken today, that's a product bug, not a security gap.
- **`product.template` create/write (several `catalog/designs/*`
  routes) has the same shape of gap, verified against
  `addons/product/security/ir.model.access.csv`:** it requires
  `base.group_system` or `sales_team.group_sale_manager`, neither of
  which `indigo_decors`' security XML grants to Manager or Office.
  Unlike `res.users` above, this is genuinely ambiguous rather than a
  clear bug: a live Odoo deployment commonly grants "Sales Manager" or
  similar to the same people who run day-to-day operations, as a
  manual admin action outside this addon's code. Static inspection
  can't tell whether that's true on the deployed `indigo-prod`
  database, so this is flagged rather than classified as `none` or
  matched.
- **`ir.attachment` access on the design-image routes is genuinely
  ambiguous.** Base ACL grants `group_indigo_user` full CRUD, but
  Odoo's `ir.attachment` model layers extra access logic for
  attachments tied to a `res_model`/`res_id` that (in stock Odoo)
  typically delegates to the linked record's own access rights. Which
  behavior is active on this deployment isn't verifiable from the
  addon source alone.
- **Two route-level comments in the codebase are directly
  contradicted by this audit** and should probably be corrected
  alongside whatever fix ships: `orders/[id]/advance/route.ts` is
  right that money wizards need the extra gate; but
  `orders/[id]/substatus/route.ts`'s comment — "Specialists mark their
  step via the wizard flow which has its own ACL on the Odoo side" — is
  not accurate; that wizard flow has no re-check either (see Finding
  1).

## Closing

Signed session cookies (this plan) close the class of issue where a
forged `groups` claim in the cookie itself grants access the panel
gate was designed to withhold — `deriveRole(s.user.groups)` now reads
from a value the client cannot fabricate. But every row marked `none`
above was never actually protected by that role claim in the first
place: Odoo's own ACLs, record rules, or `sudo()`-wrapped methods
either don't check it or actively grant more than the panel implies.
Cookie signing does not close any of those gaps — they need an
Odoo-side fix (a re-check in the wizard `action_save_and_advance`
methods being the highest-priority one), and they deserve one
regardless of this deploy, because the planned MCP server will call
these exact same `model`/`method` pairs on behalf of an AI agent and
will inherit whatever Odoo does or doesn't enforce here.

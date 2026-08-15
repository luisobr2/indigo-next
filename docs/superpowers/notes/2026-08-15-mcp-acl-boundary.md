# MCP ACL boundary — what Odoo actually refuses, and for whom

**Measured:** 2026-08-15, against staging.
**Corrects:** the "Real run output" section of
`2026-08-15-mcp-evals.md`, which stated Odoo's ACL refusal as an
unqualified property of "the credential pair an MCP token is built from."
It isn't — it depends on the role behind that credential. That section now
carries a correction note pointing here; this file is the full record.

## What was measured

`check_access_rights("create")` on `indigo.design`, called as each of four
real staging accounts:

| account | role | can create? |
|---|---|---|
| `majela@indigodecors.com` | manager | **YES** |
| `oficina@indigodecors.com` | office | no |
| `ics-service@indigodecors.com` | office | no |
| `pintor@indigodecors.com` | painter | no |

The earlier record only ever tested `ics-service@indigodecors.com` — an
office account — by attempting a real `create` directly against
**production** and observing it get refused, then generalised "Odoo refuses
the write" to every MCP credential. That generalisation was wrong. Office,
and (by the same ACL mechanism) painter, CNC, designer and installer
accounts genuinely are refused by Odoo's own access rules on
`indigo.design.create` — confirmed directly in
`c:/Trabajo/odoo-indigo/addons/indigo_decors/security/ir.model.access.csv`
(read-only reference): `access_indigo_design_office` grants
`(read=1, write=1, create=0, unlink=0)`, and the base `access_indigo_design_user`
row (the group every internal role implies) grants `(read=1, write=0,
create=0, unlink=0)`. **`access_indigo_design_manager` grants
`(read=1, write=1, create=1, unlink=1)`.** Manager accounts are not refused
— they were never going to be, per that same CSV; the earlier test simply
never happened to use one.

## What it means in practice

MCP tools run against Odoo *as the real person* (see `tools.ts`'s top doc
comment and the design spec's Auth section) — every RPC call authenticates
with that person's own Odoo API key, so Odoo's ACL is a live, independent
check on every write this project's tools make, not a formality inherited
from the panel. For a restricted role (office, painter, CNC, designer,
installer), that means there really are two barriers between a mistaken or
malicious tool call and an unwanted write: this project's own tool surface
(which write tools exist, and what each one validates before it writes),
and Odoo's ACL underneath it. A bug that let a restricted-role identity
reach an Odoo write this project never intended to expose would, in many
cases, still be caught by Odoo itself.

For a manager identity, there is only one barrier: **the set of tools this
project chooses to expose.** Today that surface is six read tools plus five
reversible, preview-then-confirm write tools (`advance_order`,
`assign_order`, `schedule_install`, `hold_order`, `add_note`) —
deliberately narrow, and deliberately excluding money, deletion and bulk
operations (see the design spec's "Nunca se exponen como tool" list, and
`advance_order`'s own exclusion of the sixth, money-moving stage wizard).
That surface is safe on its own terms. But it is safe because of what IS
and ISN'T built, not because Odoo would refuse anything extra a
manager-credentialed agent tried. **There is no second net for managers.**
If a future write tool (or a bug in an existing one) ever let a manager
identity reach an Odoo write beyond what that tool is supposed to do, Odoo's
ACL would not catch it — group_indigo_manager's grants are broad by design
(managers run the business from the panel too).

## Decision

**Keep per-person identity. Accept the tool surface as the boundary for
managers**, rather than introduce a second wall. Attribution — Odoo's
`mail.thread` recording that Majela (not "the bot," not a shared service
account) asked for a given change — is worth more than a redundant ACL
check, because it's the property that makes an AI-operated system
auditable at all (see the design spec's "Propiedad clave" callout: *"si
Majela le pide algo al agente, en la orden queda registrado como Majela, no
como 'el bot'"*). A second wall bought by breaking that property would be a
worse trade, not a better one — it would turn every MCP-driven change back
into an anonymous one, which is the exact failure mode the whole per-person
API-key design exists to avoid.

### Rejected alternative: a restricted shared Odoo role

Considered: mint a locked-down Odoo role (something between office and
painter, with `indigo.design.create` and similar denied) and put every MCP
identity — including Majela's — behind it when acting through the MCP
server, so Odoo's ACL refuses the same things regardless of who's actually
asking.

Rejected because it destroys attribution. Such a role either:

- is a login distinct from the person's own account, so `mail.thread`
  records "MCP service account" instead of "Majela" — exactly the failure
  mode the design spec's Auth section rules out; or
- somehow reuses Majela's own login but with a down-scoped effective
  permission set for MCP calls specifically — which Odoo's ACL model has no
  native way to express per-*channel* (ACLs are per-user/per-group, not
  per-credential-type), so this would mean either a second, MCP-only Odoo
  user for her (same attribution problem as above) or stripping her real
  account of rights she genuinely needs for her own non-MCP work in the
  panel, which isn't an option.

Neither is worth what it costs. The tool surface — narrow, reversible,
previewed, logged — is the boundary that was chosen instead.

## Follow-up

`scripts/mcp-eval.mjs`'s `write_is_refused` scenario asserted the old,
unqualified claim — it would FAIL every time it ran with a manager's
`MCP_TOKEN`, misleadingly, since that's expected behaviour, not a
regression. Fixed to:

1. Use `check_access_rights("create")` (no side effects) instead of an
   actual `create` attempt, so it never has to write-then-clean-up a probe
   row in whatever Odoo instance it's pointed at.
2. Detect the caller's own Indigo role first (the same `res.users` /
   `res.groups` read this measurement used), and only assert refusal for a
   **non-manager** identity — the guarantee that's actually real. For a
   manager identity it SKIPs with an explicit explanation of which
   guarantee is (and isn't) being checked, rather than either failing on
   expected behaviour or silently asserting nothing. It is still fully
   capable of failing: if a non-manager role's ACL is ever loosened to
   permit the create, this scenario catches it.

See the updated doc comment on `scenarioWriteIsRefused` in that file for the
full detail.

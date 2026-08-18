# Dealer Portal Password — SDD progress ledger

Plan: `docs/superpowers/plans/2026-07-07-dealer-portal-password.md`
Branches (both `feat/dealer-portal-password`):
- odoo-indigo — base `a3780c4`
- indigo-next — base `0ff07f8` (docs committed)
Prereq: local Odoo running (`indigo-odoo` + `indigo-db`, DB **indigo-prod**).

Task 1 (odoo: dealer portal methods + tests): complete (commits a3780c4..59e8421, review clean; 5/5 tests pass)
  Minor (for final triage): (1) idempotent test doesn't assert password changed on reuse; (2) no test for guard rejection branch (non-manager caller).
Task 2 (next api: GET portal + PUT set-password): complete (commits 0ff07f8..5b7bdb3, review clean; tsc 0, eslint 0)
  Minor (for final triage): portal/result types inline-duplicated across route.ts + portal/route.ts (could share a type in lib/odoo/types.ts).
FINAL whole-branch review: found 1 Critical (privilege escalation in indigo_dealer_set_password — unscoped target, RPC-callable). FIXED in odoo commit f4491a2 (is_indigo_dealer guard + protected/non-portal-user guard + 2 negative tests; 7/7 pass). Re-review: RESOLVED, no regressions. All other Minors triaged as defer-to-follow-up.

Task 3 (next ui: Acceso portal card): complete (commits 5b7bdb3..16492fb, review clean; tsc 0)
  Controller fix applied post-review (16492fb): gate the card on data.portal so non-managers don't see a misleading actionable card (resolved reviewer ⚠️).
  Minor (for final triage): (a) show/hide toggle has tabIndex=-1 (a11y: keyboard users can't reveal pw) — inherited from plan; (b) card hand-rolls label instead of reusing Field; (c) too-short-password PUT returns HTTP 500 (correct message) not 400 — matches codebase's Odoo-error handling; (d) pre-existing eslint error at page.tsx:117 (form-sync useEffect), NOT introduced here.

END-TO-END (local Odoo, dealer 21 USA Windows): PUT create → {ok,created:true}; GET after has_user:true; dealer logged in with new pw (200); idempotent 2nd PUT created:false; short pw rejected; wrong pw 401. Nothing hit prod (prod-pointed attempts 401'd, no session, no PUT executed).
Local test residue: dealer 21 now has a portal user (pw dealerpass456) in LOCAL indigo-prod; local admin pw set to testadmin123. Local dev copy only.

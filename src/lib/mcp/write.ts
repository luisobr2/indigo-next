/**
 * The write-tool plumbing every MCP write tool shares: the `confirm`
 * argument's schema, the preview -> confirm orchestration (runWriteTool) and
 * the office/manager gate. Extracted from tools.ts so the invoice tools
 * (./invoices.ts) can use the exact same handshake without importing
 * tools.ts back (tools.ts imports the invoice tools to register them).
 * tools.ts re-exports runWriteTool, so its existing importers keep working.
 *
 * Free of `@/`-aliased imports at module level, like ./confirm.ts, so its
 * pure parts load under plain `node --test`.
 */
import type { McpIdentity } from "./token.ts";
import { requireSessionSecret } from "../odoo/session-cookie.ts";
import { issueConfirmToken, verifyConfirmToken } from "./confirm.ts";
import { mcpError } from "./errors.ts";

// Lazy for the same reason as tools.ts's own getDeriveRole(): the `@/`
// alias doesn't resolve under plain `node --test`.
async function getDeriveRole() {
  const { deriveRole } = await import("@/lib/odoo/types");
  return deriveRole;
}

/** JSON Schema fragment shared by every write tool's `confirm` argument. */
export const CONFIRM_SCHEMA_PROPERTY = {
  type: "string",
  description:
    "The 'confirm' token returned by a PREVIOUS call to this SAME tool with these SAME arguments. Omit this argument to preview — that call makes no change and costs nothing to undo. Pass the token back, unchanged, alongside the identical arguments to execute. It expires a few minutes after the preview; if execution is rejected as expired or mismatched, call again without 'confirm' to get a fresh preview and token.",
};

/**
 * The role gate the panel's own /assign, /schedule, /hold and /note routes
 * apply (src/app/api/orders/[id]/{assign,schedule,hold,note}/route.ts all
 * check `role.isManager || role.isOffice || s.user.isAdmin`) — reproduced
 * here because, per this file's top doc comment, Odoo's own ACL does NOT
 * enforce it for these four direct-write actions.
 *
 * Narrower than the panel's own check in one respect: MCP identities
 * (McpIdentity, from an Odoo API key) don't carry an `isAdmin` flag the way
 * a browser session does — verifyMcpToken only reads `groups_id`, never
 * whether the user is Odoo's technical superadmin. That's acceptable here:
 * it makes this gate fail CLOSED for an edge case (a bare superadmin
 * account with no Indigo group membership calling the MCP) rather than
 * open, and the real people this surface is for (Majela, Javier, and
 * whoever else is issued an MCP token) are expected to hold an actual
 * Indigo role group either way.
 */
export async function requireOfficeRole(id: McpIdentity, action: string): Promise<void> {
  const deriveRole = await getDeriveRole();
  const role = deriveRole(id.groups);
  if (!role.isManager && !role.isOffice) {
    throw mcpError(
      "PERMISO_DENEGADO",
      `Esta cuenta no tiene permiso para ${action}. Solo oficina o gerencia pueden hacerlo desde el asistente — pídeselo a alguien con ese rol.`,
    );
  }
}

/**
 * A write tool's plan: computed fresh on EVERY call (preview or confirm —
 * see runWriteTool), never cached between them, so a confirm always
 * re-validates against Odoo's current state rather than trusting what was
 * true when the preview ran. `message` is written tense-neutral ("marcar la
 * orden X como instalada", not "se marcará"/"se marcó") so runWriteTool can
 * prefix it for either a preview or a completed action without the two
 * reading like they contradict each other.
 */
export interface WritePlan {
  message: string;
  /** Extra fields merged into the tool's JSON result alongside `message`
   *  (e.g. `{ order, client }`) — never anything security-relevant, since
   *  this is included verbatim in BOTH the preview and the executed result. */
  extra?: Record<string, unknown>;
  /** Performs the actual Odoo write(s). Only ever invoked after a valid,
   *  argument-bound confirm token has verified — see runWriteTool. */
  execute: () => Promise<void>;
  /** Values the plan RESOLVED on the server (not given as arguments) that
   *  decide the effect — e.g. the dealer addresses an email goes to when no
   *  'emails' was passed. They're signed into the confirm token with the
   *  arguments, so if they change between preview and confirm the token no
   *  longer matches and a fresh preview is required: what the person saw is
   *  what happens. */
  bind?: Record<string, unknown>;
}

/**
 * Shared preview -> confirm orchestration for every write tool. `buildPlan`
 * does ALL the Odoo reads and business-rule validation and must be safe to
 * call on every invocation, preview or confirm alike, with no side effects
 * of its own — only `plan.execute()` writes, and this function calls it in
 * exactly one place, gated by a verified token. That single call site is
 * the entire write surface of this module; see the doc comment above
 * WritePlan for why re-running buildPlan on confirm (rather than trusting
 * whatever the preview computed) matters.
 *
 * `now` is an explicit parameter rather than read internally — same
 * convention as checkRate() in ./rate-limit.ts — so callers control the
 * clock in tests instead of this function reading Date.now() itself.
 */
export async function runWriteTool(
  toolName: string,
  args: Record<string, unknown>,
  id: McpIdentity,
  buildPlan: () => Promise<WritePlan>,
  now: number,
): Promise<unknown> {
  const { confirm, ...args0 } = args;
  const plan = await buildPlan();
  const boundArgs = plan.bind ? { ...args0, __resolved: plan.bind } : args0;

  if (typeof confirm !== "string" || !confirm) {
    const secret = requireSessionSecret();
    const token = issueConfirmToken(toolName, boundArgs, id.uid, secret, now);
    return { preview: true, message: `Vista previa — ${plan.message}`, confirm: token, ...(plan.extra ?? {}) };
  }

  const secret = requireSessionSecret();
  const decision = verifyConfirmToken(confirm, toolName, boundArgs, id.uid, secret, now);
  if (!decision.ok) {
    const reasonMsg =
      decision.reason === "expired"
        ? "El token de confirmación venció (expiran a los pocos minutos)."
        : "El token de confirmación no corresponde exactamente a esta acción — cambiaron los datos, es de otra herramienta, o es inválido.";
    throw mcpError("CONFIRMACION_INVALIDA", `${reasonMsg} Vuelve a llamar a esta herramienta SIN 'confirm' para previsualizar de nuevo, y confirma con el token nuevo.`);
  }

  await plan.execute();
  return { ok: true, message: `Hecho — ${plan.message}`, ...(plan.extra ?? {}) };
}

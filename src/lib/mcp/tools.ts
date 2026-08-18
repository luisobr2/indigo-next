/**
 * MCP tools over the Indigo panel's Odoo data: seven read-only tools (the six
 * from Fase 1 plus list_people, added once assign_order's name-to-id gap
 * became a real usability blocker) plus five reversible write tools
 * (Fase 2) — advance_order, assign_order, schedule_install, hold_order,
 * add_note.
 *
 * Every Odoo call runs through `rpcExecuteKw(id.uid, id.apiKey, ...)` —
 * Odoo's external API (see src/lib/odoo/rpc.ts) — so it executes as the
 * real logged-in person and Odoo's own ACLs / record rules apply, same
 * as every BFF route under src/app/api (those go through the session-cookie
 * transport in src/lib/odoo/client.ts instead; MCP tokens are API keys,
 * which only the external API accepts).
 *
 * Field names and domains below are copied verbatim from the panel
 * routes that already query/write these models (see comments per tool) —
 * never invented, so a tool call can't 500 on an Odoo "Invalid field".
 *
 * Every write tool follows the SAME preview -> confirm handshake, built on
 * top of ./confirm.ts's argument-bound HMAC tokens: called without
 * `confirm`, it only reads Odoo state and returns a Spanish description of
 * what would change (zero writes); called again with the `confirm` token
 * that call returned, it executes. See runWriteTool() below for the shared
 * plumbing and docs/superpowers/specs/2026-08-14-mcp-ai-control-design.md's
 * "Guardrails" section for why this exists (it's binding, not advisory).
 *
 * Two write-tool-specific guardrails worth calling out up front, because
 * they only became visible by reading the Odoo module directly (see
 * c:/Trabajo/odoo-indigo/addons/indigo_decors/security/ir.model.access.csv
 * and indigo_role_rules.xml, read-only, never modified from here):
 *
 *  - advance_order drives four Odoo stage wizards plus one direct
 *    indigo.order method call — indigo.order.action_send_to_designer() for
 *    'digitalization_done', since Majela's 2026-08-15 request removed
 *    per-line SQF entry from Digitalization and deleted the wizard that
 *    used to live there (indigo.sqf.entry.wizard). It never drives the
 *    sixth, money-moving wizard (indigo.invoiced.paid.wizard — see
 *    ADVANCE_OUTCOMES below). Both the wizards and action_send_to_designer
 *    enforce their own role check server-side (`_indigo_require_groups` in
 *    the addon's wizards/indigo_stage_wizards.py,
 *    `_indigo_assert_can_send_to_designer` in models/indigo_order.py). A
 *    caller whose role doesn't match gets a genuine Odoo AccessError, which
 *    this file maps to PERMISO_DENEGADO naming the action attempted (see
 *    withActionAccessError).
 *  - assign_order / schedule_install / hold_order / add_note do NOT go
 *    through a wizard — they write indigo.order fields directly, exactly
 *    like the panel routes they mirror (src/app/api/orders/[id]/{assign,
 *    schedule,hold,note}/route.ts). Odoo's own ir.model.access.csv grants
 *    write=1 on indigo.order to `group_indigo_user` — the base group every
 *    internal role implies — with NO field-level restriction, so Odoo's ACL
 *    alone would let a painter's API key reassign painters or release a
 *    hold. The office/manager-only gate on those four actions exists ONLY
 *    in the panel's route handlers today; requireOfficeRole() below is that
 *    same gate, reimplemented here so an MCP caller can't bypass it by
 *    skipping the panel — this is exactly the "invariants live in the
 *    panel, not in Odoo" problem the design doc's "Por qué NO hablarle a
 *    Odoo directo" section warns about, encountered firsthand.
 */
import { isInternalUser, type McpIdentity } from "./token.ts";
// Type-only, so it is erased at compile time and never becomes a
// runtime import the test runner would have to resolve. The VALUE
// still comes from getDeriveRole() below, like everywhere else here.
import type * as OdooTypes from "../odoo/types.ts";
import { shopDateString } from "../shop-time.ts";
import { requireSessionSecret } from "../odoo/session-cookie.ts";
import { issueConfirmToken, verifyConfirmToken } from "./confirm.ts";

// Lazy import so this module can be loaded (and its pure exports tested)
// in a plain `node --test` environment that doesn't resolve the `@/`
// path alias. Same trick as token.ts's getRpc().
async function getRpc() {
  const { rpcExecuteKw } = await import("@/lib/odoo/rpc");
  return rpcExecuteKw;
}

// Same lazy-import trick, for the one non-Odoo `@/`-aliased dependency the
// write tools need: the exact same role derivation the panel routes use
// (src/lib/odoo/types.ts's deriveRole), so requireOfficeRole() below can't
// silently drift from what "office or manager" means anywhere else in the
// app. That module has no Node imports of its own (see its file doc
// comment) — only the `@/` alias itself is the obstacle under plain
// `node --test`.
async function getDeriveRole() {
  const { deriveRole } = await import("@/lib/odoo/types");
  return deriveRole;
}

// ---------------------------------------------------------------------
// Shared shaping helpers (pure — no I/O)
// ---------------------------------------------------------------------

/** Odoo many2one fields arrive as `[id, "Label"]` or `false`. */
function m2oLabel(value: unknown): string | null {
  return Array.isArray(value) ? ((value[1] as string) ?? null) : null;
}

/** Odoo uses `false` for every empty scalar field; MCP callers want `null`. */
function emptyToNull<T>(value: T | false | undefined | null): T | null {
  return value === false || value === undefined || value === null ? null : value;
}

export interface FormattedOrder {
  id: number;
  order: string;
  client: string;
  address: string | null;
  stage: string | null;
  dealer: string | null;
  installation_date: string | null;
  doors: number;
}

/**
 * Shapes one `indigo.order` search_read row into the compact form every
 * list-style tool returns. Field names match ORDER_FIELDS_BASE in
 * src/app/api/orders/route.ts and src/app/api/orders/[id]/route.ts.
 */
export function formatOrder(row: Record<string, unknown>): FormattedOrder {
  return {
    id: row.id as number,
    order: row.name as string,
    client: row.client_name as string,
    address: emptyToNull(row.client_address as string | false),
    stage: m2oLabel(row.stage_id),
    dealer: m2oLabel(row.dealer_id),
    installation_date: emptyToNull(row.installation_date as string | false),
    doors: row.door_count as number,
  };
}

interface FormattedOrderLine {
  id: number;
  design: string | null;
  door_type: string | null;
  color: string | null;
  width: number | null;
  height: number | null;
  qty: number | null;
  parts: number | null;
  sqf: number | null;
}

/**
 * Shapes one `indigo.order.line` row. Field names match LINE_FIELDS_BASE
 * in src/app/api/orders/[id]/route.ts.
 */
function formatOrderLine(row: Record<string, unknown>): FormattedOrderLine {
  return {
    id: row.id as number,
    design: m2oLabel(row.design_id),
    door_type: emptyToNull(row.door_type as string | false),
    color: emptyToNull(row.color as string | false),
    width: emptyToNull(row.width as number | false),
    height: emptyToNull(row.height as number | false),
    qty: emptyToNull(row.qty as number | false),
    parts: emptyToNull(row.parts_count as number | false),
    sqf: emptyToNull(row.sqf as number | false),
  };
}

// ---------------------------------------------------------------------
// Limit/offset clamps — the blast-radius cap. Never trust the caller's
// number.
// ---------------------------------------------------------------------

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** today_board's cap is its own: the active working set is bounded (this
 *  shop runs ~20-40 doors at a time), so 500 comfortably covers "everything
 *  on the board" without the tool's blast radius growing unbounded. It is
 *  both the default and the ceiling — there's no smaller "first page" that
 *  makes sense for a tool whose whole point is "show me all of it". */
const TODAY_BOARD_LIMIT = 500;

function clampLimitTo(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const n = Math.floor(raw);
  if (n < 1) return fallback;
  return Math.min(n, max);
}

export function clampLimit(raw: unknown): number {
  return clampLimitTo(raw, DEFAULT_LIMIT, MAX_LIMIT);
}

function clampOffset(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  const n = Math.floor(raw);
  return n < 0 ? 0 : n;
}

const LIMIT_SCHEMA_PROPERTY = {
  type: "number",
  description:
    "Maximum number of records to return. Defaults to 25. Capped at 100 server-side no matter what is requested. The result's `total` and `truncated` tell you if more exist — page through them with `offset` rather than raising this.",
};

const OFFSET_SCHEMA_PROPERTY = {
  type: "number",
  description:
    "How many matching records to skip before returning results — use with `limit` to page past the 100-record cap when `truncated` was true. Defaults to 0.",
};

const TODAY_BOARD_LIMIT_SCHEMA_PROPERTY = {
  type: "number",
  description:
    "Maximum number of orders to consider across all active stages. Defaults to and is capped at 500 — the active working set is normally far smaller than that, so you should rarely need to lower it. The result's `total` and `truncated` tell you if the board actually had more than this.",
};

// ---------------------------------------------------------------------
// Error contract — every failure a tool raises reaches the agent as
// actionable Spanish text prefixed with a stable "[CODIGO] mensaje", so
// the agent can branch on the code (retry vs. ask the user vs. give up)
// without parsing prose or guessing what language Odoo happened to answer
// in. Never forwards an Odoo traceback — rpc.ts already only ever throws
// `error.data.message` (never `.debug`), and that property is preserved
// here.
// ---------------------------------------------------------------------

export class McpToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "McpToolError";
    this.code = code;
  }
}

/** Builds a stable-coded, Spanish, actionable tool error. */
export function mcpError(code: string, message: string): McpToolError {
  return new McpToolError(code, message);
}

/**
 * Maps whatever a tool implementation throws onto the error contract.
 * `OdooRpcError.errorName` carries Odoo's own exception dotted name (see
 * src/lib/odoo/rpc.ts) — duck-typed on `.name`/`.errorName`/`.httpStatus`
 * rather than `instanceof` so this module doesn't need a top-level import
 * of rpc.ts (it only ever reaches Odoo through the lazy getRpc()).
 */
export function toMcpToolError(e: unknown): McpToolError {
  if (e instanceof McpToolError) return e;

  if (e instanceof Error && e.name === "OdooRpcError") {
    const err = e as Error & { errorName?: string; httpStatus?: number };
    if (err.errorName === "TIMEOUT" || err.errorName === "NETWORK") {
      return mcpError("TRANSITORIO", "Odoo no respondió a tiempo. Intenta de nuevo en unos segundos.");
    }
    if (typeof err.httpStatus === "number" && err.httpStatus >= 500) {
      return mcpError("TRANSITORIO", "Odoo devolvió un error de servidor. Intenta de nuevo en unos segundos.");
    }
    if (err.errorName === "odoo.exceptions.AccessError") {
      return mcpError("PERMISO_DENEGADO", "No tienes permiso en Odoo para ver estos datos.");
    }
    if (err.errorName === "odoo.exceptions.MissingError") {
      return mcpError("NO_ENCONTRADO", "El registro solicitado ya no existe en Odoo.");
    }
    return mcpError("ERROR_ODOO", `Odoo devolvió un error: ${err.message}`);
  }

  const message = e instanceof Error ? e.message : "Error inesperado.";
  return mcpError("ERROR_ODOO", message);
}

// ---------------------------------------------------------------------
// Write-tool infrastructure — shared by all five reversible write tools
// (advance_order, assign_order, schedule_install, hold_order, add_note).
// Nothing above this point writes anything; everything below it exists
// specifically to gate writes behind the preview -> confirm handshake.
// ---------------------------------------------------------------------

/** JSON Schema fragment shared by every write tool's `confirm` argument. */
const CONFIRM_SCHEMA_PROPERTY = {
  type: "string",
  description:
    "The 'confirm' token returned by a PREVIOUS call to this SAME tool with these SAME arguments. Omit this argument to preview — that call makes no change and costs nothing to undo. Pass the token back, unchanged, alongside the identical arguments to execute. It expires a few minutes after the preview; if execution is rejected as expired or mismatched, call again without 'confirm' to get a fresh preview and token.",
};

/**
 * One order per write-tool call, always. Stricter than `Number(args.id)`
 * (used by the read-only get_order) on purpose: get_order returning null
 * for a garbage id is harmless, but a write tool accepting something
 * Number()-coercible-but-not-actually-a-number (e.g. an array like `[5]`,
 * which `Number([5])` silently accepts as `5`) would blur the "one order,
 * never bulk" blast-radius guarantee at the type-check level, before any
 * business logic even runs.
 */
function requireOrderId(args: Record<string, unknown>, toolName: string): number {
  const raw = args.order_id;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw mcpError("ENTRADA_INVALIDA", `${toolName} requiere un 'order_id' numérico de una sola orden.`);
  }
  return raw;
}

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
async function requireOfficeRole(id: McpIdentity, action: string): Promise<void> {
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
interface WritePlan {
  message: string;
  /** Extra fields merged into the tool's JSON result alongside `message`
   *  (e.g. `{ order, client }`) — never anything security-relevant, since
   *  this is included verbatim in BOTH the preview and the executed result. */
  extra?: Record<string, unknown>;
  /** Performs the actual Odoo write(s). Only ever invoked after a valid,
   *  argument-bound confirm token has verified — see runWriteTool. */
  execute: () => Promise<void>;
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
  const { confirm, ...boundArgs } = args;
  const plan = await buildPlan();

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

/**
 * Runs an Odoo write behind a Spanish, action-naming PERMISO_DENEGADO on
 * AccessError, instead of the generic ("no tienes permiso para VER estos
 * datos") mapping toMcpToolError gives every other AccessError in this
 * file. Only advance_order needs this: its writes go through an Odoo
 * wizard that enforces its OWN role check server-side (see this file's top
 * doc comment) — a caller can genuinely be rejected there even after
 * passing every check this file itself makes. The other four write tools
 * never hit Odoo's ACL this way; they're stopped earlier by
 * requireOfficeRole() before any RPC happens.
 */
async function withActionAccessError<T>(action: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && e.name === "OdooRpcError") {
      const err = e as Error & { errorName?: string };
      if (err.errorName === "odoo.exceptions.AccessError") {
        throw mcpError(
          "PERMISO_DENEGADO",
          `No tienes permiso en Odoo para ${action}. Pídele a alguien con el rol de esa etapa (o de oficina/gerencia) que lo haga.`,
        );
      }
    }
    throw e;
  }
}

// ---------------------------------------------------------------------
// Tool definitions (JSON Schema) — what the calling model reads to
// decide which tool to use and how to call it.
// ---------------------------------------------------------------------

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "today_board",
    title: "Today's production board",
    description:
      "Shows orders currently in an active production stage (excludes Invoiced/Paid and Closed), grouped by stage in pipeline order, up to 500 orders across all active stages (the working set is normally far smaller than that ceiling). Use this to answer 'what's on the board right now' questions like '¿qué hay para pintar hoy?' or 'what's in CNC today' without paging through the full order list. Returns one group per stage that has work in it, each with the matching orders (client, dealer, door count, install date), plus `shown`/`total`/`truncated` — check `truncated` before treating the result as complete; if true, narrow with find_orders (stage or dealer filter) instead.",
    inputSchema: {
      type: "object",
      properties: {
        limit: TODAY_BOARD_LIMIT_SCHEMA_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: "find_orders",
    title: "Find orders",
    description:
      "Searches orders by free text (matches order number, client name or dealer reference, case-insensitive partial match) and/or an exact stage code or dealer id. Use this when the user names a customer, an order number like 'IO-0007', a dealer reference, or wants orders in a specific stage — e.g. 'find Perez's order' or 'Lock Tight orders in painting'. Returns the most recently created matches first, wrapped as `{ items, total, truncated }` — up to 100 per call; page with `offset` (or narrow the search) when `truncated` is true rather than assuming `items` is everything. Use list_stages or list_dealers first if you need the exact code/id.",
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description:
            "Free text to match against order number, client name or dealer reference (ilike, case-insensitive, partial).",
        },
        stage: {
          type: "string",
          description:
            "Exact stage code to filter by (e.g. 'painting', 'cnc'). Get valid codes from list_stages — do not guess one.",
        },
        dealer_id: {
          type: "number",
          description: "Numeric dealer id to filter by. Get it from list_dealers — do not guess one.",
        },
        limit: LIMIT_SCHEMA_PROPERTY,
        offset: OFFSET_SCHEMA_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_order",
    title: "Get order detail",
    description:
      "Retrieves full detail for a single order by its numeric id: client contact info, dealer, stage, payment state, totals, and every door/line item (design code, color, dimensions, quantity, SQF). Use this once you already have an order id, e.g. from find_orders or today_board, and need the complete picture rather than the list summary. Returns null if the order doesn't exist or isn't visible to this user (never throws for a missing/invisible id — a numerically invalid id is the only case that throws).",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "The numeric indigo.order id, e.g. from a find_orders or today_board result.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_stages",
    title: "List production stages",
    description:
      "Lists the production pipeline stages (New Order through Closed) in their configured order, each with its numeric id, display name and short code (e.g. 'painting', 'cnc'). Stage codes are configurable per deployment, so call this before filtering by stage anywhere else instead of guessing a code — it's the ground truth for what stages actually exist right now. Wrapped as `{ items, total, truncated }`; there are normally well under 100 stages, but check `truncated` rather than assuming.",
    inputSchema: {
      type: "object",
      properties: {
        limit: LIMIT_SCHEMA_PROPERTY,
        offset: OFFSET_SCHEMA_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_dealers",
    title: "List dealers",
    description:
      "Lists the dealer companies that place orders with the shop (e.g. Lock Tight, Web Indigo, USA Windows), with their id, contact info and default price per SQF. Dealers are created dynamically, so call this before filtering orders by dealer or when the user names a dealer you don't recognize — never invent a dealer name or id. Wrapped as `{ items, total, truncated }`; page with `offset` if `truncated` is true.",
    inputSchema: {
      type: "object",
      properties: {
        limit: LIMIT_SCHEMA_PROPERTY,
        offset: OFFSET_SCHEMA_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_designs",
    title: "List catalog designs",
    description:
      "Lists catalog design codes (e.g. 'ID07-SD-W', 'TD-DD-B12') with name, door type and description, optionally filtered by text matching the code or name. Call this before referencing a design code you're not certain exists, or to help find the code for a design the user is describing — design codes are catalog data, not something to guess. Wrapped as `{ items, total, truncated }` — the catalog can exceed the 100-per-call cap, so a design missing from `items` is NOT proof it doesn't exist: check `truncated` and page with `offset` (or narrow with `q`) before telling the user a code is invalid.",
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Optional free text to match against design code or name (ilike, case-insensitive, partial).",
        },
        limit: LIMIT_SCHEMA_PROPERTY,
        offset: OFFSET_SCHEMA_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_people",
    title: "List internal staff",
    description:
      "Looks up internal Indigo staff by name and returns, per match, the numeric id — a res.partner id, exactly what assign_order's painter_id / installer_ids / clear_painter expect — their name, and their Indigo role(s) in plain terms (Manager, Office, Designer, CNC, Painter, Installer; a person can hold more than one). ALWAYS call this BEFORE assign_order to turn a name like 'Javier' into an id — never guess or invent one. Staff only: dealers and customers never show up here, no matter what they're named. If more than one plausible match comes back — there are, for example, two people named Javier in this deployment — do NOT pick one yourself: show the candidates (name + role) to the human and ask which one they mean. That disambiguation is the entire reason this tool reports roles. Wrapped as `{ items, total, truncated }`; narrow with `q` or page with `offset` if `truncated` is true.",
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Optional free text to match against the person's name (ilike, case-insensitive, partial).",
        },
        limit: LIMIT_SCHEMA_PROPERTY,
        offset: OFFSET_SCHEMA_PROPERTY,
      },
      additionalProperties: false,
    },
  },

  // ---------------------------------------------------------------------
  // Write tools (Fase 2) — every one previews before it writes. Call once
  // WITHOUT 'confirm' to see exactly what would change (no write happens);
  // call again with the returned 'confirm' token, unchanged, to execute.
  // See CONFIRM_SCHEMA_PROPERTY and runWriteTool() above.
  // ---------------------------------------------------------------------
  {
    name: "advance_order",
    title: "Advance an order to its next stage",
    description:
      "Moves ONE order forward in production by describing what actually happened — never by naming an Odoo model or wizard. The server picks the right step from the order's CURRENT stage and the 'outcome' you give it, and refuses (code CONFLICTO) if the order isn't in the stage that outcome applies to — call get_order first if you're not sure which stage it's in. Preview-then-confirm like every write tool here (see 'confirm'); the preview also tells you if this step will trigger a contractor payout or an email notification, so nothing is a surprise on confirm. Valid 'outcome' values: 'measurements_taken' (Measurement Pending -> Measured; installers/office/manager only; needs 'line_dimensions' with real width/height for every piece, inches), 'digitalization_done' (Ready for Digitalization -> CNC; office/manager only, NOT the designer — this emails the Ficha de orden PDF to the order's assigned designer and moves it to CNC; the order MUST already have a designer assigned or this refuses with CONFLICTO telling you to assign one first — never guess a designer; no SQF is entered at this step anymore), 'cnc_done' (CNC -> Painting; CNC/office/manager only; needs 'line_sqf' with the REAL decorated square footage measured for every piece — this number becomes the painter's pay, never estimate or invent it, and the call is refused if any piece is missing it), 'painting_done' (Painting -> Ready for Installation; painter/office/manager only; may generate a painter payout if one is assigned; optional 'photo_base64'), 'installed' (Installation Scheduled -> Installed; the assigned installer, office, or manager only; may generate installer payout(s); optional 'photo_base64'). Does NOT cover invoicing or marking an order paid — money is out of scope for this tool entirely, in every phase this tool exists in today.",
    inputSchema: {
      type: "object",
      properties: {
        order_id: {
          type: "number",
          description: "The numeric indigo.order id to advance. One order per call — this tool never advances more than one.",
        },
        outcome: {
          type: "string",
          enum: ["measurements_taken", "digitalization_done", "cnc_done", "painting_done", "installed"],
          description: "What actually happened, in the shop's own terms — see the tool description for what each one requires and which stage it moves from/to.",
        },
        note: {
          type: "string",
          description: "Optional short note added to the order's timeline alongside the stage change.",
        },
        photo_base64: {
          type: "string",
          description: "Optional photo as raw base64 (no 'data:' prefix). Only used for outcomes 'painting_done' and 'installed'; ignored for the others.",
        },
        line_sqf: {
          type: "object",
          description: "REQUIRED for outcome 'cnc_done', ignored otherwise. Maps EVERY order-line id (string key — get ids from get_order's 'lines') to its real decorated square footage. Must cover every piece on the order, no more and no less — the tool refuses if any piece is missing, an unknown line id is included, or a value is zero/not a positive number. This is what the painter gets paid on; never estimate or invent it.",
          additionalProperties: { type: "number" },
        },
        line_dimensions: {
          type: "object",
          description: "REQUIRED for outcome 'measurements_taken', ignored otherwise. Maps EVERY order-line id (string key) to its real {width, height} in inches. Must cover every piece on the order, no more and no less.",
          additionalProperties: {
            type: "object",
            properties: { width: { type: "number" }, height: { type: "number" } },
            required: ["width", "height"],
            additionalProperties: false,
          },
        },
        confirm: CONFIRM_SCHEMA_PROPERTY,
      },
      required: ["order_id", "outcome"],
      additionalProperties: false,
    },
  },
  {
    name: "assign_order",
    title: "Assign painter / installers to an order",
    description:
      "Sets who is responsible for painting and/or installing ONE order: the painter (single contractor) and/or the installer(s). installer_ids REPLACES the current set entirely — send the full list you want assigned, not just the ones to add. painter_id and installer_ids are res.partner ids — call list_people FIRST to resolve a name (e.g. 'Javier') to the right id, and to tell apart two staff members who share a first name; never guess one. Office/manager only. Preview-then-confirm like every write tool here (see 'confirm'). Provide at least one of painter_id, clear_painter or installer_ids — omit a field entirely to leave that assignment untouched.",
    inputSchema: {
      type: "object",
      properties: {
        order_id: {
          type: "number",
          description: "The numeric indigo.order id to update. One order per call.",
        },
        painter_id: {
          type: "number",
          description: "res.partner id of the painter to assign. Get it from list_people — do not guess one. Omit to leave the current painter unchanged; use clear_painter instead to remove one.",
        },
        clear_painter: {
          type: "boolean",
          description: "true removes the currently assigned painter. Mutually exclusive with painter_id.",
        },
        installer_ids: {
          type: "array",
          items: { type: "number" },
          description: "res.partner ids of the installer(s) to assign — REPLACES the current set. Get them from list_people — do not guess one. Pass an empty array to clear all installers. Omit to leave installers unchanged.",
        },
        confirm: CONFIRM_SCHEMA_PROPERTY,
      },
      required: ["order_id"],
      additionalProperties: false,
    },
  },
  {
    name: "schedule_install",
    title: "Schedule (or reschedule) an installation",
    description:
      "Sets the installation date for ONE order and moves it to the 'Installation Scheduled' stage, optionally (re)assigning installer(s) in the same call. installer_ids, if given, REPLACES the current set. Office/manager only. Preview-then-confirm like every write tool here (see 'confirm').",
    inputSchema: {
      type: "object",
      properties: {
        order_id: {
          type: "number",
          description: "The numeric indigo.order id to schedule. One order per call.",
        },
        installation_date: {
          type: "string",
          description: "Installation date as YYYY-MM-DD.",
        },
        installer_ids: {
          type: "array",
          items: { type: "number" },
          description: "res.partner ids of the installer(s) — REPLACES the current set. Omit to leave the currently assigned installer(s) unchanged.",
        },
        confirm: CONFIRM_SCHEMA_PROPERTY,
      },
      required: ["order_id", "installation_date"],
      additionalProperties: false,
    },
  },
  {
    name: "hold_order",
    title: "Put an order on hold, or release it",
    description:
      "Puts ONE order on hold (with a cause and an optional free-text reason) or releases it from hold. 'cause' is REQUIRED when action is 'hold' — it's how Majela tells apart a door blocked by the DEALER (they need to fix something first) from one blocked by the CLIENT (not available / hasn't responded), and it drives the dealer/client counters and colors on the Installations screen. If the human hasn't said which one it is, ASK before calling this tool with action 'hold' — never guess a cause. Office/manager only. Preview-then-confirm like every write tool here (see 'confirm').",
    inputSchema: {
      type: "object",
      properties: {
        order_id: {
          type: "number",
          description: "The numeric indigo.order id to hold or release. One order per call.",
        },
        action: {
          type: "string",
          enum: ["hold", "release"],
          description: "'hold' puts the order on hold; 'release' clears an existing hold.",
        },
        cause: {
          type: "string",
          enum: ["dealer", "client", "other"],
          description: "Who/what is blocking this order. REQUIRED when action is 'hold' — ask the human if they didn't say: 'dealer' when the dealer has to fix or provide something before work can continue, 'client' when the end client isn't available or hasn't confirmed, 'other' only when neither fits. Ignored when action is 'release'.",
        },
        reason: {
          type: "string",
          description: "Optional free-text detail on top of 'cause' (e.g. exactly what the dealer needs to fix), used only when action is 'hold'. Shown on the order's hold banner in the panel and in its timeline.",
        },
        confirm: CONFIRM_SCHEMA_PROPERTY,
      },
      required: ["order_id", "action"],
      additionalProperties: false,
    },
  },
  {
    name: "add_note",
    title: "Add a note to an order's timeline",
    description:
      "Appends a note to ONE order's timeline without changing its stage — the right tool for logging an incident, a client call, or any other context that shouldn't move the order backward or forward. Can also open or close the order's 'incidence' flag (visible on dashboards) in the same call. Office/manager only. Preview-then-confirm like every write tool here (see 'confirm').",
    inputSchema: {
      type: "object",
      properties: {
        order_id: {
          type: "number",
          description: "The numeric indigo.order id to annotate. One order per call.",
        },
        note: {
          type: "string",
          description: "The note text.",
        },
        incidence: {
          type: "boolean",
          description: "Optional. true flags the order as an open incidence; false closes an open incidence. Omit to leave the incidence flag unchanged.",
        },
        confirm: CONFIRM_SCHEMA_PROPERTY,
      },
      required: ["order_id", "note"],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------

/** Fields shared by today_board / find_orders — exactly what formatOrder consumes. */
const ORDER_LIST_FIELDS = [
  "id",
  "name",
  "client_name",
  "client_address",
  "stage_id",
  "dealer_id",
  "installation_date",
  "door_count",
];

interface StageRow {
  id: number;
  name: string;
  code: string;
  sequence: number;
}

async function todayBoard(args: Record<string, unknown>, id: McpIdentity) {
  const execute = await getRpc();
  const limit = clampLimitTo(args.limit, TODAY_BOARD_LIMIT, TODAY_BOARD_LIMIT);

  // Same "active production" domain as src/app/api/kanban/route.ts's
  // default (non-archived) view: everything except Invoiced/Paid and Closed.
  const activeDomain = [["stage_id.code", "not in", ["closed", "invoiced"]]];

  // Same stage list (ordered by sequence) as src/app/api/stages/route.ts
  // and src/app/api/kanban/route.ts.
  const [stageRows, orderRows, total] = await Promise.all([
    execute<StageRow[]>(
      id.uid,
      id.apiKey,
      "indigo.stage",
      "search_read",
      [[], ["id", "name", "code", "sequence"]],
      { order: "sequence, id", limit: 50 },
    ),
    execute<Array<Record<string, unknown>>>(
      id.uid,
      id.apiKey,
      "indigo.order",
      "search_read",
      [activeDomain, ORDER_LIST_FIELDS],
      { order: "last_stage_change asc, id desc", limit },
    ),
    execute<number>(id.uid, id.apiKey, "indigo.order", "search_count", [activeDomain], {}),
  ]);

  const byStageId = new Map<number, FormattedOrder[]>();
  for (const row of orderRows) {
    const stageTuple = row.stage_id as [number, string] | false;
    const stageId = Array.isArray(stageTuple) ? stageTuple[0] : 0;
    const list = byStageId.get(stageId) ?? [];
    list.push(formatOrder(row));
    byStageId.set(stageId, list);
  }

  const stages = stageRows
    .map((s) => ({ stage: s.name, code: s.code, orders: byStageId.get(s.id) ?? [] }))
    .filter((group) => group.orders.length > 0);

  return { stages, shown: orderRows.length, total, truncated: orderRows.length < total };
}

async function findOrders(args: Record<string, unknown>, id: McpIdentity) {
  const execute = await getRpc();
  const limit = clampLimit(args.limit);
  const offset = clampOffset(args.offset);

  // Same ilike-on-3-fields pattern as src/app/api/orders/route.ts's `?q=`.
  const domain: unknown[] = [];
  const q = typeof args.q === "string" ? args.q.trim() : "";
  if (q) {
    domain.push("|", "|");
    domain.push(["name", "ilike", q]);
    domain.push(["client_name", "ilike", q]);
    domain.push(["dealer_ref", "ilike", q]);
  }
  if (typeof args.stage === "string" && args.stage.trim()) {
    domain.push(["stage_id.code", "=", args.stage.trim()]);
  }
  if (typeof args.dealer_id === "number" && Number.isFinite(args.dealer_id)) {
    domain.push(["dealer_id", "=", args.dealer_id]);
  }

  const [rows, total] = await Promise.all([
    execute<Array<Record<string, unknown>>>(
      id.uid,
      id.apiKey,
      "indigo.order",
      "search_read",
      [domain, ORDER_LIST_FIELDS],
      { order: "create_date desc", limit, offset },
    ),
    execute<number>(id.uid, id.apiKey, "indigo.order", "search_count", [domain], {}),
  ]);

  const items = rows.map(formatOrder);
  return { items, total, truncated: offset + items.length < total };
}

async function getOrder(args: Record<string, unknown>, id: McpIdentity) {
  const execute = await getRpc();
  const orderId = Number(args.id);
  if (!Number.isFinite(orderId)) {
    throw mcpError("ENTRADA_INVALIDA", "get_order requiere un 'id' numérico.");
  }

  // Field subset of ORDER_FIELDS_BASE in src/app/api/orders/[id]/route.ts.
  // search_read (not read) so a missing/invisible id comes back as an empty
  // array like every other list call, instead of `read` raising
  // MissingError/AccessError — that's what makes "returns null" in the
  // tool's description actually true instead of a dead branch.
  const rows = await execute<Array<Record<string, unknown>>>(
    id.uid,
    id.apiKey,
    "indigo.order",
    "search_read",
    [
      [["id", "=", orderId]],
      [
        "id",
        "name",
        "client_name",
        "client_phone",
        "client_email",
        "client_address",
        "stage_id",
        "dealer_id",
        "dealer_ref",
        "on_hold",
        "payment_state",
        "door_count",
        "total_sqf",
        "total_dealer_charge",
        "installation_date",
        "expected_completion_date",
        "priv_ref",
        "customer_po",
        "notes",
      ],
    ],
    { limit: 1 },
  );
  if (!rows.length) return null;
  const order = rows[0];

  // Field subset of LINE_FIELDS_BASE in src/app/api/orders/[id]/route.ts,
  // fetched by order_id like the `?include=lines` path in
  // src/app/api/orders/route.ts.
  const lineRows = await execute<Array<Record<string, unknown>>>(
    id.uid,
    id.apiKey,
    "indigo.order.line",
    "search_read",
    [
      [["order_id", "=", orderId]],
      ["id", "design_id", "door_type", "color", "width", "height", "qty", "parts_count", "sqf"],
    ],
    { order: "sequence, id", limit: 100 },
  );

  return {
    ...formatOrder(order),
    phone: emptyToNull(order.client_phone as string | false),
    email: emptyToNull(order.client_email as string | false),
    dealer_ref: emptyToNull(order.dealer_ref as string | false),
    on_hold: !!order.on_hold,
    payment_state: emptyToNull(order.payment_state as string | false),
    total_sqf: emptyToNull(order.total_sqf as number | false),
    total_dealer_charge: emptyToNull(order.total_dealer_charge as number | false),
    expected_completion_date: emptyToNull(order.expected_completion_date as string | false),
    priv_ref: emptyToNull(order.priv_ref as string | false),
    customer_po: emptyToNull(order.customer_po as string | false),
    notes: emptyToNull(order.notes as string | false),
    lines: lineRows.map(formatOrderLine),
  };
}

async function listStages(args: Record<string, unknown>, id: McpIdentity) {
  const execute = await getRpc();
  const limit = clampLimit(args.limit);
  const offset = clampOffset(args.offset);

  // Same model/fields/order as src/app/api/stages/route.ts.
  const [rows, total] = await Promise.all([
    execute<StageRow[]>(
      id.uid,
      id.apiKey,
      "indigo.stage",
      "search_read",
      [[], ["id", "name", "code", "sequence"]],
      { order: "sequence, id", limit, offset },
    ),
    execute<number>(id.uid, id.apiKey, "indigo.stage", "search_count", [[]], {}),
  ]);

  const items = rows.map((r) => ({ id: r.id, name: r.name, code: r.code, sequence: r.sequence }));
  return { items, total, truncated: offset + items.length < total };
}

async function listDealers(args: Record<string, unknown>, id: McpIdentity) {
  const execute = await getRpc();
  const limit = clampLimit(args.limit);
  const offset = clampOffset(args.offset);

  // Same domain/fields as src/app/api/catalog/dealers/route.ts (default,
  // non-archived view).
  const domain = [["is_indigo_dealer", "=", true]];
  const [rows, total] = await Promise.all([
    execute<Array<Record<string, unknown>>>(
      id.uid,
      id.apiKey,
      "res.partner",
      "search_read",
      [domain, ["id", "name", "email", "phone", "city", "indigo_default_price_per_sqf"]],
      { order: "name asc", limit, offset },
    ),
    execute<number>(id.uid, id.apiKey, "res.partner", "search_count", [domain], {}),
  ]);

  const items = rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    email: emptyToNull(r.email as string | false),
    phone: emptyToNull(r.phone as string | false),
    city: emptyToNull(r.city as string | false),
    price_per_sqf: emptyToNull(r.indigo_default_price_per_sqf as number | false),
  }));
  return { items, total, truncated: offset + items.length < total };
}

async function listDesigns(args: Record<string, unknown>, id: McpIdentity) {
  const execute = await getRpc();
  const limit = clampLimit(args.limit);
  const offset = clampOffset(args.offset);

  // Same ilike-on-code-or-name pattern as src/app/api/catalog/designs/route.ts.
  const domain: unknown[] = [];
  const q = typeof args.q === "string" ? args.q.trim() : "";
  if (q) {
    domain.push("|");
    domain.push(["code", "ilike", q]);
    domain.push(["name", "ilike", q]);
  }

  const [rows, total] = await Promise.all([
    execute<Array<Record<string, unknown>>>(
      id.uid,
      id.apiKey,
      "indigo.design",
      "search_read",
      [domain, ["id", "code", "name", "description", "door_type"]],
      { order: "code asc", limit, offset },
    ),
    execute<number>(id.uid, id.apiKey, "indigo.design", "search_count", [domain], {}),
  ]);

  const items = rows.map((r) => ({
    id: r.id as number,
    code: r.code as string,
    name: emptyToNull(r.name as string | false),
    description: emptyToNull(r.description as string | false),
    door_type: emptyToNull(r.door_type as string | false),
  }));
  return { items, total, truncated: offset + items.length < total };
}

/** Raw fetch cap for list_people's res.users read — NOT the caller-facing
 *  `limit` (that's applied afterward, to the already-internal-only list; see
 *  listPeople below). Exists only to bound the initial fetch before this
 *  tool's own internal-only filtering runs client-side, because that filter
 *  can't be pushed into the Odoo domain (see listPeople's doc comment for
 *  why). A taller running ~20-40 doors at a time has, at most, a handful of
 *  internal accounts — nowhere near this ceiling.
 */
const PEOPLE_FETCH_LIMIT = 500;

interface PersonUserRow {
  id: number;
  name: string;
  partner_id: [number, string] | false;
  groups_id: number[];
}

/** Same shape token.ts's verifyMcpToken reads res.groups into: `full_name`
 *  when present (Odoo's "<Category> / <Group>" form, e.g. "Indigo Decors /
 *  Manager" or "User types / Internal User"), falling back to `name`. Both
 *  isInternalUser (./token.ts) and deriveRole (@/lib/odoo/types) key off
 *  this exact string shape — see PersonRow's derivation in listPeople.
 */
interface PersonGroupRow {
  id: number;
  name: string;
  full_name?: string;
}

export interface PersonRow {
  id: number;
  name: string;
  roles: string[];
}

/**
 * Human labels for deriveRole's flags — Manager / Office / Designer / CNC /
 * Painter / Installer, the exact wording list_people's own tool description
 * promises. Unlike indigo_team_list's `role` field
 * (c:/Trabajo/odoo-indigo/addons/indigo_decors/models/indigo_team.py,
 * read-only reference), which reports only the FIRST matching role, this
 * reports EVERY role the person actually holds: list_people's whole job is
 * disambiguating people, so silently hiding a second role a person holds
 * would work against the tool's own purpose.
 */
export function personRoleLabels(role: {
  isManager: boolean;
  isOffice: boolean;
  isDesigner: boolean;
  isCnc: boolean;
  isPainter: boolean;
  isInstaller: boolean;
}): string[] {
  const labels: string[] = [];
  if (role.isManager) labels.push("Manager");
  if (role.isOffice) labels.push("Office");
  if (role.isDesigner) labels.push("Designer");
  if (role.isCnc) labels.push("CNC");
  if (role.isPainter) labels.push("Painter");
  if (role.isInstaller) labels.push("Installer");
  return labels;
}

/**
 * Resolves internal staff by name to the res.partner id assign_order needs
 * (painter_id / installer_ids are Many2one/Many2many onto res.partner, NOT
 * res.users — verified against
 * c:/Trabajo/odoo-indigo/addons/indigo_decors/models/indigo_order.py and
 * against how the panel's own /api/contractors route already resolves this
 * exact id for its assignment dropdowns: `u.partner_id[0]`, never `u.id`).
 * Every res.users record carries a linked res.partner, so this is available
 * for any internal user, not just contractors.
 *
 * "Internal" is decided the SAME way route.ts's own MCP-access gate decides
 * it — isInternalUser(groups) from ./token.ts, checking for the "User types
 * / Internal User" group — deliberately NOT a hand-rolled Odoo domain
 * (e.g. `share = false`, the mechanism a couple of panel routes use): a
 * second, different definition of "internal" living in this file would be
 * one more thing that could quietly drift from what actually gates the MCP
 * server itself. Because that check needs each user's group NAMES (not just
 * ids), this fetches res.users broadly first, then res.groups once for the
 * union of every group id referenced, then filters/shapes client-side —
 * there's no way to ask Odoo for "share this JS function's definition of
 * internal" directly in a domain.
 */
async function listPeople(args: Record<string, unknown>, id: McpIdentity) {
  const execute = await getRpc();
  const deriveRole = await getDeriveRole();
  const limit = clampLimit(args.limit);
  const offset = clampOffset(args.offset);

  const domain: unknown[] = [];
  const q = typeof args.q === "string" ? args.q.trim() : "";
  if (q) domain.push(["name", "ilike", q]);

  const users = await execute<PersonUserRow[]>(
    id.uid,
    id.apiKey,
    "res.users",
    "search_read",
    [domain, ["id", "name", "partner_id", "groups_id"]],
    { order: "name asc", limit: PEOPLE_FETCH_LIMIT },
  );

  const groupIds = [...new Set(users.flatMap((u) => u.groups_id))];
  const groupNameById = new Map<number, string>();
  if (groupIds.length) {
    const groupRows = await execute<PersonGroupRow[]>(
      id.uid,
      id.apiKey,
      "res.groups",
      "read",
      [groupIds, ["name", "full_name"]],
      {},
    );
    for (const g of groupRows) groupNameById.set(g.id, g.full_name ?? g.name);
  }

  const people: PersonRow[] = [];
  for (const u of users) {
    const groupNames = u.groups_id.map((gid) => groupNameById.get(gid)).filter((n): n is string => !!n);
    if (!isInternalUser(groupNames)) continue; // dealer/customer portal login — never staff
    const partnerId = Array.isArray(u.partner_id) ? u.partner_id[0] : null;
    if (!partnerId) continue; // defensive: every real res.users has one, but never fabricate an id
    people.push({ id: partnerId, name: u.name, roles: personRoleLabels(deriveRole(groupNames)) });
  }

  const items = people.slice(offset, offset + limit);
  return { items, total: people.length, truncated: offset + items.length < people.length };
}

// ---------------------------------------------------------------------
// Write tools (Fase 2)
// ---------------------------------------------------------------------

/** Posted to indigo.order's chatter after every successful write made via
 *  advance_order, in addition to (never instead of) the wizard's own
 *  descriptive note — attribution to the real person happens automatically
 *  (the RPC runs as them), this just marks that an assistant drove it. */
const AI_ORIGIN_NOTE = "Acción ejecutada a través del asistente de IA (MCP).";

/** Appended to the human-written note body posted by assign_order,
 *  schedule_install, hold_order and add_note — those tools construct their
 *  OWN descriptive chatter message directly (there's no separate wizard
 *  note to avoid duplicating), so the origin marker rides in the same
 *  message rather than as a second chatter line. */
const AI_ORIGIN_SUFFIX = " (vía asistente de IA)";

/** The flag names on deriveRole()'s result — kept tied to that function's
 *  return type so adding or renaming a role there breaks this at compile
 *  time instead of silently un-gating a transition. */
type RoleFlag = keyof ReturnType<typeof OdooTypes.deriveRole>;

interface AdvanceOutcome {
  /** Odoo TransientModel wizard driven via create() + action_save_and_advance().
   *  Exactly one of `wizardModel` / `orderMethod` is set per outcome. */
  wizardModel?: string;
  /** A plain method called directly on indigo.order — no wizard record,
   *  no per-piece line writes, no note/photo (Odoo's method takes no
   *  arguments beyond the order id). Only 'digitalization_done' uses this;
   *  see planAdvanceOrder's execute() below for the two different Odoo
   *  call shapes this drives. */
  orderMethod?: string;
  fromStageCode: string;
  toStageLabel: string;
  actionLabel: string;
  roleHint: string;
  requiresLineSqf?: boolean;
  requiresLineDimensions?: boolean;
  /** Refuse up front (CONFLICTO) if the order has no designer_id, instead
   *  of letting action_send_to_designer's own UserError surface deep in
   *  execute() — the assistant must never guess who the Ficha goes to. */
  requiresDesigner?: boolean;
  supportsPhoto?: boolean;
  /** Roles Odoo will accept for this transition, mirroring the wizard's own
   *  `_indigo_require_groups(...)` call (or, for digitalization_done,
   *  `indigo.order._indigo_assert_can_send_to_designer`). See
   *  assertMayAdvance below for why this has to be checked HERE and not
   *  merely left to Odoo. Admins bypass it, exactly as `user._is_admin()`
   *  does inside every one of those wizards. */
  allowedRoles: RoleFlag[];
  /** installed only: an internal installer may close an install, but ONLY
   *  one assigned to them (their partner in the order's installer_ids) —
   *  same carve-out as indigo.installed.wizard.action_save_and_advance. */
  allowsAssignedInstaller?: boolean;
  /** When set, order.write's stage-change hook
   *  (c:/Trabajo/odoo-indigo/addons/indigo_decors/models/indigo_order.py,
   *  read-only reference — see this file's top doc comment) generates a
   *  draft payout for whoever is assigned to this role, IF anyone is. */
  triggersPayoutFor?: "painter" | "installer";
}

/**
 * outcome -> either an Odoo stage wizard (wizardModel) or a direct
 * indigo.order method call (orderMethod), verified against
 * c:/Trabajo/odoo-indigo/addons/indigo_decors/wizards/{indigo_stage_wizards,
 * indigo_measurement_entry_wizard}.py, models/indigo_order.py and
 * data/indigo_stages.xml (read-only reference, never modified from this
 * repo).
 *
 * 'digitalization_done' is the odd one out. Majela's 2026-08-15 request
 * removed per-line SQF entry from Digitalization entirely — the wizard
 * that used to live there (indigo.sqf.entry.wizard) was deleted from the
 * addon, not just unwired. The ONLY way out of that stage now is
 * indigo.order.action_send_to_designer(), a plain model method (not a
 * TransientModel wizard): it emails the Ficha de orden PDF to designer_id
 * and advances the stage in one call, and it requires designer_id to
 * already be set (requiresDesigner below) — Odoo raises a UserError
 * otherwise, which this tool pre-empts with a clearer CONFLICTO. SQF entry
 * moved to 'cnc_done' instead (requiresLineSqf there): it's still needed,
 * just one stage later, because total_painter_payout is computed from
 * line_ids.sqf when the order LEAVES Painting (indigo_order.py's write()
 * stage-change hook via _create_painter_payout), and nothing else ever
 * sets it — skipping SQF at cnc_done would silently pay the painter $0.
 *
 * Deliberately excludes the sixth stage wizard, indigo.invoiced.paid.wizard
 * (installed -> invoiced) — it moves money, which is out of scope for
 * advance_order entirely, per this phase's brief ("never anything touching
 * money"), not merely role-gated like the rest already are inside Odoo
 * itself.
 */
export const ADVANCE_OUTCOMES: Record<string, AdvanceOutcome> = {
  measurements_taken: {
    wizardModel: "indigo.measurement.entry.wizard",
    fromStageCode: "measure_pending",
    toStageLabel: "Measured",
    actionLabel: "registrar las medidas y pasar la orden a 'Measured'",
    roleHint: "Pueden hacerlo instaladores, oficina o gerencia.",
    requiresLineDimensions: true,
    allowedRoles: ["isInstaller", "isOffice", "isManager"],
  },
  digitalization_done: {
    orderMethod: "action_send_to_designer",
    fromStageCode: "ready_digitalization",
    toStageLabel: "CNC / Router",
    actionLabel: "enviar la Ficha de orden por correo al diseñador/a asignado y pasar la orden a CNC",
    roleHint: "Solo puede hacerlo oficina o gerencia (no el diseñador/a) — es quien confirma que la Ficha está lista para salir.",
    requiresDesigner: true,
    allowedRoles: ["isOffice", "isManager"],
  },
  cnc_done: {
    wizardModel: "indigo.cnc.done.wizard",
    fromStageCode: "cnc",
    toStageLabel: "Painting",
    actionLabel: "registrar el SQF real de cada pieza, marcar el corte CNC como terminado y enviar la orden a Pintura",
    roleHint: "Pueden hacerlo CNC, oficina o gerencia.",
    requiresLineSqf: true,
    allowedRoles: ["isCnc", "isOffice", "isManager"],
  },
  painting_done: {
    wizardModel: "indigo.painter.done.wizard",
    fromStageCode: "painting",
    toStageLabel: "Ready for Installation",
    actionLabel: "marcar la pintura como terminada y dejar la orden lista para instalación",
    roleHint: "Pueden hacerlo pintura, oficina o gerencia.",
    supportsPhoto: true,
    triggersPayoutFor: "painter",
    allowedRoles: ["isPainter", "isOffice", "isManager"],
  },
  installed: {
    wizardModel: "indigo.installed.wizard",
    fromStageCode: "install_scheduled",
    toStageLabel: "Installed",
    actionLabel: "marcar la orden como instalada",
    roleHint: "Puede hacerlo el instalador asignado a esta orden, oficina o gerencia.",
    supportsPhoto: true,
    triggersPayoutFor: "installer",
    allowedRoles: ["isOffice", "isManager"],
    allowsAssignedInstaller: true,
  },
};

interface AdvanceOrderRow {
  id: number;
  name: string;
  client_name: string;
  stage_id: [number, string] | false;
  stage_code: string | false;
  painter_id: [number, string] | false;
  installer_ids: number[];
  assigned_user_ids: number[];
  designer_id: [number, string] | false;
}

/** Validates that `provided`'s keys are EXACTLY the order's line ids (as
 *  strings) — no missing piece, no unknown line id — and that every value
 *  passes `checkValue`. Shared by the line_sqf and line_dimensions checks
 *  in planAdvanceOrder, which differ only in field name and value shape. */
function requireCompleteLineMap(
  provided: unknown,
  lineIds: number[],
  fieldName: string,
  outcome: string,
  checkValue: (v: unknown) => boolean,
  valueHint: string,
): Record<string, unknown> {
  if (!provided || typeof provided !== "object" || Array.isArray(provided)) {
    throw mcpError(
      "ENTRADA_INVALIDA",
      `outcome '${outcome}' requiere '${fieldName}' como un objeto con una entrada por cada pieza de la orden (ids: ${lineIds.join(", ") || "ninguna"}).`,
    );
  }
  const map = provided as Record<string, unknown>;
  const expected = new Set(lineIds.map(String));
  const providedKeys = Object.keys(map);
  const missing = [...expected].filter((k) => !providedKeys.includes(k));
  const extra = providedKeys.filter((k) => !expected.has(k));
  if (missing.length || extra.length || expected.size === 0) {
    const parts: string[] = [];
    if (expected.size === 0) parts.push("esta orden no tiene piezas registradas");
    if (missing.length) parts.push(`faltan las piezas ${missing.join(", ")}`);
    if (extra.length) parts.push(`hay ids que no pertenecen a esta orden: ${extra.join(", ")}`);
    throw mcpError(
      "ENTRADA_INVALIDA",
      `'${fieldName}' debe traer exactamente una entrada por cada pieza de la orden (${parts.join("; ")}). No lo completes a medias ni lo inventes — pídele el dato real a la persona.`,
    );
  }
  for (const [lineId, value] of Object.entries(map)) {
    if (!checkValue(value)) {
      throw mcpError("ENTRADA_INVALIDA", `'${fieldName}' de la pieza ${lineId} ${valueHint}.`);
    }
  }
  return map;
}

/** cnc_done's per-line SQF requirement — extracted from planAdvanceOrder so
 *  it's directly unit-testable without a live Odoo (see tools.test.ts):
 *  this is the exact validation that stands between the assistant and
 *  silently sending the painter's payout computation a bunch of zeros (see
 *  the ADVANCE_OUTCOMES doc comment above for why line_ids.sqf feeds
 *  total_painter_payout down the line). */
export function requireLineSqf(provided: unknown, lineIds: number[], outcome: string): Record<string, unknown> {
  return requireCompleteLineMap(
    provided,
    lineIds,
    "line_sqf",
    outcome,
    (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
    "debe ser un número mayor que 0 (SQF real, no estimado)",
  );
}

/** Human labels for the role flags, for the denial message. */
const ROLE_FLAG_LABELS: Record<RoleFlag, string> = {
  isManager: "gerencia",
  isOffice: "oficina",
  isDesigner: "diseño",
  isPainter: "pintura",
  isCnc: "CNC",
  isInstaller: "instalación",
};

/**
 * Refuses the transition unless the caller holds a role Odoo would accept,
 * BEFORE anything is written.
 *
 * Why this can't be left to Odoo alone. The wizards do check roles — but
 * they check inside `action_save_and_advance`, which is the LAST call this
 * tool makes. The per-line `sqf` / `width` / `height` writes that
 * `cnc_done` and `measurements_taken` need happen first, in their own RPCs,
 * against `indigo.order.line` — and `ir.model.access.csv` grants write on
 * that model to `group_indigo_user`, the base group every internal role
 * implies. So without this gate the sequence for, say, a painter calling
 * `cnc_done` was: overwrite every piece's SQF (committed), then get an
 * AccessError from the wizard, then truthfully report failure — while
 * `total_sqf` had already changed underneath. That matters because
 * `total_sqf x rate` IS the painter's pay (`_create_painter_payout` fires
 * when the order leaves Painting), so a "failed" call could still move
 * money.
 *
 * This mirrors each wizard's own `_indigo_require_groups(...)` list rather
 * than replacing it — the addon keeps its check, this just makes sure we
 * never write before it has had its say. Kept in ADVANCE_OUTCOMES next to
 * each transition so the two lists are diffable side by side.
 */
async function assertMayAdvance(
  outcome: string,
  config: AdvanceOutcome,
  id: McpIdentity,
  order: AdvanceOrderRow,
  execute: Awaited<ReturnType<typeof getRpc>>,
): Promise<void> {
  // Same bypass every wizard opens with (`user._is_admin()`).
  if (id.isAdmin) return;

  const deriveRole = await getDeriveRole();
  const role = deriveRole(id.groups);
  if (config.allowedRoles.some((flag) => role[flag])) return;

  if (config.allowsAssignedInstaller && role.isInstaller) {
    // An internal installer may close their OWN install. installer_ids
    // holds partners, so resolve the caller's partner to compare.
    const userRows = await execute<Array<{ partner_id: [number, string] | false }>>(
      id.uid,
      id.apiKey,
      "res.users",
      "read",
      [[id.uid], ["partner_id"]],
      {},
    );
    const partnerId = userRows[0]?.partner_id ? userRows[0].partner_id[0] : null;
    if (partnerId !== null && order.installer_ids.includes(partnerId)) return;
    throw mcpError(
      "PERMISO_DENEGADO",
      `La orden ${order.name} no está asignada a ti como instalador, así que no puedes marcarla como instalada. Si te toca a ti, pide en oficina que te asignen la instalación primero.`,
    );
  }

  const allowed = config.allowedRoles.map((flag) => ROLE_FLAG_LABELS[flag]).join(", ");
  const suffix = config.allowsAssignedInstaller ? `, ${ROLE_FLAG_LABELS.isInstaller} (solo la orden asignada a esa persona)` : "";
  throw mcpError(
    "PERMISO_DENEGADO",
    `Tu cuenta (${id.login}) no tiene permiso para '${outcome}' en la orden ${order.name}. Esta acción es de: ${allowed}${suffix}. No se modificó nada. Pídeselo a alguien con ese rol.`,
  );
}

async function planAdvanceOrder(args: Record<string, unknown>, id: McpIdentity): Promise<WritePlan> {
  const orderId = requireOrderId(args, "advance_order");
  const outcome = typeof args.outcome === "string" ? args.outcome : "";
  const config = ADVANCE_OUTCOMES[outcome];
  if (!config) {
    throw mcpError(
      "ENTRADA_INVALIDA",
      `outcome inválido: '${args.outcome ?? ""}'. Usa uno de: ${Object.keys(ADVANCE_OUTCOMES).join(", ")}.`,
    );
  }

  const execute = await getRpc();
  const rows = await execute<AdvanceOrderRow[]>(
    id.uid,
    id.apiKey,
    "indigo.order",
    "search_read",
    [
      [["id", "=", orderId]],
      [
        "id",
        "name",
        "client_name",
        "stage_id",
        "stage_code",
        "painter_id",
        "installer_ids",
        "assigned_user_ids",
        "designer_id",
      ],
    ],
    { limit: 1 },
  );
  if (!rows.length) throw mcpError("NO_ENCONTRADO", `No existe la orden ${orderId}.`);
  const order = rows[0];

  // BEFORE any write, and before we even describe the action: a caller
  // without the role must never reach the per-line writes below. See
  // assertMayAdvance's doc comment for what that used to cost.
  await assertMayAdvance(outcome, config, id, order, execute);

  if (order.stage_code !== config.fromStageCode) {
    const currentStage = m2oLabel(order.stage_id) ?? "(sin etapa)";
    throw mcpError(
      "CONFLICTO",
      `La orden ${order.name} está actualmente en la etapa '${currentStage}', no en la etapa donde aplica el outcome '${outcome}'. Usa get_order para confirmar la etapa actual y elige el outcome correcto.`,
    );
  }

  if (config.requiresDesigner && !order.designer_id) {
    throw mcpError(
      "CONFLICTO",
      `La orden ${order.name} no tiene diseñador/a asignado. Asígnalo desde la ficha de la orden en el panel de Odoo antes de enviarla a digitalización — el asistente no puede adivinar quién debe recibir la Ficha.`,
    );
  }

  let lineIds: number[] = [];
  if (config.requiresLineSqf || config.requiresLineDimensions) {
    const lineRows = await execute<Array<{ id: number }>>(
      id.uid,
      id.apiKey,
      "indigo.order.line",
      "search_read",
      [[["order_id", "=", orderId]], ["id"]],
      {},
    );
    lineIds = lineRows.map((l) => l.id);
  }

  let lineSqf: Record<string, unknown> | undefined;
  if (config.requiresLineSqf) {
    lineSqf = requireLineSqf(args.line_sqf, lineIds, outcome);
  }

  let lineDims: Record<string, unknown> | undefined;
  if (config.requiresLineDimensions) {
    lineDims = requireCompleteLineMap(
      args.line_dimensions,
      lineIds,
      "line_dimensions",
      outcome,
      (v) =>
        !!v &&
        typeof v === "object" &&
        typeof (v as { width?: unknown }).width === "number" &&
        Number.isFinite((v as { width: number }).width) &&
        (v as { width: number }).width > 0 &&
        typeof (v as { height?: unknown }).height === "number" &&
        Number.isFinite((v as { height: number }).height) &&
        (v as { height: number }).height > 0,
      "debe traer {width, height} en pulgadas, ambos mayores que 0",
    );
  }

  const noteArg = typeof args.note === "string" ? args.note.trim() : "";
  const photoArg = config.supportsPhoto && typeof args.photo_base64 === "string" ? args.photo_base64 : "";

  const messageParts = [`Orden ${order.name} (${order.client_name}): ${config.actionLabel}.`];
  if (config.orderMethod === "action_send_to_designer" && order.designer_id) {
    messageParts.push(
      `Se enviará la Ficha de orden (PDF) por correo a ${m2oLabel(order.designer_id)} y la orden pasará a CNC.`,
    );
  }
  if (config.triggersPayoutFor === "painter" && order.painter_id) {
    messageParts.push(`Esto generará un pago borrador para el pintor asignado (${m2oLabel(order.painter_id)}).`);
  }
  if (config.triggersPayoutFor === "installer" && order.installer_ids.length > 0) {
    messageParts.push(
      `Esto generará pago(s) borrador para ${order.installer_ids.length === 1 ? "el instalador asignado" : "los instaladores asignados"}.`,
    );
  }
  if (order.assigned_user_ids.length > 0) {
    messageParts.push("Se enviará un correo de notificación a los usuarios asignados a la orden.");
  }
  messageParts.push(config.roleHint);

  return {
    message: messageParts.join(" "),
    extra: { order: order.name, client: order.client_name },
    execute: async () => {
      if (lineSqf) {
        await Promise.all(
          Object.entries(lineSqf).map(([lineIdStr, sqf]) =>
            execute(id.uid, id.apiKey, "indigo.order.line", "write", [[Number(lineIdStr)], { sqf: sqf as number }], {}),
          ),
        );
      }
      if (lineDims) {
        await Promise.all(
          Object.entries(lineDims).map(([lineIdStr, dim]) => {
            const d = dim as { width: number; height: number };
            return execute(
              id.uid,
              id.apiKey,
              "indigo.order.line",
              "write",
              [[Number(lineIdStr)], { width: d.width, height: d.height }],
              {},
            );
          }),
        );
      }

      await withActionAccessError(config.actionLabel, async () => {
        if (config.orderMethod) {
          // Direct indigo.order method call (action_send_to_designer) —
          // no wizard record to create, and the Odoo method itself takes
          // no arguments beyond the order id (it reads designer_id off the
          // order). note/photo_base64 aren't accepted by it, so a caller's
          // 'note' is posted separately below instead of silently dropped.
          await execute(id.uid, id.apiKey, "indigo.order", config.orderMethod, [[orderId]], {});
        } else if (config.wizardModel) {
          const payload: Record<string, unknown> = { order_id: orderId };
          if (noteArg) payload.note = noteArg;
          if (photoArg) payload.photo = photoArg;
          const wizardId = await execute<number>(id.uid, id.apiKey, config.wizardModel, "create", [payload], {});
          await execute(id.uid, id.apiKey, config.wizardModel, "action_save_and_advance", [[wizardId]], {});
        }
      });

      if (config.orderMethod && noteArg) {
        await execute(id.uid, id.apiKey, "indigo.order", "message_post", [[orderId]], {
          body: noteArg,
          message_type: "comment",
        }).catch(() => undefined);
      }

      await execute(id.uid, id.apiKey, "indigo.order", "message_post", [[orderId]], {
        body: AI_ORIGIN_NOTE,
        message_type: "comment",
      }).catch(() => undefined);
    },
  };
}

async function advanceOrder(args: Record<string, unknown>, id: McpIdentity, now: number) {
  return runWriteTool("advance_order", args, id, () => planAdvanceOrder(args, id), now);
}

interface PartnerRow {
  id: number;
  name: string;
}

async function resolvePartnerNames(
  execute: Awaited<ReturnType<typeof getRpc>>,
  id: McpIdentity,
  ids: number[],
  fieldLabel: string,
): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await execute<PartnerRow[]>(id.uid, id.apiKey, "res.partner", "read", [ids, ["name"]], {});
  const found = new Map(rows.map((r) => [r.id, r.name]));
  const missing = ids.filter((i) => !found.has(i));
  if (missing.length) {
    throw mcpError("NO_ENCONTRADO", `${fieldLabel}: no existe(n) el/los contacto(s) con id ${missing.join(", ")}.`);
  }
  return found;
}

interface StaffUserRow {
  partner_id: [number, string] | false;
  groups_id: number[];
}

/**
 * Refuses to assign someone who doesn't actually hold the job.
 *
 * `indigo.order.painter_id` / `installer_ids` are plain res.partner
 * relations with no domain and no "is a contractor" flag, so before this
 * any partner id at all was accepted — including a customer's. That is not
 * a cosmetic mistake: assigning a partner as painter is what decides who
 * `_create_painter_payout` books money to when the order leaves Painting,
 * and installers are paid per door installed. A typo'd id, or an agent
 * picking the client's contact because it matched the name it was given,
 * would quietly create a real payable to the wrong person.
 *
 * The check mirrors list_people, which is where an agent is told to look
 * up candidates in the first place: a person is a painter/installer if
 * they are an internal Odoo user carrying that Indigo role group. That
 * matches how the shop is actually set up (see ACCESOS_USUARIOS.md —
 * Mario/Pintor, Instalador, Amado/Diseñador+Instalador all have logins).
 * Assigning someone outside that set stays possible from Odoo itself; it
 * just isn't something this surface will do on a person's say-so.
 */
async function assertPartnersHoldRole(
  execute: Awaited<ReturnType<typeof getRpc>>,
  id: McpIdentity,
  partnerIds: number[],
  flag: RoleFlag,
  jobLabel: string,
  names: Map<number, string>,
): Promise<void> {
  if (partnerIds.length === 0) return;
  const deriveRole = await getDeriveRole();

  const users = await execute<StaffUserRow[]>(
    id.uid,
    id.apiKey,
    "res.users",
    "search_read",
    [[["partner_id", "in", partnerIds]], ["partner_id", "groups_id"]],
    {},
  );

  const groupIds = [...new Set(users.flatMap((u) => u.groups_id))];
  const groupNameById = new Map<number, string>();
  if (groupIds.length) {
    const groupRows = await execute<PersonGroupRow[]>(
      id.uid,
      id.apiKey,
      "res.groups",
      "read",
      [groupIds, ["name", "full_name"]],
      {},
    );
    for (const g of groupRows) groupNameById.set(g.id, g.full_name ?? g.name);
  }

  const qualified = new Set<number>();
  for (const u of users) {
    const partnerId = Array.isArray(u.partner_id) ? u.partner_id[0] : null;
    if (!partnerId) continue;
    const groupNames = u.groups_id.map((gid) => groupNameById.get(gid)).filter((n): n is string => !!n);
    if (!isInternalUser(groupNames)) continue; // a dealer/customer portal login is never staff
    if (deriveRole(groupNames)[flag]) qualified.add(partnerId);
  }

  const rejected = partnerIds.filter((pid) => !qualified.has(pid));
  if (rejected.length) {
    const labels = rejected.map((pid) => `${names.get(pid) ?? "?"} (id ${pid})`).join(", ");
    throw mcpError(
      "ENTRADA_INVALIDA",
      `No se puede asignar como ${jobLabel} a: ${labels}. Esa persona no figura en el equipo con ese rol — y de esta asignación depende a quién se le paga. Usa list_people para ver quién puede, o pide que le den el rol en Odoo primero.`,
    );
  }
}

async function planAssignOrder(args: Record<string, unknown>, id: McpIdentity): Promise<WritePlan> {
  const orderId = requireOrderId(args, "assign_order");
  const hasPainterId = "painter_id" in args && args.painter_id !== undefined;
  const clearPainter = args.clear_painter === true;
  const hasInstallerIds = Array.isArray(args.installer_ids);

  if (hasPainterId && clearPainter) {
    throw mcpError("ENTRADA_INVALIDA", "assign_order: no pases 'painter_id' y 'clear_painter' a la vez.");
  }
  if (!hasPainterId && !clearPainter && !hasInstallerIds) {
    throw mcpError(
      "ENTRADA_INVALIDA",
      "assign_order requiere al menos uno de 'painter_id', 'clear_painter' o 'installer_ids'.",
    );
  }
  if (hasPainterId && typeof args.painter_id !== "number") {
    throw mcpError("ENTRADA_INVALIDA", "'painter_id' debe ser un id numérico.");
  }
  const installerIds = hasInstallerIds ? (args.installer_ids as unknown[]) : [];
  if (hasInstallerIds && !installerIds.every((v) => typeof v === "number")) {
    throw mcpError("ENTRADA_INVALIDA", "'installer_ids' debe ser un arreglo de ids numéricos.");
  }

  await requireOfficeRole(id, "asignar pintor o instaladores");

  const execute = await getRpc();
  const rows = await execute<AdvanceOrderRow[]>(
    id.uid,
    id.apiKey,
    "indigo.order",
    "search_read",
    [[["id", "=", orderId]], ["id", "name", "client_name", "painter_id", "installer_ids"]],
    { limit: 1 },
  );
  if (!rows.length) throw mcpError("NO_ENCONTRADO", `No existe la orden ${orderId}.`);
  const order = rows[0];

  const newPainterId = hasPainterId ? (args.painter_id as number) : null;
  const newInstallerIds = installerIds as number[];

  const names = await resolvePartnerNames(
    execute,
    id,
    [...(newPainterId ? [newPainterId] : []), ...newInstallerIds],
    "assign_order",
  );

  // Before anything is described or written: the people named must hold
  // the job. See assertPartnersHoldRole -- this is a money decision.
  if (newPainterId) {
    await assertPartnersHoldRole(execute, id, [newPainterId], "isPainter", "pintor", names);
  }
  if (hasInstallerIds && newInstallerIds.length) {
    await assertPartnersHoldRole(execute, id, newInstallerIds, "isInstaller", "instalador/a", names);
  }

  const messageParts = [`Orden ${order.name} (${order.client_name}):`];
  if (hasPainterId) {
    messageParts.push(`se asignará como pintor a ${names.get(newPainterId as number)}.`);
  } else if (clearPainter) {
    messageParts.push(
      order.painter_id ? `se quitará el pintor actual (${m2oLabel(order.painter_id)}).` : "no tiene pintor asignado; no habrá cambio.",
    );
  }
  if (hasInstallerIds) {
    const label = newInstallerIds.length ? newInstallerIds.map((i) => names.get(i)).join(", ") : "(ninguno)";
    messageParts.push(`instaladores → ${label} (reemplaza el set actual).`);
  }

  return {
    message: messageParts.join(" "),
    extra: { order: order.name, client: order.client_name },
    execute: async () => {
      const vals: Record<string, unknown> = {};
      if (hasPainterId) vals.painter_id = newPainterId;
      if (clearPainter) vals.painter_id = false;
      if (hasInstallerIds) vals.installer_ids = [[6, 0, newInstallerIds]];

      await execute(id.uid, id.apiKey, "indigo.order", "write", [[orderId], vals], {});
      await execute(id.uid, id.apiKey, "indigo.order", "message_post", [[orderId]], {
        body: `Asignación actualizada: ${messageParts.slice(1).join(" ")}${AI_ORIGIN_SUFFIX}`,
        message_type: "comment",
      }).catch(() => undefined);
    },
  };
}

async function assignOrder(args: Record<string, unknown>, id: McpIdentity, now: number) {
  return runWriteTool("assign_order", args, id, () => planAssignOrder(args, id), now);
}

async function planScheduleInstall(args: Record<string, unknown>, id: McpIdentity): Promise<WritePlan> {
  const orderId = requireOrderId(args, "schedule_install");
  const date = typeof args.installation_date === "string" ? args.installation_date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw mcpError("ENTRADA_INVALIDA", "schedule_install requiere 'installation_date' en formato YYYY-MM-DD.");
  }
  const hasInstallerIds = Array.isArray(args.installer_ids);
  const installerIds = hasInstallerIds ? (args.installer_ids as unknown[]) : [];
  if (hasInstallerIds && !installerIds.every((v) => typeof v === "number")) {
    throw mcpError("ENTRADA_INVALIDA", "'installer_ids' debe ser un arreglo de ids numéricos.");
  }

  await requireOfficeRole(id, "programar una instalación");

  const execute = await getRpc();
  const rows = await execute<AdvanceOrderRow[]>(
    id.uid,
    id.apiKey,
    "indigo.order",
    "search_read",
    [[["id", "=", orderId]], ["id", "name", "client_name", "stage_code", "installer_ids"]],
    { limit: 1 },
  );
  if (!rows.length) throw mcpError("NO_ENCONTRADO", `No existe la orden ${orderId}.`);
  const order = rows[0];

  const newInstallerIds = installerIds as number[];
  const names = hasInstallerIds ? await resolvePartnerNames(execute, id, newInstallerIds, "schedule_install") : new Map();

  const messageParts = [`Orden ${order.name} (${order.client_name}): se programará la instalación para el ${date}.`];
  if (hasInstallerIds) {
    const label = newInstallerIds.length ? newInstallerIds.map((i) => names.get(i)).join(", ") : "(ninguno)";
    messageParts.push(`Instaladores → ${label} (reemplaza el set actual).`);
  }
  if (order.stage_code === "closed" || order.stage_code === "invoiced") {
    messageParts.push(`Aviso: esta orden ya está en '${order.stage_code}' — programar una instalación en este punto es inusual.`);
  }

  // Resolved HERE, in the plan, not inside execute(). It used to run after
  // confirmation wrapped in .catch(() => []) — so a failed lookup silently
  // dropped stage_id from the write, and the order got an installation date
  // while staying in whatever stage it was already in, with the tool
  // reporting success. "Programada" that never left the previous stage is
  // exactly the kind of quiet half-move that sends someone looking for a
  // door on the wrong board. Failing in the plan also means the preview is
  // never shown for something that cannot be carried out.
  const stages = await execute<Array<{ id: number }>>(
    id.uid,
    id.apiKey,
    "indigo.stage",
    "search_read",
    [[["code", "=", "install_scheduled"]], ["id"]],
    { limit: 1 },
  );
  const scheduledStageId = stages[0]?.id;
  if (!scheduledStageId) {
    throw mcpError(
      "ERROR_ODOO",
      "No se encontró la etapa 'Installation Scheduled' en Odoo, así que no se puede programar la instalación sin dejar la orden a medias. Avisa a soporte.",
    );
  }
  messageParts.push("La orden pasará a 'Installation Scheduled'.");

  return {
    message: messageParts.join(" "),
    extra: { order: order.name, client: order.client_name },
    execute: async () => {
      const vals: Record<string, unknown> = {
        installation_date: date,
        stage_id: scheduledStageId,
      };
      if (hasInstallerIds) vals.installer_ids = [[6, 0, newInstallerIds]];

      await execute(id.uid, id.apiKey, "indigo.order", "write", [[orderId], vals], {});
      await execute(id.uid, id.apiKey, "indigo.order", "message_post", [[orderId]], {
        body: `Instalación programada para <b>${date}</b>.${AI_ORIGIN_SUFFIX}`,
        message_type: "comment",
      }).catch(() => undefined);
    },
  };
}

async function scheduleInstall(args: Record<string, unknown>, id: McpIdentity, now: number) {
  return runWriteTool("schedule_install", args, id, () => planScheduleInstall(args, id), now);
}

/** The three hold_cause values indigo.order accepts (Odoo 17.0.0.88.0+). */
export type HoldCause = "dealer" | "client" | "other";
const HOLD_CAUSES: HoldCause[] = ["dealer", "client", "other"];
const HOLD_CAUSE_LABEL: Record<HoldCause, string> = {
  dealer: "problema del dealer",
  client: "problema del cliente",
  other: "otro / sin clasificar",
};

/**
 * hold_order's 'cause' argument is required whenever action is 'hold' — a
 * hold with no cause is exactly the unclassifiable row Majela's 2026-08-15
 * request (item 3) exists to eliminate: free text can't be counted or
 * colored, so 'dealer' vs 'client' vs 'other' is what makes the "7 doors
 * blocked by the dealer" counter possible at all. indigo.order's own
 * _check_hold_requires_cause constraint would reject a bare write() too
 * (it's the actual enforcement, covering every caller including this one),
 * but validating it HERE first — before any RPC — gives the model a clean,
 * actionable error instead of a raw Odoo ValidationError, and (like
 * requireLineSqf above) makes this rule directly unit-testable without a
 * live Odoo behind it.
 */
export function requireHoldCause(args: Record<string, unknown>, action: "hold" | "release"): HoldCause | undefined {
  if (action === "release") return undefined;
  const raw = args.cause;
  if (typeof raw !== "string" || !HOLD_CAUSES.includes(raw as HoldCause)) {
    throw mcpError(
      "ENTRADA_INVALIDA",
      "hold_order requiere 'cause' ('dealer', 'client' u 'other') para poner una orden en espera — si la persona no dijo cuál es, pregúntale antes de llamar a esta herramienta en vez de adivinar.",
    );
  }
  return raw as HoldCause;
}

async function planHoldOrder(args: Record<string, unknown>, id: McpIdentity): Promise<WritePlan> {
  const orderId = requireOrderId(args, "hold_order");
  const action = args.action;
  if (action !== "hold" && action !== "release") {
    throw mcpError("ENTRADA_INVALIDA", "hold_order requiere 'action' igual a 'hold' o 'release'.");
  }
  const cause = requireHoldCause(args, action);
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";

  await requireOfficeRole(id, "poner en espera o liberar una orden");

  const execute = await getRpc();
  const rows = await execute<Array<{ id: number; name: string; client_name: string; on_hold: boolean }>>(
    id.uid,
    id.apiKey,
    "indigo.order",
    "search_read",
    [[["id", "=", orderId]], ["id", "name", "client_name", "on_hold"]],
    { limit: 1 },
  );
  if (!rows.length) throw mcpError("NO_ENCONTRADO", `No existe la orden ${orderId}.`);
  const order = rows[0];

  const release = action === "release";
  let effectMessage: string;
  if (release) {
    effectMessage = order.on_hold
      ? "se liberará de la espera."
      : "no está en espera actualmente; esto no tendrá efecto.";
  } else {
    effectMessage = `se pondrá EN ESPERA (${HOLD_CAUSE_LABEL[cause!]})${reason ? ` — motivo: "${reason}"` : ""}.`;
  }

  const chatterBody = release
    ? "Orden liberada de espera."
    : `Movida a espera — ${HOLD_CAUSE_LABEL[cause!]}${reason ? `: ${reason}` : ""}.`;

  return {
    message: `Orden ${order.name} (${order.client_name}): ${effectMessage}`,
    extra: { order: order.name, client: order.client_name },
    execute: async () => {
      await execute(
        id.uid,
        id.apiKey,
        "indigo.order",
        "write",
        [
          [orderId],
          {
            on_hold: !release,
            hold_cause: release ? false : cause,
            hold_reason: release ? false : reason || false,
          },
        ],
        {},
      );
      await execute(id.uid, id.apiKey, "indigo.order", "message_post", [[orderId]], {
        body: `${chatterBody}${AI_ORIGIN_SUFFIX}`,
        message_type: "comment",
      }).catch(() => undefined);
    },
  };
}

async function holdOrder(args: Record<string, unknown>, id: McpIdentity, now: number) {
  return runWriteTool("hold_order", args, id, () => planHoldOrder(args, id), now);
}

async function planAddNote(args: Record<string, unknown>, id: McpIdentity): Promise<WritePlan> {
  const orderId = requireOrderId(args, "add_note");
  const note = typeof args.note === "string" ? args.note.trim() : "";
  if (!note) throw mcpError("ENTRADA_INVALIDA", "add_note requiere 'note' (no vacío).");
  const hasIncidence = typeof args.incidence === "boolean";
  const incidence = args.incidence === true;

  await requireOfficeRole(id, "agregar una nota o incidencia");

  const execute = await getRpc();
  const rows = await execute<Array<{ id: number; name: string; client_name: string; notes: string | false }>>(
    id.uid,
    id.apiKey,
    "indigo.order",
    "search_read",
    [[["id", "=", orderId]], ["id", "name", "client_name", "notes"]],
    { limit: 1 },
  );
  if (!rows.length) throw mcpError("NO_ENCONTRADO", `No existe la orden ${orderId}.`);
  const order = rows[0];

  const messageParts = [`Orden ${order.name} (${order.client_name}): se agregará la nota "${note}".`];
  if (hasIncidence) {
    messageParts.push(incidence ? "Se marcará como INCIDENCIA ABIERTA." : "Se cerrará la incidencia abierta (si había alguna).");
  }

  return {
    message: messageParts.join(" "),
    extra: { order: order.name, client: order.client_name },
    execute: async () => {
      const existing = (order.notes || "") as string;
      // Fecha del taller (Miami), no la del contenedor -- que corre en UTC.
      // Una nota puesta a las 21:00 hora de Miami quedaba fechada al dia
      // siguiente, que es justo lo que hace dudar de una nota.
      const dateStr = shopDateString(new Date());
      const tag = hasIncidence && incidence ? " ⚠️ INCIDENT" : "";
      const line = `${dateStr}${tag}: ${note}`;

      // One write, not two. The incidence flag used to be a SECOND write
      // wrapped in .catch(() => undefined) -- so when the preview had just
      // promised "Se marcara como INCIDENCIA ABIERTA", the flag could fail
      // to land and the tool still reported success. An open incident that
      // silently is not open is worse than no incident at all: nobody goes
      // looking for it. Folding it into the same write makes the two halves
      // succeed or fail together, and a failure now propagates.
      const values: Record<string, unknown> = {
        notes: existing ? `${line}\n${existing}` : line,
      };
      if (hasIncidence) values.incidence = incidence;
      await execute(id.uid, id.apiKey, "indigo.order", "write", [[orderId], values], {});

      // Chatter stays best-effort: it duplicates what the note field now
      // already holds, so losing it costs presentation, not information.
      await execute(id.uid, id.apiKey, "indigo.order", "message_post", [[orderId]], {
        body: `${hasIncidence && incidence ? "⚠️ Incident: " : "Note: "}${note}${AI_ORIGIN_SUFFIX}`,
        message_type: "comment",
      }).catch(() => undefined);
    },
  };
}

async function addNote(args: Record<string, unknown>, id: McpIdentity, now: number) {
  return runWriteTool("add_note", args, id, () => planAddNote(args, id), now);
}

// ---------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  id: McpIdentity,
): Promise<unknown> {
  try {
    return await dispatchTool(name, args, id);
  } catch (e) {
    throw toMcpToolError(e);
  }
}

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  id: McpIdentity,
): Promise<unknown> {
  // Read-only tools have no clock dependency; write tools need `now` for
  // their confirm-token issue/verify — Date.now() read exactly once here,
  // at the actual dispatch boundary, not inside each tool. Tests reach the
  // token logic deterministically instead via runWriteTool() directly
  // (see tools.test.ts), which takes `now` as an explicit argument.
  const now = Date.now();
  switch (name) {
    case "today_board":
      return todayBoard(args, id);
    case "find_orders":
      return findOrders(args, id);
    case "get_order":
      return getOrder(args, id);
    case "list_stages":
      return listStages(args, id);
    case "list_dealers":
      return listDealers(args, id);
    case "list_designs":
      return listDesigns(args, id);
    case "list_people":
      return listPeople(args, id);
    case "advance_order":
      return advanceOrder(args, id, now);
    case "assign_order":
      return assignOrder(args, id, now);
    case "schedule_install":
      return scheduleInstall(args, id, now);
    case "hold_order":
      return holdOrder(args, id, now);
    case "add_note":
      return addNote(args, id, now);
    default:
      // Unreachable via the MCP transport today (route.ts only ever calls
      // this with a literal def.name from TOOL_DEFS), but runTool is
      // exported and directly testable, so this still honors the same
      // error contract rather than a bare Error.
      throw mcpError("ENTRADA_INVALIDA", `Herramienta no reconocida: '${name}'.`);
  }
}

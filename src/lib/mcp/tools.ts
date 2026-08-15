/**
 * Six read-only MCP tools over the Indigo panel's Odoo data.
 *
 * Every Odoo call runs through `rpcExecuteKw(id.uid, id.apiKey, ...)` —
 * Odoo's external API (see src/lib/odoo/rpc.ts) — so it executes as the
 * real logged-in person and Odoo's own ACLs / record rules apply, same
 * as every BFF route under src/app/api (those go through the session-cookie
 * transport in src/lib/odoo/client.ts instead; MCP tokens are API keys,
 * which only the external API accepts). Nothing here writes, creates or
 * unlinks anything: this file is read-only by construction, and stays
 * that way until a future phase deliberately adds a write tool.
 *
 * Field names and domains below are copied verbatim from the panel
 * routes that already query these models (see comments per tool) —
 * never invented, so a tool call can't 500 on an Odoo "Invalid field".
 */
import type { McpIdentity } from "./token";

// Lazy import so this module can be loaded (and its pure exports tested)
// in a plain `node --test` environment that doesn't resolve the `@/`
// path alias. Same trick as token.ts's getRpc().
async function getRpc() {
  const { rpcExecuteKw } = await import("@/lib/odoo/rpc");
  return rpcExecuteKw;
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
    default:
      // Unreachable via the MCP transport today (route.ts only ever calls
      // this with a literal def.name from TOOL_DEFS), but runTool is
      // exported and directly testable, so this still honors the same
      // error contract rather than a bare Error.
      throw mcpError("ENTRADA_INVALIDA", `Herramienta no reconocida: '${name}'.`);
  }
}

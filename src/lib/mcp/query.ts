/**
 * query_data — the ad-hoc read escape hatch.
 *
 * The other read tools are shaped around the shop's daily verbs ("what's on
 * the board", "find Perez's order"). They cover the questions we anticipated.
 * This one covers the ones we didn't: counts, group-bys, date ranges and sums
 * across orders, lines, payouts and contractors.
 *
 * WHY ORM AND NOT SQL. An MCP token is an Odoo login + API key, and every
 * call runs as that real person through execute_kw (see ./token.ts). So
 * Odoo's own ACLs and record rules apply to this tool for free — a painter's
 * token sees what a painter may see. Raw SQL would throw exactly that away
 * and hand every token holder dealer pricing, contractor pay and the full
 * client contact list, plus the risk of an accidental write or a lock on a
 * live database. The ORM keeps the security model; the whitelist below adds
 * defense in depth on top of it.
 *
 * WHAT THE WHITELIST IS ACTUALLY FOR, given rules already apply:
 *   1. Credentials are not data. indigo.order.access_token grants portal
 *      access to an order — it must never be selectable at any privilege.
 *   2. Blast radius and legibility: indigo.order has 63 columns; a tool that
 *      can dump all of them returns noise the agent then has to wade through.
 *   3. Every field here is a stored column, so it is safe to filter, group
 *      and order by — no "cannot search on a non-stored field" surprises
 *      surfacing as an opaque Odoo traceback.
 *
 * Adding a model or field is a deliberate act: add it here, and it becomes
 * queryable by everyone whose Odoo rules already allow it.
 */
import { mcpError } from "./errors.ts";

export type FieldKind = "char" | "number" | "date" | "datetime" | "bool" | "m2o";

export interface ModelSpec {
  /** Shown in the tool description so the agent can pick a model. */
  label: string;
  fields: Record<string, FieldKind>;
  /** Returned when the caller names no fields. Keep it short and readable. */
  defaultFields: string[];
  defaultOrder: string;
}

// ---------------------------------------------------------------------
// The whitelist.
// ---------------------------------------------------------------------

const ORDER_FIELDS: Record<string, FieldKind> = {
  id: "number",
  name: "char",
  dealer_id: "m2o",
  stage_id: "m2o",
  painter_id: "m2o",
  designer_id: "m2o",
  create_uid: "m2o",
  client_name: "char",
  client_phone: "char",
  client_email: "char",
  client_address: "char",
  client_zip: "char",
  customer_po: "char",
  dealer_ref: "char",
  priv_ref: "char",
  notes: "char",
  door_count: "number",
  total_sqf: "number",
  total_dealer_charge: "number",
  total_painter_payout: "number",
  total_installer_payout: "number",
  price_per_sqf: "number",
  installation_fee: "number",
  payment_state: "char",
  date_paid: "date",
  installation_date: "date",
  expected_completion_date: "date",
  create_date: "datetime",
  write_date: "datetime",
  last_stage_change: "datetime",
  invoiced_at: "datetime",
  // Per-phase stamps — the raw material for cycle-time questions
  // ("how long does painting actually take?").
  design_sent_date: "datetime",
  digi_started_at: "datetime",
  digi_done_at: "datetime",
  cnc_started_at: "datetime",
  cnc_done_at: "datetime",
  paint_started_at: "datetime",
  paint_done_at: "datetime",
  cancelled_at: "datetime",
  cancellation_reason: "char",
  on_hold: "bool",
  hold_cause: "char",
  hold_reason: "char",
  hold_reason_id: "m2o",
  incidence: "bool",
  is_stock: "bool",
  stock_label: "char",
  active: "bool",
  install_zone_name: "char",
  install_range_id: "m2o",
  install_distance_mi: "number",
  install_corridor: "char",
  install_geo_approx: "bool",
};

const ORDER_LINE_FIELDS: Record<string, FieldKind> = {
  id: "number",
  order_id: "m2o",
  design_id: "m2o",
  brand_id: "m2o",
  sequence: "number",
  qty: "number",
  parts_count: "number",
  door_type: "char",
  color: "char",
  color_custom: "char",
  glass_type: "char",
  glass_privacy: "char",
  is_privacy_glass: "bool",
  material: "char",
  thickness: "char",
  design_tier: "char",
  paint_sides: "number",
  width: "number",
  height: "number",
  sqf: "number",
  custom_price: "number",
  unit_price: "number",
  line_charge: "number",
  customer_name: "char",
  notes_line: "char",
  create_date: "datetime",
  write_date: "datetime",
};

const PAYOUT_FIELDS: Record<string, FieldKind> = {
  id: "number",
  name: "char",
  contractor_id: "m2o",
  contractor_type: "char",
  state: "char",
  date: "date",
  period_start: "date",
  period_end: "date",
  amount: "number",
  notes: "char",
  create_date: "datetime",
  write_date: "datetime",
};

const PAYOUT_LINE_FIELDS: Record<string, FieldKind> = {
  id: "number",
  payout_id: "m2o",
  order_id: "m2o",
  order_line_id: "m2o",
  description: "char",
  date_work: "date",
  quantity: "number",
  rate: "number",
  amount: "number",
  create_date: "datetime",
  write_date: "datetime",
};

const STAGE_FIELDS: Record<string, FieldKind> = {
  id: "number",
  name: "char",
  code: "char",
  sequence: "number",
  sla_days: "number",
  is_optional: "bool",
  fold: "bool",
  active: "bool",
};

const DESIGN_FIELDS: Record<string, FieldKind> = {
  id: "number",
  code: "char",
  name: "char",
  door_type: "char",
  allowed_colors: "char",
  allowed_glass_types: "char",
  min_width: "number",
  max_width: "number",
  min_height: "number",
  max_height: "number",
  catalog_source: "char",
  dealer_price_override: "number",
  active: "bool",
  create_date: "datetime",
};

const HOLD_REASON_FIELDS: Record<string, FieldKind> = {
  id: "number",
  name: "char",
  cause: "char",
  sequence: "number",
  color: "char",
  active: "bool",
};

const INSTALL_RANGE_FIELDS: Record<string, FieldKind> = {
  id: "number",
  name: "char",
  short_name: "char",
  min_miles: "number",
  max_miles: "number",
  sequence: "number",
  color: "char",
  active: "bool",
};

// Contacts: dealers and contractors. Deliberately narrow — this model also
// holds every end client, so only the fields the shop actually reports on
// are exposed. Free-text notes (`comment`, `function`) are not among them.
const PARTNER_FIELDS: Record<string, FieldKind> = {
  id: "number",
  name: "char",
  email: "char",
  phone: "char",
  mobile: "char",
  city: "char",
  zip: "char",
  is_indigo_dealer: "bool",
  indigo_dealer_code: "char",
  indigo_default_price_per_sqf: "number",
  indigo_charge_install_fee: "bool",
  indigo_notification_channels: "char",
  customer_rank: "number",
  active: "bool",
  create_date: "datetime",
};

export const QUERY_MODELS: Record<string, ModelSpec> = {
  "indigo.order": {
    label: "Órdenes de producción (una por cliente final, con varias puertas)",
    fields: ORDER_FIELDS,
    defaultFields: ["id", "name", "dealer_id", "stage_id", "client_name", "door_count", "total_dealer_charge", "create_date"],
    defaultOrder: "create_date desc",
  },
  "indigo.order.line": {
    label: "Piezas/puertas de cada orden (medidas, SQF, diseño, color)",
    fields: ORDER_LINE_FIELDS,
    defaultFields: ["id", "order_id", "design_id", "door_type", "color", "width", "height", "sqf"],
    defaultOrder: "id desc",
  },
  "indigo.payout": {
    label: "Liquidaciones a contratistas (pintor por SQF, instalador por puerta)",
    fields: PAYOUT_FIELDS,
    defaultFields: ["id", "name", "contractor_id", "contractor_type", "state", "amount", "date"],
    defaultOrder: "create_date desc",
  },
  "indigo.payout.line": {
    label: "Renglones de cada liquidación (cantidad × tarifa por orden)",
    fields: PAYOUT_LINE_FIELDS,
    defaultFields: ["id", "payout_id", "order_id", "description", "quantity", "rate", "amount"],
    defaultOrder: "id desc",
  },
  "indigo.stage": {
    label: "Etapas del pipeline de producción",
    fields: STAGE_FIELDS,
    defaultFields: ["id", "name", "code", "sequence", "sla_days"],
    defaultOrder: "sequence",
  },
  "indigo.design": {
    label: "Catálogo de diseños",
    fields: DESIGN_FIELDS,
    defaultFields: ["id", "code", "name", "door_type", "active"],
    defaultOrder: "code",
  },
  "indigo.hold.reason": {
    label: "Motivos por los que una orden queda en espera",
    fields: HOLD_REASON_FIELDS,
    defaultFields: ["id", "name", "cause", "active"],
    defaultOrder: "sequence",
  },
  "indigo.install.range": {
    label: "Rangos de distancia usados para planificar instalaciones",
    fields: INSTALL_RANGE_FIELDS,
    defaultFields: ["id", "name", "short_name", "min_miles", "max_miles"],
    defaultOrder: "sequence",
  },
  "res.partner": {
    label: "Contactos: dealers y contratistas (nombre, contacto, tarifa por dealer)",
    fields: PARTNER_FIELDS,
    defaultFields: ["id", "name", "email", "phone", "is_indigo_dealer"],
    defaultOrder: "name",
  },
};

// ---------------------------------------------------------------------
// Operators, aggregates, date granularities.
// ---------------------------------------------------------------------

/** Operator -> which field kinds it is meaningful on. */
const OPERATORS: Record<string, FieldKind[] | "any"> = {
  "=": "any",
  "!=": "any",
  ">": ["number", "date", "datetime"],
  ">=": ["number", "date", "datetime"],
  "<": ["number", "date", "datetime"],
  "<=": ["number", "date", "datetime"],
  in: "any",
  "not in": "any",
  ilike: ["char", "m2o"],
  "not ilike": ["char", "m2o"],
  set: "any",
  "not set": "any",
};

const ARRAY_OPERATORS = new Set(["in", "not in"]);
/** The only operators that carry no value — everything else needs one. */
const VALUELESS_OPERATORS = new Set(["set", "not set"]);

const AGGREGATE_FNS = new Set(["sum", "avg", "min", "max"]);
const DATE_GRANULARITIES = new Set(["day", "week", "month", "quarter", "year"]);

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// ---------------------------------------------------------------------
// The plan.
// ---------------------------------------------------------------------

export interface QueryPlan {
  model: string;
  /** Odoo domain — a flat AND of validated leaves. */
  domain: unknown[];
  /** "rows" -> search_read; "groups" -> read_group. */
  mode: "rows" | "groups";
  /** rows: field names to read. groups: Odoo aggregate specs ("amount:sum"). */
  fields: string[];
  /** groups only; entries may carry a granularity ("create_date:month"). */
  groupBy: string[];
  limit: number;
  offset: number;
  /** rows only — read_group orders by its grouping, not by a row field. */
  order?: string;
}

function fieldKind(spec: ModelSpec, field: string, where: string): FieldKind {
  const kind = spec.fields[field];
  if (!kind) {
    throw mcpError(
      "ENTRADA_INVALIDA",
      `El campo '${field}' (en ${where}) no existe o no es consultable en este modelo. ` +
        `Campos válidos: ${Object.keys(spec.fields).join(", ")}.`,
    );
  }
  return kind;
}

function asArray(raw: unknown, where: string): unknown[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw mcpError("ENTRADA_INVALIDA", `'${where}' tiene que ser una lista.`);
  }
  return raw;
}

function clamp(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const n = Math.floor(raw);
  if (n < 1) return fallback;
  return Math.min(n, max);
}

function buildDomain(spec: ModelSpec, raw: unknown): unknown[] {
  const domain: unknown[] = [];
  for (const entry of asArray(raw, "filters")) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw mcpError(
        "ENTRADA_INVALIDA",
        "Cada filtro tiene que ser un objeto {field, op, value}.",
      );
    }
    const f = entry as Record<string, unknown>;
    const field = typeof f.field === "string" ? f.field : "";
    const op = typeof f.op === "string" ? f.op : "=";
    const kind = fieldKind(spec, field, "filters");

    const allowed = OPERATORS[op];
    if (!allowed) {
      throw mcpError(
        "ENTRADA_INVALIDA",
        `Operador '${op}' no reconocido. Válidos: ${Object.keys(OPERATORS).join(", ")}.`,
      );
    }
    if (allowed !== "any" && !allowed.includes(kind)) {
      throw mcpError(
        "ENTRADA_INVALIDA",
        `El operador '${op}' no aplica a '${field}', que es de tipo ${kind}. ` +
          `'${op}' sirve para campos de tipo: ${allowed.join(", ")}.`,
      );
    }

    if (VALUELESS_OPERATORS.has(op)) {
      // "tiene valor" / "está vacío" in Odoo's own idiom.
      domain.push([field, op === "set" ? "!=" : "=", false]);
      continue;
    }
    if (!("value" in f) || f.value === undefined) {
      throw mcpError(
        "ENTRADA_INVALIDA",
        `El filtro sobre '${field}' con operador '${op}' necesita un 'value'. ` +
          "Usa op 'set' / 'not set' para preguntar sólo si el campo está lleno o vacío.",
      );
    }
    if (ARRAY_OPERATORS.has(op) && !Array.isArray(f.value)) {
      throw mcpError(
        "ENTRADA_INVALIDA",
        `El operador '${op}' sobre '${field}' necesita que 'value' sea una lista.`,
      );
    }
    domain.push([field, op, f.value]);
  }
  return domain;
}

function buildGroupBy(spec: ModelSpec, raw: unknown): string[] {
  return asArray(raw, "group_by").map((entry) => {
    if (typeof entry !== "string") {
      throw mcpError("ENTRADA_INVALIDA", "Cada entrada de 'group_by' tiene que ser texto.");
    }
    const [field, granularity] = entry.split(":");
    const kind = fieldKind(spec, field, "group_by");
    if (granularity === undefined) return field;
    if (!DATE_GRANULARITIES.has(granularity)) {
      throw mcpError(
        "ENTRADA_INVALIDA",
        `Granularidad '${granularity}' no reconocida. Válidas: ${[...DATE_GRANULARITIES].join(", ")}.`,
      );
    }
    if (kind !== "date" && kind !== "datetime") {
      throw mcpError(
        "ENTRADA_INVALIDA",
        `Sólo un campo de fecha se puede agrupar por granularidad; '${field}' es de tipo ${kind}.`,
      );
    }
    return `${field}:${granularity}`;
  });
}

function buildAggregates(spec: ModelSpec, raw: unknown, hasGroupBy: boolean): string[] {
  const entries = asArray(raw, "aggregate");
  if (entries.length && !hasGroupBy) {
    throw mcpError(
      "ENTRADA_INVALIDA",
      "'aggregate' sólo tiene sentido junto con 'group_by'. Para totales de todo el " +
        "conjunto, agrupa por un campo constante o suma los renglones que devuelva la consulta.",
    );
  }
  return entries.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw mcpError("ENTRADA_INVALIDA", "Cada agregado tiene que ser un objeto {field, fn}.");
    }
    const a = entry as Record<string, unknown>;
    const field = typeof a.field === "string" ? a.field : "";
    const fn = typeof a.fn === "string" ? a.fn : "";
    const kind = fieldKind(spec, field, "aggregate");
    if (!AGGREGATE_FNS.has(fn)) {
      throw mcpError(
        "ENTRADA_INVALIDA",
        `Función de agregado '${fn}' no reconocida. Válidas: ${[...AGGREGATE_FNS].join(", ")}.`,
      );
    }
    if (kind !== "number") {
      throw mcpError(
        "ENTRADA_INVALIDA",
        `Sólo se puede agregar un campo numérico; '${field}' es de tipo ${kind}. ` +
          "Para contar registros no hace falta agregado: cada grupo ya trae su 'count'.",
      );
    }
    return `${field}:${fn}`;
  });
}

function buildOrder(spec: ModelSpec, raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return spec.defaultOrder;
  const parts = raw.trim().split(/\s+/);
  if (parts.length > 2) {
    throw mcpError(
      "ENTRADA_INVALIDA",
      `'order' debe ser 'campo' o 'campo asc|desc', no '${raw}'.`,
    );
  }
  const [field, direction] = parts;
  fieldKind(spec, field, "order");
  if (direction !== undefined && direction !== "asc" && direction !== "desc") {
    throw mcpError(
      "ENTRADA_INVALIDA",
      `Dirección de orden '${direction}' no reconocida: usa 'asc' o 'desc'.`,
    );
  }
  return direction ? `${field} ${direction}` : field;
}

export function planQuery(args: Record<string, unknown>): QueryPlan {
  const model = typeof args.model === "string" ? args.model : "";
  const spec = QUERY_MODELS[model];
  if (!spec) {
    throw mcpError(
      "ENTRADA_INVALIDA",
      `'model' es obligatorio y tiene que ser uno de: ${Object.keys(QUERY_MODELS).join(", ")}.` +
        (model ? ` Recibí '${model}'.` : ""),
    );
  }

  const domain = buildDomain(spec, args.filters);
  const groupBy = buildGroupBy(spec, args.group_by);
  const aggregates = buildAggregates(spec, args.aggregate, groupBy.length > 0);
  const limit = clamp(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const offset = typeof args.offset === "number" && Number.isFinite(args.offset)
    ? Math.max(0, Math.floor(args.offset))
    : 0;

  if (groupBy.length) {
    return { model, domain, mode: "groups", fields: aggregates, groupBy, limit, offset };
  }

  const requested = asArray(args.fields, "fields").map((f) => {
    if (typeof f !== "string") {
      throw mcpError("ENTRADA_INVALIDA", "Cada entrada de 'fields' tiene que ser texto.");
    }
    fieldKind(spec, f, "fields");
    return f;
  });
  // Without an id every result is a dead end — the agent can't drill into it
  // with get_order or follow it anywhere else.
  const fields = requested.length
    ? [...new Set(["id", ...requested])]
    : spec.defaultFields;

  return {
    model,
    domain,
    mode: "rows",
    fields,
    groupBy: [],
    limit,
    offset,
    order: buildOrder(spec, args.order),
  };
}

// ---------------------------------------------------------------------
// Result shaping. Odoo answers with [id, label] tuples for many2ones and
// `false` for every empty value regardless of type; neither reads well to
// an agent, and `false` for an empty string is actively misleading.
// ---------------------------------------------------------------------

function shapeValue(kind: FieldKind, value: unknown): unknown {
  if (kind === "m2o") {
    if (Array.isArray(value) && value.length === 2) {
      return { id: value[0], name: value[1] };
    }
    return null;
  }
  // A false boolean is a value; a false anything-else is Odoo for "empty".
  if (value === false && kind !== "bool") return null;
  return value;
}

/** Projects an Odoo row down to the whitelisted fields, shaped. Anything
 *  Odoo added on its own (`__last_update`, `display_name`) is dropped —
 *  only whitelisted fields ever leave this tool. */
export function formatQueryRow(model: string, row: Record<string, unknown>): Record<string, unknown> {
  const spec = QUERY_MODELS[model];
  if (!spec) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const kind = spec.fields[key];
    if (!kind) continue;
    out[key] = shapeValue(kind, value);
  }
  return out;
}

/** Projects one read_group bucket: the grouped value(s), each aggregate
 *  under its plain field name, and Odoo's `__count` renamed to `count`. */
export function formatGroupRow(plan: QueryPlan, row: Record<string, unknown>): Record<string, unknown> {
  const spec = QUERY_MODELS[plan.model];
  const out: Record<string, unknown> = {};

  for (const groupSpec of plan.groupBy) {
    const [field, granularity] = groupSpec.split(":");
    const value = row[groupSpec] !== undefined ? row[groupSpec] : row[field];
    if (granularity) {
      // Odoo returns a localized label ("julio 2026") for a bucketed date.
      out[groupSpec] = value === false ? null : value;
    } else {
      out[field] = shapeValue(spec?.fields[field] ?? "char", value);
    }
  }

  for (const aggSpec of plan.fields) {
    const field = aggSpec.split(":")[0];
    out[field] = row[field] === false ? null : row[field];
  }

  out.count = row.__count;
  return out;
}

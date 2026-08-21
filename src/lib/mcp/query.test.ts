import test from "node:test";
import assert from "node:assert/strict";

import {
  QUERY_MODELS,
  planQuery,
  formatQueryRow,
  formatGroupRow,
} from "./query.ts";
import { McpToolError } from "./errors.ts";

/** Asserts `fn` throws an ENTRADA_INVALIDA McpToolError whose message names
 *  `mentions` — the message is the agent's only repair instruction, so a
 *  rejection that doesn't say what was wrong is a bug, not a pass. */
function rejects(fn: () => unknown, mentions: string) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof McpToolError, `expected McpToolError, got ${e}`);
    assert.equal(e.code, "ENTRADA_INVALIDA");
    assert.ok(
      e.message.includes(mentions),
      `message should mention '${mentions}': ${e.message}`,
    );
    return;
  }
  assert.fail(`expected a rejection mentioning '${mentions}'`);
}

// ---------------------------------------------------------------------
// The whitelist itself. These are the invariants that make the tool safe
// to expose at all — every other test assumes them.
// ---------------------------------------------------------------------

test("every whitelisted model declares fields, defaults and an order", () => {
  const names = Object.keys(QUERY_MODELS);
  assert.ok(names.length >= 5, `expected at least 5 models, got ${names.length}`);
  for (const [name, spec] of Object.entries(QUERY_MODELS)) {
    assert.ok(spec.label.length > 3, `${name} needs a human label`);
    assert.ok(Object.keys(spec.fields).length > 2, `${name} has too few fields`);
    for (const f of spec.defaultFields) {
      assert.ok(spec.fields[f], `${name}: default field '${f}' is not whitelisted`);
    }
    const orderField = spec.defaultOrder.split(" ")[0];
    assert.ok(spec.fields[orderField], `${name}: default order '${orderField}' is not whitelisted`);
  }
});

test("the order's portal access_token is never queryable", () => {
  // access_token grants portal access to an order. It is a credential, not
  // data — a query tool that can read it hands out order access.
  assert.equal(QUERY_MODELS["indigo.order"].fields.access_token, undefined);
  rejects(
    () => planQuery({ model: "indigo.order", fields: ["access_token"] }),
    "access_token",
  );
  rejects(
    () => planQuery({ model: "indigo.order", filters: [{ field: "access_token", op: "set" }] }),
    "access_token",
  );
});

// ---------------------------------------------------------------------
// Model and field validation
// ---------------------------------------------------------------------

test("rejects an unknown model and names the valid ones", () => {
  rejects(() => planQuery({ model: "res.users" }), "indigo.order");
  rejects(() => planQuery({}), "model");
});

test("rejects an unknown field in fields, filters, group_by and order", () => {
  rejects(() => planQuery({ model: "indigo.order", fields: ["nope"] }), "nope");
  rejects(
    () => planQuery({ model: "indigo.order", filters: [{ field: "nope", op: "=", value: 1 }] }),
    "nope",
  );
  rejects(() => planQuery({ model: "indigo.order", group_by: ["nope"] }), "nope");
  rejects(() => planQuery({ model: "indigo.order", order: "nope desc" }), "nope");
});

test("a field valid on one model is rejected on another", () => {
  // sqf lives on the line, not the order — a whitelist shared across models
  // would silently let this through and error deep inside Odoo instead.
  assert.ok(QUERY_MODELS["indigo.order.line"].fields.sqf);
  rejects(() => planQuery({ model: "indigo.order", fields: ["sqf"] }), "sqf");
});

// ---------------------------------------------------------------------
// Defaults and clamps
// ---------------------------------------------------------------------

test("defaults to the model's own fields, order, limit 25 and offset 0", () => {
  const plan = planQuery({ model: "indigo.order" });
  assert.equal(plan.mode, "rows");
  assert.deepEqual(plan.domain, []);
  assert.deepEqual(plan.fields, QUERY_MODELS["indigo.order"].defaultFields);
  assert.deepEqual(plan.groupBy, []);
  assert.equal(plan.limit, 25);
  assert.equal(plan.offset, 0);
  assert.equal(plan.order, QUERY_MODELS["indigo.order"].defaultOrder);
});

test("clamps limit to 100 and floors a negative offset at 0", () => {
  assert.equal(planQuery({ model: "indigo.order", limit: 5000 }).limit, 100);
  assert.equal(planQuery({ model: "indigo.order", limit: 0 }).limit, 25);
  assert.equal(planQuery({ model: "indigo.order", limit: "many" }).limit, 25);
  assert.equal(planQuery({ model: "indigo.order", offset: -10 }).offset, 0);
  assert.equal(planQuery({ model: "indigo.order", offset: 40 }).offset, 40);
});

test("id is always returned even if the caller forgets it", () => {
  // Without an id the agent can't drill down with get_order, which makes
  // every result a dead end.
  const plan = planQuery({ model: "indigo.order", fields: ["client_name"] });
  assert.ok(plan.fields.includes("id"));
});

// ---------------------------------------------------------------------
// Filters -> Odoo domain
// ---------------------------------------------------------------------

test("ANDs filters into a flat Odoo domain", () => {
  const plan = planQuery({
    model: "indigo.order",
    filters: [
      { field: "payment_state", op: "=", value: "paid" },
      { field: "door_count", op: ">=", value: 2 },
    ],
  });
  assert.deepEqual(plan.domain, [
    ["payment_state", "=", "paid"],
    ["door_count", ">=", 2],
  ]);
});

test("set / not set become the != false / = false Odoo idiom", () => {
  assert.deepEqual(
    planQuery({ model: "indigo.order", filters: [{ field: "installation_date", op: "set" }] }).domain,
    [["installation_date", "!=", false]],
  );
  assert.deepEqual(
    planQuery({ model: "indigo.order", filters: [{ field: "client_zip", op: "not set" }] }).domain,
    [["client_zip", "=", false]],
  );
});

test("rejects an unknown operator and names the valid ones", () => {
  rejects(
    () => planQuery({ model: "indigo.order", filters: [{ field: "door_count", op: "=~", value: 1 }] }),
    "=~",
  );
});

test("in / not in require an array value", () => {
  rejects(
    () => planQuery({ model: "indigo.order", filters: [{ field: "id", op: "in", value: 7 }] }),
    "lista",
  );
  assert.deepEqual(
    planQuery({ model: "indigo.order", filters: [{ field: "id", op: "in", value: [1, 2] }] }).domain,
    [["id", "in", [1, 2]]],
  );
});

test("every operator except set/not set requires a value", () => {
  rejects(
    () => planQuery({ model: "indigo.order", filters: [{ field: "door_count", op: ">" }] }),
    "value",
  );
});

test("rejects ordering comparisons on a boolean field", () => {
  rejects(
    () => planQuery({ model: "indigo.order", filters: [{ field: "on_hold", op: ">", value: 0 }] }),
    "on_hold",
  );
  assert.deepEqual(
    planQuery({ model: "indigo.order", filters: [{ field: "on_hold", op: "=", value: true }] }).domain,
    [["on_hold", "=", true]],
  );
});

test("rejects ilike on a numeric field", () => {
  rejects(
    () => planQuery({ model: "indigo.order", filters: [{ field: "door_count", op: "ilike", value: "2" }] }),
    "door_count",
  );
});

// ---------------------------------------------------------------------
// Grouping and aggregates
// ---------------------------------------------------------------------

test("group_by switches to groups mode and carries aggregates as Odoo specs", () => {
  const plan = planQuery({
    model: "indigo.order",
    group_by: ["stage_id"],
    aggregate: [{ field: "total_dealer_charge", fn: "sum" }],
  });
  assert.equal(plan.mode, "groups");
  assert.deepEqual(plan.groupBy, ["stage_id"]);
  assert.deepEqual(plan.fields, ["total_dealer_charge:sum"]);
});

test("grouping without aggregates is a plain count", () => {
  const plan = planQuery({ model: "indigo.order", group_by: ["payment_state"] });
  assert.equal(plan.mode, "groups");
  assert.deepEqual(plan.fields, []);
});

test("a date field can be grouped by granularity", () => {
  assert.deepEqual(
    planQuery({ model: "indigo.order", group_by: ["create_date:month"] }).groupBy,
    ["create_date:month"],
  );
  rejects(() => planQuery({ model: "indigo.order", group_by: ["create_date:decade"] }), "decade");
  rejects(() => planQuery({ model: "indigo.order", group_by: ["client_name:month"] }), "client_name");
});

test("aggregates are numeric-only and use a known function", () => {
  rejects(
    () =>
      planQuery({
        model: "indigo.order",
        group_by: ["stage_id"],
        aggregate: [{ field: "client_name", fn: "sum" }],
      }),
    "client_name",
  );
  rejects(
    () =>
      planQuery({
        model: "indigo.order",
        group_by: ["stage_id"],
        aggregate: [{ field: "door_count", fn: "median" }],
      }),
    "median",
  );
});

test("aggregate without group_by is rejected rather than silently ignored", () => {
  rejects(
    () => planQuery({ model: "indigo.order", aggregate: [{ field: "door_count", fn: "sum" }] }),
    "group_by",
  );
});

test("rows mode keeps its order; groups mode drops it", () => {
  // read_group orders by the grouping, not by an arbitrary row field —
  // forwarding the row order would make Odoo raise.
  assert.equal(planQuery({ model: "indigo.order", order: "door_count desc" }).order, "door_count desc");
  assert.equal(
    planQuery({ model: "indigo.order", group_by: ["stage_id"], order: "door_count desc" }).order,
    undefined,
  );
});

test("order direction must be asc or desc", () => {
  rejects(() => planQuery({ model: "indigo.order", order: "door_count sideways" }), "sideways");
  assert.equal(planQuery({ model: "indigo.order", order: "door_count" }).order, "door_count");
});

// ---------------------------------------------------------------------
// Result shaping
// ---------------------------------------------------------------------

test("formatQueryRow flattens many2ones to {id,name} and false to null", () => {
  const row = {
    id: 7,
    name: "IO-0007",
    dealer_id: [2, "Lock Tight"],
    client_zip: false,
    door_count: 2,
    on_hold: false,
  };
  assert.deepEqual(formatQueryRow("indigo.order", row), {
    id: 7,
    name: "IO-0007",
    dealer_id: { id: 2, name: "Lock Tight" },
    client_zip: null,
    door_count: 2,
    // a false boolean is a value, not an absence
    on_hold: false,
  });
});

test("formatQueryRow drops Odoo's internal keys", () => {
  const out = formatQueryRow("indigo.order", { id: 1, __last_update: "x", display_name: "y" });
  assert.deepEqual(Object.keys(out), ["id"]);
});

test("formatGroupRow surfaces __count as count and keeps the grouped value", () => {
  const plan = planQuery({
    model: "indigo.order",
    group_by: ["stage_id"],
    aggregate: [{ field: "total_dealer_charge", fn: "sum" }],
  });
  const out = formatGroupRow(plan, {
    stage_id: [8, "Painting"],
    total_dealer_charge: 1234.5,
    __count: 28,
    __domain: [["stage_id", "=", 8]],
  });
  assert.deepEqual(out, {
    stage_id: { id: 8, name: "Painting" },
    total_dealer_charge: 1234.5,
    count: 28,
  });
});

test("formatGroupRow keeps a date-granularity group label as text", () => {
  const plan = planQuery({ model: "indigo.order", group_by: ["create_date:month"] });
  const out = formatGroupRow(plan, {
    "create_date:month": "julio 2026",
    __count: 41,
    __domain: [],
  });
  assert.deepEqual(out, { "create_date:month": "julio 2026", count: 41 });
});

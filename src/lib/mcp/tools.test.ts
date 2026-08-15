import test from "node:test";
import assert from "node:assert/strict";

import { TOOL_DEFS, formatOrder } from "./tools.ts";

test("every tool advertises a name, description and object schema", () => {
  assert.ok(TOOL_DEFS.length >= 6, `expected at least 6 tools, got ${TOOL_DEFS.length}`);
  for (const t of TOOL_DEFS) {
    assert.ok(t.name && /^[a-z_]+$/.test(t.name), `bad tool name: ${t.name}`);
    assert.ok(t.description && t.description.length > 20, `thin description on ${t.name}`);
    assert.equal(t.inputSchema.type, "object", `${t.name} schema must be an object`);
  }
});

test("tool names are unique", () => {
  const names = TOOL_DEFS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test("formatOrder flattens Odoo's many2one tuples and false-for-empty", () => {
  const row = {
    id: 7,
    name: "IO-0007",
    client_name: "Perez",
    client_address: false,
    stage_id: [3, "Painting"],
    dealer_id: [2, "Lock Tight"],
    installation_date: false,
    door_count: 2,
  };
  assert.deepEqual(formatOrder(row), {
    id: 7,
    order: "IO-0007",
    client: "Perez",
    address: null,
    stage: "Painting",
    dealer: "Lock Tight",
    installation_date: null,
    doors: 2,
  });
});

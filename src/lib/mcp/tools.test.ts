import test from "node:test";
import assert from "node:assert/strict";

import { TOOL_DEFS, formatOrder, clampLimit, mcpError, toMcpToolError, McpToolError } from "./tools.ts";

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

// ---------------------------------------------------------------------
// clampLimit — the blast-radius cap. A regression here (e.g. the clamp
// silently disappearing) must fail a unit test directly, not depend on
// the eval harness's DB happening to be small enough that an unclamped
// query still comes back under 100 rows.
// ---------------------------------------------------------------------

test("clampLimit caps an oversized request at MAX_LIMIT (100)", () => {
  assert.equal(clampLimit(5000), 100);
});

test("clampLimit falls back to DEFAULT_LIMIT (25) for zero", () => {
  assert.equal(clampLimit(0), 25);
});

test("clampLimit falls back to DEFAULT_LIMIT (25) for a negative number", () => {
  assert.equal(clampLimit(-1), 25);
});

test("clampLimit falls back to DEFAULT_LIMIT (25) for a non-number (string)", () => {
  assert.equal(clampLimit("50"), 25);
});

test("clampLimit falls back to DEFAULT_LIMIT (25) for NaN", () => {
  assert.equal(clampLimit(NaN), 25);
});

test("clampLimit passes through an in-range value unchanged", () => {
  assert.equal(clampLimit(7), 7);
});

// ---------------------------------------------------------------------
// Error contract — mcpError()/toMcpToolError() map every failure a tool
// can raise onto "[CODIGO] mensaje en castellano" with a stable code the
// agent can branch on. See src/lib/mcp/tools.ts's toMcpToolError doc
// comment for why this is duck-typed on OdooRpcError's shape rather than
// instanceof.
// ---------------------------------------------------------------------

test("mcpError formats as '[CODE] message'", () => {
  const e = mcpError("PERMISO_DENEGADO", "No tienes permiso.");
  assert.equal(e.message, "[PERMISO_DENEGADO] No tienes permiso.");
  assert.equal(e.code, "PERMISO_DENEGADO");
});

test("toMcpToolError passes an existing McpToolError through unchanged", () => {
  const original = mcpError("NO_ENCONTRADO", "No existe.");
  assert.equal(toMcpToolError(original), original);
});

test("toMcpToolError maps an OdooRpcError-shaped AccessError to PERMISO_DENEGADO", () => {
  const odooError = Object.assign(new Error("You are not allowed to access this."), {
    name: "OdooRpcError",
    errorName: "odoo.exceptions.AccessError",
  });
  const mapped = toMcpToolError(odooError);
  assert.ok(mapped instanceof McpToolError);
  assert.equal(mapped.code, "PERMISO_DENEGADO");
});

test("toMcpToolError maps an OdooRpcError-shaped MissingError to NO_ENCONTRADO", () => {
  const odooError = Object.assign(new Error("Record does not exist."), {
    name: "OdooRpcError",
    errorName: "odoo.exceptions.MissingError",
  });
  const mapped = toMcpToolError(odooError);
  assert.equal(mapped.code, "NO_ENCONTRADO");
});

test("toMcpToolError maps a timeout/network OdooRpcError to TRANSITORIO", () => {
  for (const errorName of ["TIMEOUT", "NETWORK"]) {
    const odooError = Object.assign(new Error("boom"), { name: "OdooRpcError", errorName });
    assert.equal(toMcpToolError(odooError).code, "TRANSITORIO", `errorName=${errorName}`);
  }
});

test("toMcpToolError maps an OdooRpcError with an HTTP 5xx status to TRANSITORIO", () => {
  const odooError = Object.assign(new Error("HTTP 502 from Odoo"), {
    name: "OdooRpcError",
    httpStatus: 502,
  });
  assert.equal(toMcpToolError(odooError).code, "TRANSITORIO");
});

test("toMcpToolError falls back to ERROR_ODOO for an unrecognized OdooRpcError", () => {
  const odooError = Object.assign(new Error("odoo.exceptions.ValidationError: something else"), {
    name: "OdooRpcError",
    errorName: "odoo.exceptions.ValidationError",
  });
  assert.equal(toMcpToolError(odooError).code, "ERROR_ODOO");
});

test("toMcpToolError falls back to ERROR_ODOO for a plain Error", () => {
  assert.equal(toMcpToolError(new Error("something unexpected")).code, "ERROR_ODOO");
});

test("toMcpToolError falls back to ERROR_ODOO for a non-Error throw", () => {
  assert.equal(toMcpToolError("just a string").code, "ERROR_ODOO");
});

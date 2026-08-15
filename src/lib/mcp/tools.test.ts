import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import {
  TOOL_DEFS,
  formatOrder,
  clampLimit,
  mcpError,
  toMcpToolError,
  McpToolError,
  runWriteTool,
} from "./tools.ts";
import { issueConfirmToken, CONFIRM_TOKEN_TTL_MS } from "./confirm.ts";
import type { McpIdentity } from "./token.ts";

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

// ---------------------------------------------------------------------
// Fase 2 write tools — schema shape. The full read/write/execute behavior
// of each write tool talks to Odoo (via the lazily-imported rpc.ts), which
// this plain `node --test` environment can't reach — same reason
// today_board/find_orders/etc. aren't exercised end-to-end here either (see
// this file's own top-of-suite tests, and docs/superpowers/notes/2026-08-
// 15-mcp-evals.md for where that contract-level testing actually lives).
// What IS fully testable here, with zero Odoo dependency, is the preview ->
// confirm handshake itself — see the runWriteTool suite below.
// ---------------------------------------------------------------------

const WRITE_TOOL_NAMES = ["advance_order", "assign_order", "schedule_install", "hold_order", "add_note"];

test("all five Fase 2 write tools are registered in TOOL_DEFS", () => {
  const names = new Set(TOOL_DEFS.map((t) => t.name));
  for (const name of WRITE_TOOL_NAMES) {
    assert.ok(names.has(name), `expected TOOL_DEFS to include '${name}'`);
  }
  assert.ok(TOOL_DEFS.length >= 11, `expected at least 11 tools (6 read + 5 write), got ${TOOL_DEFS.length}`);
});

test("every write tool's schema declares an optional 'confirm' string argument", () => {
  for (const name of WRITE_TOOL_NAMES) {
    const def = TOOL_DEFS.find((t) => t.name === name);
    assert.ok(def, `missing tool def for ${name}`);
    const props = def!.inputSchema.properties as Record<string, { type?: string }>;
    assert.equal(props.confirm?.type, "string", `${name} should have a string 'confirm' property`);
    assert.ok(
      !def!.inputSchema.required?.includes("confirm"),
      `${name} must NOT require 'confirm' — omitting it is what triggers a preview`,
    );
  }
});

test("every write tool's schema requires an 'order_id'", () => {
  for (const name of WRITE_TOOL_NAMES) {
    const def = TOOL_DEFS.find((t) => t.name === name)!;
    const props = def.inputSchema.properties as Record<string, { type?: string }>;
    assert.equal(props.order_id?.type, "number", `${name} should take a numeric order_id`);
    assert.ok(def.inputSchema.required?.includes("order_id"), `${name} should require order_id`);
  }
});

// ---------------------------------------------------------------------
// runWriteTool — the shared preview -> confirm orchestration every write
// tool is built on (src/lib/mcp/tools.ts). Exercised directly with a fake
// plan so this suite has ZERO Odoo dependency, matching this project's
// existing split between "pure logic, unit tested here" and "real Odoo,
// covered by the eval harness" (see docs/superpowers/notes/2026-08-15-mcp-
// evals.md). This is where the task's four required properties are proven
// end-to-end through the actual code path a real tool call takes, not just
// at the confirm.ts crypto layer (see confirm.test.ts for that layer).
// ---------------------------------------------------------------------

const SECRET = "w".repeat(32);
let savedSecret: string | undefined;

before(() => {
  savedSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET;
});

after(() => {
  if (savedSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = savedSecret;
});

const FAKE_ID: McpIdentity = { uid: 42, login: "majela@indigodecors.com", groups: [], apiKey: "fake-key" };
const NOW = 1_700_000_000_000;

function fakePlan(executed: { count: number; builds: number }) {
  return async () => {
    executed.builds += 1;
    return {
      message: "hacer la cosa de prueba",
      extra: { order: "IND/2026/00001", client: "Cliente de prueba" },
      execute: async () => {
        executed.count += 1;
      },
    };
  };
}

test("runWriteTool: a preview call (no confirm) performs zero writes", async () => {
  const executed = { count: 0, builds: 0 };
  const result = (await runWriteTool("advance_order", { order_id: 1 }, FAKE_ID, fakePlan(executed), NOW)) as {
    preview: boolean;
    confirm: string;
    message: string;
  };
  assert.equal(executed.count, 0, "buildPlan's execute() must not run on a preview call");
  assert.equal(executed.builds, 1, "buildPlan itself DOES run on preview — that's how it reads current state");
  assert.equal(result.preview, true);
  assert.ok(result.message.includes("Vista previa"));
  assert.equal(typeof result.confirm, "string");
  assert.ok(result.confirm.length > 0);
});

test("runWriteTool: a valid confirm token executes the plan exactly once", async () => {
  const executed = { count: 0, builds: 0 };
  const args = { order_id: 1 };
  const preview = (await runWriteTool("advance_order", args, FAKE_ID, fakePlan(executed), NOW)) as { confirm: string };

  const result = (await runWriteTool(
    "advance_order",
    { ...args, confirm: preview.confirm },
    FAKE_ID,
    fakePlan(executed),
    NOW + 1_000,
  )) as { ok: boolean; message: string };

  assert.equal(executed.count, 1, "execute() must run exactly once on a valid confirm");
  assert.equal(result.ok, true);
  assert.ok(result.message.includes("Hecho"));
});

test("runWriteTool: a token replayed with different arguments is rejected, and never executes", async () => {
  const executed = { count: 0, builds: 0 };
  const preview = (await runWriteTool("advance_order", { order_id: 1 }, FAKE_ID, fakePlan(executed), NOW)) as {
    confirm: string;
  };

  await assert.rejects(
    () =>
      runWriteTool(
        "advance_order",
        { order_id: 999, confirm: preview.confirm }, // different order_id than what was previewed
        FAKE_ID,
        fakePlan(executed),
        NOW + 1_000,
      ),
    (err: unknown) => {
      assert.ok(err instanceof McpToolError);
      assert.equal((err as McpToolError).code, "CONFIRMACION_INVALIDA");
      return true;
    },
  );
  assert.equal(executed.count, 0, "a mismatched confirm must never reach plan.execute()");
});

test("runWriteTool: an expired token is rejected, and never executes", async () => {
  const executed = { count: 0, builds: 0 };
  const preview = (await runWriteTool("advance_order", { order_id: 1 }, FAKE_ID, fakePlan(executed), NOW)) as {
    confirm: string;
  };

  const wayAfterExpiry = NOW + CONFIRM_TOKEN_TTL_MS + 60_000;
  await assert.rejects(
    () => runWriteTool("advance_order", { order_id: 1, confirm: preview.confirm }, FAKE_ID, fakePlan(executed), wayAfterExpiry),
    (err: unknown) => {
      assert.ok(err instanceof McpToolError);
      assert.equal((err as McpToolError).code, "CONFIRMACION_INVALIDA");
      return true;
    },
  );
  assert.equal(executed.count, 0, "an expired confirm must never reach plan.execute()");
});

test("runWriteTool: a token minted for a DIFFERENT tool name is rejected even with identical arguments", async () => {
  const executed = { count: 0, builds: 0 };
  const secret = SECRET;
  // Minted directly via confirm.ts for "assign_order", then presented to "advance_order".
  const foreignToken = issueConfirmToken("assign_order", { order_id: 1 }, FAKE_ID.uid, secret, NOW);

  await assert.rejects(
    () =>
      runWriteTool("advance_order", { order_id: 1, confirm: foreignToken }, FAKE_ID, fakePlan(executed), NOW + 1_000),
    (err: unknown) => {
      assert.ok(err instanceof McpToolError);
      assert.equal((err as McpToolError).code, "CONFIRMACION_INVALIDA");
      return true;
    },
  );
  assert.equal(executed.count, 0);
});

test("runWriteTool: buildPlan is re-evaluated fresh on the confirm call, not reused from the preview", async () => {
  // A confirm must re-read current Odoo state (order might have moved
  // stages, been reassigned, etc. between preview and confirm) rather than
  // trusting whatever the preview computed — see WritePlan's doc comment.
  const executed = { count: 0, builds: 0 };
  const args = { order_id: 1 };
  const preview = (await runWriteTool("advance_order", args, FAKE_ID, fakePlan(executed), NOW)) as { confirm: string };
  assert.equal(executed.builds, 1);

  await runWriteTool("advance_order", { ...args, confirm: preview.confirm }, FAKE_ID, fakePlan(executed), NOW + 1_000);
  assert.equal(executed.builds, 2, "buildPlan should run again on the confirm call, not be cached from the preview");
});

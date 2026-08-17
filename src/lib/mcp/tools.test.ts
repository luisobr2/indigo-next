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
  personRoleLabels,
  ADVANCE_OUTCOMES,
  requireLineSqf,
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
// list_people — the discovery tool that lets an agent turn a name like
// "Javier" into the res.partner id assign_order needs. Pure-logic pieces
// only (personRoleLabels, TOOL_DEFS shape) are unit-testable here; the
// Odoo-touching part (listPeople itself: res.users + res.groups reads,
// isInternalUser filtering) needs a real Odoo, same split as every other
// list tool in this file — see this suite's own top-of-file precedent.
// ---------------------------------------------------------------------

const NO_ROLES = {
  isManager: false,
  isOffice: false,
  isDesigner: false,
  isCnc: false,
  isPainter: false,
  isInstaller: false,
};

test("personRoleLabels returns an empty array when no Indigo group matched", () => {
  assert.deepEqual(personRoleLabels(NO_ROLES), []);
});

test("personRoleLabels maps a single role flag to its human label", () => {
  assert.deepEqual(personRoleLabels({ ...NO_ROLES, isInstaller: true }), ["Installer"]);
  assert.deepEqual(personRoleLabels({ ...NO_ROLES, isPainter: true }), ["Painter"]);
});

test("personRoleLabels reports EVERY role a person holds, not just the first (disambiguation is the point)", () => {
  assert.deepEqual(personRoleLabels({ ...NO_ROLES, isManager: true, isOffice: true }), ["Manager", "Office"]);
});

test("personRoleLabels orders labels Manager, Office, Designer, CNC, Painter, Installer regardless of input order", () => {
  const allRoles = { isManager: true, isOffice: true, isDesigner: true, isCnc: true, isPainter: true, isInstaller: true };
  assert.deepEqual(personRoleLabels(allRoles), ["Manager", "Office", "Designer", "CNC", "Painter", "Installer"]);
});

test("list_people is registered with an optional 'q' and no required arguments", () => {
  const def = TOOL_DEFS.find((t) => t.name === "list_people");
  assert.ok(def, "expected a 'list_people' tool in TOOL_DEFS");
  const props = def!.inputSchema.properties as Record<string, { type?: string }>;
  assert.equal(props.q?.type, "string");
  assert.equal(props.limit?.type, "number");
  assert.equal(props.offset?.type, "number");
  assert.ok(!def!.inputSchema.required?.length, "list_people should have no required arguments");
});

test("list_people's description tells the model to call it before assign_order and to ask on ambiguity", () => {
  const def = TOOL_DEFS.find((t) => t.name === "list_people")!;
  assert.ok(/assign_order/.test(def.description), "should reference assign_order by name");
  assert.ok(/before/i.test(def.description), "should instruct calling it BEFORE assign_order");
  assert.ok(/ask/i.test(def.description), "should instruct asking the human on ambiguity, not guessing");
  assert.ok(/res\.partner/.test(def.description), "should state the id is a res.partner id");
});

test("assign_order's description points at list_people for resolving a name to an id", () => {
  const def = TOOL_DEFS.find((t) => t.name === "assign_order")!;
  assert.ok(/list_people/.test(def.description), "assign_order should reference list_people");
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

// ---------------------------------------------------------------------
// advance_order — 'digitalization_done' / 'cnc_done' wiring, and the
// per-line SQF requirement that moved from the (now-deleted)
// indigo.sqf.entry.wizard to indigo.cnc.done.wizard.
//
// The painter is paid total_sqf x rate, computed from line_ids.sqf at the
// moment the order LEAVES Painting (indigo_order.py's write() stage-change
// hook, via _create_painter_payout — see the ADVANCE_OUTCOMES doc comment
// in tools.ts). SQF is entered at 'cnc_done' and never touched again before
// that payout is created, so if 'cnc_done' silently accepted a missing or
// zero SQF, the painter's payout would be computed from zero. This is the
// money bug the wizard-removal task exists to prevent — hence its own test,
// separate from the generic runWriteTool coverage above.
// ---------------------------------------------------------------------

test("ADVANCE_OUTCOMES: SQF entry lives on cnc_done now, not digitalization_done", () => {
  assert.equal(
    ADVANCE_OUTCOMES.cnc_done?.requiresLineSqf,
    true,
    "cnc_done must require line_sqf -- it's the only place SQF is ever entered now",
  );
  assert.equal(ADVANCE_OUTCOMES.cnc_done?.wizardModel, "indigo.cnc.done.wizard");
  assert.ok(
    !ADVANCE_OUTCOMES.digitalization_done?.requiresLineSqf,
    "digitalization_done must NOT require line_sqf -- Majela asked for SQF entry to be removed from Digitalization",
  );
  assert.equal(
    ADVANCE_OUTCOMES.digitalization_done?.orderMethod,
    "action_send_to_designer",
    "digitalization_done drives indigo.order.action_send_to_designer(), not a wizard",
  );
  assert.equal(ADVANCE_OUTCOMES.digitalization_done?.wizardModel, undefined);
  assert.equal(
    ADVANCE_OUTCOMES.digitalization_done?.requiresDesigner,
    true,
    "must refuse up front if no designer is assigned, rather than guessing one",
  );
});

test("cnc_done refuses when line_sqf is missing entirely", () => {
  assert.throws(
    () => requireLineSqf(undefined, [10, 11], "cnc_done"),
    (err: unknown) => {
      assert.ok(err instanceof McpToolError);
      assert.equal((err as McpToolError).code, "ENTRADA_INVALIDA");
      assert.match((err as McpToolError).message, /line_sqf/);
      return true;
    },
  );
});

test("cnc_done refuses when line_sqf is missing SQF for one piece out of several", () => {
  assert.throws(
    () => requireLineSqf({ "10": 5.5 }, [10, 11], "cnc_done"),
    (err: unknown) => {
      assert.ok(err instanceof McpToolError);
      assert.equal((err as McpToolError).code, "ENTRADA_INVALIDA");
      assert.match((err as McpToolError).message, /pieza 11|piezas 11/);
      return true;
    },
  );
});

test("cnc_done refuses a zero SQF instead of silently sending it (would pay the painter $0)", () => {
  assert.throws(
    () => requireLineSqf({ "10": 0, "11": 5 }, [10, 11], "cnc_done"),
    (err: unknown) => {
      assert.ok(err instanceof McpToolError);
      assert.equal((err as McpToolError).code, "ENTRADA_INVALIDA");
      return true;
    },
  );
});

test("cnc_done accepts a complete map of real, positive SQF values", () => {
  const result = requireLineSqf({ "10": 5.5, "11": 3.25 }, [10, 11], "cnc_done");
  assert.deepEqual(result, { "10": 5.5, "11": 3.25 });
});

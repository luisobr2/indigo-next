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
  requireHoldCause,
  parseOrderDoors,
  inchesLabel,
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
    visit_type: null,
    visit_date: null,
    doors: 2,
  });
});

test("formatOrder surfaces a pending MEASUREMENT, which has no install date", () => {
  // El caso que motivo añadir visit_*: una orden a medir no tiene
  // installation_date, asi que con solo ese campo la IA la veia como una
  // orden sin nada programado. visit_type/visit_date son los que dicen que
  // alguien tiene que conducir hasta alli, y cuando.
  const row = {
    id: 9,
    name: "IO-0009",
    client_name: "Diaz",
    client_address: "1200 Brickell Ave, Miami, FL 33131",
    stage_id: [4, "Measurement Pending"],
    dealer_id: [2, "Lock Tight"],
    installation_date: false,
    visit_type: "measure",
    visit_date: "2026-09-18",
    door_count: 1,
  };
  const out = formatOrder(row);
  assert.equal(out.installation_date, null, "una medicion no tiene fecha de instalacion");
  assert.equal(out.visit_type, "measure");
  assert.equal(out.visit_date, "2026-09-18");
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

// Esta lista es el contrato de las herramientas de ESCRITURA: cada una tiene
// que pedir order_id y aceptar 'confirm' opcional. Una herramienta que escriba
// y no este aqui queda fuera de esas comprobaciones, que es justo como se
// cuela una que no pide confirmacion.
const WRITE_TOOL_NAMES = [
  "advance_order",
  "assign_order",
  "schedule_install",
  "schedule_measurement",
  "hold_order",
  "add_note",
  "create_order",
];

test("every write tool is registered in TOOL_DEFS", () => {
  const names = new Set(TOOL_DEFS.map((t) => t.name));
  for (const name of WRITE_TOOL_NAMES) {
    assert.ok(names.has(name), `expected TOOL_DEFS to include '${name}'`);
  }
  assert.ok(
    TOOL_DEFS.length >= 12,
    `expected at least 12 tools (6 read + 6 write), got ${TOOL_DEFS.length}`,
  );
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

test("every write tool that acts on an existing order requires an 'order_id'", () => {
  for (const name of WRITE_TOOL_NAMES) {
    // create_order is the one write tool with no order_id: it is what MAKES
    // the order the other six act on. Every other part of the write
    // contract — registered in TOOL_DEFS, optional 'confirm' — still applies
    // to it, which is why it stays in WRITE_TOOL_NAMES rather than being
    // dropped from the list to dodge this one assertion.
    if (name === "create_order") continue;
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

const FAKE_ID: McpIdentity = { uid: 42, login: "majela@indigodecors.com", groups: [], apiKey: "fake-key", isAdmin: false };
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

// ---------------------------------------------------------------------
// advance_order — the pre-write authorization gate.
//
// Every write outcome needs a role list, and each list must mirror the
// group list in the corresponding Odoo wizard. The reason the gate exists
// at all: advance_order writes per-line sqf/width/height to
// indigo.order.line BEFORE calling the wizard whose role check would
// refuse the caller — and ir.model.access.csv grants write on that model
// to group_indigo_user, which every internal role implies. So the writes
// landed and only then did the call "fail". Since total_sqf x rate is the
// painter's pay, a refused call could still have moved money.
//
// The lists below are transcribed from
// c:/Trabajo/odoo-indigo/addons/indigo_decors/wizards/indigo_stage_wizards.py
// and .../wizards/indigo_measurement_entry_wizard.py and
// .../models/indigo_order.py::_indigo_assert_can_send_to_designer.
// If the addon's lists change, this test is what should fail.
// ---------------------------------------------------------------------

test("every advance outcome declares who may run it", () => {
  for (const [outcome, config] of Object.entries(ADVANCE_OUTCOMES)) {
    assert.ok(
      Array.isArray(config.allowedRoles) && config.allowedRoles.length > 0,
      `outcome '${outcome}' has no allowedRoles — it would be writable by any internal role`,
    );
  }
});

test("allowedRoles mirrors each Odoo wizard's own group list", () => {
  const expected: Record<string, string[]> = {
    // _indigo_require_groups(manager, office, installer_internal)
    measurements_taken: ["isInstaller", "isOffice", "isManager"],
    // _indigo_assert_can_send_to_designer: office/manager only — explicitly
    // NOT the designer, who is the recipient, not the sender.
    digitalization_done: ["isOffice", "isManager"],
    // _indigo_require_groups(cnc, office, manager)
    cnc_done: ["isCnc", "isOffice", "isManager"],
    // _indigo_require_groups(painter_op, office, manager)
    painting_done: ["isPainter", "isOffice", "isManager"],
    // manager/office outright; an internal installer only for their own
    // assigned install — hence allowsAssignedInstaller rather than a role.
    installed: ["isOffice", "isManager"],
  };
  for (const [outcome, roles] of Object.entries(expected)) {
    assert.deepEqual(
      [...(ADVANCE_OUTCOMES[outcome]?.allowedRoles ?? [])].sort(),
      [...roles].sort(),
      `allowedRoles drifted from the Odoo wizard for '${outcome}'`,
    );
  }
  assert.deepEqual(
    Object.keys(ADVANCE_OUTCOMES).sort(),
    Object.keys(expected).sort(),
    "a new advance outcome was added without pinning its role list here",
  );
});

test("only 'installed' opens the assigned-installer carve-out", () => {
  for (const [outcome, config] of Object.entries(ADVANCE_OUTCOMES)) {
    assert.equal(
      config.allowsAssignedInstaller === true,
      outcome === "installed",
      `'${outcome}' must not let an installer through on assignment alone`,
    );
  }
});

test("no outcome that writes line data is open to a role the wizard would refuse", () => {
  // The two outcomes that write to indigo.order.line before the wizard
  // runs. These are the ones where a too-wide role list is not just a
  // permissions bug but a data-integrity one.
  for (const outcome of ["cnc_done", "measurements_taken"]) {
    const config = ADVANCE_OUTCOMES[outcome];
    assert.ok(config, `${outcome} missing`);
    assert.ok(
      !config.allowedRoles.includes("isPainter") && !config.allowedRoles.includes("isDesigner"),
      `${outcome} must not be reachable by painter or designer — they could overwrite pay-relevant line data`,
    );
  }
});

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

// ---------------------------------------------------------------------
// hold_order — requireHoldCause. Majela's 2026-08-15 request (item 3): a
// hold with no cause can't be counted or colored on the Installations
// screen, so the assistant must be blocked from creating one — same
// "money/data bug prevention" reasoning as requireLineSqf above, and same
// testable-without-Odoo split (indigo.order's own constraint is the real
// enforcement; this is the assistant-facing guard that fires first).
// ---------------------------------------------------------------------

test("hold_order refuses action 'hold' with no cause at all", () => {
  assert.throws(
    () => requireHoldCause({ order_id: 5, action: "hold" }, "hold"),
    (err: unknown) => {
      assert.ok(err instanceof McpToolError);
      assert.equal((err as McpToolError).code, "ENTRADA_INVALIDA");
      assert.match((err as McpToolError).message, /cause/);
      return true;
    },
  );
});

test("hold_order refuses action 'hold' with a cause that isn't one of the three values", () => {
  assert.throws(
    () => requireHoldCause({ order_id: 5, action: "hold", cause: "weather" }, "hold"),
    (err: unknown) => {
      assert.ok(err instanceof McpToolError);
      assert.equal((err as McpToolError).code, "ENTRADA_INVALIDA");
      return true;
    },
  );
});

test("hold_order accepts each of the three valid causes", () => {
  for (const cause of ["dealer", "client", "other"]) {
    assert.equal(requireHoldCause({ order_id: 5, action: "hold", cause }, "hold"), cause);
  }
});

test("hold_order's release action never requires a cause, even if omitted", () => {
  assert.equal(requireHoldCause({ order_id: 5, action: "release" }, "release"), undefined);
});

test("hold_order's description requires 'cause' when holding and tells the model to ask, not guess", () => {
  const def = TOOL_DEFS.find((t) => t.name === "hold_order")!;
  assert.match(def.description, /REQUIRED when action is 'hold'/);
  assert.match(def.description, /ask/i);
  const props = def.inputSchema.properties as Record<string, { enum?: string[] }>;
  assert.deepEqual(props.cause?.enum, ["dealer", "client", "other"]);
});

// ---------------------------------------------------------------------
// create_order — parseOrderDoors. The rules here exist because of what was
// measured on a real dealer sheet (2026-09-15, the Sotelo sheet that is
// already order IND/2026/00384): reading the same scan four times gave the
// contact block identical every time, but three different handwritten
// fractions and three different design codes. So type and color are
// required, and measurements and design are optional on purpose — an order
// with no dimensions is normal, an order with confident wrong ones is a
// scrapped door.
// ---------------------------------------------------------------------

test("parseOrderDoors accepts a door with only type and color", () => {
  const doors = parseOrderDoors({ doors: [{ door_type: "SD", color: "bronze" }] });
  assert.equal(doors.length, 1);
  assert.equal(doors[0].door_type, "SD");
  assert.equal(doors[0].color, "bronze");
  assert.equal(doors[0].qty, 1, "qty defaults to 1");
  assert.equal(doors[0].width, undefined, "no dimensions is a valid door");
  assert.equal(doors[0].design_code, undefined, "no design is a valid door");
});

test("parseOrderDoors rejects an empty or missing door list", () => {
  for (const args of [{}, { doors: [] }, { doors: "SD" }]) {
    assert.throws(() => parseOrderDoors(args as Record<string, unknown>), McpToolError);
  }
});

test("parseOrderDoors requires an explicit color — there is no safe default", () => {
  assert.throws(
    () => parseOrderDoors({ doors: [{ door_type: "SD" }] }),
    (e: unknown) => e instanceof McpToolError && /color/.test(e.message),
  );
});

test("parseOrderDoors rejects a door type that is not one of Odoo's three", () => {
  assert.throws(
    () => parseOrderDoors({ doors: [{ door_type: "single", color: "white" }] }),
    (e: unknown) => e instanceof McpToolError && /door_type/.test(e.message),
  );
});

test("parseOrderDoors rejects a window sold as a door type", () => {
  assert.throws(
    () => parseOrderDoors({ doors: [{ door_type: "horizontal_roller", color: "bronze" }] }),
    McpToolError,
  );
});

test("parseOrderDoors rejects a transcribed measurement that is off by a digit", () => {
  // 665.813 is really in their production data — a 65.813 that gained a 6.
  assert.throws(
    () => parseOrderDoors({ doors: [{ door_type: "SD", color: "white", width: 25.875, height: 665.813 }] }),
    (e: unknown) => e instanceof McpToolError && /transcripcion/.test(e.message),
  );
  assert.throws(
    () => parseOrderDoors({ doors: [{ door_type: "SD", color: "white", width: 222, height: 222 }] }),
    McpToolError,
  );
});

test("parseOrderDoors keeps the largest real panel Indigo has made", () => {
  // 72 x 103 in, a double door, measured in production 2026-09-15.
  const doors = parseOrderDoors({ doors: [{ door_type: "DD", color: "black", width: 72, height: 103 }] });
  assert.equal(doors[0].width, 72);
  assert.equal(doors[0].height, 103);
});

test("parseOrderDoors rejects zero and negative dimensions", () => {
  for (const height of [0, -5]) {
    assert.throws(
      () => parseOrderDoors({ doors: [{ door_type: "SD", color: "white", width: 24, height }] }),
      McpToolError,
    );
  }
});

test("parseOrderDoors caps how many doors one order can carry", () => {
  const one = { door_type: "SD", color: "white" };
  assert.equal(parseOrderDoors({ doors: Array(20).fill(one) }).length, 20);
  assert.throws(() => parseOrderDoors({ doors: Array(21).fill(one) }), McpToolError);
});

test("parseOrderDoors validates qty as a whole positive number", () => {
  assert.equal(parseOrderDoors({ doors: [{ door_type: "DD", color: "white", qty: 3 }] })[0].qty, 3);
  for (const qty of [0, -1, 2.5, "2"]) {
    assert.throws(
      () => parseOrderDoors({ doors: [{ door_type: "DD", color: "white", qty }] }),
      McpToolError,
    );
  }
});

test("create_order advertises no default color in its schema", () => {
  // A default here would undo the requirement enforced above: the model
  // would read one off the schema instead of asking.
  const def = TOOL_DEFS.find((t) => t.name === "create_order");
  assert.ok(def);
  const doors = def!.inputSchema.properties.doors as {
    items: { properties: Record<string, Record<string, unknown>>; required: string[] };
  };
  assert.equal(doors.items.properties.color.default, undefined);
  assert.deepEqual(doors.items.required, ["door_type", "color"]);
  assert.ok(!doors.items.required.includes("width"), "dimensions must stay optional");
  assert.ok(!doors.items.required.includes("design_code"), "design must stay optional");
});

test("inchesLabel writes a decimal back as the fraction on the sheet", () => {
  // The preview shows these so a wrong 24 1/8 is obvious next to the paper.
  assert.equal(inchesLabel(24.875), "24 7/8");
  assert.equal(inchesLabel(24.125), "24 1/8");
  assert.equal(inchesLabel(66.0625), "66 1/16");
  assert.equal(inchesLabel(75.125), "75 1/8");
  assert.equal(inchesLabel(72), "72");
  assert.equal(inchesLabel(20.5), "20 1/2");
});

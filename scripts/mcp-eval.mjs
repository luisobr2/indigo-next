#!/usr/bin/env node
/**
 * MCP eval harness for the Indigo panel's read-only MCP server.
 *
 * Speaks raw JSON-RPC 2.0 over HTTP directly against `POST /api/mcp` — no
 * MCP SDK client, no LLM, no agent. It exists to answer one question after
 * any change to a tool or its description: did the DATA a tool returns get
 * better or worse? Every scenario asserts on the parsed JSON payload a tool
 * call returns, never on prose an agent might produce about it.
 *
 * Usage:
 *   MCP_URL=http://localhost:4000/api/mcp MCP_TOKEN='<login>.<apikey>' node scripts/mcp-eval.mjs
 *
 * Exit code: 0 if every scenario passed (SKIPs allowed), 1 if any FAILed,
 * missing env, or an unrecoverable harness error.
 */

// ---------------------------------------------------------------------
// Env / config — fail loudly and immediately, never hang waiting on a
// request that has nowhere to go.
// ---------------------------------------------------------------------

const MCP_URL = process.env.MCP_URL;
const MCP_TOKEN = process.env.MCP_TOKEN;

if (!MCP_URL || !MCP_TOKEN) {
  console.error("FATAL: MCP_URL and/or MCP_TOKEN are not set — refusing to run (would hang or 401 on every request).");
  console.error(`  MCP_URL:   ${MCP_URL ? "(set)" : "MISSING"}`);
  console.error(`  MCP_TOKEN: ${MCP_TOKEN ? "(set)" : "MISSING"}`);
  console.error("");
  console.error("Usage:");
  console.error("  MCP_URL=http://localhost:4000/api/mcp MCP_TOKEN='<login>.<apikey>' node scripts/mcp-eval.mjs");
  process.exit(1);
}

const REQUEST_TIMEOUT_MS = 15000;
const PROTOCOL_VERSION = "2025-06-18";

/** Known-good tool names, from src/lib/mcp/tools.ts's TOOL_DEFS. */
const EXPECTED_TOOL_NAMES = [
  "today_board",
  "find_orders",
  "get_order",
  "list_stages",
  "list_dealers",
  "list_designs",
];

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

class ScenarioFail extends Error {
  constructor(message, expected, actual) {
    super(message);
    this.name = "ScenarioFail";
    this.expected = expected;
    this.actual = actual;
  }
}

class ScenarioSkip extends Error {
  constructor(message) {
    super(message);
    this.name = "ScenarioSkip";
  }
}

function fail(message, expected, actual) {
  throw new ScenarioFail(message, expected, actual);
}

function skip(message) {
  throw new ScenarioSkip(message);
}

/** Throws a ScenarioFail with expected/actual attached when `cond` is falsy. */
function expect(cond, message, expected, actual) {
  if (!cond) fail(message, expected, actual);
}

/** Renders any value as a short, readable string for a FAIL/SKIP line. */
function truncate(value, max = 500) {
  let s;
  if (typeof value === "string") {
    s = value;
  } else {
    try {
      s = JSON.stringify(value, null, 2);
    } catch {
      s = String(value);
    }
  }
  if (s === undefined) s = String(value);
  return s.length > max ? `${s.slice(0, max)}... (${s.length} chars total)` : s;
}

// ---------------------------------------------------------------------
// Transport — raw JSON-RPC 2.0 over HTTP, streamable-HTTP aware.
//
// The server (@modelcontextprotocol/server's createMcpHandler) responds
// with plain `application/json` in this deployment, but the streamable-HTTP
// spec allows `text/event-stream` too — handle both rather than assume one.
// If the server ever issues an `Mcp-Session-Id` response header, echo it on
// every later request, per the streamable-HTTP protocol notes in the brief.
// ---------------------------------------------------------------------

let nextRequestId = 1;
let sessionId;

/**
 * POSTs one JSON-RPC message to MCP_URL and returns
 * `{ status, contentType, rawText, json }`, where `json` is the parsed
 * JSON-RPC message matching the request id (or the last parsed message, for
 * notifications) — or `null` if nothing parseable came back.
 */
async function postRpc(body, { token = MCP_TOKEN } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    const reason = e?.name === "AbortError" ? `timed out after ${REQUEST_TIMEOUT_MS}ms` : e.message;
    throw new Error(`network error POSTing to ${MCP_URL}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  const returnedSessionId = res.headers.get("mcp-session-id");
  if (returnedSessionId) sessionId = returnedSessionId;

  const contentType = res.headers.get("content-type") || "";
  const rawText = await res.text();

  const messages = [];
  if (contentType.includes("text/event-stream")) {
    for (const line of rawText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (!payload) continue;
      try {
        messages.push(JSON.parse(payload));
      } catch {
        // Not a JSON data line (e.g. a keep-alive comment) — ignore it.
      }
    }
  } else if (rawText.trim()) {
    try {
      messages.push(JSON.parse(rawText));
    } catch {
      // Leave messages empty; caller sees status + rawText for diagnostics.
    }
  }

  let json = null;
  if (body && typeof body === "object" && "id" in body) {
    json = messages.find((m) => m && typeof m === "object" && m.id === body.id) ?? null;
  }
  if (!json) json = messages.length ? messages[messages.length - 1] : null;

  return { status: res.status, contentType, rawText, json };
}

/** Sends a JSON-RPC *request* (assigns the next id) and returns the postRpc() result. */
async function rpc(method, params) {
  const id = nextRequestId++;
  const body = { jsonrpc: "2.0", id, method, params: params ?? {} };
  return postRpc(body);
}

/** Calls a tool via tools/call and returns the raw postRpc() result. */
async function callTool(name, args = {}) {
  return rpc("tools/call", { name, arguments: args });
}

/**
 * Parses a successful tools/call response into the tool's actual return
 * value (result.content[0].text is a JSON string per route.ts's
 * `JSON.stringify(data, null, 2)`). Fails the scenario with expected/actual
 * context for every way this can go wrong: transport error, JSON-RPC error,
 * `isError` result, or unparseable text.
 */
function parseToolData(resp, toolName) {
  if (resp.status < 200 || resp.status >= 300) {
    fail(`tools/call(${toolName}) returned HTTP ${resp.status}`, "HTTP 2xx", `HTTP ${resp.status}: ${truncate(resp.rawText)}`);
  }
  if (!resp.json) {
    fail(`tools/call(${toolName}) returned no parseable JSON-RPC message`, "a JSON-RPC response", truncate(resp.rawText));
  }
  if (resp.json.error) {
    fail(`tools/call(${toolName}) returned a top-level JSON-RPC error`, "a successful result", truncate(resp.json.error));
  }
  const result = resp.json.result;
  if (!result || result.isError) {
    fail(`tools/call(${toolName}) returned isError`, "isError: false (or absent)", truncate(result));
  }
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") {
    fail(`tools/call(${toolName}) result.content[0].text is missing`, "a string", truncate(result));
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`tools/call(${toolName}) result.content[0].text was not valid JSON`, "valid JSON", truncate(text));
  }
}

// ---------------------------------------------------------------------
// Scenario state carried between dependent scenarios (per the brief:
// find_orders_by_dealer reuses the dealer found by dealers_include_locktight;
// get_order_roundtrip reuses the order found by find_orders_by_dealer).
// ---------------------------------------------------------------------

let lockTightDealer; // set by dealers_include_locktight
let dealerFilteredOrderId; // set by find_orders_by_dealer, if it found rows

// ---------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------

async function scenarioInitializeOk() {
  const resp = await rpc("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "indigo-eval", version: "1" },
  });
  expect(resp.status >= 200 && resp.status < 300, `initialize returned HTTP ${resp.status}`, "HTTP 2xx", truncate(resp.rawText));
  expect(!!resp.json, "initialize response body was not parseable JSON-RPC", "a JSON-RPC message", truncate(resp.rawText));
  expect(!resp.json.error, "initialize returned a JSON-RPC error", "no top-level error", truncate(resp.json.error));
  expect(!!resp.json.result, "initialize returned no 'result'", "{ result: {...} }", truncate(resp.json));
}

async function scenarioToolsListComplete() {
  const resp = await rpc("tools/list", {});
  expect(resp.status >= 200 && resp.status < 300, `tools/list returned HTTP ${resp.status}`, "HTTP 2xx", truncate(resp.rawText));
  expect(!!resp.json, "tools/list response body was not parseable JSON-RPC", "a JSON-RPC message", truncate(resp.rawText));
  expect(!resp.json.error, "tools/list returned a JSON-RPC error", "no top-level error", truncate(resp.json.error));
  const tools = resp.json.result?.tools;
  expect(Array.isArray(tools), "tools/list result.tools is not an array", "array", truncate(resp.json.result));
  const names = tools.map((t) => t?.name);
  const missing = EXPECTED_TOOL_NAMES.filter((n) => !names.includes(n));
  expect(missing.length === 0, "tools/list is missing expected tool(s)", EXPECTED_TOOL_NAMES, `got: ${truncate(names)}`);
}

async function scenarioStagesAreOrdered() {
  const data = parseToolData(await callTool("list_stages", { limit: 100 }), "list_stages");
  expect(Array.isArray(data), "list_stages did not return an array", "array", truncate(data));
  expect(data.length >= 10, "list_stages returned fewer than 10 stages", ">= 10 stages", `${data.length} stages: ${truncate(data)}`);
  const codes = [];
  for (const s of data) {
    expect(
      s && typeof s.code === "string" && s.code.length > 0,
      "a stage is missing a non-empty 'code'",
      "{ code: string, ... } on every stage",
      truncate(s),
    );
    codes.push(s.code);
  }
  const dupes = [...new Set(codes.filter((c, i) => codes.indexOf(c) !== i))];
  expect(dupes.length === 0, "list_stages has duplicate codes", "no duplicate codes", `duplicates: ${dupes.join(", ")}`);
}

async function scenarioDealersIncludeLocktight() {
  const data = parseToolData(await callTool("list_dealers", { limit: 100 }), "list_dealers");
  expect(Array.isArray(data), "list_dealers did not return an array", "array", truncate(data));
  const match = data.find((d) => d && typeof d.name === "string" && /lock ?tight/i.test(d.name));
  expect(!!match, "no dealer name matched /lock ?tight/i", "a dealer named like 'Lock Tight'", `dealer names: ${truncate(data.map((d) => d?.name))}`);
  lockTightDealer = match;
}

async function scenarioDesignsAreGrounded() {
  const data = parseToolData(await callTool("list_designs", { limit: 100 }), "list_designs");
  expect(Array.isArray(data), "list_designs did not return an array", "array", truncate(data));
  expect(data.length >= 20, "list_designs returned fewer than 20 designs", ">= 20 designs", `${data.length} designs`);
  const codeRe = /^[A-Z0-9][A-Z0-9_-]*$/;
  const bad = data.filter((d) => !d || typeof d.code !== "string" || !codeRe.test(d.code));
  expect(
    bad.length === 0,
    "some design codes don't match the expected pattern",
    codeRe.toString(),
    truncate(bad.map((d) => d?.code)),
  );
}

async function scenarioTodayBoardShape() {
  const data = parseToolData(await callTool("today_board", {}), "today_board");
  // The tool's real return shape (todayBoard() in src/lib/mcp/tools.ts) is
  // `{ stages: [{ stage, code, orders: [...] }, ...] }` — an array of
  // per-stage groups, NOT a plain object keyed directly by stage name as a
  // literal reading of the brief's one-line description might suggest.
  // Asserting against the actual shape here, per the task's field-by-field
  // instruction: "grouped by stage, every value [group] is an array
  // [of orders]".
  expect(data && typeof data === "object" && !Array.isArray(data), "today_board did not return an object", "object", truncate(data));
  expect(Array.isArray(data.stages), "today_board result has no 'stages' array", "{ stages: [...] }", truncate(data));
  for (const group of data.stages) {
    expect(group && typeof group.stage === "string", "a today_board group is missing 'stage'", "{ stage: string, ... }", truncate(group));
    expect(Array.isArray(group.orders), "a today_board group's 'orders' is not an array", "array", truncate(group));
  }
}

async function scenarioFindOrdersByDealer() {
  if (!lockTightDealer) {
    skip("dealers_include_locktight didn't find a Lock Tight dealer to filter by — nothing to test here");
  }
  // find_orders filters by dealer via the numeric `dealer_id` arg (per its
  // inputSchema in tools.ts) — its free-text `q` matches order number,
  // client name or dealer_ref, NOT the dealer's own display name, so a
  // literal "pass the dealer name as q" reading of the brief would test an
  // unsupported combination. Filtering by dealer_id is what the tool's own
  // schema documents for this purpose.
  const data = parseToolData(await callTool("find_orders", { dealer_id: lockTightDealer.id, limit: 100 }), "find_orders");
  expect(Array.isArray(data), "find_orders did not return an array", "array", truncate(data));
  if (data.length === 0) {
    skip(`find_orders returned 0 orders for dealer_id=${lockTightDealer.id} (${lockTightDealer.name}) — nothing to assert on in this environment`);
  }
  const badRows = data.filter((row) => !row || typeof row.dealer !== "string" || !/lock ?tight/i.test(row.dealer));
  expect(
    badRows.length === 0,
    "some rows from find_orders(dealer_id=<Lock Tight>) have a non-matching 'dealer' field",
    "every row.dealer matches /lock ?tight/i",
    truncate(badRows),
  );
  dealerFilteredOrderId = data[0].id;
}

async function scenarioGetOrderRoundtrip() {
  let orderId = dealerFilteredOrderId;
  let source = "find_orders_by_dealer";
  if (orderId === undefined) {
    // Sparse-DB fallback: find_orders_by_dealer may have legitimately SKIPped
    // (no Lock Tight orders here). Still exercise get_order against ANY order
    // so this scenario doesn't silently no-op whenever the seed data is thin.
    const rows = parseToolData(await callTool("find_orders", { limit: 10 }), "find_orders");
    expect(Array.isArray(rows), "find_orders (unfiltered fallback) did not return an array", "array", truncate(rows));
    if (rows.length === 0) {
      skip("no orders exist in this environment at all (both dealer-filtered and unfiltered find_orders returned 0 rows) — nothing to round-trip");
    }
    orderId = rows[0].id;
    source = "find_orders (unfiltered fallback)";
  }
  const data = parseToolData(await callTool("get_order", { id: orderId }), "get_order");
  expect(
    data !== null && data !== undefined,
    `get_order(${orderId}) returned null (order id came from ${source} but isn't visible via get_order)`,
    "a non-null order object",
    truncate(data),
  );
  expect(data.id === orderId, "get_order returned a different id than requested", orderId, data.id);
  expect(Array.isArray(data.lines), "get_order result 'lines' is not an array", "array", truncate(data.lines));
}

async function scenarioLimitIsCapped() {
  const data = parseToolData(await callTool("find_orders", { limit: 5000 }), "find_orders");
  expect(Array.isArray(data), "find_orders did not return an array", "array", truncate(data));
  expect(
    data.length <= 100,
    "find_orders with limit:5000 returned more than 100 rows — the blast-radius cap did not hold",
    "<= 100 rows",
    `${data.length} rows`,
  );
}

async function scenarioUnknownToolIsError() {
  const resp = await callTool("definitely_not_a_tool", {});
  // "Returns an error, not a crash": rpc()/callTool() would already have
  // thrown on a network failure, so getting here means the HTTP exchange
  // completed. It must come back as a well-formed JSON-RPC message that
  // signals failure either as a top-level JSON-RPC error, or as a tool
  // result with isError: true — the SDK's own docs say tool execution
  // errors use isError while protocol-level errors (like an unregistered
  // tool name) use a top-level JSON-RPC error, so accept either shape.
  expect(!!resp.json, "no parseable JSON-RPC response for an unknown tool call", "a JSON-RPC message", `HTTP ${resp.status}: ${truncate(resp.rawText)}`);
  const hasRpcError = !!resp.json.error;
  const hasIsError = !!(resp.json.result && resp.json.result.isError);
  expect(
    hasRpcError || hasIsError,
    "unknown tool call did not report an error either way",
    "top-level JSON-RPC 'error', or result.isError === true",
    truncate(resp.json),
  );
}

async function scenarioBadTokenIs401() {
  const savedSessionId = sessionId; // don't let this call disturb the real session
  try {
    const id = nextRequestId++;
    const body = {
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "indigo-eval-badtoken", version: "1" } },
    };
    const resp = await postRpc(body, { token: "not-a-real-login.not-a-real-apikey" });
    expect(resp.status === 401, "a bogus bearer token did not get HTTP 401", 401, resp.status);
  } finally {
    sessionId = savedSessionId;
  }
}

// ---------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------

const SCENARIOS = [
  ["initialize_ok", scenarioInitializeOk],
  ["tools_list_complete", scenarioToolsListComplete],
  ["stages_are_ordered", scenarioStagesAreOrdered],
  ["dealers_include_locktight", scenarioDealersIncludeLocktight],
  ["designs_are_grounded", scenarioDesignsAreGrounded],
  ["today_board_shape", scenarioTodayBoardShape],
  ["find_orders_by_dealer", scenarioFindOrdersByDealer],
  ["get_order_roundtrip", scenarioGetOrderRoundtrip],
  ["limit_is_capped", scenarioLimitIsCapped],
  ["unknown_tool_is_an_error", scenarioUnknownToolIsError],
  ["bad_token_is_401", scenarioBadTokenIs401],
];

async function main() {
  console.log(`MCP eval harness — target ${MCP_URL}`);
  console.log("");

  const results = [];
  for (const [name, fn] of SCENARIOS) {
    try {
      await fn();
      results.push({ name, status: "PASS" });
      console.log(`PASS ${name}`);
    } catch (e) {
      if (e instanceof ScenarioSkip) {
        results.push({ name, status: "SKIP", reason: e.message });
        console.log(`SKIP ${name} - ${e.message}`);
      } else if (e instanceof ScenarioFail) {
        results.push({ name, status: "FAIL", reason: e.message });
        console.log(`FAIL ${name} - ${e.message}`);
        console.log(`     expected: ${truncate(e.expected)}`);
        console.log(`     actual:   ${truncate(e.actual)}`);
      } else {
        results.push({ name, status: "FAIL", reason: e.message });
        console.log(`FAIL ${name} - unexpected error: ${e.message}`);
        if (e.stack) console.log(`     ${truncate(e.stack, 600)}`);
      }
    }
  }

  const totals = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const r of results) totals[r.status]++;

  console.log("");
  console.log(`Totals: ${totals.PASS} passed, ${totals.FAIL} failed, ${totals.SKIP} skipped (of ${results.length} scenarios)`);

  process.exit(totals.FAIL > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: eval harness crashed: ${e.message}`);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});

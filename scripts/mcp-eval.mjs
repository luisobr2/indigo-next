#!/usr/bin/env node
/**
 * MCP eval harness for the Indigo panel's MCP server — read-only tools
 * (Fase 1) and the reversible write tools' preview -> confirm handshake
 * (Fase 2).
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
 * Optionally also set ODOO_URL + ODOO_DB (the same values the target
 * server itself was started with) to run the `write_is_refused` scenario,
 * which authenticates directly against Odoo's own `/jsonrpc` with the
 * MCP_TOKEN credential and confirms Odoo refuses a write — deliberately a
 * separate pair of env vars from MCP_URL/MCP_TOKEN so an ordinary run
 * against a server that already points at a real Odoo doesn't
 * accidentally attempt a write there; that scenario SKIPs (not fails)
 * when they're absent.
 *
 * WRITE-TOOL SCENARIOS (advance_order/assign_order/schedule_install/
 * hold_order/add_note) additionally require `ODOO_DB` to be the LITERAL
 * string `indigo-staging` — see requireStagingOrSkip() below and
 * docs/superpowers/notes/2026-08-15-staging.md for how to stand up and
 * tunnel to that environment. Every one of them SKIPs loudly (never
 * silently) otherwise. This is not a courtesy check: a write eval that ran
 * against production because someone forgot to set an env var would be the
 * worst possible outcome of this whole phase, per the task brief that
 * built these tools. Even the PREVIEW-only assertions are gated the same
 * way, on purpose — proving "a preview writes nothing" is only meaningful
 * against a real Odoo, and the one place that's safe to prove it is
 * staging.
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
  "advance_order",
  "assign_order",
  "schedule_install",
  "hold_order",
  "add_note",
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

/**
 * Asserts a list tool's paging envelope: `{ items: [...], total, truncated }`
 * with `total` a non-negative number and `truncated` consistent with
 * `items.length` vs `total` (offset defaults to 0 for every call in this
 * harness). Returns `data.items` so callers can keep asserting on the rows
 * without re-deriving this every time.
 */
function expectListEnvelope(data, toolName) {
  expect(data && typeof data === "object" && !Array.isArray(data), `${toolName} did not return an envelope object`, "{ items, total, truncated }", truncate(data));
  expect(Array.isArray(data.items), `${toolName} result has no 'items' array`, "{ items: [...], ... }", truncate(data));
  expect(typeof data.total === "number" && data.total >= 0, `${toolName} result 'total' is not a non-negative number`, "number >= 0", truncate(data.total));
  expect(typeof data.truncated === "boolean", `${toolName} result 'truncated' is not a boolean`, "boolean", truncate(data.truncated));
  expect(
    data.truncated === data.items.length < data.total,
    `${toolName} 'truncated' is inconsistent with items.length vs total`,
    `truncated === (items.length < total) — items.length=${data.items.length}, total=${data.total}`,
    `truncated=${data.truncated}`,
  );
  return data.items;
}

async function scenarioStagesAreOrdered() {
  const envelope = parseToolData(await callTool("list_stages", { limit: 100 }), "list_stages");
  const data = expectListEnvelope(envelope, "list_stages");
  expect(data.length >= 10, "list_stages returned fewer than 10 stages", ">= 10 stages", `${data.length} stages: ${truncate(data)}`);
  const codes = [];
  let lastSequence = -Infinity;
  for (const s of data) {
    expect(
      s && typeof s.code === "string" && s.code.length > 0,
      "a stage is missing a non-empty 'code'",
      "{ code: string, ... } on every stage",
      truncate(s),
    );
    expect(
      typeof s.sequence === "number",
      "a stage is missing a numeric 'sequence'",
      "{ sequence: number, ... } on every stage",
      truncate(s),
    );
    // The tool's own description promises stages come back "in their
    // configured order" — assert that ordering directly (sequence
    // non-decreasing) instead of only checking count/uniqueness, which
    // pass regardless of whether `order: "sequence, id"` actually held.
    expect(
      s.sequence >= lastSequence,
      "list_stages returned stages out of sequence order",
      `sequence >= ${lastSequence}`,
      `got sequence ${s.sequence} for stage '${s.code}' after a higher one`,
    );
    lastSequence = s.sequence;
    codes.push(s.code);
  }
  const dupes = [...new Set(codes.filter((c, i) => codes.indexOf(c) !== i))];
  expect(dupes.length === 0, "list_stages has duplicate codes", "no duplicate codes", `duplicates: ${dupes.join(", ")}`);
}

async function scenarioDealersIncludeLocktight() {
  const envelope = parseToolData(await callTool("list_dealers", { limit: 100 }), "list_dealers");
  const data = expectListEnvelope(envelope, "list_dealers");
  const match = data.find((d) => d && typeof d.name === "string" && /lock ?tight/i.test(d.name));
  expect(!!match, "no dealer name matched /lock ?tight/i", "a dealer named like 'Lock Tight'", `dealer names: ${truncate(data.map((d) => d?.name))}`);
  lockTightDealer = match;
}

async function scenarioDesignsAreGrounded() {
  const envelope = parseToolData(await callTool("list_designs", { limit: 100 }), "list_designs");
  const data = expectListEnvelope(envelope, "list_designs");
  expect(data.length >= 20, "list_designs returned fewer than 20 designs", ">= 20 designs", `${data.length} designs`);
  const codeRe = /^[A-Z0-9][A-Z0-9_-]*$/;
  const bad = data.filter((d) => !d || typeof d.code !== "string" || !codeRe.test(d.code));
  expect(
    bad.length === 0,
    "some design codes don't match the expected pattern",
    codeRe.toString(),
    truncate(bad.map((d) => d?.code)),
  );
  // Production has 161 designs (per the catalog), well past the 100-per-call
  // cap — this tool exists specifically to ground design-code references, so
  // a silent truncation here is worse than useless (a confident false
  // "that code doesn't exist"). If the catalog is at or under 100 in this
  // environment, `truncated` legitimately reads false — only assert the
  // envelope is internally consistent (already done by expectListEnvelope)
  // and log what we saw so a shrinking catalog doesn't go unnoticed.
  if (envelope.total > 100) {
    expect(envelope.truncated === true, "list_designs has > 100 designs but did not report truncated:true", true, envelope.truncated);
  }
}

async function scenarioTodayBoardShape() {
  const data = parseToolData(await callTool("today_board", {}), "today_board");
  // The tool's real return shape (todayBoard() in src/lib/mcp/tools.ts) is
  // `{ stages: [{ stage, code, orders: [...] }, ...], shown, total,
  // truncated }` — an array of per-stage groups plus a paging envelope, NOT
  // a plain object keyed directly by stage name as a literal reading of the
  // brief's one-line description might suggest.
  expect(data && typeof data === "object" && !Array.isArray(data), "today_board did not return an object", "object", truncate(data));
  expect(Array.isArray(data.stages), "today_board result has no 'stages' array", "{ stages: [...] }", truncate(data));
  for (const group of data.stages) {
    expect(group && typeof group.stage === "string", "a today_board group is missing 'stage'", "{ stage: string, ... }", truncate(group));
    expect(Array.isArray(group.orders), "a today_board group's 'orders' is not an array", "array", truncate(group));
  }
  expect(typeof data.shown === "number", "today_board result has no numeric 'shown'", "number", truncate(data.shown));
  expect(typeof data.total === "number", "today_board result has no numeric 'total'", "number", truncate(data.total));
  expect(typeof data.truncated === "boolean", "today_board result has no boolean 'truncated'", "boolean", truncate(data.truncated));
  expect(
    data.truncated === data.shown < data.total,
    "today_board 'truncated' is inconsistent with shown vs total",
    `truncated === (shown < total) — shown=${data.shown}, total=${data.total}`,
    `truncated=${data.truncated}`,
  );
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
  const envelope = parseToolData(await callTool("find_orders", { dealer_id: lockTightDealer.id, limit: 100 }), "find_orders");
  const data = expectListEnvelope(envelope, "find_orders");
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
    const envelope = parseToolData(await callTool("find_orders", { limit: 10 }), "find_orders");
    const rows = expectListEnvelope(envelope, "find_orders");
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

async function scenarioGetOrderMissingIsNull() {
  // get_order's description promises null for a nonexistent/invisible id
  // (search_read-based, not read-based — see tools.ts) rather than an
  // Odoo MissingError/AccessError bubbling up as a tool error. Use an id
  // astronomically unlikely to exist.
  const data = parseToolData(await callTool("get_order", { id: 999999999 }), "get_order");
  expect(data === null, "get_order(999999999) did not return null for a nonexistent id", null, truncate(data));
}

async function scenarioLimitIsCapped() {
  // This is now a smoke test backed by a direct unit test on clampLimit()
  // in src/lib/mcp/tools.test.ts (5000 -> 100 among other cases) — that
  // test is the one that actually fails if the clamp regresses, since this
  // scenario alone would pass vacuously against a database with fewer than
  // 100 orders in it.
  const envelope = parseToolData(await callTool("find_orders", { limit: 5000 }), "find_orders");
  const data = expectListEnvelope(envelope, "find_orders");
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

/**
 * Regression guard for the "create-refusal" evidence that, before this
 * scenario existed, was only a one-off manual observation in the review
 * notes — never re-checked automatically. No MCP tool can write (every
 * tool implementation in tools.ts only ever calls search_read/read/
 * search_count), so there is no tool call that could even attempt this —
 * that absence is the read-only guarantee at the tool layer, and it's
 * already covered by every other scenario in this file only ever calling
 * read-style tools. What this scenario checks INSTEAD is the layer below
 * that: does Odoo's own ACL also refuse a write for the exact credential
 * pair (login + API key) an MCP bearer token is built from, in case that
 * pair is ever used directly (e.g. extracted from a token) rather than
 * through this app? It authenticates against Odoo's `/jsonrpc` exactly
 * like src/lib/odoo/rpc.ts does, then attempts `indigo.design.create` and
 * asserts Odoo itself rejects it.
 *
 * Requires ODOO_URL/ODOO_DB (NOT passed by this script's own MCP_URL/
 * MCP_TOKEN — deliberately separate env vars so a normal `mcp-eval.mjs`
 * run against a server that already has them configured doesn't
 * accidentally attempt a write against whatever Odoo that server points
 * at). SKIPs with a clear line if either is unset, per the brief — do not
 * default them to anything.
 */
async function scenarioWriteIsRefused() {
  const odooUrl = process.env.ODOO_URL;
  const odooDb = process.env.ODOO_DB;
  if (!odooUrl || !odooDb) {
    skip("ODOO_URL and/or ODOO_DB are not set for this eval process — refusing to guess an Odoo instance to write-probe. Set both explicitly to run this scenario.");
  }

  // Same <login>.<apikey> split as parseBearer() in src/lib/mcp/token.ts —
  // split on the LAST dot, since Odoo logins are emails and contain dots.
  const idx = MCP_TOKEN.lastIndexOf(".");
  if (idx <= 0 || idx === MCP_TOKEN.length - 1) {
    skip("MCP_TOKEN doesn't look like a '<login>.<apikey>' pair — cannot derive an Odoo credential for a direct write attempt");
  }
  const login = MCP_TOKEN.slice(0, idx);
  const apiKey = MCP_TOKEN.slice(idx + 1);

  async function odooRpc(service, method, args) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${odooUrl}/jsonrpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "call", params: { service, method, args } }),
        signal: controller.signal,
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        fail(`Odoo /jsonrpc (${service}.${method}) returned non-JSON`, "valid JSON", truncate(text));
      }
      return { httpStatus: res.status, json };
    } catch (e) {
      fail(`network error calling Odoo /jsonrpc directly (${service}.${method}): ${e.message}`, "a response from Odoo", e.message);
    } finally {
      clearTimeout(timer);
    }
  }

  const auth = await odooRpc("common", "authenticate", [odooDb, login, apiKey, {}]);
  const uid = auth.json?.result;
  expect(
    typeof uid === "number" && uid > 0,
    "direct Odoo authenticate with the MCP_TOKEN credential pair failed — cannot test write refusal without a valid uid",
    "a numeric uid",
    truncate(auth.json),
  );

  // A throwaway, obviously-labeled probe row — only matters if Odoo
  // unexpectedly ALLOWS this (see the assertion below), in which case a
  // human needs to find and remove it manually; nothing here can delete
  // it, on purpose.
  const probeCode = `MCP-EVAL-WRITE-PROBE-${Date.now()}`;
  const create = await odooRpc("object", "execute_kw", [
    odooDb,
    uid,
    apiKey,
    "indigo.design",
    "create",
    [{ code: probeCode, name: "MCP eval write probe — should be refused by Odoo" }],
  ]);
  expect(
    !!create.json?.error,
    `a direct indigo.design create over the MCP credential pair (login=${login}) was NOT refused by Odoo — read-only-ness is not actually enforced at the Odoo ACL layer for this account. If this created record ${probeCode}, remove it manually.`,
    "a JSON-RPC error (e.g. AccessError) from Odoo",
    truncate(create.json),
  );
}

// ---------------------------------------------------------------------
// Write-tool (Fase 2) scenarios — the preview -> confirm handshake,
// exercised against a REAL Odoo. Every one refuses to run unless ODOO_DB is
// the literal string "indigo-staging" — see the module doc comment above.
// ---------------------------------------------------------------------

/**
 * Every write-tool scenario calls this FIRST, before touching the MCP
 * server at all. `ODOO_DB` is the same env var the existing
 * `write_is_refused` scenario already requires (the operator is expected to
 * set it to whatever the target panel instance was actually started with —
 * this script has no way to introspect that from the MCP endpoint alone),
 * so this reuses that existing convention rather than inventing a second
 * flag. The check is an exact string match on purpose: no prefix/substring
 * match, no case-insensitivity, nothing that could accidentally accept
 * "indigo-prod-staging-copy" or similar.
 */
function requireStagingOrSkip(scenarioLabel) {
  const odooDb = process.env.ODOO_DB;
  if (odooDb !== "indigo-staging") {
    skip(
      `refusing to run ${scenarioLabel}: ODOO_DB is '${odooDb || "(unset)"}', not the literal 'indigo-staging'. ` +
        "Set ODOO_DB=indigo-staging (and point MCP_URL at a panel instance actually running against staging — " +
        "see docs/superpowers/notes/2026-08-15-staging.md) to run this scenario. This check exists specifically " +
        "so a write eval can never silently run against production.",
    );
  }
}

/**
 * Like parseToolData, but for calls this harness EXPECTS to be rejected
 * (a mismatched or tampered confirm token). Accepts either a top-level
 * JSON-RPC error or a tool result with `isError: true` — same duality as
 * scenarioUnknownToolIsError, for the same protocol-level reason — and
 * asserts the error text contains `codeSubstring` (e.g. "CONFIRMACION_
 * INVALIDA"), not just that SOME error came back, so this can't pass
 * against a call that failed for an unrelated reason.
 */
function expectToolIsError(resp, toolName, codeSubstring) {
  expect(resp.status >= 200 && resp.status < 300, `tools/call(${toolName}) returned HTTP ${resp.status}`, "HTTP 2xx (the error rides inside the JSON-RPC body)", `HTTP ${resp.status}: ${truncate(resp.rawText)}`);
  expect(!!resp.json, `tools/call(${toolName}) returned no parseable JSON-RPC message`, "a JSON-RPC response", truncate(resp.rawText));

  if (resp.json.error) {
    const msg = truncate(resp.json.error);
    expect(String(msg).includes(codeSubstring), `tools/call(${toolName}) errored, but not with the expected code`, codeSubstring, msg);
    return;
  }
  const result = resp.json.result;
  expect(!!result && result.isError, `tools/call(${toolName}) unexpectedly SUCCEEDED`, `isError:true or a JSON-RPC error containing '${codeSubstring}'`, truncate(result));
  const text = result?.content?.[0]?.text;
  expect(typeof text === "string" && text.includes(codeSubstring), `tools/call(${toolName}) isError text did not contain the expected code`, codeSubstring, truncate(text));
}

/** Scans up to 20 recent orders and returns the full get_order detail of
 *  the first one that is NOT currently on hold — the safe target for the
 *  hold/release round trip below, so the scenario never touches an order a
 *  real person genuinely put on hold for a real reason. Returns null if
 *  every recent order happens to be on hold (extremely unlikely; the
 *  scenario SKIPs in that case rather than picking one anyway). */
async function findOrderNotOnHold() {
  const envelope = parseToolData(await callTool("find_orders", { limit: 20 }), "find_orders");
  const rows = expectListEnvelope(envelope, "find_orders");
  for (const row of rows) {
    const detail = parseToolData(await callTool("get_order", { id: row.id }), "get_order");
    if (detail && detail.on_hold === false) return detail;
  }
  return null;
}

let safeOrderForWriteEvals; // set by hold_order_preview_and_rejections_make_no_change, reused by the round-trip scenario

async function scenarioHoldOrderPreviewAndRejectionsMakeNoChange() {
  requireStagingOrSkip("hold_order_preview_and_rejections_make_no_change");

  const order = await findOrderNotOnHold();
  if (!order) skip("every recent order is already on hold — nothing safe to probe without disturbing a real hold");
  safeOrderForWriteEvals = order;

  const previewArgs = { order_id: order.id, action: "hold", reason: "MCP eval harness probe (should never actually apply)" };
  const preview = parseToolData(await callTool("hold_order", previewArgs), "hold_order");
  expect(preview.preview === true, "hold_order without 'confirm' did not return preview:true", true, preview.preview);
  expect(typeof preview.confirm === "string" && preview.confirm.length > 0, "hold_order preview did not return a usable 'confirm' token", "non-empty string", truncate(preview.confirm));
  expect(typeof preview.message === "string" && preview.message.includes(order.order), "hold_order preview message does not name the order by its human number", `a message containing '${order.order}'`, truncate(preview.message));

  // The preview itself must be a pure read: re-fetch and confirm on_hold is
  // still false. This is the "a preview performs no write" property, proven
  // against the real server rather than only at the confirm.ts/tools.ts
  // unit-test layer (see confirm.test.ts and tools.test.ts's runWriteTool suite).
  const afterPreview = parseToolData(await callTool("get_order", { id: order.id }), "get_order");
  expect(afterPreview.on_hold === false, "calling hold_order WITHOUT confirm changed on_hold — a preview must never write", false, afterPreview.on_hold);

  // Argument-bound rejection: same token, different reason.
  const mismatchedArgs = { ...previewArgs, reason: "a different reason than what was previewed", confirm: preview.confirm };
  const mismatchResp = await callTool("hold_order", mismatchedArgs);
  expectToolIsError(mismatchResp, "hold_order", "CONFIRMACION_INVALIDA");

  // Tampered-token rejection: correct args, corrupted token.
  const tamperedConfirm = `${preview.confirm}tampered`;
  const tamperedResp = await callTool("hold_order", { ...previewArgs, confirm: tamperedConfirm });
  expectToolIsError(tamperedResp, "hold_order", "CONFIRMACION_INVALIDA");

  // Neither rejected attempt should have written anything either.
  const afterRejections = parseToolData(await callTool("get_order", { id: order.id }), "get_order");
  expect(afterRejections.on_hold === false, "a rejected (mismatched/tampered) confirm changed on_hold — it must never reach the write", false, afterRejections.on_hold);
}

async function scenarioHoldOrderConfirmAppliesAndReleaseReverts() {
  requireStagingOrSkip("hold_order_confirm_applies_and_release_reverts");

  const order = safeOrderForWriteEvals ?? (await findOrderNotOnHold());
  if (!order) skip("no safe (not-on-hold) order found to run the hold/release round trip on");

  let holdApplied = false;
  try {
    const holdArgs = { order_id: order.id, action: "hold", reason: "MCP eval harness round-trip (auto-released)" };
    const holdPreview = parseToolData(await callTool("hold_order", holdArgs), "hold_order");
    const holdResult = parseToolData(await callTool("hold_order", { ...holdArgs, confirm: holdPreview.confirm }), "hold_order");
    expect(holdResult.ok === true, "confirmed hold_order did not report ok:true", true, holdResult.ok);
    holdApplied = true;

    const afterHold = parseToolData(await callTool("get_order", { id: order.id }), "get_order");
    expect(afterHold.on_hold === true, "confirmed hold_order did not actually set on_hold on the order", true, afterHold.on_hold);
  } finally {
    // Best-effort revert, even if an assertion above threw — never leave a
    // real order on hold because this harness ran. Not wrapped in its own
    // try/catch: if the release itself fails, that SHOULD surface as an
    // uncaught error for a human to notice, since it means a probe order is
    // now stuck on hold.
    if (holdApplied) {
      const releaseArgs = { order_id: order.id, action: "release" };
      const releasePreview = parseToolData(await callTool("hold_order", releaseArgs), "hold_order");
      const releaseResult = parseToolData(await callTool("hold_order", { ...releaseArgs, confirm: releasePreview.confirm }), "hold_order");
      expect(releaseResult.ok === true, "confirmed hold_order (release) did not report ok:true — order may still be on hold, check manually", true, releaseResult.ok);

      const afterRelease = parseToolData(await callTool("get_order", { id: order.id }), "get_order");
      expect(afterRelease.on_hold === false, "order is still on_hold after the release round-trip — check manually", false, afterRelease.on_hold);
    }
  }
}

async function scenarioAddNoteConfirmIsVisibleInGetOrder() {
  requireStagingOrSkip("add_note_confirm_is_visible_in_get_order");

  const envelope = parseToolData(await callTool("find_orders", { limit: 1 }), "find_orders");
  const rows = expectListEnvelope(envelope, "find_orders");
  if (rows.length === 0) skip("no orders exist in this environment to add a note to");
  const orderId = rows[0].id;

  const marker = `MCP-EVAL-NOTE-PROBE-${Date.now()}`;
  const args = { order_id: orderId, note: marker };
  const preview = parseToolData(await callTool("add_note", args), "add_note");
  expect(preview.preview === true, "add_note without 'confirm' did not return preview:true", true, preview.preview);

  const beforeConfirm = parseToolData(await callTool("get_order", { id: orderId }), "get_order");
  expect(
    !beforeConfirm.notes || !beforeConfirm.notes.includes(marker),
    "the note text appeared BEFORE confirming — add_note's preview must not write",
    "notes does not yet contain the probe marker",
    truncate(beforeConfirm.notes),
  );

  const result = parseToolData(await callTool("add_note", { ...args, confirm: preview.confirm }), "add_note");
  expect(result.ok === true, "confirmed add_note did not report ok:true", true, result.ok);

  const afterConfirm = parseToolData(await callTool("get_order", { id: orderId }), "get_order");
  expect(
    typeof afterConfirm.notes === "string" && afterConfirm.notes.includes(marker),
    "confirmed add_note did not actually append the note visible via get_order",
    `notes containing '${marker}'`,
    truncate(afterConfirm.notes),
  );
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
  ["get_order_missing_is_null", scenarioGetOrderMissingIsNull],
  ["limit_is_capped", scenarioLimitIsCapped],
  ["unknown_tool_is_an_error", scenarioUnknownToolIsError],
  ["bad_token_is_401", scenarioBadTokenIs401],
  ["write_is_refused", scenarioWriteIsRefused],
  ["hold_order_preview_and_rejections_make_no_change", scenarioHoldOrderPreviewAndRejectionsMakeNoChange],
  ["hold_order_confirm_applies_and_release_reverts", scenarioHoldOrderConfirmAppliesAndReleaseReverts],
  ["add_note_confirm_is_visible_in_get_order", scenarioAddNoteConfirmIsVisibleInGetOrder],
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

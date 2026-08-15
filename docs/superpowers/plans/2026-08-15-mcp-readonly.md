# Read-Only MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Indigo team query the system by talking to an agent (Cowork, Codex) — read-only, over a remote MCP server the panel serves at `/api/mcp`.

**Architecture:** A Next route hosts `@modelcontextprotocol/server`'s web-standard handler. Every request carries a bearer token that IS an Odoo credential pair, so the RPC runs as the real person and Odoo's ACLs and record rules apply unchanged. Tools are domain-shaped (`today_board`, `find_orders`), not one-per-endpoint, and every tool is read-only in this phase.

**Tech Stack:** Next 16 App Router, `@modelcontextprotocol/server` v2.0.0, Odoo 17 JSON-RPC, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-14-mcp-ai-control-design.md` (Fase 1)

## Global Constraints

- Every tool in this phase is READ-ONLY. No tool may call a write, create, unlink or wizard method. A write tool is a Fase 2 change, not a judgement call an implementer makes.
- Modules that `node --test` loads, directly or transitively, import project modules with an explicit `.ts` extension (see `CLAUDE.md`). `next build` compiles those fine, including on Edge.
- `npm test` runs `node --test "src/**/*.test.ts"`. Baseline is 30 passing.
- Odoo RPC goes through `call({session, model, method, args, kwargs})` from `@/lib/odoo/client`. Never bypass it.
- The MCP route must never fall back to an unauthenticated identity. No token, bad token, or disabled kill switch ⇒ 401/503, never "anonymous read".
- Tool errors must be actionable Spanish text with a stable code, and must never leak an Odoo traceback.

## Ruling carried from design (read before Task 1)

The spec called for an `indigo.mcp.token` model in the addon mapping a token to `{uid, api_key, scope}`. **This plan drops that model.** The bearer token is instead `<odoo_login>.<odoo_api_key>`, verified by simply authenticating against Odoo.

Why: the model existed to give a token a scope narrower than the person's Odoo permissions — but in this phase every tool is read-only, so a narrower scope buys nothing. Dropping it removes a credential store, an ACL, a migration and a mint/revoke API surface. Revocation becomes "delete the API key in Odoo Settings", which is a screen that already exists.

What it costs: when Fase 2 adds writes, per-token scope has to come back — either as the original model or as a scoped Odoo group. Recorded in the spec's follow-ups.

---

### Task 1: Token verification

**Files:**
- Create: `src/lib/mcp/token.ts`
- Test: `src/lib/mcp/token.test.ts`

**Interfaces:**
- Consumes: `authenticate` from `@/lib/odoo/client`
- Produces:
  - `parseBearer(header: string | null): { login: string; apiKey: string } | null`
  - `verifyMcpToken(header: string | null): Promise<McpIdentity | null>` where `McpIdentity = { uid: number; login: string; name: string; groups: string[]; session: string }`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/mcp/token.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { parseBearer } from "./token.ts";

test("splits a bearer into login and api key on the LAST dot", () => {
  // Odoo logins are emails, so the login itself contains dots.
  assert.deepEqual(parseBearer("Bearer majela@indigodecors.com.abc123key"), {
    login: "majela@indigodecors.com",
    apiKey: "abc123key",
  });
});

test("accepts the raw value without the Bearer prefix", () => {
  assert.deepEqual(parseBearer("a@b.co.key"), { login: "a@b.co", apiKey: "key" });
});

test("rejects anything that is not a login/key pair", () => {
  for (const raw of [null, "", "Bearer ", "Bearer nodot", "Bearer .onlykey", "Bearer login."]) {
    assert.equal(parseBearer(raw), null, `expected null for ${JSON.stringify(raw)}`);
  }
});

test("trims surrounding whitespace", () => {
  assert.deepEqual(parseBearer("  Bearer   a@b.co.key  "), { login: "a@b.co", apiKey: "key" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './token.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/mcp/token.ts
/**
 * MCP bearer tokens are `<odoo_login>.<odoo_api_key>`.
 *
 * The token IS an Odoo credential pair, so verification is just an Odoo
 * authentication: the RPC then runs as that real person and Odoo's ACLs and
 * record rules apply unchanged, with no separate permission store to keep in
 * sync. Revoking access = deleting the API key in Odoo.
 */
import { authenticate } from "@/lib/odoo/client";

export interface McpIdentity {
  uid: number;
  login: string;
  name: string;
  groups: string[];
  /** Odoo session cookie to forward on subsequent RPCs. */
  session: string;
}

export function parseBearer(header: string | null): { login: string; apiKey: string } | null {
  if (!header) return null;
  const raw = header.trim().replace(/^Bearer\s+/i, "").trim();
  // Split on the LAST dot: Odoo logins are emails and contain dots.
  const idx = raw.lastIndexOf(".");
  if (idx <= 0 || idx === raw.length - 1) return null;
  const login = raw.slice(0, idx);
  const apiKey = raw.slice(idx + 1);
  if (!login || !apiKey) return null;
  return { login, apiKey };
}

export async function verifyMcpToken(header: string | null): Promise<McpIdentity | null> {
  const pair = parseBearer(header);
  if (!pair) return null;
  try {
    const res = await authenticate(pair.login, pair.apiKey);
    return {
      uid: res.uid,
      login: res.user.login,
      name: res.user.name,
      groups: res.user.groups,
      session: res.session,
    };
  } catch {
    // Bad key, disabled user, Odoo down — all are "no identity" to the caller.
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 4 new tests, 34 total

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/token.ts src/lib/mcp/token.test.ts
git commit -m "feat(mcp): verify MCP bearer tokens as Odoo credential pairs"
```

---

### Task 2: Read-only tool implementations

Tools are domain-shaped, not one-per-endpoint. Each returns plain data; the route layer wraps it for MCP.

**Files:**
- Create: `src/lib/mcp/tools.ts`
- Test: `src/lib/mcp/tools.test.ts`

**Interfaces:**
- Consumes: `McpIdentity` from `./token.ts`; `call` from `@/lib/odoo/client`
- Produces:
  - `formatOrder(row): object` — pure shaping helper
  - `TOOL_DEFS: Array<{name, title, description, inputSchema}>` — JSON Schema per tool
  - `runTool(name: string, args: Record<string, unknown>, id: McpIdentity): Promise<unknown>`

- [ ] **Step 1: Write the failing test for the pure parts**

```ts
// src/lib/mcp/tools.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './tools.ts'`

- [ ] **Step 3: Implement the tools**

Create `src/lib/mcp/tools.ts` with the pure helpers above plus `TOOL_DEFS` and `runTool`. Implement exactly these six tools, all read-only:

| Tool | What it does | Odoo call |
|---|---|---|
| `today_board` | Work scheduled or in progress right now, grouped by stage. Answers "¿qué hay para pintar hoy?" | `indigo.order` `search_read`, domain on active stages |
| `find_orders` | Search orders by client name, dealer, order number or stage | `indigo.order` `search_read` with an ilike domain |
| `get_order` | Full detail of one order including its lines | `indigo.order` `read` + `indigo.order.line` `search_read` |
| `list_stages` | The pipeline stages in order | `indigo.stage` `search_read` |
| `list_dealers` | Dealer companies | `res.partner` `search_read` on the dealer domain |
| `list_designs` | Catalog design codes, optionally filtered | `indigo.design` `search_read` |

Requirements binding all six:
- `runTool` dispatches on name and throws `new Error("UNKNOWN_TOOL: ...")` for anything else.
- Every Odoo call passes `session: id.session` so it runs as the real user.
- Every list tool takes an optional `limit` (default 25, hard max 100) — the blast-radius cap from the spec, applied to reads so a broad question cannot pull the whole DB into a prompt.
- The three discovery tools (`list_stages`, `list_dealers`, `list_designs`) exist so the model grounds itself instead of inventing a design code. Their descriptions must say so.
- Dates come back as plain `YYYY-MM-DD` strings, never Odoo's `false`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test && npx tsc --noEmit`
Expected: PASS — 3 new tests; tsc exit 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/tools.ts src/lib/mcp/tools.test.ts
git commit -m "feat(mcp): six read-only tools over orders, stages, dealers and designs"
```

---

### Task 3: The MCP route

**Files:**
- Create: `src/app/api/mcp/route.ts`
- Modify: `src/proxy.ts` — exempt `/api/mcp` from the session-cookie gate (it authenticates by bearer token, like `/api/calendar.ics`)

**Interfaces:**
- Consumes: `verifyMcpToken`, `McpIdentity` from `@/lib/mcp/token`; `TOOL_DEFS`, `runTool` from `@/lib/mcp/tools`
- Produces: `POST` handler at `/api/mcp`

- [ ] **Step 1: Exempt the route in the middleware**

In `src/proxy.ts`, add `pathname === "/api/mcp"` to the same exact-match exemption list that already carries `/api/calendar.ics`, with a comment saying it authenticates by bearer token. Use an exact match, not a prefix.

- [ ] **Step 2: Write the route**

```ts
// src/app/api/mcp/route.ts
import { McpServer, createMcpHandler, fromJsonSchema } from "@modelcontextprotocol/server";

import { verifyMcpToken, type McpIdentity } from "@/lib/mcp/token";
import { TOOL_DEFS, runTool } from "@/lib/mcp/tools";

export const runtime = "nodejs";

/** Kill switch: set MCP_ENABLED=false in Coolify to turn the server off
 *  without a deploy. Absent means enabled. */
function enabled(): boolean {
  return process.env.MCP_ENABLED !== "false";
}

function buildServer(identity: McpIdentity): McpServer {
  const server = new McpServer({ name: "indigo-decors", version: "1.0.0" });
  for (const def of TOOL_DEFS) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: fromJsonSchema(def.inputSchema),
      },
      async (args: Record<string, unknown>) => {
        try {
          const data = await runTool(def.name, args ?? {}, identity);
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Error";
          return {
            isError: true,
            content: [{ type: "text" as const, text: msg }],
          };
        }
      },
    );
  }
  return server;
}

export async function POST(req: Request): Promise<Response> {
  if (!enabled()) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "MCP deshabilitado." }, id: null },
      { status: 503 },
    );
  }
  const identity = await verifyMcpToken(req.headers.get("authorization"));
  if (!identity) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Token invalido." }, id: null },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="indigo-mcp"' } },
    );
  }
  const handler = createMcpHandler(() => buildServer(identity));
  return handler.fetch(req);
}
```

- [ ] **Step 3: Verify it builds and gates correctly**

Run: `npx tsc --noEmit && npx next build`
Expected: exit 0; the build output lists `ƒ /api/mcp`

Then start the server and check the gate by hand:

```bash
npm run build && npm run start &
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4000/api/mcp \
  -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: `401` — no token. Then repeat with `-H "Authorization: Bearer bogus.key"` and expect `401` again.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/mcp/route.ts src/proxy.ts
git commit -m "feat(mcp): serve a bearer-gated MCP endpoint at /api/mcp"
```

---

### Task 4: Eval harness

The evals are the only way to know whether a change to a tool or its description made the agent better or worse. They check the DATA a tool returns, not what an agent says about it.

**Files:**
- Create: `scripts/mcp-eval.mjs`
- Create: `docs/superpowers/notes/2026-08-15-mcp-evals.md`

**Interfaces:**
- Consumes: a running panel + a real MCP token, both from env (`MCP_URL`, `MCP_TOKEN`)
- Produces: a pass/fail report per scenario, non-zero exit on any failure

- [ ] **Step 1: Write the harness**

`scripts/mcp-eval.mjs` speaks raw JSON-RPC over HTTP — no SDK, no agent — so it tests the server, not a model. It must:

1. `POST {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"indigo-eval","version":"1"}}}` and assert a result comes back.
2. `tools/list` and assert every name in an expected list is present.
3. Run each scenario below via `tools/call`, asserting on the returned JSON.
4. Print `PASS`/`FAIL` per scenario and exit 1 if any failed.

Scenarios (each is `{name, tool, args, check(data)}`):

| Scenario | Asserts |
|---|---|
| `stages_are_ordered` | `list_stages` returns ≥ 10 stages, each with a `code`, and no duplicate codes |
| `dealers_include_locktight` | `list_dealers` contains a dealer whose name matches `/lock ?tight/i` |
| `designs_are_grounded` | `list_designs` returns ≥ 20 codes and every code matches `/^[A-Z0-9][A-Z0-9_-]*$/` |
| `today_board_shape` | `today_board` returns an object keyed by stage, every value an array |
| `find_orders_by_dealer` | `find_orders` with the dealer name from scenario 2 returns rows whose `dealer` all match it |
| `get_order_roundtrip` | take the first id from `find_orders`, `get_order` on it, assert same `id` and that `lines` is an array |
| `limit_is_capped` | `find_orders` with `limit: 5000` returns at most 100 rows — the blast-radius cap holds |
| `unknown_tool_is_an_error` | `tools/call` with `name: "definitely_not_a_tool"` returns an error, not a crash |
| `bad_token_is_401` | a request with a bogus bearer gets HTTP 401 |

- [ ] **Step 2: Run the evals against the local server**

```bash
MCP_URL=http://localhost:4000/api/mcp MCP_TOKEN='<login>.<apikey>' node scripts/mcp-eval.mjs
```

Expected: every scenario PASS, exit 0. If a scenario fails, fix the tool — not the assertion.

- [ ] **Step 3: Document the results**

Write `docs/superpowers/notes/2026-08-15-mcp-evals.md`: what each scenario proves, the command to re-run them, and the real output of the passing run.

- [ ] **Step 4: Commit**

```bash
git add scripts/mcp-eval.mjs docs/superpowers/notes/2026-08-15-mcp-evals.md
git commit -m "test(mcp): eval harness asserting on returned data, not agent claims"
```

---

## Self-Review

**Spec coverage.** Implements Fase 1's route, token verification, read + discovery tools, error format, blast-radius cap, kill switch, and evals. Deliberately NOT here: the `indigo.mcp.token` model (dropped, see the Ruling above), per-tool rate limiting (needs a store the panel does not have; the Odoo auth on every request is already the throttle), and the connection guide for Majela (written after the endpoint is live and its URL is known).

**Placeholder scan.** No TBD. Tasks 2 and 4 specify their deliverables as tables of exact tools and exact scenarios rather than full source, because the bodies are mechanical Odoo queries whose shape is fixed by the table; every name, cap and assertion is given.

**Type consistency.** `McpIdentity` is defined in Task 1 and consumed by Tasks 2 and 3. `TOOL_DEFS`/`runTool` are defined in Task 2 and consumed by Task 3. `parseBearer` is used only inside `verifyMcpToken`.

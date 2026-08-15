/**
 * Preview -> confirm handshake for MCP write tools.
 *
 * Every write tool in ./tools.ts performs zero writes on its own: called
 * without `confirm`, it only reads state and returns a plain-Spanish
 * description of what WOULD change, plus an opaque token minted here.
 * Called again with that token as `confirm`, it executes — but only if the
 * token verifies against the EXACT same tool + arguments it was minted for.
 *
 * No server-side store: the token is a self-contained HMAC over
 * `tool + normalised(args) + uid + exp`, so verification never looks
 * anything up — it recomputes the same MAC from whatever the caller just
 * sent and compares. That makes the argument-binding automatic: change ANY
 * argument (or call a different tool, or present a different identity) and
 * the recomputed MAC won't match, because that value was itself part of the
 * signed input. There is nothing a caller could forget to check.
 *
 * `exp` rides inside the signed input, not just alongside it as a plain
 * visible field, so a forged expiry is caught by the same signature check
 * as a forged argument — a token can't be kept alive past its TTL by
 * tampering with the visible exp part, because a different exp produces a
 * different MAC. This mirrors src/lib/odoo/session-cookie.ts's `exp`-inside-
 * the-signed-payload approach.
 *
 * Pure and clock-free by design, exactly like src/lib/mcp/rate-limit.ts's
 * `checkRate`: `now` (and here, `secret`) are parameters, never read
 * internally, so verification is deterministic under test. No `@/`-aliased
 * imports either, for the same reason as rate-limit.ts (see its own doc
 * comment) — this file is imported directly by its test file under plain
 * `node --test`, which does not resolve that alias. `node:crypto` is a bare
 * built-in specifier, not an alias, so it resolves fine there.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** "A few minutes" per the design spec (docs/superpowers/specs/2026-08-14-
 *  mcp-ai-control-design.md, Guardrails #2): long enough to read a preview
 *  aloud to a human and get a verbal go-ahead, short enough that a stale
 *  token (order changed hands, state moved on while the human was deciding)
 *  doesn't linger as a live bearer for an operation nobody actually just
 *  re-confirmed. */
export const CONFIRM_TOKEN_TTL_MS = 5 * 60_000;

const SEPARATOR = ".";

export type ConfirmFailureReason = "invalid" | "mismatch" | "expired";

export type ConfirmDecision = { ok: true } | { ok: false; reason: ConfirmFailureReason };

/**
 * Deterministic JSON encoding of a tool's args: object keys sorted
 * recursively (arrays keep their own order — order is meaningful there), so
 * `{a:1,b:2}` and `{b:2,a:1}` bind to the SAME token. Without this, a caller
 * that happens to serialize object keys in a different order on the confirm
 * call than on the preview call (e.g. re-encoding through a JS object) would
 * get a spurious "different arguments" rejection for an operation that is
 * actually identical.
 */
export function normalizeArgs(args: Record<string, unknown>): string {
  return JSON.stringify(sortKeysDeep(args));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function macInput(tool: string, argsJson: string, uid: number, exp: number): string {
  // Length-prefixing the tool name means "ab"+"c..." and "a"+"bc..." (a
  // pathological tool-name collision) can never coincide in the joined
  // string. Tool names are always one of the fixed literals in TOOL_DEFS,
  // never user input, so this is defense-in-depth rather than a real
  // exposure today.
  return `${tool.length}:${tool}:${uid}:${exp}:${argsJson}`;
}

function macOf(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

/**
 * Mints a confirm token bound to exactly this `tool` + `args` + `uid`,
 * valid until `now + CONFIRM_TOKEN_TTL_MS`. `args` should be the tool's raw
 * input with `confirm` itself already stripped out — there is nothing to
 * bind the token to inside itself, it's the token.
 */
export function issueConfirmToken(
  tool: string,
  args: Record<string, unknown>,
  uid: number,
  secret: string,
  now: number,
): string {
  const exp = now + CONFIRM_TOKEN_TTL_MS;
  const mac = macOf(macInput(tool, normalizeArgs(args), uid, exp), secret);
  const expPart = Buffer.from(String(exp), "utf8").toString("base64url");
  return `${expPart}${SEPARATOR}${mac}`;
}

/**
 * Verifies a token against the tool/args/uid the caller is presenting NOW —
 * never against what was presented when the token was issued (there is no
 * stored record of that to compare against). A token minted for different
 * arguments, a different tool, or a different identity fails here with
 * "mismatch", indistinguishable from outright tampering — the correct,
 * unavoidable property of an HMAC: verification can only tell "valid for
 * THIS exact input" from not, never "wrong args" from "forged" specifically.
 * Callers should treat both the same way: ask the agent to preview again.
 */
export function verifyConfirmToken(
  token: string,
  tool: string,
  args: Record<string, unknown>,
  uid: number,
  secret: string,
  now: number,
): ConfirmDecision {
  if (typeof token !== "string" || !token) return { ok: false, reason: "invalid" };
  const idx = token.lastIndexOf(SEPARATOR);
  if (idx <= 0 || idx === token.length - 1) return { ok: false, reason: "invalid" };
  const expPart = token.slice(0, idx);
  const presentedMac = token.slice(idx + 1);

  let exp: number;
  try {
    exp = Number(Buffer.from(expPart, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!Number.isFinite(exp)) return { ok: false, reason: "invalid" };

  const expectedMac = macOf(macInput(tool, normalizeArgs(args), uid, exp), secret);
  const presentedBuf = Buffer.from(presentedMac);
  const expectedBuf = Buffer.from(expectedMac);
  // Length check first: timingSafeEqual throws on a length mismatch rather
  // than returning false (same guard as verifyPayload in session-cookie.ts).
  if (presentedBuf.length !== expectedBuf.length || !timingSafeEqual(presentedBuf, expectedBuf)) {
    return { ok: false, reason: "mismatch" };
  }
  // Only trust `exp` for freshness once the MAC (which was computed over
  // that same exp) has verified — otherwise a caller could present ANY exp
  // with a garbage signature and have the expiry check run on their chosen
  // value instead of a signed one.
  if (now >= exp) return { ok: false, reason: "expired" };
  return { ok: true };
}

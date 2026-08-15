/**
 * Edge-safe half of the session cookie codec.
 *
 * The middleware (src/proxy.ts) runs on the Edge runtime, where node:crypto
 * is unavailable — so this module uses only atob + TextDecoder and does NOT
 * verify the signature. That is deliberate and safe: the middleware uses the
 * payload solely to route a pure installer to /installs, and API routes
 * enforce their own authorization. Anything that IS a security decision must
 * use verifyPayload from ./odoo/session-cookie.ts instead.
 */
export const SIGNATURE_SEPARATOR = ".";

/**
 * Single source of truth for how long a signed session stays valid. Both
 * consumers derive from this one constant so they cannot drift apart:
 *  - session.ts uses SESSION_LIFETIME_SECONDS for the cookie's browser-
 *    enforced `maxAge`.
 *  - session-cookie.ts uses SESSION_LIFETIME_MS to compute the `exp` baked
 *    into the signed payload (server-enforced, on every read).
 */
export const SESSION_LIFETIME_SECONDS = 60 * 60 * 8;
export const SESSION_LIFETIME_MS = SESSION_LIFETIME_SECONDS * 1000;

export function decodeUnverified(raw: string): unknown | null {
  const idx = raw.lastIndexOf(SIGNATURE_SEPARATOR);
  // idx <= 0 covers "", "nodot" and ".sig" (empty body).
  if (idx <= 0) return null;
  const body = raw.slice(0, idx);
  try {
    const b64 = body.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const bytes = Uint8Array.from(atob(b64 + pad), (ch) => ch.charCodeAt(0));
    // TextDecoder (not escape/unescape) so accented names survive.
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * Whether a decoded payload's `exp` (epoch ms) is still in the future at
 * `now`. `now` is a required parameter rather than read from the clock
 * internally, so this stays deterministic under test — same pattern as
 * `checkRate` in ../lib/mcp/rate-limit.ts.
 *
 * A payload with no `exp` field at all — one signed before this field
 * existed — is treated as EXPIRED, not valid-forever. That fails closed on
 * a format change, the same choice already made for the legacy unsigned
 * cookie (see "rejects the legacy unsigned cookie" in session-cookie.test.ts).
 * Consequence: every cookie already in a browser at deploy time (both the
 * primary session and the impersonation-backup cookie) stops verifying, and
 * that user is bounced to /login once — no data loss, just a re-login.
 */
export function isFresh(payload: unknown, now: number): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const exp = (payload as { exp?: unknown }).exp;
  return typeof exp === "number" && exp > now;
}

/**
 * Decodes a cookie value and returns the payload only if it is both
 * well-formed AND unexpired — the "is this a usable identity right now"
 * check the Edge middleware needs (proxy.ts, installer-guard.ts).
 * decodeUnverified alone only proves the cookie parses; it says nothing
 * about freshness, and deliberately keeps not saying so (see its own
 * tests) so existing callers that only care about shape are unaffected.
 */
export function decodeFreshUnverified(raw: string, now: number): unknown | null {
  const payload = decodeUnverified(raw);
  return isFresh(payload, now) ? payload : null;
}

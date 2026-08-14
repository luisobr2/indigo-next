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

/**
 * Server-only session helpers. Reads + writes the Indigo session cookie
 * via the next/headers `cookies()` API.
 *
 * Pure types + helpers (deriveRole, SessionPayload) live in ./types so
 * client components can import them safely.
 */
import "server-only";
import { cookies } from "next/headers";
import type { SessionPayload } from "./types";
export type { SessionPayload, SessionUser } from "./types";
export { deriveRole } from "./types";
import { signPayload, verifyPayload, requireSessionSecret } from "./session-cookie.ts";
import { SESSION_LIFETIME_SECONDS } from "../session-cookie-edge.ts";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "indigo_session";

/**
 * Purpose strings mixed into each cookie's MAC (see signPayload/verifyPayload
 * in ./session-cookie.ts). A value signed for one purpose must not verify
 * under the other, even though both cookies share a secret and payload
 * shape today — see the "purpose separation" tests in session-cookie.test.ts.
 */
const SESSION_PURPOSE = "session";
const ORIGINAL_SESSION_PURPOSE = "session-original";

/** Verify + parse a cookie value, or null if it is missing, forged, expired or legacy. */
function readSigned(raw: string | undefined, purpose: string): SessionPayload | null {
  if (!raw) return null;
  const payload = verifyPayload(raw, requireSessionSecret(), purpose, Date.now());
  return payload ? (payload as SessionPayload) : null;
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return readSigned(store.get(COOKIE_NAME)?.value, SESSION_PURPOSE);
}

export async function requireSession(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) throw new Response("Unauthorized", { status: 401 });
  return s;
}

/**
 * Whether the session cookie should carry the `Secure` flag.
 *
 * Defaults to true in production, but lets the operator override via
 * `COOKIE_SECURE=false` for environments behind plain HTTP (e.g. the
 * Coolify sslip.io URL before DNS + SSL are wired). Setting `Secure` on
 * an HTTP origin makes the browser silently drop the cookie, which
 * looks like a successful login that immediately bounces back to /login.
 */
const COOKIE_SECURE = (() => {
  const v = process.env.COOKIE_SECURE;
  if (v === "false" || v === "0") return false;
  if (v === "true" || v === "1") return true;
  return process.env.NODE_ENV === "production";
})();

export async function writeSession(payload: SessionPayload): Promise<void> {
  const store = await cookies();
  store.set(
    COOKIE_NAME,
    signPayload(payload, requireSessionSecret(), SESSION_PURPOSE, Date.now()),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: COOKIE_SECURE,
      path: "/",
      maxAge: SESSION_LIFETIME_SECONDS,
    },
  );
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/* ----------------------------------------------------------------- */
/* Impersonation backup — stores the manager's session under a       */
/* separate cookie so it can be restored when impersonation ends.    */
/* ----------------------------------------------------------------- */

const ORIGINAL_COOKIE = `${COOKIE_NAME}_original`;

export async function pushOriginalSession(
  payload: SessionPayload,
): Promise<void> {
  const store = await cookies();
  store.set(
    ORIGINAL_COOKIE,
    signPayload(payload, requireSessionSecret(), ORIGINAL_SESSION_PURPOSE, Date.now()),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: COOKIE_SECURE,
      path: "/",
      maxAge: SESSION_LIFETIME_SECONDS,
    },
  );
}

export async function popOriginalSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const raw = store.get(ORIGINAL_COOKIE)?.value;
  if (!raw) return null;
  store.delete(ORIGINAL_COOKIE);
  return readSigned(raw, ORIGINAL_SESSION_PURPOSE);
}

export async function getOriginalSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return readSigned(store.get(ORIGINAL_COOKIE)?.value, ORIGINAL_SESSION_PURPOSE);
}

export const SESSION_COOKIE = COOKIE_NAME;

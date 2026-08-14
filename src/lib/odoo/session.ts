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

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "indigo_session";

/** Verify + parse a cookie value, or null if it is missing, forged or legacy. */
function readSigned(raw: string | undefined): SessionPayload | null {
  if (!raw) return null;
  const payload = verifyPayload(raw, requireSessionSecret());
  return payload ? (payload as SessionPayload) : null;
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return readSigned(store.get(COOKIE_NAME)?.value);
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
  store.set(COOKIE_NAME, signPayload(payload, requireSessionSecret()), {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: 60 * 60 * 8,
  });
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
  store.set(ORIGINAL_COOKIE, signPayload(payload, requireSessionSecret()), {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function popOriginalSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const raw = store.get(ORIGINAL_COOKIE)?.value;
  if (!raw) return null;
  store.delete(ORIGINAL_COOKIE);
  return readSigned(raw);
}

export async function getOriginalSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return readSigned(store.get(ORIGINAL_COOKIE)?.value);
}

export const SESSION_COOKIE = COOKIE_NAME;

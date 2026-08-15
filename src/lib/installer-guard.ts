/**
 * Role-based routing guard for the installer role. Pure + Edge-safe: it
 * decodes the signed session cookie WITHOUT verifying the signature
 * (node:crypto is unavailable on Edge) and derives the role. That is sound
 * because this guard only routes the UI — forging a cookie to dodge the
 * redirect gains nothing, since the API routes enforce their own
 * authorization against Odoo. It DOES honor expiry (via decodeFreshUnverified)
 * so a stale cookie is treated as absent here too, not as a still-usable
 * identity.
 *
 * Why this exists: a "pure installer" (Installer with no manager/office/
 * specialist role) has exactly one place in the panel — their mobile
 * `/installs` view. The management pages either 403 their data (e.g.
 * `/installations` exposes every installer's pay) or aren't theirs to act on.
 * Without this guard an installer lands on `/installations` and the dashboard
 * fetch returns 403.
 */
import { deriveRole } from "./odoo/types.ts";
import type { SessionPayload } from "./odoo/types.ts";
import { decodeFreshUnverified } from "./session-cookie-edge.ts";

/** True when the user's ONLY Indigo role is Installer — confined to /installs. */
export function isOnlyInstaller(role: ReturnType<typeof deriveRole>): boolean {
  return (
    role.isInstaller &&
    !role.isManager &&
    !role.isOffice &&
    !role.isDesigner &&
    !role.isPainter &&
    !role.isCnc
  );
}

/**
 * Decide where to redirect a logged-in page request, or null to let it pass.
 *
 * - API routes (`/api/*`) are never redirected — they enforce their own authz
 *   and the installer's own `/installs` view fetches from them.
 * - The installer's area (`/installs`, `/installs/<id>`) is always allowed.
 * - Any other page, for a pure installer, is bounced to `/installs`.
 *
 * @param pathname     the requested path
 * @param cookieValue  raw `indigo_session` cookie value
 *                     (`<base64url(json)>.<base64url(hmac)>`), or undefined
 * @param now          epoch ms, used to reject an expired payload — passed
 *                     in rather than read internally so this stays pure and
 *                     deterministic under test (see rate-limit.ts's checkRate)
 */
export function installerRedirect(
  pathname: string,
  cookieValue: string | undefined,
  now: number,
): string | null {
  if (!cookieValue) return null;
  if (pathname.startsWith("/api")) return null;
  if (pathname === "/installs" || pathname.startsWith("/installs/")) return null;

  const payload = decodeFreshUnverified(cookieValue, now) as SessionPayload | null;
  if (!payload) return null;
  const role = deriveRole(payload.user?.groups ?? []);
  return isOnlyInstaller(role) ? "/installs" : null;
}

/**
 * Role-based routing guard for the installer role. Pure + Edge-safe: it only
 * parses the session cookie (plain JSON) and derives the role, so it can run
 * inside proxy.ts (the middleware) without any Odoo call or Node API.
 *
 * Why this exists: a "pure installer" (Installer with no manager/office/
 * specialist role) has exactly one place in the panel — their mobile
 * `/installs` view. The management pages either 403 their data (e.g.
 * `/installations` exposes every installer's pay) or aren't theirs to act on.
 * Without this guard an installer lands on `/installations` and the dashboard
 * fetch returns 403.
 */
import { deriveRole } from "./odoo/types";
import type { SessionPayload } from "./odoo/types";

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
 * @param cookieValue  raw `indigo_session` cookie value (JSON), or undefined
 */
export function installerRedirect(
  pathname: string,
  cookieValue: string | undefined,
): string | null {
  if (!cookieValue) return null;
  if (pathname.startsWith("/api")) return null;
  if (pathname === "/installs" || pathname.startsWith("/installs/")) return null;

  let role: ReturnType<typeof deriveRole>;
  try {
    const s = JSON.parse(cookieValue) as SessionPayload;
    role = deriveRole(s.user?.groups ?? []);
  } catch {
    return null;
  }
  return isOnlyInstaller(role) ? "/installs" : null;
}

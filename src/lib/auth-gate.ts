/**
 * What an unauthenticated request should be answered with.
 *
 * Split out of proxy.ts so the rule is testable without standing up a
 * NextRequest, and so the reasoning has somewhere to live.
 *
 * INCIDENT 2026-08-21. The middleware used to answer EVERY unauthenticated
 * request with a 307 to /login, API routes included. For a POST that is
 * actively harmful: a 307 preserves the method, so the browser re-POSTs to
 * /login, which is a page route and answers `405 Method Not Allowed` in
 * plain text. The caller then does `await r.json()` on "Method Not Allowed"
 * and gets a parse error. Verified end to end against production:
 *
 *   POST /api/orders/317/stage  ->  307  /login?next=%2Fapi%2Forders%2F317%2Fstage
 *   POST /login?next=...        ->  405  "Method Not Allowed"
 *
 * So an expired session surfaced to the user as an incomprehensible error
 * instead of "log in again". A programmatic caller needs a programmatic
 * answer: 401 + JSON. Only a human navigating a page wants the login screen.
 */

export const UNAUTHORIZED_BODY = {
  error: "Your session expired. Log in again and retry.",
} as const;

export type AuthFailure =
  | { kind: "json"; status: 401; body: typeof UNAUTHORIZED_BODY }
  | { kind: "redirect"; to: "/login" };

/**
 * True for paths served by a route handler rather than a page.
 *
 * Written as an exact match plus a "/api/" prefix — never `startsWith("/api")`,
 * which would also swallow a page named /apiary. proxy.ts has been bitten by
 * loose prefix matching before (see its /api/mcp comment), so this stays
 * explicit.
 */
function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function authFailureFor(pathname: string): AuthFailure {
  if (isApiPath(pathname)) {
    return { kind: "json", status: 401, body: UNAUTHORIZED_BODY };
  }
  return { kind: "redirect", to: "/login" };
}

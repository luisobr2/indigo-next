import { NextRequest, NextResponse } from "next/server";
import { installerRedirect } from "./lib/installer-guard.ts";
import { authFailureFor } from "./lib/auth-gate.ts";
import { decodeFreshUnverified } from "./lib/session-cookie-edge.ts";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "indigo_session";

/**
 * Gate-keeper for the (app) routes. Anything that isn't /login or /api/auth/*
 * needs an indigo_session cookie that actually decodes AND is unexpired.
 * Edge runtime, no Odoo calls here — decodeFreshUnverified does NOT check the
 * signature (node:crypto isn't available on Edge), it only rules out a
 * cookie that can't be parsed (missing, garbage, legacy unsigned) or whose
 * embedded `exp` has passed. Treating those as "no session" matters because
 * a forged-but-fresh-looking signature still decodes fine here and must
 * reach /api/auth/me (which DOES verify the MAC) to be told apart from a
 * live session — see app-shell.tsx. An expired one, though, is now caught
 * right here, so a stale cookie bounces straight to /login without that
 * round-trip.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const now = Date.now();
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    // Public, token-gated iCalendar feed: subscribed by external calendar
    // clients (Google/Apple) that can't carry the session cookie. The
    // route validates its own ?token=. Exact match so no sibling path is
    // accidentally exempted by prefix.
    pathname === "/api/calendar.ics" ||
    // Remote MCP endpoint: authenticates via its own bearer token (an Odoo
    // login.apiKey pair), not the session cookie. Exact match (plus the
    // trailing-slash variant some MCP clients send) so no sibling path
    // under /api/mcp* is accidentally exempted by prefix — this must stay
    // a fixed pair of literal comparisons, never startsWith("/api/mcp").
    pathname === "/api/mcp" ||
    pathname === "/api/mcp/" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/"
  ) {
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      const raw = req.cookies.get(COOKIE_NAME)?.value;
      if (!raw || !decodeFreshUnverified(raw, now)) {
        url.pathname = "/login";
      } else {
        // Installers have no dashboard — send them straight to /installs.
        url.pathname = installerRedirect("/", raw, now) ?? "/dashboard";
      }
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  const cookie = req.cookies.get(COOKIE_NAME);
  // A cookie that is present but undecodable (legacy unsigned cookie, or
  // garbage) or expired is treated the same as no cookie at all — otherwise
  // it waves the request through to a shell that can never actually load
  // data.
  if (!cookie || !decodeFreshUnverified(cookie.value, now)) {
    // An API caller needs a machine-readable answer, not the login PAGE.
    // Redirecting a POST here is actively harmful: a 307 preserves the
    // method, the browser re-POSTs to /login, that answers 405 in plain
    // text, and the caller's `await r.json()` blows up on it — which is
    // exactly the incomprehensible error Majela hit on 2026-08-21. See
    // ./lib/auth-gate.ts.
    const failure = authFailureFor(pathname);
    if (failure.kind === "json") {
      return NextResponse.json(failure.body, { status: failure.status });
    }
    const url = req.nextUrl.clone();
    url.pathname = failure.to;
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Confine a pure installer to their /installs view — the management pages
  // (e.g. /installations) 403 their data. API routes handle their own authz.
  const dest = installerRedirect(pathname, cookie.value, now);
  if (dest) {
    const url = req.nextUrl.clone();
    url.pathname = dest;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip the middleware on _next assets and on any static file in /public.
  // The trailing extension list covers images, fonts and manifests so
  // public/indigo-logo.webp etc. are served without an auth redirect.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:webp|png|jpg|jpeg|svg|gif|ico|webmanifest|woff2?|ttf)$).*)",
  ],
};

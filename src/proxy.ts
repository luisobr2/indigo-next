import { NextRequest, NextResponse } from "next/server";
import { installerRedirect } from "./lib/installer-guard";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "indigo_session";

/**
 * Gate-keeper for the (app) routes. Anything that isn't /login or /api/auth/*
 * needs an indigo_session cookie. Edge runtime, no Odoo calls here.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    // Public, token-gated iCalendar feed: subscribed by external calendar
    // clients (Google/Apple) that can't carry the session cookie. The
    // route validates its own ?token=. Exact match so no sibling path is
    // accidentally exempted by prefix.
    pathname === "/api/calendar.ics" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/"
  ) {
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      if (!req.cookies.has(COOKIE_NAME)) {
        url.pathname = "/login";
      } else {
        // Installers have no dashboard — send them straight to /installs.
        url.pathname =
          installerRedirect("/", req.cookies.get(COOKIE_NAME)?.value) ??
          "/dashboard";
      }
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  const cookie = req.cookies.get(COOKIE_NAME);
  if (!cookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Confine a pure installer to their /installs view — the management pages
  // (e.g. /installations) 403 their data. API routes handle their own authz.
  const dest = installerRedirect(pathname, cookie.value);
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

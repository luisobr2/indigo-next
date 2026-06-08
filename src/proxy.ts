import { NextRequest, NextResponse } from "next/server";

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
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/"
  ) {
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      url.pathname = req.cookies.has(COOKIE_NAME) ? "/dashboard" : "/login";
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
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

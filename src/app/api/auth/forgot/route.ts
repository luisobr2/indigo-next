import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const ODOO_URL = process.env.ODOO_URL ?? "http://localhost:8069";
const TIMEOUT_MS = parseInt(process.env.ODOO_TIMEOUT_MS ?? "30000", 10);

/**
 * POST /api/auth/forgot  — self-service password reset for panel users.
 *
 * Body: { login: string }  (the account email)
 *
 * We drive Odoo's own public reset flow server-side (the same one the
 * storefront login uses): GET /web/reset_password to grab a session cookie
 * + csrf token, then POST the login back. Odoo emails a reset link (valid
 * 24h) pointing at indigodecors.com/web/reset_password; the new password
 * then works for BOTH the panel and Odoo (same user).
 *
 * We ALWAYS return { ok: true } regardless of whether the email exists, so
 * the endpoint can't be used to enumerate accounts.
 */
export async function POST(req: NextRequest) {
  let email = "";
  try {
    const body = (await req.json()) as { login?: string };
    email = (body.login || "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // Don't reveal validity — but a clearly malformed email is a client error.
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }

  try {
    await triggerOdooReset(email);
  } catch {
    // Swallow: never tell the caller whether it worked (anti-enumeration).
  }
  return NextResponse.json({ ok: true });
}

async function triggerOdooReset(login: string): Promise<void> {
  const url = `${ODOO_URL}/web/reset_password`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // 1) GET the reset page → session cookie + csrf token.
    const getRes = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const html = await getRes.text();
    const setCookies =
      typeof getRes.headers.getSetCookie === "function"
        ? getRes.headers.getSetCookie()
        : [getRes.headers.get("set-cookie") || ""];
    const sessionId = setCookies
      .map((c) => /session_id=([^;]+)/.exec(c)?.[1])
      .find(Boolean);
    const csrf =
      /name="csrf_token"[^>]*\svalue="([^"]+)"/.exec(html)?.[1] ??
      /\svalue="([^"]+)"[^>]*name="csrf_token"/.exec(html)?.[1];
    if (!csrf) return; // form shape changed — bail quietly

    // 2) POST the login with the csrf token + same session cookie.
    const form = new URLSearchParams({ login, csrf_token: csrf });
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(sessionId ? { Cookie: `session_id=${sessionId}` } : {}),
      },
      body: form.toString(),
      signal: controller.signal,
      cache: "no-store",
      redirect: "manual",
    });
  } finally {
    clearTimeout(timer);
  }
}

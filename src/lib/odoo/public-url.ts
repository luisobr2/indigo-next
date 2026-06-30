import { call } from "./client";

/**
 * Public-facing base URL for storefront links (the customer domain), used to
 * build absolute product URLs for the "View on web" button.
 *
 * Priority:
 *   1. PUBLIC_SITE_URL env (explicit, always wins — set in Coolify).
 *   2. Odoo's `web.base.url` config param (the canonical domain Odoo uses in
 *      its own links/emails). Only readable by admin sessions, so wrapped in
 *      try/catch — managers fall through to the env default.
 *   3. ODOO_URL (the internal IP) as a last resort.
 *
 * Result is cached in-process (the domain is stable / frozen).
 */
let cached: string | null = null;

function clean(u: string) {
  return u.replace(/\/+$/, "");
}

export async function getPublicBaseUrl(session: string): Promise<string> {
  if (process.env.PUBLIC_SITE_URL) return clean(process.env.PUBLIC_SITE_URL);
  if (cached) return cached;
  try {
    const v = await call<string | false>({
      session,
      model: "ir.config_parameter",
      method: "get_param",
      args: ["web.base.url"],
      kwargs: {},
    });
    if (typeof v === "string" && v) {
      cached = clean(v);
      return cached;
    }
  } catch {
    /* not readable for this user — fall through */
  }
  return clean(process.env.ODOO_URL ?? "http://localhost:8069");
}

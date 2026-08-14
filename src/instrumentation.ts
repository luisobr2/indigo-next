/**
 * Runs once when the server process starts. Next.js calls `register()` in
 * both the Node and Edge runtimes (the Edge middleware bootstraps it too),
 * so the nodejs guard below is required — and the session-secret check is
 * dynamically imported inside it so node:crypto (via session-cookie.ts)
 * never gets pulled into the Edge bundle.
 *
 * Why this exists: `next build` never reads SESSION_SECRET, so a container
 * that forgot to set it boots clean and looks healthy. The failure only
 * shows up on the first real request, and illegibly: `POST /api/auth/login`
 * returns a generic 401 "Login failed (check server logs)" (its catch
 * assumes an OdooError), and `GET /api/auth/me` has no try/catch at all and
 * throws an unhandled 500. Calling requireSessionSecret() here turns that
 * into a crash-on-boot with the real "SESSION_SECRET must be set to at
 * least 32 characters..." message, so a misconfigured deploy fails loudly
 * instead of shipping a dead app with a misleading error.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { requireSessionSecret } = await import("./lib/odoo/session-cookie");
    requireSessionSecret();
  }
}

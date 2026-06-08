import { notFound } from "next/navigation";

/**
 * Catch-all that funnels any unmatched URL into the (app)/not-found.tsx
 * so the user keeps the sidebar + topbar. Lives in `(app)` so it only
 * fires for paths that should belong to the authenticated app (e.g.
 * `/orders/foo/bar`, `/notatall`, etc).
 *
 * The root-level not-found.tsx still catches anything before the user
 * is logged in (the proxy middleware redirects unauthenticated users
 * to /login before they ever reach this route).
 */
export default function CatchAllNotFound() {
  notFound();
}

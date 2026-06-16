/**
 * fetch + JSON parse that THROWS on a non-2xx response so React Query's
 * `isError` actually fires.
 *
 * The common `fetch(url).then(r => r.json())` pattern swallows failures: a
 * 500 returns `{ error: "..." }` which looks like valid data, so the page
 * renders zeros / "empty" with no feedback (dangerous for inventory and
 * money screens). Use this in queryFn instead.
 */
export async function fetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const r = await fetch(input, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(
      (j as { error?: string })?.error || `Request failed (${r.status})`,
    ) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  return j as T;
}

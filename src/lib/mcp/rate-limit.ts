/**
 * In-memory per-IP token bucket, applied to /api/mcp BEFORE any Odoo call.
 *
 * Why: the MCP endpoint (src/app/api/mcp/route.ts) is reachable pre-auth,
 * and every request it gets — including every rejected one — already costs
 * an Odoo round-trip before any useful work happens: `common.authenticate`
 * plus a `res.groups` read inside `verifyMcpToken` (./token.ts). Production
 * Odoo runs with `workers=0` (single-threaded — see this project's
 * CLAUDE.md, section 7, "Hardening pendiente"), and that one worker is
 * shared by the panel, the storefront AND the dealer portal. A flood of
 * garbage bearers against this endpoint alone is enough to saturate it and
 * take all three down. This module exists to reject that flood cheaply, in
 * process memory, before Odoo is ever touched.
 *
 * Pure and clock-free by design: `checkRate` takes `now` as a parameter
 * instead of reading Date.now() internally, so it's deterministic and
 * doesn't need real sleeps to unit test. It also has no `@/`-aliased
 * imports (see the comment on getRpc() in ./token.ts for why: the test
 * runner doesn't resolve those aliases, and this module is imported
 * directly by its test file).
 */

// A human chatting through an agent makes a handful of MCP calls a minute
// at most (list tools once, call one or two). 30/min is generous headroom
// for that, while remaining far below what it takes to saturate a
// single-worker Odoo instance under a pre-auth flood.
const MAX_REQUESTS_PER_MINUTE = envInt("MCP_RATE_LIMIT_PER_MINUTE", 30);

// Small burst allowance on top of the steady rate, so a legitimate burst
// (e.g. an agent listing tools then immediately invoking one) isn't
// penalized as if the 30/min budget were spread perfectly evenly.
const BURST_ALLOWANCE = envInt("MCP_RATE_LIMIT_BURST", 10);

const WINDOW_MS = 60_000;

// Bucket capacity: the steady-state budget plus the burst allowance.
const BUCKET_CAPACITY = MAX_REQUESTS_PER_MINUTE + BURST_ALLOWANCE;

// Tokens refill continuously at MAX_REQUESTS_PER_MINUTE per WINDOW_MS.
const REFILL_PER_MS = MAX_REQUESTS_PER_MINUTE / WINDOW_MS;

// A bucket untouched for this long is considered abandoned — either the
// caller genuinely stopped, or it was a spoofed IP used once and never
// again. Entries older than this are evicted on sweep. A few minutes is
// generous slack above the 1-minute window so a normal caller's bucket
// isn't dropped (and thus reset to full) between legitimate bursts.
const STALE_MS = 5 * WINDOW_MS;

// A sweep runs opportunistically every time this many *new* keys have been
// inserted, rather than on every request. That bounds sweep overhead
// (O(map size) but only 1/Nth as often) while still capping how large the
// map can grow between sweeps to roughly this many new IPs.
const SWEEP_EVERY_N_INSERTS = 50;

interface Bucket {
  tokens: number;
  lastRefillAt: number;
  lastSeenAt: number;
}

const buckets = new Map<string, Bucket>();
let insertsSinceSweep = 0;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Removes buckets that haven't been touched in over STALE_MS. */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastSeenAt > STALE_MS) buckets.delete(key);
  }
}

/**
 * Consumes one token from the bucket for `key`, creating it (full) on
 * first sight. Returns whether the request is allowed and, when it isn't,
 * how long the caller should wait before the next token is available.
 */
export function checkRate(key: string, now: number): { ok: boolean; retryAfterMs: number } {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: BUCKET_CAPACITY, lastRefillAt: now, lastSeenAt: now };
    buckets.set(key, bucket);
    insertsSinceSweep += 1;
    if (insertsSinceSweep >= SWEEP_EVERY_N_INSERTS) {
      insertsSinceSweep = 0;
      sweep(now);
    }
  }

  // Refill based on elapsed time since this bucket was last touched,
  // capped at capacity. Guards against a `now` that moves backwards
  // (clock weirdness) crediting negative tokens.
  const elapsedMs = Math.max(0, now - bucket.lastRefillAt);
  bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + elapsedMs * REFILL_PER_MS);
  bucket.lastRefillAt = now;
  bucket.lastSeenAt = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true, retryAfterMs: 0 };
  }

  const missingTokens = 1 - bucket.tokens;
  const retryAfterMs = Math.ceil(missingTokens / REFILL_PER_MS);
  return { ok: false, retryAfterMs };
}

/**
 * Resolves the rate-limit bucket key for a request from the standard
 * reverse-proxy headers: `x-forwarded-for`'s first hop (the original
 * client, as set by Traefik in front of this app under Coolify), falling
 * back to `x-real-ip`. If neither header is present, the request didn't
 * come through the expected proxy path — rather than trust that absence
 * and give every such request its own fresh bucket (an easy bypass: omit
 * the header, get unlimited requests), it falls back to one shared bucket.
 * Failing closed-ish (a coarser, shared limit) beats failing open.
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstHop = forwardedFor.split(",")[0]?.trim();
    if (firstHop) return firstHop;
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "__no_client_ip__";
}

/**
 * Exposed for tests only: the number of distinct keys currently tracked.
 * Used to prove the map stays bounded under a flood of spoofed IPs rather
 * than growing forever (see rate-limit.test.ts).
 */
export function bucketCount(): number {
  return buckets.size;
}

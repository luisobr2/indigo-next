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

// Hard ceiling on tracked keys. The staleness sweep alone is NOT a memory
// bound: during a sustained flood every entry is younger than STALE_MS, so
// the sweep finds nothing to evict and the map grows for as long as the
// flood lasts. This cap is what actually bounds it — once reached, the
// least-recently-seen entries are dropped to make room (see evictLru).
// 10k buckets is far more distinct clients than this deployment will ever
// legitimately see, and costs a few hundred KB.
const MAX_BUCKETS = envInt("MCP_RATE_LIMIT_MAX_BUCKETS", 10_000);

// How far below the cap an eviction pass takes the map, so eviction runs
// once per batch instead of on every single insert once full.
const EVICT_DOWN_TO = Math.max(1, Math.floor(MAX_BUCKETS * 0.9));

interface Bucket {
  tokens: number;
  lastRefillAt: number;
  lastSeenAt: number;
}

// Insertion order is maintained as LRU order: every touch in checkRate
// re-inserts the entry at the back, so the map's iteration order runs
// least-recently-seen first. That makes evictLru() an O(k) walk from the
// front instead of an O(n log n) sort.
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
 * Drops the least-recently-seen entries until the map is back under
 * EVICT_DOWN_TO. Evicting a bucket only resets that key to a full bucket
 * on its next request — it never grants more than one extra burst — so
 * trading a little limiter accuracy for a hard memory bound is the right
 * side to err on. LRU order means an actively-throttled flooder's own
 * entries are the last things evicted, and an idle legitimate caller is
 * the cheapest thing to lose.
 */
function evictLru(): void {
  for (const key of buckets.keys()) {
    if (buckets.size <= EVICT_DOWN_TO) break;
    buckets.delete(key);
  }
}

/**
 * Consumes one token from the bucket for `key`, creating it (full) on
 * first sight. Returns whether the request is allowed and, when it isn't,
 * how long the caller should wait before the next token is available.
 */
export function checkRate(key: string, now: number): { ok: boolean; retryAfterMs: number } {
  let bucket = buckets.get(key);
  if (bucket) {
    // Re-insert at the back to keep the map in LRU order (see `buckets`).
    buckets.delete(key);
    buckets.set(key, bucket);
  } else {
    bucket = { tokens: BUCKET_CAPACITY, lastRefillAt: now, lastSeenAt: now };
    buckets.set(key, bucket);
    insertsSinceSweep += 1;
    if (insertsSinceSweep >= SWEEP_EVERY_N_INSERTS) {
      insertsSinceSweep = 0;
      sweep(now);
    }
    // Checked on every insert, not only on sweep ticks: under a flood the
    // sweep above evicts nothing (all entries are fresh), and this is the
    // only thing standing between a rotating-IP flood and unbounded growth.
    if (buckets.size > MAX_BUCKETS) evictLru();
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

// Longest textual IPv6 form. Anything past this is not an address, it's a
// payload.
const MAX_IP_LENGTH = 45;
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
// Deliberately loose on IPv6 *shape* but strict on its alphabet and length:
// the goal is a bounded, non-attacker-authored bucket key, not RFC-perfect
// parsing. Dots are allowed for IPv4-mapped forms (::ffff:192.0.2.1).
const IPV6_RE = /^[0-9a-f:.]{2,45}$/;

/**
 * Returns the canonical bucket key for one header value, or null if the
 * value isn't a plausible IP literal. Without this, the bucket key is a
 * raw attacker-controlled string: an 8KB `x-forwarded-for` (right up to
 * Odoo's `limit_request`) becomes an 8KB map key, and one distinct value
 * per request means the map grows by 8KB per request. Rejecting
 * non-addresses collapses all of that onto the shared fallback bucket,
 * where the limiter can actually do its job.
 */
function normalizeIp(raw: string | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim().toLowerCase();
  // Bounded before any regex runs, so a megabyte-long header value is
  // rejected by a length check rather than fed to the matcher.
  if (!value || value.length > MAX_IP_LENGTH + 8) return null;
  // Bracketed IPv6, optionally with a port: "[2001:db8::1]:443".
  const bracketed = /^\[([0-9a-f:.]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) value = bracketed[1]!;
  if (value.length > MAX_IP_LENGTH) return null;
  if (IPV4_RE.test(value)) {
    return value.split(".").every((octet) => Number(octet) <= 255) ? value : null;
  }
  if (value.includes(":") && IPV6_RE.test(value)) return value;
  return null;
}

/**
 * Resolves the rate-limit bucket key for a request.
 *
 * Order matters, and it is the opposite of the obvious one. `x-real-ip` is
 * a single value written by the reverse proxy itself (Traefik, in front of
 * this app under Coolify), so it is the one header here the client cannot
 * author. `x-forwarded-for` is a list the client can prefill: send
 * "1.2.3.4" and the proxy appends the real peer, so the FIRST hop is
 * whatever the caller typed and the LAST is the proxy's own view of who
 * connected. Keying on the first hop — as this did — hands every attacker
 * a fresh, unlimited bucket per request just by rotating one header.
 *
 * Both candidates must parse as IP literals (see normalizeIp). Anything
 * else, or nothing at all, falls back to a single shared bucket: a coarse
 * shared limit beats an easily-bypassed per-caller one.
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const realIp = normalizeIp(headers.get("x-real-ip") ?? undefined);
  if (realIp) return realIp;

  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor.split(",");
    const lastHop = normalizeIp(hops[hops.length - 1]);
    if (lastHop) return lastHop;
  }
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

/** Exposed for tests only: the hard ceiling enforced by evictLru(). */
export const MAX_TRACKED_KEYS = MAX_BUCKETS;

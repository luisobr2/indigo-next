import test from "node:test";
import assert from "node:assert/strict";

import { checkRate, clientKeyFromHeaders, bucketCount, MAX_TRACKED_KEYS } from "./rate-limit.ts";

const MINUTE_MS = 60_000;
// Matches the module's default MAX_REQUESTS_PER_MINUTE (30) + BURST_ALLOWANCE
// (10) — no MCP_RATE_LIMIT_* env vars are set for this test run.
const DEFAULT_CAPACITY = 40;

function uniqueKey(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------
// checkRate — the token bucket itself.
// ---------------------------------------------------------------------

test("allows up to the bucket capacity, then rejects", () => {
  const key = uniqueKey("capacity");
  const now = 0;
  let allowed = 0;
  for (let i = 0; i < DEFAULT_CAPACITY; i++) {
    assert.equal(checkRate(key, now).ok, true, `request ${i} should be allowed`);
    allowed++;
  }
  const rejected = checkRate(key, now);
  assert.equal(rejected.ok, false);
  assert.equal(allowed, DEFAULT_CAPACITY);
});

test("a rejected request reports a positive retryAfterMs", () => {
  const key = uniqueKey("retry-after");
  const now = 0;
  for (let i = 0; i < DEFAULT_CAPACITY; i++) checkRate(key, now);
  const result = checkRate(key, now);
  assert.equal(result.ok, false);
  assert.ok(result.retryAfterMs > 0, "expected retryAfterMs > 0");
});

test("an allowed request reports retryAfterMs 0", () => {
  const key = uniqueKey("ok-retry");
  assert.deepEqual(checkRate(key, 0), { ok: true, retryAfterMs: 0 });
});

test("tokens refill over time and requests are allowed again", () => {
  const key = uniqueKey("refill");
  const now = 0;
  for (let i = 0; i < DEFAULT_CAPACITY; i++) checkRate(key, now);
  assert.equal(checkRate(key, now).ok, false);

  // A full minute later the bucket should be back at (near) full capacity.
  const later = now + MINUTE_MS;
  assert.equal(checkRate(key, later).ok, true);
});

test("retryAfterMs shrinks the longer the caller waits", () => {
  const key = uniqueKey("shrink");
  const now = 0;
  for (let i = 0; i < DEFAULT_CAPACITY; i++) checkRate(key, now);
  const soon = checkRate(key, now).retryAfterMs;
  const later = checkRate(key, now + 5_000).retryAfterMs;
  assert.ok(later < soon, `expected retryAfterMs to shrink: soon=${soon} later=${later}`);
});

test("different keys have fully independent buckets", () => {
  const a = uniqueKey("indep-a");
  const b = uniqueKey("indep-b");
  const now = 0;
  for (let i = 0; i < DEFAULT_CAPACITY; i++) checkRate(a, now);
  assert.equal(checkRate(a, now).ok, false, "bucket a should be exhausted");
  assert.equal(checkRate(b, now).ok, true, "bucket b should be untouched");
});

test("a slow, steady caller under the per-minute rate is never rejected", () => {
  const key = uniqueKey("steady");
  let now = 0;
  // One request every 3 seconds is 20/min, comfortably under the 30/min
  // default budget — should never be throttled even over several minutes.
  for (let i = 0; i < 100; i++) {
    assert.equal(checkRate(key, now).ok, true, `request ${i} at t=${now} should be allowed`);
    now += 3_000;
  }
});

// ---------------------------------------------------------------------
// Memory bound: the whole point of the sweep. A per-IP limiter that lets
// its own map grow forever under spoofed/rotating IPs just trades a DoS
// for a memory-leak DoS.
// ---------------------------------------------------------------------

test("the bucket map does not grow without bound under a flood of spoofed IPs", () => {
  let now = 0;
  // Simulate an attacker cycling through thousands of distinct IPs in a
  // short window — none of these are stale yet relative to each other.
  for (let i = 0; i < 5_000; i++) {
    checkRate(uniqueKey(`spoofed-${i}`), now);
    now += 1;
  }
  assert.ok(bucketCount() >= 5_000, "sanity: the flood should have created that many entries");

  // Jump forward well past the staleness window, then push enough new
  // inserts through to guarantee at least one opportunistic sweep fires
  // (it runs every 50th new-key insert).
  now += 10 * MINUTE_MS;
  for (let i = 0; i < 60; i++) {
    checkRate(uniqueKey(`post-sweep-${i}`), now);
  }

  // Almost everything from the flood (and from earlier tests in this
  // file) should have been evicted as stale — the map must not have kept
  // growing forever.
  assert.ok(
    bucketCount() < 500,
    `expected stale entries to be evicted, map still has ${bucketCount()} entries`,
  );
});

// The staleness sweep is not a bound on its own: during a sustained flood
// every entry is younger than STALE_MS, so the sweep finds nothing to
// evict. Only the hard cap stops the map there.
test("the bucket map stays under the hard cap during a flood where nothing is stale yet", () => {
  const now = 0; // frozen clock: no entry ever becomes stale
  for (let i = 0; i < MAX_TRACKED_KEYS * 2; i++) {
    checkRate(uniqueKey(`burst-${i}`), now);
  }
  assert.ok(
    bucketCount() <= MAX_TRACKED_KEYS,
    `expected the map to stay at or under ${MAX_TRACKED_KEYS}, got ${bucketCount()}`,
  );
});

test("an oversized header value cannot become an oversized map key", () => {
  const before = bucketCount();
  const eightKb = "x".repeat(8 * 1024);
  for (let i = 0; i < 200; i++) {
    // A distinct 8KB value per request: the shape that grew the map by 8KB
    // per request when the raw header was used as the key.
    checkRate(clientKeyFromHeaders(new Headers({ "x-forwarded-for": `${eightKb}${i}` })), 0);
  }
  // All 200 collapse onto the single shared fallback bucket.
  assert.ok(
    bucketCount() - before <= 1,
    `expected at most 1 new bucket, got ${bucketCount() - before}`,
  );
});

// ---------------------------------------------------------------------
// clientKeyFromHeaders — IP resolution behind Coolify's Traefik.
//
// The client can prefill x-forwarded-for; it cannot write x-real-ip, and
// it cannot author the hop Traefik appends. These tests pin that down —
// an earlier version keyed on the FIRST x-forwarded-for hop, which handed
// any caller a fresh unlimited bucket per request.
// ---------------------------------------------------------------------

test("clientKeyFromHeaders prefers x-real-ip, which the client cannot author", () => {
  const headers = new Headers({
    "x-forwarded-for": "203.0.113.5, 10.0.0.1",
    "x-real-ip": "198.51.100.9",
  });
  assert.equal(clientKeyFromHeaders(headers), "198.51.100.9");
});

test("clientKeyFromHeaders reads the LAST x-forwarded-for hop, not the client-supplied first", () => {
  // "203.0.113.5" is whatever the caller typed; "10.0.0.2" is what the
  // proxy appended after seeing the real peer.
  const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" });
  assert.equal(clientKeyFromHeaders(headers), "10.0.0.2");
});

test("spoofing the first x-forwarded-for hop does NOT yield a fresh bucket", () => {
  const realPeer = "192.0.2.77";
  const keys = new Set<string>();
  for (let i = 0; i < 50; i++) {
    keys.add(
      clientKeyFromHeaders(new Headers({ "x-forwarded-for": `203.0.113.${i}, ${realPeer}` })),
    );
  }
  assert.deepEqual([...keys], [realPeer], "50 spoofed first hops must share one bucket");
});

test("clientKeyFromHeaders trims whitespace around the hop", () => {
  const headers = new Headers({ "x-forwarded-for": "10.0.0.1,  203.0.113.5  " });
  assert.equal(clientKeyFromHeaders(headers), "203.0.113.5");
});

test("clientKeyFromHeaders reads x-forwarded-for when x-real-ip is absent", () => {
  const headers = new Headers({ "x-forwarded-for": "198.51.100.9" });
  assert.equal(clientKeyFromHeaders(headers), "198.51.100.9");
});

test("clientKeyFromHeaders accepts IPv6, bracketed and with a port", () => {
  assert.equal(
    clientKeyFromHeaders(new Headers({ "x-real-ip": "2001:DB8::1" })),
    "2001:db8::1",
    "IPv6 is lowercased so casing variants share one bucket",
  );
  assert.equal(
    clientKeyFromHeaders(new Headers({ "x-forwarded-for": "[2001:db8::1]:443" })),
    "2001:db8::1",
  );
});

test("clientKeyFromHeaders rejects values that are not IP literals", () => {
  const shared = clientKeyFromHeaders(new Headers());
  for (const bogus of [
    "not-an-ip",
    "999.999.999.999", // right shape, impossible octets
    "x".repeat(9000), // the 8KB-key attack
    "203.0.113.5; DROP TABLE",
    "",
  ]) {
    assert.equal(
      clientKeyFromHeaders(new Headers({ "x-forwarded-for": bogus })),
      shared,
      `expected ${JSON.stringify(bogus.slice(0, 24))} to fall back to the shared bucket`,
    );
  }
});

test("a garbage x-real-ip falls through to x-forwarded-for rather than poisoning the key", () => {
  const headers = new Headers({ "x-real-ip": "garbage", "x-forwarded-for": "198.51.100.9" });
  assert.equal(clientKeyFromHeaders(headers), "198.51.100.9");
});

test("clientKeyFromHeaders falls back to a single shared key when neither header is present", () => {
  assert.equal(clientKeyFromHeaders(new Headers()), clientKeyFromHeaders(new Headers()));
  assert.equal(typeof clientKeyFromHeaders(new Headers()), "string");
});

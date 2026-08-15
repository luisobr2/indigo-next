/**
 * Node half of the session cookie codec: sign on write, verify on read.
 *
 * Format: <base64url(json)>.<base64url(hmac-sha256 of "purpose:json")>
 *
 * The cookie carries `isAdmin` and `groups`, which every route's role gate
 * reads. Before signing, anyone could craft that payload in a direct HTTP
 * request — Odoo's ACLs were the only backstop. Route handlers run on the
 * Node runtime, so node:crypto is available here; the Edge middleware uses
 * ../session-cookie-edge.ts instead.
 *
 * Two hardenings on top of the base HMAC scheme:
 *  - `exp` (epoch ms) is baked into the signed payload and checked here on
 *    every verify, against a `now` the caller supplies — see isFresh in
 *    ../session-cookie-edge.ts. A signed value used to be a bearer good
 *    forever (until SESSION_SECRET rotates); it now expires server-side too.
 *  - `purpose` is mixed into the MAC input, not just the payload, so a value
 *    signed for one cookie (e.g. the primary session) cannot be replayed as
 *    another (e.g. the impersonation backup) even though both share a
 *    secret and payload shape today.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import {
  decodeUnverified,
  isFresh,
  SIGNATURE_SEPARATOR,
  SESSION_LIFETIME_MS,
} from "../session-cookie-edge.ts";

const MIN_SECRET_LENGTH = 32;

export function requireSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters. ` +
        "Refusing to read or write a session cookie unsigned.",
    );
  }
  return secret;
}

function macOf(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

/**
 * What actually gets MAC'd: the purpose bound to the body, not the body
 * alone. `body` is base64url (never contains ":"), so `purpose` — always
 * one of a small set of literal constants defined by callers, never user
 * input — cannot be confused with it; there is no pair of (purpose, body)
 * that collides with a different pair here.
 */
function macInput(purpose: string, body: string): string {
  return `${purpose}:${body}`;
}

export function signPayload(
  payload: unknown,
  secret: string,
  purpose: string,
  now: number,
): string {
  const withExp = { ...(payload as Record<string, unknown>), exp: now + SESSION_LIFETIME_MS };
  const body = Buffer.from(JSON.stringify(withExp), "utf8").toString("base64url");
  return `${body}${SIGNATURE_SEPARATOR}${macOf(macInput(purpose, body), secret)}`;
}

export function verifyPayload(
  raw: string,
  secret: string,
  purpose: string,
  now: number,
): unknown | null {
  const idx = raw.lastIndexOf(SIGNATURE_SEPARATOR);
  if (idx <= 0) return null;
  const body = raw.slice(0, idx);
  const presented = Buffer.from(raw.slice(idx + 1));
  const expected = Buffer.from(macOf(macInput(purpose, body), secret));
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (presented.length !== expected.length) return null;
  if (!timingSafeEqual(presented, expected)) return null;
  const payload = decodeUnverified(raw);
  // Expired (or pre-exp legacy) payloads fail verification exactly like a
  // bad signature would: null, never a throw. See isFresh's doc comment for
  // why a missing `exp` counts as expired rather than valid-forever.
  if (!isFresh(payload, now)) return null;
  return payload;
}

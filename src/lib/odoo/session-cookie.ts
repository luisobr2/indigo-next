/**
 * Node half of the session cookie codec: sign on write, verify on read.
 *
 * Format: <base64url(json)>.<base64url(hmac-sha256 of the body)>
 *
 * The cookie carries `isAdmin` and `groups`, which every route's role gate
 * reads. Before signing, anyone could craft that payload in a direct HTTP
 * request — Odoo's ACLs were the only backstop. Route handlers run on the
 * Node runtime, so node:crypto is available here; the Edge middleware uses
 * ../session-cookie-edge.ts instead.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { decodeUnverified, SIGNATURE_SEPARATOR } from "../session-cookie-edge.ts";

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

function macOf(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signPayload(payload: unknown, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}${SIGNATURE_SEPARATOR}${macOf(body, secret)}`;
}

export function verifyPayload(raw: string, secret: string): unknown | null {
  const idx = raw.lastIndexOf(SIGNATURE_SEPARATOR);
  if (idx <= 0) return null;
  const body = raw.slice(0, idx);
  const presented = Buffer.from(raw.slice(idx + 1));
  const expected = Buffer.from(macOf(body, secret));
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (presented.length !== expected.length) return null;
  if (!timingSafeEqual(presented, expected)) return null;
  return decodeUnverified(raw);
}

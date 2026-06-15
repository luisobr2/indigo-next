import { timingSafeEqual } from "crypto";

/**
 * Server-only token for the public iCalendar feed (/api/calendar.ics).
 *
 * NOT exposed to the client bundle (no NEXT_PUBLIC). Managers fetch the
 * full subscribe URL at runtime from the session-gated
 * /api/calendar/feed-url endpoint, so the token never ships to anonymous
 * visitors. Override in prod with the CALENDAR_ICS_TOKEN env var; rotate by
 * changing it there (old subscriptions then 403 until re-added).
 */
export const ICS_TOKEN =
  process.env.CALENDAR_ICS_TOKEN ?? "idg-ics-9b4e7a2c61f08d35e7c4";

/** Constant-time token compare (avoids timing oracles on the secret). */
export function tokenOk(provided: string | null | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(ICS_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

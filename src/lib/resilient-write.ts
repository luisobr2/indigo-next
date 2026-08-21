/**
 * Surviving a dead connection on a write, without writing twice.
 *
 * INCIDENT 2026-08-21. Majela opened order IND/2026/00317 on her phone,
 * picked a stage, and pressed "Confirm send" about seven minutes later. The
 * POST never reached the server — Odoo logged nothing at all, not even the
 * stage lookup that runs before the write — and Safari rejected the fetch
 * with `TypeError: Load failed`, which the toast rendered verbatim. On
 * cellular, the carrier's NAT reaps idle connections; the next request over
 * the reaped one fails instantly. There was no retry anywhere in the client,
 * so one dead connection meant one order that silently did not move and an
 * error message that told her nothing.
 *
 * The obvious fix — retry the POST — is wrong on its own. A network-level
 * failure does NOT mean the request was never processed: the request may
 * have landed and only the response been lost. Blind retry would append the
 * note twice and post a second chatter line. So recovery asks first:
 *
 *   write fails at the network level
 *     -> landed()?  yes -> done, the order already moved
 *     -> landed()?  no  -> write once more
 *     -> still dead     -> raise something a human can act on
 *
 * A verdict FROM the server (403, "Stage not found", a non-JSON body) is
 * never retried — the server answered, and the answer is the information.
 */

/** Shown when both attempts died on the wire. Replaces "Load failed". */
export const NETWORK_FAILURE_MESSAGE =
  "Couldn't reach the server — check your connection and try again.";

/**
 * True only for a fetch that never completed.
 *
 * Every browser reports this as a TypeError: WebKit "Load failed", Chrome
 * "Failed to fetch", Firefox "NetworkError when attempting to fetch
 * resource." Our own HTTP-error path throws a plain `Error`, and a
 * non-JSON body throws `SyntaxError` — both are answers from the server,
 * so both are excluded. An AbortError is a deliberate cancellation and
 * must not be retried either.
 */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return false;
  return e instanceof TypeError;
}

export interface ResilientWrite {
  /** Performs the write. Must throw on failure. */
  write: () => Promise<void>;
  /**
   * Did the write land after all? Optional — omit when the caller has no
   * cheap way to check, and recovery falls back to a single blind retry.
   * Runs over the same connection that just died, so it may throw; that
   * tells us nothing and is treated as "did not land".
   */
  landed?: () => Promise<boolean>;
}

export async function writeWithNetworkRecovery({ write, landed }: ResilientWrite): Promise<void> {
  try {
    await write();
    return;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
  }

  if (landed) {
    try {
      if (await landed()) return;
    } catch {
      // The check rode the same dead connection. Fall through and retry.
    }
  }

  try {
    await write();
  } catch (e) {
    // A verdict that got through on the retry is more useful than a
    // generic "check your connection" — surface it as-is.
    if (!isNetworkError(e)) throw e;
    throw new Error(NETWORK_FAILURE_MESSAGE);
  }
}

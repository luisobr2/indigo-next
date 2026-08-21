import test from "node:test";
import assert from "node:assert/strict";

import {
  isNetworkError,
  writeWithNetworkRecovery,
  NETWORK_FAILURE_MESSAGE,
} from "./resilient-write.ts";

// ---------------------------------------------------------------------
// Why this exists (incident 2026-08-21): Majela pressed "Confirm send" on
// her phone after the page had sat idle for ~7 minutes. The POST never
// reached the server — nothing at all appeared in Odoo's log — and Safari
// rejected the fetch with `TypeError: Load failed`, which the toast showed
// verbatim. On cellular, a carrier NAT reaps idle connections and the next
// request over the dead one fails instantly. There was no retry, so one
// dead connection meant one silently unmoved order.
//
// Retrying a POST blindly risks writing twice, so recovery goes:
// fail -> ASK whether it landed -> only retry if it did not.
// ---------------------------------------------------------------------

/** WebKit's message; Chrome says "Failed to fetch", Firefox its own — all TypeError. */
const safariNetworkError = () => new TypeError("Load failed");

test("isNetworkError separates a dead connection from a server verdict", () => {
  assert.equal(isNetworkError(new TypeError("Load failed")), true);
  assert.equal(isNetworkError(new TypeError("Failed to fetch")), true);
  // Our own HTTP-error path throws a plain Error — that is a real answer
  // from the server and must never be retried.
  assert.equal(isNetworkError(new Error("Forbidden")), false);
  // A non-JSON body (the 405 login page) throws SyntaxError — also an answer.
  assert.equal(isNetworkError(new SyntaxError("Unexpected token")), false);
  assert.equal(isNetworkError("boom"), false);
  assert.equal(isNetworkError(undefined), false);
});

test("a deliberate abort is not treated as a retryable network error", () => {
  const abort = new DOMException("The operation was aborted.", "AbortError");
  assert.equal(isNetworkError(abort), false);
});

test("a write that succeeds runs once and never asks whether it landed", async () => {
  let writes = 0;
  let checks = 0;
  await writeWithNetworkRecovery({
    write: async () => {
      writes++;
    },
    landed: async () => {
      checks++;
      return false;
    },
  });
  assert.equal(writes, 1);
  assert.equal(checks, 0);
});

test("a server verdict is rethrown untouched — no retry, no landed check", async () => {
  let writes = 0;
  let checks = 0;
  await assert.rejects(
    writeWithNetworkRecovery({
      write: async () => {
        writes++;
        throw new Error("Forbidden");
      },
      landed: async () => {
        checks++;
        return false;
      },
    }),
    { message: "Forbidden" },
  );
  assert.equal(writes, 1, "a 403 must not be retried");
  assert.equal(checks, 0);
});

test("if the write landed despite the dead connection, it resolves without rewriting", async () => {
  let writes = 0;
  await writeWithNetworkRecovery({
    write: async () => {
      writes++;
      throw safariNetworkError();
    },
    landed: async () => true,
  });
  assert.equal(writes, 1, "the order already moved — writing again would duplicate the note");
});

test("if it did not land, the write is retried once and can succeed", async () => {
  let writes = 0;
  await writeWithNetworkRecovery({
    write: async () => {
      writes++;
      if (writes === 1) throw safariNetworkError();
    },
    landed: async () => false,
  });
  assert.equal(writes, 2);
});

test("a second dead connection surfaces an actionable message, not 'Load failed'", async () => {
  let writes = 0;
  await assert.rejects(
    writeWithNetworkRecovery({
      write: async () => {
        writes++;
        throw safariNetworkError();
      },
      landed: async () => false,
    }),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(e.message, NETWORK_FAILURE_MESSAGE);
      assert.notEqual(e.message, "Load failed");
      return true;
    },
  );
  assert.equal(writes, 2);
});

test("a server verdict on the retry wins over the generic network message", async () => {
  // The retry got through and Odoo said no — that answer is far more
  // useful than "check your connection".
  let writes = 0;
  await assert.rejects(
    writeWithNetworkRecovery({
      write: async () => {
        writes++;
        if (writes === 1) throw safariNetworkError();
        throw new Error("Stage 99 not found");
      },
      landed: async () => false,
    }),
    { message: "Stage 99 not found" },
  );
});

test("a failed landed() check does not mask the write — it falls through to the retry", async () => {
  // The verification runs over the same dead connection, so it may fail
  // too. That tells us nothing, so behave as if it said "did not land".
  let writes = 0;
  await writeWithNetworkRecovery({
    write: async () => {
      writes++;
      if (writes === 1) throw safariNetworkError();
    },
    landed: async () => {
      throw safariNetworkError();
    },
  });
  assert.equal(writes, 2);
});

test("recovery works without a landed() check, for callers that have none", async () => {
  let writes = 0;
  await writeWithNetworkRecovery({
    write: async () => {
      writes++;
      if (writes === 1) throw safariNetworkError();
    },
  });
  assert.equal(writes, 2);
});

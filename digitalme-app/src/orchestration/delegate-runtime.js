"use strict";

/**
 * Tracks in-flight external-agent delegations for abort-on-quit / window destroy,
 * sender binding, and duplicate requestId rejection.
 */

const DEFAULT_QUIT_WAIT_MS = 8000;

/** @type {Map<string, { abort: AbortController, promise: Promise<unknown>, senderId: string, startedAt: number }>} */
const active = new Map();

function senderIdFromEvent(event) {
  return event && event.sender && event.sender.id != null ? String(event.sender.id) : "unknown";
}

function has(requestId) {
  return active.has(String(requestId || ""));
}

function listActive() {
  return [...active.entries()].map(([requestId, row]) => ({
    requestId,
    senderId: row.senderId,
    startedAt: row.startedAt,
  }));
}

/**
 * Register a new delegation. Rejects duplicate requestId.
 * @returns {{ ok: true, abort: AbortController } | { ok: false, reason: string }}
 */
function begin(requestId, event) {
  const rid = String(requestId || "").trim();
  if (!rid) return { ok: false, reason: "missing_request_id" };
  if (active.has(rid)) return { ok: false, reason: "duplicate_request_id" };
  const abort = new AbortController();
  const senderId = senderIdFromEvent(event);
  active.set(rid, {
    abort,
    promise: null,
    senderId,
    startedAt: Date.now(),
  });
  return { ok: true, abort, senderId };
}

function attachPromise(requestId, promise) {
  const rid = String(requestId || "");
  const row = active.get(rid);
  if (!row) return;
  row.promise = Promise.resolve(promise).finally(() => {
    const cur = active.get(rid);
    if (cur && cur.promise === row.promise) active.delete(rid);
  });
}

function end(requestId) {
  active.delete(String(requestId || ""));
}

function abortOne(requestId) {
  const row = active.get(String(requestId || ""));
  if (!row) return false;
  try {
    row.abort.abort();
  } catch {
    /* ignore */
  }
  return true;
}

function abortForSender(senderId) {
  const sid = String(senderId || "");
  let n = 0;
  for (const [rid, row] of active.entries()) {
    if (row.senderId === sid) {
      try {
        row.abort.abort();
      } catch {
        /* ignore */
      }
      n += 1;
      void rid;
    }
  }
  return n;
}

function abortAll() {
  for (const row of active.values()) {
    try {
      row.abort.abort();
    } catch {
      /* ignore */
    }
  }
  return active.size;
}

/**
 * Abort all in-flight delegates and wait up to timeoutMs for their promises to settle.
 */
async function abortAllAndWait(timeoutMs = DEFAULT_QUIT_WAIT_MS) {
  abortAll();
  const pending = [...active.values()]
    .map((row) => row.promise)
    .filter((p) => p && typeof p.then === "function");
  if (!pending.length) {
    active.clear();
    return { ok: true, waited: 0, remaining: 0 };
  }
  let timedOut = false;
  await Promise.race([
    Promise.allSettled(pending),
    new Promise((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, Math.max(0, Number(timeoutMs) || DEFAULT_QUIT_WAIT_MS));
    }),
  ]);
  const remaining = active.size;
  if (!timedOut) active.clear();
  return { ok: !timedOut && remaining === 0, waited: timeoutMs, remaining, timedOut };
}

function clearAllForTests() {
  active.clear();
}

module.exports = {
  DEFAULT_QUIT_WAIT_MS,
  senderIdFromEvent,
  has,
  listActive,
  begin,
  attachPromise,
  end,
  abortOne,
  abortForSender,
  abortAll,
  abortAllAndWait,
  clearAllForTests,
};

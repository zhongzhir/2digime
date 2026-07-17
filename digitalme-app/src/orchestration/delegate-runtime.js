"use strict";

/**
 * Tracks in-flight external-agent delegations.
 * Keys are always main-process operationIds; abort/stop requires matching webContents.id.
 */

const crypto = require("node:crypto");

const DEFAULT_QUIT_WAIT_MS = 8000;

/**
 * @typedef {{
 *   operationId: string,
 *   abort: AbortController,
 *   promise: Promise<unknown>|null,
 *   senderId: string,
 *   clientRequestId: string,
 *   startedAt: number,
 *   orphanRisk: boolean,
 * }} DelegateRow
 */

/** @type {Map<string, DelegateRow>} */
const active = new Map();

function senderIdFromEvent(event) {
  return event && event.sender && event.sender.id != null ? String(event.sender.id) : "";
}

function mintOperationId() {
  return "op_" + crypto.randomBytes(8).toString("hex");
}

function has(operationId) {
  return active.has(String(operationId || ""));
}

function listActive() {
  return [...active.values()].map((row) => ({
    operationId: row.operationId,
    senderId: row.senderId,
    clientRequestId: row.clientRequestId,
    startedAt: row.startedAt,
    orphanRisk: !!row.orphanRisk,
  }));
}

/**
 * Register a new delegation. Always mints a main-process operationId.
 * clientRequestId is optional correlation only and never used as the abort key alone.
 * @returns {{ ok: true, operationId: string, abort: AbortController, senderId: string } | { ok: false, reason: string }}
 */
function begin(event, clientRequestId) {
  const senderId = senderIdFromEvent(event);
  if (!senderId || senderId === "unknown") {
    return { ok: false, reason: "missing_sender" };
  }
  const operationId = mintOperationId();
  if (active.has(operationId)) {
    return { ok: false, reason: "duplicate_operation_id" };
  }
  const clientRid = String(clientRequestId || "").trim();
  // Collision guard: same sender + same clientRequestId already running.
  if (clientRid) {
    for (const row of active.values()) {
      if (row.senderId === senderId && row.clientRequestId === clientRid) {
        return { ok: false, reason: "duplicate_request_id" };
      }
    }
  }
  const abort = new AbortController();
  active.set(operationId, {
    operationId,
    abort,
    promise: null,
    senderId,
    clientRequestId: clientRid,
    startedAt: Date.now(),
    orphanRisk: false,
  });
  return { ok: true, operationId, abort, senderId };
}

function attachPromise(operationId, promise) {
  const oid = String(operationId || "");
  const row = active.get(oid);
  if (!row) return;
  row.promise = Promise.resolve(promise)
    .then((result) => {
      if (result && typeof result === "object" && result.orphanRisk) {
        row.orphanRisk = true;
      }
      if (result && result.meta && result.meta.orphanRisk) {
        row.orphanRisk = true;
      }
      return result;
    })
    .catch((err) => {
      if (err && err.orphanRisk) row.orphanRisk = true;
      throw err;
    })
    .finally(() => {
      const cur = active.get(oid);
      if (cur && cur.promise === row.promise) {
        // Keep row briefly if orphanRisk so quit can observe; otherwise delete.
        if (!cur.orphanRisk) active.delete(oid);
      }
    });
}

function end(operationId) {
  const oid = String(operationId || "");
  const row = active.get(oid);
  if (!row) return;
  if (row.orphanRisk) return; // retain for quit risk reporting until clearOrphan / clearAll
  active.delete(oid);
}

function clearOrphan(operationId) {
  active.delete(String(operationId || ""));
}

/**
 * Abort one operation. Requires the calling event's webContents.id to match the owner.
 * Cross-sender / unknown / already-stopped → no side effects on other tasks.
 */
function abortOne(event, operationId) {
  const senderId = senderIdFromEvent(event);
  const oid = String(operationId || "").trim();
  if (!senderId || !oid) {
    return { ok: false, reason: "missing_sender_or_operation", aborted: false };
  }
  const row = active.get(oid);
  if (!row) {
    return { ok: false, reason: "unknown_operation", aborted: false };
  }
  if (row.senderId !== senderId) {
    return { ok: false, reason: "sender_mismatch", aborted: false };
  }
  try {
    row.abort.abort();
  } catch {
    /* ignore */
  }
  return { ok: true, reason: "aborted", aborted: true, operationId: oid };
}

function abortForSender(senderId) {
  const sid = String(senderId || "");
  let n = 0;
  for (const row of active.values()) {
    if (row.senderId === sid) {
      try {
        row.abort.abort();
      } catch {
        /* ignore */
      }
      n += 1;
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
 * Abort all in-flight delegates and wait up to timeoutMs for promises to settle.
 * Reports remaining count and any orphanRisk observed on rows.
 */
async function abortAllAndWait(timeoutMs = DEFAULT_QUIT_WAIT_MS) {
  abortAll();
  const snapshot = [...active.values()];
  const pendingRows = snapshot.filter((row) => row.promise);
  const pending = pendingRows.map((row) => row.promise);

  // Rows with no attached promise are already idle — drop unless orphanRisk.
  for (const [oid, row] of [...active.entries()]) {
    if (!row.promise && !row.orphanRisk) active.delete(oid);
  }

  if (!pending.length) {
    const orphanRisk = [...active.values()].some((r) => r.orphanRisk);
    return {
      ok: !orphanRisk && active.size === 0,
      waited: 0,
      remaining: active.size,
      timedOut: false,
      orphanRisk,
    };
  }

  const settledIds = new Set();
  const trackers = pendingRows.map((row) =>
    Promise.resolve(row.promise).finally(() => {
      settledIds.add(row.operationId);
    })
  );

  let timedOut = false;
  await Promise.race([
    Promise.allSettled(trackers),
    new Promise((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, Math.max(0, Number(timeoutMs) || DEFAULT_QUIT_WAIT_MS));
    }),
  ]);

  for (const [oid, row] of [...active.entries()]) {
    if (settledIds.has(oid) && !row.orphanRisk) {
      active.delete(oid);
    }
  }
  const remaining = active.size;
  const orphanRisk = [...active.values()].some((r) => r.orphanRisk);
  return {
    ok: !timedOut && remaining === 0 && !orphanRisk,
    waited: timeoutMs,
    remaining,
    timedOut,
    orphanRisk,
  };
}

function clearAllForTests() {
  active.clear();
}

module.exports = {
  DEFAULT_QUIT_WAIT_MS,
  senderIdFromEvent,
  mintOperationId,
  has,
  listActive,
  begin,
  attachPromise,
  end,
  clearOrphan,
  abortOne,
  abortForSender,
  abortAll,
  abortAllAndWait,
  clearAllForTests,
};

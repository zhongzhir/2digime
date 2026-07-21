"use strict";

const crypto = require("node:crypto");

/** Bound tombstone set — late events after clear must still be rejected, without unbounded growth. */
const TOMBSTONE_LIMIT = 64;

/**
 * App-wide single-flight active chat request registry with generation validity.
 * Stopped / fallback-invalidated requestIds must not emit events or persist again.
 */
function createActiveRequestRegistry(opts = {}) {
  /** @type {null | {
   *   requestId: string,
   *   originSessionId: string,
   *   assistantMessageId: string,
   *   startedAt: string,
   *   status: string,
   *   sequence: number,
   *   generation: number,
   *   writable: boolean,
   *   abortController: AbortController,
   * }} */
  let current = null;
  let generationCounter = 0;
  /** @type {Map<string, true>} insertion-ordered bounded tombstones */
  const tombstones = new Map();
  /** @type {Map<string, Array<() => void>>} */
  const clearWaiters = new Map();
  const tombstoneLimit =
    typeof opts.tombstoneLimit === "number" && opts.tombstoneLimit > 0
      ? opts.tombstoneLimit
      : TOMBSTONE_LIMIT;

  function newRequestId() {
    return "req_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
  }

  function newMessageId() {
    return "m_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
  }

  function addTombstone(id) {
    const key = String(id || "");
    if (!key) return;
    if (tombstones.has(key)) {
      tombstones.delete(key);
    }
    tombstones.set(key, true);
    while (tombstones.size > tombstoneLimit) {
      const oldest = tombstones.keys().next().value;
      tombstones.delete(oldest);
    }
  }

  function snapshot(rec) {
    if (!rec) return null;
    return {
      requestId: rec.requestId,
      originSessionId: rec.originSessionId,
      assistantMessageId: rec.assistantMessageId,
      startedAt: rec.startedAt,
      status: rec.status,
      sequence: rec.sequence,
      generation: rec.generation,
      writable: rec.writable === true,
    };
  }

  function get() {
    return snapshot(current);
  }

  function assertIdle() {
    if (current) {
      return {
        ok: false,
        code: "request_in_progress",
        message: "请先停止当前回复，再继续操作。",
        activeRequest: get(),
      };
    }
    return { ok: true };
  }

  function register({ originSessionId, status } = {}) {
    const idle = assertIdle();
    if (!idle.ok) return idle;
    generationCounter += 1;
    const abortController = new AbortController();
    current = {
      requestId: newRequestId(),
      originSessionId: String(originSessionId || ""),
      assistantMessageId: newMessageId(),
      startedAt: new Date().toISOString(),
      status: status || "running",
      sequence: 0,
      generation: generationCounter,
      writable: true,
      abortController,
    };
    return { ok: true, activeRequest: get(), abortController, generation: current.generation };
  }

  /**
   * True only while this requestId is the live registry entry AND still writable.
   * Tombstoned / mismatched / cleared / aborted requests always return false.
   */
  function isCurrentWritable(requestId) {
    if (!requestId) return false;
    return !!(current && current.requestId === requestId && current.writable === true);
  }

  function isCurrent(requestId) {
    if (!requestId) return false;
    return !!(current && current.requestId === requestId);
  }

  function matchesGeneration(requestId, generation) {
    if (!isCurrent(requestId)) return false;
    return current.generation === generation;
  }

  function nextSequence(requestId) {
    if (!current || current.requestId !== requestId) return null;
    if (!current.writable) return null;
    current.sequence += 1;
    return current.sequence;
  }

  function setStatus(requestId, status) {
    if (!current || current.requestId !== requestId) return false;
    current.status = String(status || current.status);
    return true;
  }

  function getAbortController(requestId) {
    if (!current || (requestId && current.requestId !== requestId)) return null;
    return current.abortController;
  }

  function notifyCleared(requestId) {
    const waiters = clearWaiters.get(requestId) || [];
    clearWaiters.delete(requestId);
    for (const w of waiters) {
      try {
        w();
      } catch {
        /* ignore */
      }
    }
  }

  function clear(requestId) {
    if (!current) return false;
    if (requestId && current.requestId !== requestId) return false;
    const id = current.requestId;
    addTombstone(id);
    current = null;
    notifyCleared(id);
    return true;
  }

  /**
   * Abort signal + mark not writable. No further emit/persist is allowed.
   * Request stays until clear() so waitUntilCleared can observe completion.
   */
  function abort(requestId) {
    if (!current) return { ok: false, code: "no_active_request" };
    if (requestId && current.requestId !== requestId) {
      return { ok: false, code: "request_mismatch" };
    }
    try {
      current.abortController.abort();
    } catch {
      /* ignore */
    }
    current.status = "stopping";
    current.writable = false;
    return { ok: true, activeRequest: get() };
  }

  function invalidate(requestId) {
    if (!current) return false;
    if (requestId && current.requestId !== requestId) return false;
    try {
      current.abortController.abort();
    } catch {
      /* ignore */
    }
    current.writable = false;
    current.status = current.status === "running" ? "stopping" : current.status;
    return true;
  }

  function waitUntilCleared(requestId, timeoutMs) {
    const id = String(requestId || "");
    if (!id) return Promise.resolve(true);
    if (!current || current.requestId !== id) return Promise.resolve(true);
    const ms = typeof timeoutMs === "number" && timeoutMs >= 0 ? timeoutMs : 5000;
    return new Promise((resolve) => {
      const list = clearWaiters.get(id) || [];
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      list.push(done);
      clearWaiters.set(id, list);
      const timer = setTimeout(() => {
        const arr = clearWaiters.get(id) || [];
        const idx = arr.indexOf(done);
        if (idx >= 0) arr.splice(idx, 1);
        if (!arr.length) clearWaiters.delete(id);
        else clearWaiters.set(id, arr);
        // Force clear zombie after timeout — still tombstoned so late writes fail
        if (current && current.requestId === id) {
          current = null;
          addTombstone(id);
        }
        resolve(false);
      }, ms);
    });
  }

  function isTombstoned(requestId) {
    return tombstones.has(String(requestId || ""));
  }

  function tombstoneSize() {
    return tombstones.size;
  }

  /** Test helper */
  function _resetForTests() {
    current = null;
    tombstones.clear();
    clearWaiters.clear();
    generationCounter = 0;
  }

  return {
    TOMBSTONE_LIMIT: tombstoneLimit,
    get,
    assertIdle,
    register,
    nextSequence,
    setStatus,
    getAbortController,
    clear,
    abort,
    invalidate,
    isCurrent,
    isCurrentWritable,
    matchesGeneration,
    waitUntilCleared,
    isTombstoned,
    tombstoneSize,
    newRequestId,
    newMessageId,
    _resetForTests,
  };
}

module.exports = {
  TOMBSTONE_LIMIT,
  createActiveRequestRegistry,
};

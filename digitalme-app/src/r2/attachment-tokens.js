"use strict";

const crypto = require("node:crypto");

const TTL_MS = 300_000;

/**
 * In-memory attachment selection vault (process-local, not persisted).
 * Supports injectable monotonic clock for hermetic TTL tests.
 * Expired / cleared records wipe selection bodies immediately.
 */
function createAttachmentTokenVault(opts = {}) {
  /** @type {Map<string, object>} */
  const vault = new Map();
  let nowFn =
    typeof opts.nowMonotonicMs === "function"
      ? opts.nowMonotonicMs
      : () => Number(process.hrtime.bigint() / 1_000_000n);
  /** @type {ReturnType<typeof setInterval>|null} */
  let sweepTimer = null;

  function setClock(fn) {
    if (typeof fn === "function") nowFn = fn;
  }

  function wipeSelection(selection) {
    if (!Array.isArray(selection)) return;
    for (const a of selection) {
      if (a && typeof a === "object") {
        a.text = "";
        a.path = undefined;
        a.body = undefined;
      }
    }
  }

  function create(entry) {
    expireStale();
    const token = "attok_" + crypto.randomBytes(16).toString("hex");
    const record = {
      token,
      webContentsId: entry.webContentsId,
      sessionId: String(entry.sessionId || ""),
      selection: entry.selection,
      createdMonotonic: nowFn(),
      consumed: false,
    };
    vault.set(token, record);
    return {
      token,
      attachments: (entry.selection || []).map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type || undefined,
        size: typeof a.size === "number" ? a.size : undefined,
        ok: a.ok !== false,
        note: a.note || "",
        chars: typeof a.chars === "number" ? a.chars : undefined,
      })),
    };
  }

  function peek(token) {
    return vault.get(String(token || "")) || null;
  }

  function isExpired(record, atMs) {
    const t = atMs != null ? atMs : nowFn();
    return t - record.createdMonotonic >= TTL_MS;
  }

  function removeRecord(token) {
    const key = String(token || "");
    const record = vault.get(key);
    if (!record) return false;
    wipeSelection(record.selection);
    record.selection = [];
    vault.delete(key);
    return true;
  }

  /**
   * Validate without consuming. Expired tokens are wiped from vault immediately.
   * Peek this token before sweeping others so callers still observe `token_expired`
   * (not `token_not_found`) on the first expiry check.
   */
  function validate(token, { webContentsId, sessionId } = {}) {
    const record = peek(token);
    if (!record) {
      expireStale();
      return { ok: false, code: "token_not_found", message: "附件选择已失效，请重新选择材料。" };
    }
    if (record.consumed) {
      return { ok: false, code: "token_consumed", message: "附件选择已使用，请重新选择材料。" };
    }
    if (isExpired(record)) {
      removeRecord(record.token);
      expireStale();
      return { ok: false, code: "token_expired", message: "附件选择已过期，请重新选择材料。" };
    }
    if (webContentsId != null && record.webContentsId !== webContentsId) {
      return { ok: false, code: "token_window_mismatch", message: "附件选择与当前窗口不匹配，请重新选择材料。" };
    }
    if (sessionId != null && record.sessionId !== String(sessionId)) {
      return { ok: false, code: "token_session_mismatch", message: "附件选择与当前对话不匹配，请重新选择材料。" };
    }
    expireStale();
    return { ok: true, record };
  }

  /**
   * Mark consumed only after caller has registered activeRequest.
   */
  function consume(token, bind) {
    const v = validate(token, bind);
    if (!v.ok) return v;
    v.record.consumed = true;
    return { ok: true, selection: v.record.selection, record: v.record };
  }

  function clear(token) {
    return removeRecord(token);
  }

  function clearForWebContents(webContentsId) {
    for (const [token, record] of [...vault.entries()]) {
      if (record.webContentsId === webContentsId) removeRecord(token);
    }
  }

  function clearAll() {
    for (const token of [...vault.keys()]) removeRecord(token);
  }

  function expireStale() {
    const t = nowFn();
    for (const [token, record] of [...vault.entries()]) {
      // Only TTL expiry here — consumed tokens are cleared by caller after request ends.
      if (isExpired(record, t)) {
        removeRecord(token);
      }
    }
  }

  function startSweeper(intervalMs) {
    stopSweeper();
    const ms = typeof intervalMs === "number" && intervalMs > 0 ? intervalMs : 15_000;
    sweepTimer = setInterval(() => {
      try {
        expireStale();
      } catch {
        /* ignore */
      }
    }, ms);
    if (sweepTimer && typeof sweepTimer.unref === "function") sweepTimer.unref();
  }

  function stopSweeper() {
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }

  function size() {
    return vault.size;
  }

  /** Test: return raw selection text lengths still held (should be 0 after expire). */
  function debugBodyChars(token) {
    const record = peek(token);
    if (!record) return 0;
    let n = 0;
    for (const a of record.selection || []) {
      n += String((a && a.text) || "").length;
    }
    return n;
  }

  return {
    TTL_MS,
    create,
    peek,
    validate,
    consume,
    clear,
    clearAll,
    clearForWebContents,
    expireStale,
    startSweeper,
    stopSweeper,
    setClock,
    size,
    isExpired,
    debugBodyChars,
  };
}

module.exports = {
  TTL_MS,
  createAttachmentTokenVault,
};

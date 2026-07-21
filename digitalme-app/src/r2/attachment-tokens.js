"use strict";

const crypto = require("node:crypto");

const TTL_MS = 300_000;

/**
 * In-memory attachment selection vault (process-local, not persisted).
 * Supports injectable monotonic clock for hermetic TTL tests.
 */
function createAttachmentTokenVault(opts = {}) {
  /** @type {Map<string, object>} */
  const vault = new Map();
  let nowFn =
    typeof opts.nowMonotonicMs === "function"
      ? opts.nowMonotonicMs
      : () => Number(process.hrtime.bigint() / 1_000_000n);

  function setClock(fn) {
    if (typeof fn === "function") nowFn = fn;
  }

  function create(entry) {
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

  /**
   * Validate without consuming. Does not clear body.
   */
  function validate(token, { webContentsId, sessionId } = {}) {
    const record = peek(token);
    if (!record) {
      return { ok: false, code: "token_not_found", message: "附件选择已失效，请重新选择材料。" };
    }
    if (record.consumed) {
      return { ok: false, code: "token_consumed", message: "附件选择已使用，请重新选择材料。" };
    }
    if (isExpired(record)) {
      vault.delete(record.token);
      return { ok: false, code: "token_expired", message: "附件选择已过期，请重新选择材料。" };
    }
    if (webContentsId != null && record.webContentsId !== webContentsId) {
      return { ok: false, code: "token_window_mismatch", message: "附件选择与当前窗口不匹配，请重新选择材料。" };
    }
    if (sessionId != null && record.sessionId !== String(sessionId)) {
      return { ok: false, code: "token_session_mismatch", message: "附件选择与当前对话不匹配，请重新选择材料。" };
    }
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
    const key = String(token || "");
    const record = vault.get(key);
    if (record && record.selection) {
      for (const a of record.selection) {
        if (a && typeof a === "object") {
          a.text = "";
          a.path = undefined;
        }
      }
    }
    vault.delete(key);
  }

  function clearAll() {
    for (const token of [...vault.keys()]) clear(token);
  }

  function expireStale() {
    const t = nowFn();
    for (const [token, record] of vault) {
      if (isExpired(record, t) || record.consumed) {
        clear(token);
      }
    }
  }

  function size() {
    return vault.size;
  }

  return {
    TTL_MS,
    create,
    peek,
    validate,
    consume,
    clear,
    clearAll,
    expireStale,
    setClock,
    size,
    isExpired,
  };
}

module.exports = {
  TTL_MS,
  createAttachmentTokenVault,
};

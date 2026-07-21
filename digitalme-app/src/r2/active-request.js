"use strict";

const crypto = require("node:crypto");

/**
 * App-wide single-flight active chat request registry.
 */
function createActiveRequestRegistry() {
  /** @type {null | {
   *   requestId: string,
   *   originSessionId: string,
   *   assistantMessageId: string,
   *   startedAt: string,
   *   status: string,
   *   sequence: number,
   *   abortController: AbortController,
   * }} */
  let current = null;

  function newRequestId() {
    return "req_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
  }

  function newMessageId() {
    return "m_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
  }

  function get() {
    if (!current) return null;
    return {
      requestId: current.requestId,
      originSessionId: current.originSessionId,
      assistantMessageId: current.assistantMessageId,
      startedAt: current.startedAt,
      status: current.status,
      sequence: current.sequence,
    };
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
    const abortController = new AbortController();
    current = {
      requestId: newRequestId(),
      originSessionId: String(originSessionId || ""),
      assistantMessageId: newMessageId(),
      startedAt: new Date().toISOString(),
      status: status || "running",
      sequence: 0,
      abortController,
    };
    return { ok: true, activeRequest: get(), abortController };
  }

  function nextSequence(requestId) {
    if (!current || current.requestId !== requestId) return null;
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

  function clear(requestId) {
    if (!current) return false;
    if (requestId && current.requestId !== requestId) return false;
    current = null;
    return true;
  }

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
    return { ok: true, activeRequest: get() };
  }

  return {
    get,
    assertIdle,
    register,
    nextSequence,
    setStatus,
    getAbortController,
    clear,
    abort,
    newRequestId,
    newMessageId,
  };
}

module.exports = {
  createActiveRequestRegistry,
};

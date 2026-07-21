"use strict";

/**
 * R1 renderer entry controller (main-authoritative).
 * Distinguishes preferredEntry (persisted default), effectiveEntry (this process),
 * and fallback latch (process-local anti-loop).
 */

const DEFAULT_READY_TIMEOUT_MS = 8000;

/**
 * Explicit generation is required. Missing → generation_required;
 * non-finite / non-integer / <1 → generation_invalid.
 * @param {unknown} raw
 */
function parseExplicitGeneration(raw) {
  if (raw === undefined || raw === null) {
    return { ok: false, code: "generation_required" };
  }
  if (typeof raw === "string" && raw.trim() === "") {
    return { ok: false, code: "generation_required" };
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return { ok: false, code: "generation_invalid" };
  }
  return { ok: true, generation: n };
}

function createRendererEntryController(opts = {}) {
  const readyTimeoutMs =
    typeof opts.readyTimeoutMs === "number" && opts.readyTimeoutMs > 0
      ? opts.readyTimeoutMs
      : DEFAULT_READY_TIMEOUT_MS;

  /** @type {"legacy"|"next"} */
  let preferredEntry = "legacy";
  /** @type {"legacy"|"next"} */
  let effectiveEntry = "legacy";
  let fallbackLatched = false;
  let navigationGeneration = 0;
  let readyConsumedGeneration = null;
  let readyTimer = null;
  let readyArmed = false;
  let lastFailure = null;
  /** @type {((info: object) => void)|null} */
  let onFallback = null;

  function clearReadyTimer() {
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    readyArmed = false;
  }

  function isSpikeHarnessEnabled() {
    return (
      process.env.DIGITALME_R1_SPIKE_HARNESS === "1" ||
      process.env.DIGITALME_R1_OWNER_RUNTIME === "1"
    );
  }

  function isViteDevEnabled() {
    return process.env.DIGITALME_VITE_DEV === "1";
  }

  function snapshot() {
    return {
      preferredEntry,
      effectiveEntry,
      fallbackLatched,
      navigationGeneration,
      readyConsumedGeneration,
      readyArmed,
      lastFailure,
      readyTimeoutMs,
      harnessEnabled: isSpikeHarnessEnabled(),
      viteDevEnabled: isViteDevEnabled(),
    };
  }

  function resolveInitialEntry() {
    if (
      isSpikeHarnessEnabled() &&
      process.env.DIGITALME_R1_INITIAL_ENTRY === "next" &&
      !fallbackLatched
    ) {
      return "next";
    }
    return preferredEntry === "next" && !fallbackLatched ? "next" : "legacy";
  }

  /**
   * Ordinary renderer may only request next → legacy.
   */
  function requestFromRenderer(entry, reason) {
    const target = entry === "next" ? "next" : entry === "legacy" ? "legacy" : null;
    if (!target) {
      return { ok: false, code: "invalid_entry" };
    }
    if (target === "next") {
      return { ok: false, code: "entry_upgrade_forbidden" };
    }
    if (effectiveEntry !== "next") {
      return { ok: false, code: "already_legacy" };
    }
    return {
      ok: true,
      code: "ok",
      action: "load_legacy",
      reason: String(reason || "renderer_request"),
    };
  }

  /**
   * Harness / main-only path for legacy → next.
   */
  function requestNextFromHarness(reason) {
    if (!isSpikeHarnessEnabled()) {
      return { ok: false, code: "harness_required" };
    }
    if (fallbackLatched) {
      return { ok: false, code: "fallback_latched" };
    }
    if (effectiveEntry === "next") {
      return { ok: false, code: "already_next" };
    }
    return {
      ok: true,
      code: "ok",
      action: "load_next",
      reason: String(reason || "harness_request"),
    };
  }

  function beginNextNavigation() {
    clearReadyTimer();
    navigationGeneration += 1;
    readyConsumedGeneration = null;
    effectiveEntry = "next";
    const generation = navigationGeneration;
    return { generation };
  }

  function beginLegacyNavigation() {
    clearReadyTimer();
    readyConsumedGeneration = null;
    effectiveEntry = "legacy";
    return { ok: true };
  }

  function armReadyTimer(generation, onTimeout) {
    clearReadyTimer();
    readyArmed = true;
    readyTimer = setTimeout(() => {
      readyTimer = null;
      readyArmed = false;
      if (typeof onTimeout !== "function") return;
      try {
        const result = onTimeout(generation);
        if (result && typeof result.then === "function") {
          Promise.resolve(result).catch((err) => {
            const category =
              err && err.code
                ? String(err.code)
                : err && err.message
                  ? "timeout_callback_rejected"
                  : "timeout_callback_rejected";
            // Sanitize: category + time only; never attach stacks/paths/bodies into latch detail.
            if (!fallbackLatched) {
              latchFallback({ category, generation });
            }
          });
        }
      } catch (err) {
        const category =
          err && err.code ? String(err.code) : "timeout_callback_threw";
        if (!fallbackLatched) {
          latchFallback({ category, generation });
        }
      }
    }, readyTimeoutMs);
    return { ok: true, generation, readyTimeoutMs };
  }

  function acceptSignalReady({ generation, webContentsId, expectedWebContentsId, isNextPage }) {
    const parsed = parseExplicitGeneration(generation);
    if (!parsed.ok) return parsed;

    if (effectiveEntry !== "next") {
      return { ok: false, code: "not_next_entry" };
    }
    if (!isNextPage) {
      return { ok: false, code: "not_next_page" };
    }
    if (expectedWebContentsId != null && webContentsId !== expectedWebContentsId) {
      return { ok: false, code: "window_mismatch" };
    }
    if (parsed.generation !== navigationGeneration) {
      return { ok: false, code: "generation_mismatch" };
    }
    if (readyConsumedGeneration === parsed.generation) {
      return { ok: false, code: "already_consumed" };
    }
    if (!readyArmed) {
      return { ok: false, code: "ready_late" };
    }
    readyConsumedGeneration = parsed.generation;
    clearReadyTimer();
    return { ok: true, code: "ok", generation: parsed.generation };
  }

  function latchFallback(failure) {
    clearReadyTimer();
    fallbackLatched = true;
    effectiveEntry = "legacy";
    lastFailure = {
      category: String((failure && failure.category) || "unknown"),
      at: new Date().toISOString(),
      generation: failure && failure.generation != null ? failure.generation : navigationGeneration,
    };
    if (typeof onFallback === "function") {
      try {
        onFallback({ ...lastFailure });
      } catch {
        /* ignore */
      }
    }
    return { ok: true, effectiveEntry, fallbackLatched, lastFailure };
  }

  function setOnFallback(fn) {
    onFallback = typeof fn === "function" ? fn : null;
  }

  /** Test-only: set preferred without renderer IPC. */
  function setPreferredEntryForHarness(entry) {
    if (!isSpikeHarnessEnabled()) return { ok: false, code: "harness_required" };
    if (entry !== "legacy" && entry !== "next") return { ok: false, code: "invalid_entry" };
    preferredEntry = entry;
    return { ok: true, preferredEntry };
  }

  function getBoundGeneration() {
    if (effectiveEntry !== "next") return null;
    return navigationGeneration;
  }

  return {
    DEFAULT_READY_TIMEOUT_MS,
    snapshot,
    resolveInitialEntry,
    requestFromRenderer,
    requestNextFromHarness,
    beginNextNavigation,
    beginLegacyNavigation,
    armReadyTimer,
    acceptSignalReady,
    latchFallback,
    clearReadyTimer,
    setOnFallback,
    setPreferredEntryForHarness,
    getBoundGeneration,
    isSpikeHarnessEnabled,
    isViteDevEnabled,
    parseExplicitGeneration,
  };
}

module.exports = {
  createRendererEntryController,
  parseExplicitGeneration,
  DEFAULT_READY_TIMEOUT_MS,
};

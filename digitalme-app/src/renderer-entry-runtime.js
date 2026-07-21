"use strict";

/**
 * Main-process orchestration for R1 legacy/next whole-window switching.
 */

const { createRendererEntryController, parseExplicitGeneration } = require("./renderer-entry-controller");
const loadHelpers = require("./renderer-entry-load");

function createRendererEntryRuntime(opts = {}) {
  const controller = createRendererEntryController({
    readyTimeoutMs: opts.readyTimeoutMs,
  });

  const loadLegacyEntry = opts.loadLegacyEntry || loadHelpers.loadLegacyEntry;
  const loadNextEntry = opts.loadNextEntry || loadHelpers.loadNextEntry;
  const isNextPageUrl = opts.isNextPageUrl || loadHelpers.isNextPageUrl;

  /** @type {import('electron').BrowserWindow|null} */
  let boundWindow = null;
  /** Single-flight gate for whole-window navigation (sync reservation). */
  let navigating = false;

  function getWindow() {
    return boundWindow && !boundWindow.isDestroyed() ? boundWindow : null;
  }

  function currentWebContentsId() {
    const win = getWindow();
    return win ? win.webContents.id : null;
  }

  function pageIsNext() {
    const win = getWindow();
    if (!win) return false;
    return isNextPageUrl(win.webContents.getURL());
  }

  function tryAcquireNavigation() {
    if (navigating) return { ok: false, code: "navigation_in_progress" };
    navigating = true;
    return { ok: true };
  }

  function releaseNavigation() {
    navigating = false;
  }

  async function navigateLegacy(reason, gateOpts = {}) {
    const win = getWindow();
    if (!win) return { ok: false, code: "no_window" };
    const holdGate = gateOpts.holdGate === true;
    if (!holdGate) {
      const gate = tryAcquireNavigation();
      if (!gate.ok) return gate;
    }
    try {
      controller.beginLegacyNavigation();
      await loadLegacyEntry(win);
      return { ok: true, effectiveEntry: "legacy", reason: String(reason || "legacy") };
    } finally {
      if (!holdGate) releaseNavigation();
    }
  }

  async function fallbackToLegacy(failure) {
    controller.latchFallback(failure);
    // Fallback may run while a next navigation still holds the gate.
    const holdGate = navigating;
    return navigateLegacy(`fallback:${(failure && failure.category) || "unknown"}`, {
      holdGate,
    });
  }

  async function navigateNext(reason, gateOpts = {}) {
    const win = getWindow();
    if (!win) return { ok: false, code: "no_window" };
    if (controller.snapshot().fallbackLatched) {
      return { ok: false, code: "fallback_latched" };
    }

    const holdGate = gateOpts.holdGate === true;
    if (!holdGate) {
      const gate = tryAcquireNavigation();
      if (!gate.ok) return gate;
    }

    // Arm generation + ready timer BEFORE load so early ready is accepted.
    const { generation } = controller.beginNextNavigation();
    controller.armReadyTimer(generation, async (timedOutGeneration) => {
      if (timedOutGeneration !== controller.snapshot().navigationGeneration) return;
      if (controller.snapshot().effectiveEntry !== "next") return;
      await fallbackToLegacy({
        category: "ready_timeout",
        generation: timedOutGeneration,
      });
    });

    try {
      const loadResult = await loadNextEntry(win, {
        viteDev: controller.isViteDevEnabled(),
      });
      return {
        ok: true,
        generation,
        loadResult,
        reason: String(reason || "next"),
      };
    } catch (err) {
      const code = err && err.code ? String(err.code) : "next_load_failed";
      await fallbackToLegacy({ category: code, generation });
      return { ok: false, code, fallback: true };
    } finally {
      if (!holdGate) releaseNavigation();
    }
  }

  function bindWindow(win) {
    boundWindow = win;
    win.on("closed", () => {
      controller.clearReadyTimer();
      if (boundWindow === win) boundWindow = null;
    });
  }

  async function applyInitialEntry() {
    const initial = controller.resolveInitialEntry();
    if (initial === "next") {
      return navigateNext("initial");
    }
    return navigateLegacy("initial_default");
  }

  function getPublicEntryState() {
    const snap = controller.snapshot();
    return {
      ok: true,
      preferredEntry: snap.preferredEntry,
      effectiveEntry: snap.effectiveEntry,
      fallbackLatched: snap.fallbackLatched,
      navigationGeneration: snap.navigationGeneration,
      apiVersion: 1,
    };
  }

  function handleRequestFromRenderer(entry, reason) {
    const decision = controller.requestFromRenderer(entry, reason);
    if (!decision.ok) return Promise.resolve(decision);
    const gate = tryAcquireNavigation();
    if (!gate.ok) return Promise.resolve(gate);
    // Defer load so renderer invoke can complete before navigation tears down the page.
    setImmediate(() => {
      void navigateLegacy(decision.reason, { holdGate: true }).finally(() => {
        releaseNavigation();
      });
    });
    return Promise.resolve({ ok: true, code: "ok", deferred: true });
  }

  function handleHarnessRequestNext(reason) {
    const decision = controller.requestNextFromHarness(reason);
    if (!decision.ok) return Promise.resolve(decision);
    const gate = tryAcquireNavigation();
    if (!gate.ok) return Promise.resolve(gate);
    setImmediate(() => {
      void navigateNext(decision.reason, { holdGate: true }).finally(() => {
        releaseNavigation();
      });
    });
    return Promise.resolve({ ok: true, code: "ok", deferred: true });
  }

  function handleSignalReady(payload = {}) {
    // Must not invent generation when missing — explicit only.
    const parsed = parseExplicitGeneration(payload.generation);
    if (!parsed.ok) return parsed;
    return controller.acceptSignalReady({
      generation: parsed.generation,
      webContentsId: payload.webContentsId,
      expectedWebContentsId: currentWebContentsId(),
      isNextPage: pageIsNext(),
    });
  }

  function getBoundGeneration() {
    return {
      ok: true,
      generation: controller.getBoundGeneration(),
    };
  }

  return {
    controller,
    bindWindow,
    applyInitialEntry,
    navigateLegacy,
    navigateNext,
    fallbackToLegacy,
    getPublicEntryState,
    handleRequestFromRenderer,
    handleHarnessRequestNext,
    handleSignalReady,
    getBoundGeneration,
    pageIsNext,
    nextDistExists: opts.nextDistExists || loadHelpers.nextDistExists,
    isNavigating: () => navigating,
    tryAcquireNavigation,
    releaseNavigation,
  };
}

module.exports = {
  createRendererEntryRuntime,
};

"use strict";

/**
 * Main-process orchestration for R1 legacy/next whole-window switching.
 */

const { createRendererEntryController } = require("./renderer-entry-controller");
const {
  loadLegacyEntry,
  loadNextEntry,
  isNextPageUrl,
  nextDistExists,
} = require("./renderer-entry-load");

function createRendererEntryRuntime(opts = {}) {
  const controller = createRendererEntryController({
    readyTimeoutMs: opts.readyTimeoutMs,
  });

  /** @type {import('electron').BrowserWindow|null} */
  let boundWindow = null;
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

  async function navigateLegacy(reason) {
    const win = getWindow();
    if (!win) return { ok: false, code: "no_window" };
    navigating = true;
    try {
      controller.beginLegacyNavigation();
      await loadLegacyEntry(win);
      return { ok: true, effectiveEntry: "legacy", reason: String(reason || "legacy") };
    } finally {
      navigating = false;
    }
  }

  async function fallbackToLegacy(failure) {
    controller.latchFallback(failure);
    return navigateLegacy(`fallback:${(failure && failure.category) || "unknown"}`);
  }

  async function navigateNext(reason) {
    const win = getWindow();
    if (!win) return { ok: false, code: "no_window" };
    if (controller.snapshot().fallbackLatched) {
      return { ok: false, code: "fallback_latched" };
    }

    navigating = true;
    const { generation } = controller.beginNextNavigation();
    try {
      const loadResult = await loadNextEntry(win, {
        viteDev: controller.isViteDevEnabled(),
      });
      controller.armReadyTimer(generation, async (timedOutGeneration) => {
        if (timedOutGeneration !== controller.snapshot().navigationGeneration) return;
        if (controller.snapshot().effectiveEntry !== "next") return;
        await fallbackToLegacy({
          category: "ready_timeout",
          generation: timedOutGeneration,
        });
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
      navigating = false;
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
    // Defer load so renderer invoke can complete before navigation tears down the page.
    setImmediate(() => {
      void navigateLegacy(decision.reason);
    });
    return Promise.resolve({ ok: true, code: "ok", deferred: true });
  }

  function handleHarnessRequestNext(reason) {
    const decision = controller.requestNextFromHarness(reason);
    if (!decision.ok) return Promise.resolve(decision);
    setImmediate(() => {
      void navigateNext(decision.reason);
    });
    return Promise.resolve({ ok: true, code: "ok", deferred: true });
  }

  function handleSignalReady(payload = {}) {
    const generation =
      payload.generation != null ? Number(payload.generation) : controller.getBoundGeneration();
    const result = controller.acceptSignalReady({
      generation,
      webContentsId: payload.webContentsId,
      expectedWebContentsId: currentWebContentsId(),
      isNextPage: pageIsNext(),
    });
    return result;
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
    nextDistExists,
    isNavigating: () => navigating,
  };
}

module.exports = {
  createRendererEntryRuntime,
};

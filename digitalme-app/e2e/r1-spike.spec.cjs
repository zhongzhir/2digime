"use strict";

/**
 * R1 Playwright Electron minimal E2E.
 * Run: npx playwright test e2e/r1-spike.spec.cjs
 */

const { test, expect, _electron: electron } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");

const APP_ROOT = path.join(__dirname, "..");
const ELECTRON_BIN = require("electron");
const ENTRY = path.join(APP_ROOT, "scripts", "electron-r1-spike-entry.cjs");

test.setTimeout(60_000);

async function launchApp(extraEnv = {}) {
  const electronApp = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [ENTRY],
    env: {
      ...process.env,
      DIGITALME_R1_SPIKE_HARNESS: "1",
      DIGITALME_R1_READY_TIMEOUT_MS: "3000",
      ...extraEnv,
    },
  });
  const win = await electronApp.firstWindow({ timeout: 45_000 });
  await win.waitForLoadState("domcontentloaded");
  return { electronApp, win };
}

async function waitUntilLegacy(win, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = win.url();
    if (url.includes("renderer") && !url.includes("renderer-next")) return url;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for legacy entry; last=${win.url()}`);
}

async function waitUntilNext(win, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = win.url();
    if (url.includes("renderer-next")) return url;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for next entry; last=${win.url()}`);
}

test.describe("R1 renderer-next spike", () => {
  test("default entry is legacy and stamp is readable", async () => {
    const { electronApp, win } = await launchApp();
    try {
      const url = win.url();
      expect(url.includes("renderer-next")).toBeFalsy();
      expect(url.includes("renderer")).toBeTruthy();

      const stamp = await win.evaluate(async () => {
        return window.digitalMe.getRuntimeStamp();
      });
      expect(stamp && stamp.ok).toBeTruthy();
      expect(stamp.apiVersion).toBe(1);

      const entry = await win.evaluate(async () => {
        return window.digitalMe.runtime.getRendererEntry();
      });
      expect(entry.effectiveEntry).toBe("legacy");
      expect(entry.preferredEntry).toBe("legacy");
      expect(entry.fallbackLatched).toBeFalsy();

      const denied = await win.evaluate(async () => {
        return window.digitalMe.runtime.requestRendererEntry("next", "e2e_probe");
      });
      expect(denied.ok).toBeFalsy();
      expect(denied.code).toBe("entry_upgrade_forbidden");
    } finally {
      await electronApp.close();
    }
  });

  test("harness can enter next, read stamp, and return legacy", async () => {
    const dist = path.join(APP_ROOT, "src", "renderer-next", "dist", "index.html");
    expect(fs.existsSync(dist)).toBeTruthy();

    const { electronApp, win } = await launchApp();
    try {
      const switched = await win.evaluate(async () => {
        return window.digitalMe.runtime.testRequestNext("e2e_enter_next");
      });
      expect(switched.ok).toBeTruthy();

      await waitUntilNext(win);
      await win.waitForSelector('[data-testid="renderer-next-shell"]', { timeout: 15_000 });
      const stampValue = await win.locator('[data-testid="runtime-stamp-value"]').innerText();
      expect(stampValue.length).toBeGreaterThan(0);
      expect(stampValue).not.toBe("未提供");

      await expect(win.locator('[data-testid="ready-status"]')).toHaveText("ok", {
        timeout: 10_000,
      });

      await win.locator('[data-testid="return-legacy"]').click();
      await waitUntilLegacy(win);

      const entry = await win.evaluate(async () => {
        return window.digitalMe.runtime.getRendererEntry();
      });
      expect(entry.effectiveEntry).toBe("legacy");
    } finally {
      await electronApp.close();
    }
  });

  test("ready failure auto-falls back and latch blocks re-entry", async () => {
    const { electronApp, win } = await launchApp({
      DIGITALME_R1_FAIL_READY: "1",
      DIGITALME_R1_READY_TIMEOUT_MS: "1500",
    });
    try {
      const switched = await win.evaluate(async () => {
        return window.digitalMe.runtime.testRequestNext("e2e_fail_ready");
      });
      expect(switched.ok).toBeTruthy();

      await waitUntilNext(win);
      await waitUntilLegacy(win, 20_000);

      const snap = await win.evaluate(async () => {
        return window.digitalMe.runtime.testGetEntrySnapshot();
      });
      expect(snap.ok).toBeTruthy();
      expect(snap.effectiveEntry).toBe("legacy");
      expect(snap.fallbackLatched).toBeTruthy();

      const blocked = await win.evaluate(async () => {
        return window.digitalMe.runtime.testRequestNext("e2e_retry_after_latch");
      });
      expect(blocked.ok).toBeFalsy();
      expect(blocked.code).toBe("fallback_latched");
    } finally {
      await electronApp.close();
    }
  });

  test("wrong generation signalReady is rejected while on next", async () => {
    const { electronApp, win } = await launchApp({
      DIGITALME_R1_FAIL_READY: "1",
      DIGITALME_R1_READY_TIMEOUT_MS: "8000",
    });
    try {
      const switched = await win.evaluate(async () => {
        return window.digitalMe.runtime.testRequestNext("e2e_wrong_gen");
      });
      expect(switched.ok).toBeTruthy();
      await waitUntilNext(win);
      await win.waitForSelector('[data-testid="renderer-next-shell"]', { timeout: 15_000 });

      const result = await win.evaluate(async () => {
        const bound = await window.digitalMe.runtime.getBoundGeneration();
        const wrong = await window.digitalMe.runtime.signalReady((bound.generation || 0) + 99);
        return { bound, wrong };
      });
      expect(result.wrong.ok).toBeFalsy();
      expect(result.wrong.code).toBe("generation_mismatch");
    } finally {
      await electronApp.close();
    }
  });
});

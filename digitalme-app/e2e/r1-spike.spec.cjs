"use strict";

/**
 * R1 Playwright Electron minimal E2E.
 * Run: npx playwright test -c playwright.config.cjs
 */

const { test, expect, _electron: electron } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");

const APP_ROOT = path.join(__dirname, "..");
const ELECTRON_BIN = require("electron");
const ENTRY = path.join(APP_ROOT, "scripts", "electron-r1-spike-entry.cjs");
const VITE_CONFIG = path.join(APP_ROOT, "src", "renderer-next", "vite.config.ts");
const VITE_HOST = "127.0.0.1";
const VITE_PORT = 5173;
const VITE_URL = `http://${VITE_HOST}:${VITE_PORT}/`;

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
    if (url.includes("renderer") && !url.includes("renderer-next") && !url.includes(`${VITE_HOST}:${VITE_PORT}`)) {
      return url;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for legacy entry; last=${win.url()}`);
}

async function waitUntilNext(win, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = win.url();
    if (url.includes("renderer-next") || url.includes(`${VITE_HOST}:${VITE_PORT}`)) return url;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for next entry; last=${win.url()}`);
}

function waitForHttpOk(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve(true);
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error(`vite not ready status=${res.statusCode}`));
          return;
        }
        setTimeout(attempt, 150);
      });
      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error("vite not ready (connection failed)"));
          return;
        }
        setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

async function startViteDevServer() {
  const viteJs = path.join(APP_ROOT, "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(viteJs)) {
    throw new Error(`vite binary missing: ${viteJs}`);
  }
  const child = spawn(
    process.execPath,
    [viteJs, "--config", VITE_CONFIG, "--host", VITE_HOST, "--port", String(VITE_PORT), "--strictPort"],
    {
      cwd: APP_ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  );
  let stderr = "";
  child.stderr.on("data", (buf) => {
    stderr += String(buf);
  });
  child.stdout.on("data", () => {});
  try {
    await waitForHttpOk(VITE_URL, 25_000);
  } catch (err) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    throw new Error(`${err.message}; vite stderr=${stderr.slice(0, 500)}`);
  }
  return child;
}

async function stopChild(child) {
  if (!child || child.killed) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill();
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
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

  test("missing invalid wrong and late generation are rejected", async () => {
    const { electronApp, win } = await launchApp({
      DIGITALME_R1_FAIL_READY: "1",
      DIGITALME_R1_READY_TIMEOUT_MS: "8000",
    });
    try {
      const switched = await win.evaluate(async () => {
        return window.digitalMe.runtime.testRequestNext("e2e_gen_cases");
      });
      expect(switched.ok).toBeTruthy();
      await waitUntilNext(win);
      await win.waitForSelector('[data-testid="renderer-next-shell"]', { timeout: 15_000 });

      const result = await win.evaluate(async () => {
        const bound = await window.digitalMe.runtime.getBoundGeneration();
        const missing = await window.digitalMe.runtime.signalReady(undefined);
        const invalid = await window.digitalMe.runtime.signalReady(1.5);
        const wrong = await window.digitalMe.runtime.signalReady((bound.generation || 0) + 99);
        return { bound, missing, invalid, wrong };
      });
      expect(result.missing.ok).toBeFalsy();
      expect(result.missing.code).toBe("generation_required");
      expect(result.invalid.ok).toBeFalsy();
      expect(result.invalid.code).toBe("generation_invalid");
      expect(result.wrong.ok).toBeFalsy();
      expect(result.wrong.code).toBe("generation_mismatch");

      // Consume correctly once, then late/repeat fails.
      const afterOk = await win.evaluate(async () => {
        const bound = await window.digitalMe.runtime.getBoundGeneration();
        const first = await window.digitalMe.runtime.signalReady(bound.generation);
        const second = await window.digitalMe.runtime.signalReady(bound.generation);
        return { first, second };
      });
      expect(afterOk.first.ok).toBeTruthy();
      expect(afterOk.second.ok).toBeFalsy();
      expect(["already_consumed", "ready_late"]).toContain(afterOk.second.code);
    } finally {
      await electronApp.close();
    }
  });

  test("concurrent testRequestNext only one succeeds", async () => {
    const { electronApp, win } = await launchApp();
    try {
      const pair = await win.evaluate(async () => {
        const a = window.digitalMe.runtime.testRequestNext("concurrent_a");
        const b = window.digitalMe.runtime.testRequestNext("concurrent_b");
        return Promise.all([a, b]);
      });
      const oks = pair.filter((r) => r && r.ok);
      const blocked = pair.filter((r) => r && !r.ok);
      expect(oks.length).toBe(1);
      expect(blocked.length).toBe(1);
      expect(blocked[0].code).toBe("navigation_in_progress");
      await waitUntilNext(win);
      await expect(win.locator('[data-testid="ready-status"]')).toHaveText("ok", {
        timeout: 10_000,
      });
    } finally {
      await electronApp.close();
    }
  });

  test("vite dev URL loads only when DIGITALME_VITE_DEV=1", async () => {
    const vite = await startViteDevServer();
    try {
      // Without explicit dev flag, Vite URL env must not be used.
      const prod = await launchApp({
        DIGITALME_VITE_DEV_URL: VITE_URL,
      });
      try {
        const switched = await prod.win.evaluate(async () => {
          return window.digitalMe.runtime.testRequestNext("e2e_prod_not_vite");
        });
        expect(switched.ok).toBeTruthy();
        const url = await waitUntilNext(prod.win);
        expect(url.includes("renderer-next")).toBeTruthy();
        expect(url.startsWith("http")).toBeFalsy();
      } finally {
        await prod.electronApp.close();
      }

      const dev = await launchApp({
        DIGITALME_VITE_DEV: "1",
        DIGITALME_VITE_DEV_URL: VITE_URL,
      });
      try {
        const switched = await dev.win.evaluate(async () => {
          return window.digitalMe.runtime.testRequestNext("e2e_vite_dev");
        });
        expect(switched.ok).toBeTruthy();
        const url = await waitUntilNext(dev.win);
        expect(url.startsWith(VITE_URL) || url.includes(`${VITE_HOST}:${VITE_PORT}`)).toBeTruthy();
        await dev.win.waitForSelector('[data-testid="renderer-next-shell"]', { timeout: 15_000 });
        await expect(dev.win.locator('[data-testid="ready-status"]')).toHaveText("ok", {
          timeout: 10_000,
        });
      } finally {
        await dev.electronApp.close();
      }
    } finally {
      await stopChild(vite);
    }
  });

  test("error boundary inject only via harness env", async () => {
    const injected = await launchApp({
      DIGITALME_R1_INJECT_ERROR_BOUNDARY: "1",
    });
    try {
      const switched = await injected.win.evaluate(async () => {
        return window.digitalMe.runtime.testRequestNext("e2e_inject_boundary");
      });
      expect(switched.ok).toBeTruthy();
      await waitUntilNext(injected.win);
      await injected.win.waitForSelector('[data-testid="shell-error"]', { timeout: 15_000 });
    } finally {
      await injected.electronApp.close();
    }

    const normal = await launchApp();
    try {
      // query/hash/localStorage must not enable injection.
      await normal.win.evaluate(() => {
        try {
          localStorage.setItem("DIGITALME_R1_INJECT_ERROR_BOUNDARY", "1");
          location.hash = "injectErrorBoundary=1";
        } catch {
          /* ignore */
        }
      });
      const flag = await normal.win.evaluate(() => {
        return Boolean(window.digitalMe?.runtime?.injectErrorBoundary);
      });
      expect(flag).toBeFalsy();

      const switched = await normal.win.evaluate(async () => {
        return window.digitalMe.runtime.testRequestNext("e2e_no_inject");
      });
      expect(switched.ok).toBeTruthy();
      await waitUntilNext(normal.win);
      await normal.win.waitForSelector('[data-testid="renderer-next-shell"]', { timeout: 15_000 });
      await expect(normal.win.locator('[data-testid="shell-error"]')).toHaveCount(0);
    } finally {
      await normal.electronApp.close();
    }
  });
});

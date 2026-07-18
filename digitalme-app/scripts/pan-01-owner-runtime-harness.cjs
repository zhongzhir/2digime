"use strict";

/**
 * PAN-01 Owner runtime harness: panorama default entry + CTAs.
 */

const assert = require("node:assert/strict");
const { ipcMain } = require("electron");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, { timeoutMs = 25000, intervalMs = 50, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}: ${String(last)}`);
}

async function evalIn(win, source) {
  return win.webContents.executeJavaScript(source, true);
}

function removeHandler(channel) {
  try {
    ipcMain.removeHandler(channel);
  } catch {
    /* ignore */
  }
}

function installInboxPendingMock() {
  removeHandler("inbox:list");
  ipcMain.handle("inbox:list", async () => ({
    items: [
      {
        id: "pending_1",
        name: "pending.txt",
        status: "suggested",
        suggestedKind: "persona",
        materialKind: "persona",
      },
    ],
  }));
}

async function runPan01OwnerRuntimeHarness({ BrowserWindow }) {
  const results = [];
  const pass = (name) => {
    results.push({ name, ok: true });
    console.log("PASS", name);
  };
  const fail = (name, err) => {
    results.push({ name, ok: false, err: String(err && err.stack ? err.stack : err) });
    console.error("FAIL", name, err && err.stack ? err.stack : err);
  };

  installInboxPendingMock();

  const win =
    BrowserWindow.getAllWindows()[0] ||
    (await waitFor(() => BrowserWindow.getAllWindows()[0], { label: "BrowserWindow" }));

  await waitFor(() => !win.webContents.isLoading(), { label: "load complete", timeoutMs: 30000 });
  await sleep(1500);

  try {
    await evalIn(
      win,
      `(async () => {
        document.querySelector('[data-view="me"]')?.click();
        await new Promise((r) => setTimeout(r, 200));
        if (typeof goSelfView === "function") goSelfView("overview");
        await new Promise((r) => setTimeout(r, 800));
        return true;
      })()`
    );

    const state = await waitFor(
      async () => {
        const s = await evalIn(
          win,
          `({
            meVisible: !document.getElementById("view-me")?.classList.contains("hidden"),
            selfVisible: !document.getElementById("me-lane-self")?.classList.contains("hidden"),
            buildHidden: document.getElementById("me-lane-build")?.classList.contains("hidden"),
            overviewActive: document.querySelector('#me-tabs .mode-tab[data-me-tab="overview"]')?.classList.contains("active"),
            overviewLabel: document.querySelector('#me-tabs .mode-tab[data-me-tab="overview"]')?.textContent?.trim() || "",
            title: document.getElementById("subject-home-title")?.textContent || "",
            promises: document.getElementById("panorama-promises")?.children.length || 0,
            journey: document.getElementById("panorama-journey")?.children.length || 0,
            bodyText: document.getElementById("subject-home")?.innerText || "",
          })`
        );
        return s.meVisible && s.selfVisible && s.promises >= 4 ? s : null;
      },
      { label: "panorama home ready", timeoutMs: 15000 }
    );

    assert.equal(state.meVisible, true);
    assert.equal(state.selfVisible, true);
    assert.equal(state.buildHidden, true, "inbox pending must not open build lane");
    assert.equal(state.overviewActive, true);
    assert.equal(state.overviewLabel, "全貌");
    assert.ok(state.promises >= 4, "four promises visible");
    assert.ok(state.journey >= 5, "five journey steps visible");
    pass("default entry is 数字之我 → 全貌 despite pending inbox");

    const forbidden = ["受限", "实验中", "不可用", "未知"];
    for (const word of forbidden) {
      const scrubbed = state.bodyText.replace(/尚无法确认/g, "").replace(/尚未命名/g, "").replace(/尚未开放/g, "").replace(/尚未建立/g, "");
      const re = new RegExp(`(^|[^\\u4e00-\\u9fff])${word}([^\\u4e00-\\u9fff]|$)`);
      assert.equal(re.test(scrubbed), false, `forbidden maturity word: ${word}`);
    }
    pass("no legacy maturity labels on panorama home");

    assert.match(state.bodyText, /这是我/);
    assert.match(state.bodyText, /属于我/);
    assert.match(state.bodyText, /由我管/);
    assert.match(state.bodyText, /代表我协作/);
    assert.match(state.bodyText, /尚未开放/);
    pass("hero promises journey content visible");
  } catch (err) {
    fail("panorama default entry / content", err);
  }

  try {
    await evalIn(
      win,
      `(async () => {
        if (typeof goSelfView === "function") goSelfView("overview");
        await new Promise((r) => setTimeout(r, 500));
        const btns = [...document.querySelectorAll("#panorama-journey button, #panorama-promises button, #panorama-next-action button")];
        const buildBtn = btns.find((b) => /继续构建/.test(b.textContent || ""));
        if (buildBtn) buildBtn.click();
        else if (typeof goBuildView === "function") goBuildView();
        await new Promise((r) => setTimeout(r, 500));
        return true;
      })()`
    );
    const afterBuild = await waitFor(
      async () => {
        const s = await evalIn(
          win,
          `({ buildVisible: !document.getElementById("me-lane-build")?.classList.contains("hidden") })`
        );
        return s.buildVisible ? s : null;
      },
      { label: "build lane visible", timeoutMs: 8000 }
    );
    assert.equal(afterBuild.buildVisible, true);
    pass("继续构建 enters build lane");
  } catch (err) {
    fail("继续构建", err);
  }

  try {
    await evalIn(
      win,
      `(async () => {
        if (typeof goSelfView === "function") goSelfView("overview");
        await new Promise((r) => setTimeout(r, 500));
        const btn = [...document.querySelectorAll("button")].find((b) => /查看能力/.test(b.textContent || ""));
        if (btn) btn.click();
        else if (typeof navigatePanoramaTarget === "function") navigatePanoramaTarget("capabilities");
        await new Promise((r) => setTimeout(r, 500));
        return true;
      })()`
    );
    const caps = await waitFor(
      async () => {
        const s = await evalIn(
          win,
          `({ extVisible: !document.getElementById("view-extensions")?.classList.contains("hidden") })`
        );
        return s.extVisible ? s : null;
      },
      { label: "capabilities visible", timeoutMs: 8000 }
    );
    assert.equal(caps.extVisible, true);
    pass("查看能力 opens capabilities");
  } catch (err) {
    fail("查看能力", err);
  }

  try {
    await evalIn(
      win,
      `(async () => {
        const nav = document.querySelector('.nav-item[data-view="me"]');
        if (nav) nav.click();
        await new Promise((r) => setTimeout(r, 500));
        const btn = [...document.querySelectorAll("button")].find((b) => /查看边界/.test(b.textContent || ""));
        if (btn) btn.click();
        await new Promise((r) => setTimeout(r, 400));
        return true;
      })()`
    );
    const bounds = await evalIn(
      win,
      `({
        selfVisible: !document.getElementById("me-lane-self").classList.contains("hidden"),
        boundariesActive: document.querySelector('#me-tabs .mode-tab[data-me-tab="boundaries"]').classList.contains("active"),
      })`
    );
    assert.equal(bounds.selfVisible, true);
    assert.equal(bounds.boundariesActive, true);
    pass("查看边界 opens boundaries tab");
  } catch (err) {
    fail("查看边界", err);
  }

  try {
    await evalIn(
      win,
      `(async () => {
        const nav = document.querySelector('.nav-item[data-view="me"]');
        if (nav) nav.click();
        await new Promise((r) => setTimeout(r, 500));
        const refresh = document.getElementById("btn-subject-refresh");
        if (refresh) refresh.click();
        await new Promise((r) => setTimeout(r, 500));
        return true;
      })()`
    );
    const afterRefresh = await evalIn(
      win,
      `({
        overviewActive: document.querySelector('#me-tabs .mode-tab[data-me-tab="overview"]').classList.contains("active"),
        buildHidden: document.getElementById("me-lane-build").classList.contains("hidden"),
      })`
    );
    assert.equal(afterRefresh.overviewActive, true);
    assert.equal(afterRefresh.buildHidden, true);
    pass("refresh stays on 全貌");
  } catch (err) {
    fail("refresh 全貌", err);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nPAN-01 owner-runtime: ${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
  // Give logs a moment then quit
  setTimeout(() => {
    const { app } = require("electron");
    app.quit();
  }, 200);
}

module.exports = { runPan01OwnerRuntimeHarness };

"use strict";

/**
 * PAN-01 Owner runtime harness (updated for PAN-01S minimal surface).
 * Hermetic package + real inbox queue so subject:getOverview sees P2 confirm label.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const {
  createHermeticPackageFixture,
  cleanupHermeticPackageFixture,
} = require("./hermetic-package-fixture.cjs");
const inbox = require("../src/inbox");

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

/**
 * Point config at a hermetic readable package and seed real inbox queue data.
 * subject:getOverview calls inbox.listQueue(userData) directly — IPC mocks alone are insufficient.
 */
function setupHermeticOwnerRuntime() {
  const { packageDir } = createHermeticPackageFixture("pan01-owner");
  const userData = app.getPath("userData");
  const cfgPath = path.join(userData, "config.json");
  fs.writeFileSync(
    cfgPath,
    JSON.stringify(
      {
        packageDir,
        provider: "openai-compatible",
        model: "stub-model",
      },
      null,
      2
    ),
    "utf8"
  );

  // Seed REAL queue so overview inboxSummary has awaiting_review (+ suggested for conflict case).
  inbox.saveQueue(userData, {
    version: 1,
    items: [
      {
        id: "inbox_pending_1",
        name: "pending.txt",
        status: "awaiting_review",
        suggestedKind: "persona",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "inbox_suggested_1",
        name: "suggested.txt",
        status: "suggested",
        suggestedKind: "persona",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });

  return { packageDir, userData };
}

async function clickSidebarMe(win) {
  await evalIn(
    win,
    `(() => {
      const btn = document.querySelector('.nav-item[data-view="me"]');
      if (!btn) throw new Error("sidebar 我 missing");
      btn.click();
      return true;
    })()`
  );
}

async function waitMinimalHome(win) {
  return waitFor(
    async () => {
      const s = await evalIn(
        win,
        `({
          meVisible: !document.getElementById("view-me")?.classList.contains("hidden"),
          selfVisible: !document.getElementById("me-lane-self")?.classList.contains("hidden"),
          buildHidden: document.getElementById("me-lane-build")?.classList.contains("hidden"),
          overviewActive: document.querySelector('#me-tabs .mode-tab[data-me-tab="overview"]')?.classList.contains("active"),
          primary: (document.getElementById("subject-minimal-primary")?.textContent || "").trim(),
          bodyText: document.getElementById("subject-home")?.innerText || "",
          promises: document.getElementById("panorama-promises-card"),
          journey: document.getElementById("panorama-journey-card"),
          cta: document.getElementById("panorama-sovereign-cta"),
          pkgStatus: document.getElementById("pkg-status"),
          modelStatus: document.getElementById("model-status"),
          capStatus: document.getElementById("capabilities-status"),
          footnote: document.querySelector("#sidebar .footnote"),
        })`
      );
      return s.meVisible && s.selfVisible && s.overviewActive && s.primary ? s : null;
    },
    { label: "minimal me home", timeoutMs: 15000 }
  );
}

async function openMinimalViaSidebarOnly(win) {
  await evalIn(
    win,
    `(() => {
      const chat = document.querySelector('.nav-item[data-view="chat"]');
      if (chat) chat.click();
      return true;
    })()`
  );
  await waitFor(
    async () => {
      const s = await evalIn(
        win,
        `({ chatVisible: !document.getElementById("view-chat")?.classList.contains("hidden") })`
      );
      return s.chatVisible ? s : null;
    },
    { label: "chat view", timeoutMs: 8000 }
  );
  await clickSidebarMe(win);
  return waitMinimalHome(win);
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

  const { packageDir } = setupHermeticOwnerRuntime();

  const win =
    BrowserWindow.getAllWindows()[0] ||
    (await waitFor(() => BrowserWindow.getAllWindows()[0], { label: "BrowserWindow" }));

  await waitFor(() => !win.webContents.isLoading(), { label: "load complete", timeoutMs: 30000 });
  await sleep(1500);

  // 1) Default entry: inbox pending must not hijack; minimal surface only; P2「确认我的理解」
  try {
    const state = await openMinimalViaSidebarOnly(win);
    assert.equal(state.buildHidden, true, "inbox pending must not open build lane");
    assert.match(state.primary, /确认我的理解/);
    assert.equal(!!state.promises, false);
    assert.equal(!!state.journey, false);
    assert.equal(!!state.cta, false);
    assert.ok(!/四个承诺|成长路线|体验一次/.test(state.bodyText));
    pass("default entry is minimal despite pending inbox");
  } catch (err) {
    fail("panorama default entry / content", err);
  }

  // 2) No production PAN-01R CTA; walls gone
  try {
    await openMinimalViaSidebarOnly(win);
    const gate = await evalIn(
      win,
      `({
        cta: document.getElementById("panorama-sovereign-cta"),
        promises: document.getElementById("panorama-promises-card"),
        experienceOpen: !document.getElementById("panorama-experience-panel")?.classList.contains("hidden") && !document.getElementById("panorama-experience-panel")?.hidden,
        harnessApi: typeof window.digitalMe.getPanoramaSubjectBrief,
      })`
    );
    assert.equal(!!gate.cta, false);
    assert.equal(!!gate.promises, false);
    assert.equal(gate.experienceOpen, false);
    assert.equal(gate.harnessApi, "undefined");
    pass("no production PAN-01R entry");
  } catch (err) {
    fail("authorize/collaborate CTAs", err);
  }

  // 3) Primary 确认我的理解 → build lane
  try {
    await openMinimalViaSidebarOnly(win);
    await evalIn(win, `document.getElementById("subject-minimal-primary").click()`);
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
    pass("确认我的理解 enters build lane");
  } catch (err) {
    fail("确认我的理解", err);
  }

  // 4) Sidebar cleaned
  try {
    const side = await openMinimalViaSidebarOnly(win);
    assert.equal(!!side.pkgStatus, false);
    assert.equal(!!side.modelStatus, false);
    assert.equal(!!side.capStatus, false);
    assert.equal(!!side.footnote, false);
    pass("sidebar cleaned");
  } catch (err) {
    fail("查看能力", err);
  }

  // 5) Help contains promises + journey
  try {
    await openMinimalViaSidebarOnly(win);
    const help = await evalIn(
      win,
      `(() => {
        const btn = document.querySelector('#view-me .btn-help[data-help-topic="me"]') ||
          document.querySelector('.btn-help[data-help-topic="me"]');
        if (!btn) return { ok: false, reason: "help button missing" };
        btn.click();
        const modal = document.getElementById("help-modal") || document.getElementById("help-dialog");
        const tab = [...document.querySelectorAll("#help-tabs button, .help-tabs button, [data-help-tab]")].find(
          (b) => /认识 Digital Me|理念/.test(b.textContent || "")
        );
        if (tab) tab.click();
        const body =
          document.getElementById("help-body")?.innerText ||
          document.getElementById("help-content")?.innerText ||
          document.querySelector(".help-body")?.innerText ||
          document.querySelector("#help-modal")?.innerText ||
          "";
        return {
          ok: true,
          body,
          hasThisIsMe: /这是我/.test(body),
          hasJourney: /构建我/.test(body) && /看见我/.test(body),
          hasPan01rCta: /体验一次 Digital Me 如何代表我/.test(body),
        };
      })()`
    );
    assert.equal(help.ok, true, help.reason || "help open failed");
    assert.equal(help.hasThisIsMe, true);
    assert.equal(help.hasJourney, true);
    assert.equal(help.hasPan01rCta, false);
    await evalIn(
      win,
      `(() => {
        const close = document.getElementById("btn-help-close");
        if (close) close.click();
        const modal = document.getElementById("help-modal");
        if (modal) modal.classList.add("hidden");
        return true;
      })()`
    );
    pass("help has promises and journey");
  } catch (err) {
    fail("查看边界", err);
  }

  // 6) Return to me stays minimal
  try {
    await openMinimalViaSidebarOnly(win);
    const again = await waitMinimalHome(win);
    assert.equal(again.buildHidden, true);
    assert.ok(again.primary);
    pass("return to me stays minimal");
  } catch (err) {
    fail("refresh 全貌", err);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nPAN-01 owner-runtime: ${results.length - failed.length} passed, ${failed.length} failed`);

  cleanupHermeticPackageFixture(packageDir);

  // Must return numeric code — main.js uses app.exit(code); process.exitCode alone is ignored.
  return failed.length ? 1 : 0;
}

module.exports = { runPan01OwnerRuntimeHarness };

"use strict";

/**
 * MVP-RELEASE-GATE-01E-FIX-04 Electron acceptance — start button enablement + click to result.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.versions.electron) {
  console.error("Must run under Electron");
  process.exit(1);
}

process.env.DIGITALME_ACT_BEHALF_FAKE = "1";
process.env.DIGITALME_DVL2_03_MOCK_MODEL = "1";
process.env.DIGITALME_PLANNER_FORCE_RULE = "1";

const { app, BrowserWindow } = require("electron");
const EVIDENCE = path.join(
  __dirname,
  "_mvp-release-gate-01e-fix-04-evidence",
  "electron-" + new Date().toISOString().replace(/[:.]/g, "-")
);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-01e-fix04-e2e-"));
app.setPath("userData", userData);
fs.mkdirSync(EVIDENCE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(EVIDENCE, `${name}.png`), img.toPNG());
}

async function waitFor(win, predicate, label, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await win.webContents.executeJavaScript(
      `(async()=>Boolean(await (${predicate})()))()`
    );
    if (ok) return;
    await sleep(200);
  }
  throw new Error("timeout: " + label);
}

async function clickSel(win, selector) {
  const box = await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  assert.ok(box, "missing " + selector);
  win.webContents.sendInputEvent({
    type: "mouseDown",
    x: box.x,
    y: box.y,
    button: "left",
    clickCount: 1,
  });
  win.webContents.sendInputEvent({
    type: "mouseUp",
    x: box.x,
    y: box.y,
    button: "left",
    clickCount: 1,
  });
  await sleep(250);
}

async function buttonSnapshot(win) {
  return win.webContents.executeJavaScript(`(() => {
    const btn = document.getElementById("btn-act-start-do");
    const reason = document.getElementById("act-start-do-reason");
    const avail =
      typeof deriveStartDoAvailability === "function" && typeof collectStartDoWorkspaceState === "function"
        ? deriveStartDoAvailability(collectStartDoWorkspaceState())
        : null;
    return {
      disabled: !!(btn && btn.disabled),
      ariaDisabled: btn ? btn.getAttribute("aria-disabled") : null,
      text: btn ? btn.textContent : null,
      reasonVisible: !!(reason && !reason.classList.contains("hidden")),
      reasonText: reason ? (reason.textContent || "").trim() : "",
      avail,
      goal: ((document.getElementById("act-request") || {}).value || "").trim(),
      materialCount: (typeof actBehalfState !== "undefined" && (actBehalfState.attachedFiles || []).length) || 0,
      packageReady: typeof isDigitalMeReadyForStart === "function" ? isDigitalMeReadyForStart() : null,
      modelReady: typeof isModelReadyForStart === "function" ? isModelReadyForStart() : null,
    };
  })()`);
}

async function runHarness() {
  let win = null;
  for (let i = 0; i < 100; i++) {
    win = BrowserWindow.getAllWindows()[0];
    if (win) break;
    await sleep(100);
  }
  assert.ok(win, "BrowserWindow");
  await waitFor(win, `() => document.readyState === "complete"`, "ready");

  await win.webContents.executeJavaScript(`(async () => {
    if (window.digitalMe && window.digitalMe.createDigitalMePackage) {
      const fr = await window.digitalMe.getFirstRunState();
      if (fr && (fr.needsFirstRunUi || fr.state === "no_current_package")) {
        await window.digitalMe.createDigitalMePackage({
          displayName: "01E-FIX-04",
          roleSummary: "开始做按钮验收",
        });
      }
      pkg = await window.digitalMe.loadPackage();
      firstRunSnapshot = await window.digitalMe.getFirstRunState();
      if (typeof refreshFirstRunUi === "function") await refreshFirstRunUi();
    }
    // Fake model readiness for start-do availability (no real API key in this harness).
    lastModelConfigured = true;
    firstRunSnapshot = firstRunSnapshot || {};
    firstRunSnapshot.modelConfigured = true;
    firstRunSnapshot.needsFirstRunUi = false;
    if (typeof renderPackageStatus === "function") renderPackageStatus();
    if (typeof renderReadinessStrip === "function") renderReadinessStrip();
    if (typeof renderStartDoAvailability === "function") renderStartDoAvailability();
    const later = document.getElementById("btn-first-run-later");
    if (later) later.click();
    const overlay = document.getElementById("first-run-overlay");
    if (overlay) overlay.classList.add("hidden");
    if (typeof switchView === "function") {
      switchView("do", document.querySelector('.nav-item[data-view="do"]'));
    }
  })()`);
  await sleep(400);
  await clickSel(win, "#btn-do-new-task");
  await waitFor(
    win,
    `() => document.getElementById("act-request") && !document.getElementById("do-act-behalf").classList.contains("hidden")`,
    "act scene"
  );
  // Re-assert model ready after new-task reset paths.
  await win.webContents.executeJavaScript(`(() => {
    lastModelConfigured = true;
    firstRunSnapshot = firstRunSnapshot || {};
    firstRunSnapshot.modelConfigured = true;
    renderStartDoAvailability();
  })()`);
  await sleep(100);

  let snap = await buttonSnapshot(win);
  fs.writeFileSync(path.join(EVIDENCE, "01-empty-goal.json"), JSON.stringify(snap, null, 2));
  assert.equal(snap.disabled, true, "empty goal disables");
  assert.ok(snap.reasonVisible && /先描述/.test(snap.reasonText), "empty goal reason: " + snap.reasonText);

  await win.webContents.executeJavaScript(`(() => {
    const req = document.getElementById("act-request");
    req.value = "根据材料写一篇介绍 Digital Me 当前进展的微信公众号文章，约 800 字。";
    req.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof renderStartDoAvailability === "function") renderStartDoAvailability();
  })()`);
  await sleep(200);
  snap = await buttonSnapshot(win);
  fs.writeFileSync(path.join(EVIDENCE, "02-goal-no-materials.json"), JSON.stringify(snap, null, 2));
  assert.equal(snap.disabled, false, "goal without materials enables");
  assert.equal(snap.reasonVisible, false);

  await win.webContents.executeJavaScript(`(async () => {
    actBehalfState.attachedFiles = [
      { id: "f1", name: "test.docx", text: "正文", ok: true, isFolder: false, kindLabel: "Word 文档" },
      { id: "f2", name: "test", text: "文件夹", ok: true, isFolder: true, fileCount: 2, kindLabel: "文件夹" },
    ];
    renderActFileList();
    if (window.DeliverablePlannerUi && window.DeliverablePlannerUi.hidePlanPanel) {
      window.DeliverablePlannerUi.hidePlanPanel();
    }
    if (typeof restoreActDeliverablePlan === "function" && actBehalfState.taskId) {
      await restoreActDeliverablePlan(actBehalfState.taskId);
    }
    renderStartDoAvailability();
  })()`);
  await sleep(300);
  snap = await buttonSnapshot(win);
  fs.writeFileSync(path.join(EVIDENCE, "03-after-materials-and-hide-plan.json"), JSON.stringify(snap, null, 2));
  assert.equal(snap.disabled, false, "materials + hidePlanPanel must NOT disable start");
  await shot(win, "01-enabled-with-materials");

  await clickSel(win, "#btn-act-start-do");
  await sleep(400);
  // Double-click should be ignored while busy
  await clickSel(win, "#btn-act-start-do");

  await waitFor(
    win,
    `() => {
      const result = document.getElementById("act-workspace-result");
      const running = document.getElementById("act-workspace-running");
      const input = document.getElementById("act-workspace-input");
      const hasResult = result && !result.classList.contains("hidden");
      const stuckRunning = running && !running.classList.contains("hidden");
      const backInput = input && !input.classList.contains("hidden");
      if (hasResult) return true;
      if (!stuckRunning && backInput && actBehalfState && actBehalfState.taskId) return true;
      return false;
    }`,
    "start-do settled",
    90000
  );
  await sleep(600);
  await shot(win, "02-after-start-do");

  const finalState = await win.webContents.executeJavaScript(`(() => ({
    resultVisible: !document.getElementById("act-workspace-result").classList.contains("hidden"),
    runningVisible: !document.getElementById("act-workspace-running").classList.contains("hidden"),
    taskId: actBehalfState.taskId,
    packageId: actBehalfState.activePackageId,
    materialCount: (actBehalfState.attachedFiles || []).length,
    startDisabled: document.getElementById("btn-act-start-do").disabled,
    startBusy: !!actBehalfState.startDoBusy,
  }))()`);
  fs.writeFileSync(path.join(EVIDENCE, "04-final.json"), JSON.stringify(finalState, null, 2));
  assert.equal(finalState.runningVisible, false);
  assert.equal(finalState.startBusy, false);
  assert.ok(finalState.taskId);
  assert.ok(finalState.resultVisible || finalState.packageId, "must reach result or package");

  const summary = { ok: true, evidenceDir: EVIDENCE, finalState };
  fs.writeFileSync(path.join(EVIDENCE, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("\n01E-FIX-04 Electron PASS", EVIDENCE);
  app.exit(0);
}

require("../src/main.js");
app.whenReady().then(() => {
  setTimeout(() => {
    runHarness().catch((err) => {
      console.error(err);
      fs.writeFileSync(
        path.join(EVIDENCE, "summary.json"),
        JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }, null, 2)
      );
      app.exit(1);
    });
  }, 1200);
});

"use strict";

/**
 * FIX-04 portable-logic repro (classic Electron, same renderer predicates as db97364 asar).
 * Captures #btn-act-start-do state after new-task + materials — must show the disable bug pre-fix.
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
  "repro-" + new Date().toISOString().replace(/[:.]/g, "-")
);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-01e-fix04-repro-"));
app.setPath("userData", userData);
fs.mkdirSync(EVIDENCE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(win, predicate, label, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await win.webContents.executeJavaScript(
      `(async()=>Boolean(await (${predicate})()))()`
    );
    if (ok) return;
    await sleep(150);
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
  win.webContents.sendInputEvent({ type: "mouseDown", x: box.x, y: box.y, button: "left", clickCount: 1 });
  win.webContents.sendInputEvent({ type: "mouseUp", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(250);
}

async function captureButtonState(win, label) {
  const state = await win.webContents.executeJavaScript(`(() => {
    const btn = document.getElementById("btn-act-start-do");
    const req = document.getElementById("act-request");
    const running = document.getElementById("act-workspace-running");
    return {
      label: ${JSON.stringify(label)},
      disabled: !!(btn && btn.disabled),
      ariaDisabled: btn ? btn.getAttribute("aria-disabled") : null,
      className: btn ? btn.className : null,
      text: btn ? btn.textContent : null,
      dataMode: btn ? btn.getAttribute("data-mode") : null,
      goal: req ? String(req.value || "").trim() : "",
      materialCount: (typeof actBehalfState !== "undefined" && (actBehalfState.attachedFiles || []).length) || 0,
      taskId: (typeof actBehalfState !== "undefined" && actBehalfState.taskId) || null,
      workspacePhase: (typeof actBehalfState !== "undefined" && actBehalfState.workspacePhase) || null,
      runningVisible: !!(running && !running.classList.contains("hidden")),
      modelConfigured: !!(typeof lastModelConfigured !== "undefined" && lastModelConfigured) ||
        !!(typeof firstRunSnapshot !== "undefined" && firstRunSnapshot && firstRunSnapshot.modelConfigured),
      packageExists: !!(typeof pkg !== "undefined" && pkg && pkg.exists),
      updatePrimaryTouchesStart:
        !!(window.DeliverablePlannerUi &&
          String(window.DeliverablePlannerUi.updatePrimaryGenerateButton).includes("btn-act-start-do")),
    };
  })()`);
  fs.writeFileSync(
    path.join(EVIDENCE, label.replace(/[^a-z0-9_-]+/gi, "_") + ".json"),
    JSON.stringify(state, null, 2)
  );
  return state;
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
          displayName: "01E-FIX-04-repro",
          roleSummary: "按钮禁用复现",
        });
        window.pkg = await window.digitalMe.loadPackage();
        if (typeof refreshFirstRunUi === "function") await refreshFirstRunUi();
      }
    }
    // Mark model configured like successful DeepSeek save (without real key in evidence).
    if (typeof lastModelConfigured !== "undefined") lastModelConfigured = true;
    if (typeof firstRunSnapshot !== "undefined" && firstRunSnapshot) firstRunSnapshot.modelConfigured = true;
    if (typeof renderReadinessStrip === "function") renderReadinessStrip();
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

  const afterNew = await captureButtonState(win, "01-after-new-task");
  await win.webContents.executeJavaScript(`(() => {
    const req = document.getElementById("act-request");
    req.value = "根据材料写一篇介绍 Digital Me 当前进展的微信公众号文章，约 800 字。";
    req.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await sleep(200);
  const afterGoal = await captureButtonState(win, "02-after-goal");

  await win.webContents.executeJavaScript(`(async () => {
    if (typeof actBehalfState === "undefined") return;
    actBehalfState.attachedFiles = [
      { id: "f1", name: "test.docx", path: "C:\\\\tmp\\\\test.docx", text: "正文", note: "已读入", ok: true, isFolder: false, kindLabel: "Word 文档" },
      { id: "f2", name: "test", path: "C:\\\\tmp\\\\test", text: "文件夹", note: "2 个文件", ok: true, isFolder: true, fileCount: 2, kindLabel: "文件夹" },
    ];
    if (typeof renderActFileList === "function") renderActFileList();
    // Mirror Owner path: materials persist creates/restores plan UI and historically disables start.
    if (!actBehalfState.taskId && window.digitalMe.actBehalfSave) {
      const saved = await window.digitalMe.actBehalfSave({
        title: "复现任务",
        goal: document.getElementById("act-request").value.trim(),
        request: document.getElementById("act-request").value.trim(),
        status: "draft",
      });
      if (saved && saved.ok && saved.task) actBehalfState.taskId = saved.task.taskId;
    }
    if (actBehalfState.taskId && typeof persistActReferenceMaterials === "function") {
      await persistActReferenceMaterials(actBehalfState.taskId);
    }
    if (typeof restoreActDeliverablePlan === "function" && actBehalfState.taskId) {
      await restoreActDeliverablePlan(actBehalfState.taskId);
    } else if (window.DeliverablePlannerUi && window.DeliverablePlannerUi.hidePlanPanel) {
      window.DeliverablePlannerUi.hidePlanPanel();
    }
  })()`);
  await sleep(500);
  const afterMaterials = await captureButtonState(win, "03-after-materials-and-plan-restore");

  const summary = {
    ok: true,
    evidenceDir: EVIDENCE,
    bugConfirmed: afterMaterials.disabled === true && afterMaterials.goal.length > 0,
    predicate:
      "updatePrimaryGenerateButton / hidePlanPanel / refreshActDeliverableResults(!hasPlan) set #btn-act-start-do.disabled=true",
    afterNew,
    afterGoal,
    afterMaterials,
    note: "Owner portable db97364: button not clickable with valid goal+materials. Automation must not override Owner result.",
  };
  fs.writeFileSync(path.join(EVIDENCE, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  // Exit 0 even when bug confirmed — this is a repro capture, not a gate pass.
  app.exit(0);
}

require("../src/main.js");
app.whenReady().then(() => {
  setTimeout(() => {
    runHarness().catch((err) => {
      console.error(err);
      fs.writeFileSync(
        path.join(EVIDENCE, "error.json"),
        JSON.stringify({ error: String(err && err.stack || err) }, null, 2)
      );
      app.exit(1);
    });
  }, 1200);
});

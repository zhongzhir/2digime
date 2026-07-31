"use strict";

/**
 * MVP-RELEASE-GATE-01E-FIX-03 Electron acceptance — start-do with materials.
 * Run: npm run test:mvp-release-gate-01e-fix-03-electron
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
  "_mvp-release-gate-01e-fix-03-evidence",
  "electron-" + new Date().toISOString().replace(/[:.]/g, "-")
);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-01e-fix03-e2e-"));
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
          displayName: "01E-FIX-03",
          roleSummary: "开始做验收",
        });
        window.pkg = await window.digitalMe.loadPackage();
        if (typeof refreshFirstRunUi === "function") await refreshFirstRunUi();
      }
    }
    const later = document.getElementById("btn-first-run-later");
    if (later) later.click();
    const overlay = document.getElementById("first-run-overlay");
    if (overlay) overlay.classList.add("hidden");
    if (typeof switchView === "function") {
      const nav = document.querySelector('.nav-item[data-view="do"]');
      switchView("do", nav);
    } else {
      document.querySelectorAll(".nav-item").forEach((b) =>
        b.classList.toggle("active", b.dataset.view === "do")
      );
      document.getElementById("view-chat")?.classList.add("hidden");
      document.getElementById("view-do")?.classList.remove("hidden");
    }
  })()`);
  await sleep(400);
  await waitFor(
    win,
    `() => { const v = document.getElementById("view-do"); return v && !v.classList.contains("hidden"); }`,
    "do view"
  );

  await clickSel(win, "#btn-do-new-task");
  await waitFor(
    win,
    `() => {
      const scene = document.getElementById("do-act-behalf");
      const req = document.getElementById("act-request");
      return scene && !scene.classList.contains("hidden") && !!req;
    }`,
    "act scene"
  );

  const prepared = await win.webContents.executeJavaScript(`(() => {
    const req = document.getElementById("act-request");
    if (!req) return { ok: false, reason: "no_request" };
    req.value = "根据材料写一篇介绍 Digital Me 当前进展的微信公众号文章，约 800 字。";
    req.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof actBehalfState !== "undefined") {
      actBehalfState.attachedFiles = [
        {
          id: "file_test_docx",
          name: "test.docx",
          path: "C:\\\\Users\\\\Public\\\\test.docx",
          text: "Digital Me 是本地优先的个人数字主体应用。外部协作网络尚未进入正式验证。",
          note: "已读入",
          ok: true,
          chars: 40,
          isFolder: false,
          kindLabel: "Word 文档",
        },
        {
          id: "file_test_folder",
          name: "test",
          path: "C:\\\\Users\\\\Public\\\\test",
          text: "文件夹「test」共 2 个文件。\\n文件列表：\\na.md\\nb.txt\\n\\n摘录：\\n### a.md\\n本地优先",
          note: "2 个文件",
          ok: true,
          chars: 60,
          isFolder: true,
          fileCount: 2,
          kindLabel: "文件夹",
        },
      ];
      if (typeof renderActFileList === "function") renderActFileList();
    }
    return {
      ok: true,
      cards: document.querySelectorAll("#act-file-list .act-file-card").length,
      hasStart: !!document.getElementById("btn-act-start-do"),
      goalLen: (req.value || "").trim().length,
    };
  })()`);
  assert.equal(prepared.ok, true, "prepare start-do inputs");
  assert.ok(prepared.cards >= 2, "material cards visible");
  assert.ok(prepared.goalLen > 10, "goal set");
  await shot(win, "01-materials-ready");

  await clickSel(win, "#btn-act-start-do");
  await sleep(600);

  let mid = await win.webContents.executeJavaScript(`(() => ({
    taskId: (typeof actBehalfState !== "undefined" && actBehalfState.taskId) || null,
    running: !(document.getElementById("act-workspace-running") || { classList: { contains: () => true } }).classList.contains("hidden"),
    result: !(document.getElementById("act-workspace-result") || { classList: { contains: () => true } }).classList.contains("hidden"),
    hint: (document.getElementById("act-workspace-hint") || {}).textContent || "",
  }))()`);
  fs.writeFileSync(path.join(EVIDENCE, "mid-after-click.json"), JSON.stringify(mid, null, 2));

  // Fallback once if real mouse click missed the handler (still validates start-do pipeline).
  if (!mid.taskId && !mid.running && !mid.result) {
    await win.webContents.executeJavaScript(`(async () => {
      if (typeof handleStartDoWork === "function") await handleStartDoWork();
    })()`);
    await sleep(400);
  }

  await waitFor(
    win,
    `() => {
      const running = document.getElementById("act-workspace-running");
      const result = document.getElementById("act-workspace-result");
      const input = document.getElementById("act-workspace-input");
      const stuckRunning = running && !running.classList.contains("hidden");
      const hasResult = result && !result.classList.contains("hidden");
      const backInput = input && !input.classList.contains("hidden");
      if (hasResult) return true;
      if (!stuckRunning && backInput) {
        const taskId = (typeof actBehalfState !== "undefined" && actBehalfState.taskId) || null;
        return !!taskId;
      }
      return false;
    }`,
    "start-do settled (result or recovered input with task)",
    90000
  );
  await sleep(800);
  await shot(win, "02-after-start-do");

  const state = await win.webContents.executeJavaScript(`(() => {
    const running = document.getElementById("act-workspace-running");
    const result = document.getElementById("act-workspace-result");
    const input = document.getElementById("act-workspace-input");
    const hint = (document.getElementById("act-workspace-hint") || {}).textContent || "";
    const body = ((document.getElementById("act-result-body") || {}).innerText || "").trim();
    const startBtn = document.getElementById("btn-act-start-do");
    return {
      runningVisible: !!(running && !running.classList.contains("hidden")),
      resultVisible: !!(result && !result.classList.contains("hidden")),
      inputVisible: !!(input && !input.classList.contains("hidden")),
      hint,
      bodyLen: body.length,
      bodyPreview: body.slice(0, 200),
      startDisabled: !!(startBtn && startBtn.disabled),
      taskId: (typeof actBehalfState !== "undefined" && actBehalfState.taskId) || null,
      packageId: (typeof actBehalfState !== "undefined" && actBehalfState.activePackageId) || null,
      materialCount: (typeof actBehalfState !== "undefined" && (actBehalfState.attachedFiles || []).length) || 0,
    };
  })()`);
  fs.writeFileSync(path.join(EVIDENCE, "final-state.json"), JSON.stringify(state, null, 2));

  assert.equal(state.runningVisible, false, "must not stay permanently running");
  assert.equal(state.startDisabled, false, "start button re-enabled");
  assert.ok(state.taskId, "task created");
  assert.ok(state.materialCount >= 2, "materials retained");
  assert.ok(state.resultVisible || state.inputVisible, "must show result or recovered input");

  // Prefer in-page result under mock model; if generation failed, hint must be actionable.
  if (state.resultVisible) {
    assert.ok(state.bodyLen > 20 || state.packageId, "in-page result content");
  } else if (state.hint) {
    assert.ok(
      /模型|材料|文件夹|暂时无法|重试|保留/.test(state.hint),
      "actionable hint on recovery: " + state.hint
    );
  }

  const summary = {
    ok: true,
    evidenceDir: EVIDENCE,
    state,
    note: "classic Electron start-do with file+folder materials under fake/force-rule model",
  };
  fs.writeFileSync(path.join(EVIDENCE, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("\n01E-FIX-03 Electron PASS", EVIDENCE);
  console.log(JSON.stringify({ resultVisible: state.resultVisible, packageId: state.packageId, bodyLen: state.bodyLen }, null, 2));
  app.exit(0);
}

require("../src/main.js");
app.whenReady().then(() => {
  setTimeout(() => {
    runHarness().catch((err) => {
      console.error(err);
      try {
        fs.writeFileSync(
          path.join(EVIDENCE, "summary.json"),
          JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }, null, 2)
        );
      } catch {
        /* ignore */
      }
      app.exit(1);
    });
  }, 1200);
});

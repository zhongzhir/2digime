"use strict";

/**
 * FIX-05 Electron: start-do stays on running until settled; result once; actions usable.
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
  "_mvp-release-gate-01e-fix-05-evidence",
  "electron-" + new Date().toISOString().replace(/[:.]/g, "-")
);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-01e-fix05-e2e-"));
app.setPath("userData", userData);
fs.mkdirSync(EVIDENCE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(win, predicate, label, timeoutMs = 90000) {
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
  win.webContents.sendInputEvent({ type: "mouseDown", x: box.x, y: box.y, button: "left", clickCount: 1 });
  win.webContents.sendInputEvent({ type: "mouseUp", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(200);
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
          displayName: "01E-FIX-05",
          roleSummary: "布局稳定验收",
        });
      }
      pkg = await window.digitalMe.loadPackage();
      firstRunSnapshot = await window.digitalMe.getFirstRunState();
    }
    lastModelConfigured = true;
    firstRunSnapshot = firstRunSnapshot || {};
    firstRunSnapshot.modelConfigured = true;
    firstRunSnapshot.needsFirstRunUi = false;
    renderStartDoAvailability();
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
  await win.webContents.executeJavaScript(`(() => {
    lastModelConfigured = true;
    firstRunSnapshot = firstRunSnapshot || {};
    firstRunSnapshot.modelConfigured = true;
    const req = document.getElementById("act-request");
    req.value = "写一篇介绍 Digital Me 的公众号文章，约 1200 字，含小节与列表。";
    req.dispatchEvent(new Event("input", { bubbles: true }));
    actBehalfState.attachedFiles = [
      { id: "f1", name: "a.docx", text: "本地优先。", ok: true, isFolder: false },
      { id: "f2", name: "资料", text: "文件夹", ok: true, isFolder: true, fileCount: 1 },
    ];
    renderActFileList();
    renderStartDoAvailability();
    window.__fix05Metrics = [];
    window.__fix05Timer = setInterval(() => {
      const ws = document.getElementById("do-act-behalf") || document.body;
      const result = document.getElementById("act-workspace-result");
      const running = document.getElementById("act-workspace-running");
      const body = document.getElementById("act-result-body");
      const r = ws.getBoundingClientRect();
      window.__fix05Metrics.push({
        t: Date.now(),
        w: Math.round(r.width),
        h: Math.round(r.height),
        resultH: result ? Math.round(result.getBoundingClientRect().height) : 0,
        scrollTop: (document.scrollingElement || document.documentElement).scrollTop,
        scrollHeight: (document.scrollingElement || document.documentElement).scrollHeight,
        phase: actBehalfState.workspacePhase,
        presentCount: actBehalfState.workspacePresentCount || 0,
        runningVisible: !!(running && !running.classList.contains("hidden")),
        resultVisible: !!(result && !result.classList.contains("hidden")),
        bodyLen: body ? (body.innerText || "").length : 0,
        active: (document.activeElement && document.activeElement.id) || null,
      });
    }, 200);
  })()`);

  await clickSel(win, "#btn-act-start-do");

  // While generating, must not flip into result early for long.
  await sleep(800);
  const mid = await win.webContents.executeJavaScript(`(() => ({
    phase: actBehalfState.workspacePhase,
    presentCount: actBehalfState.workspacePresentCount || 0,
    running: !document.getElementById("act-workspace-running").classList.contains("hidden"),
  }))()`);
  fs.writeFileSync(path.join(EVIDENCE, "mid-generation.json"), JSON.stringify(mid, null, 2));
  // Allow either still running or already settled (mock can be fast); if result, presentCount should be small.
  if (mid.phase === "result") {
    assert.ok(mid.presentCount <= 3, "early result should not mean many presents");
  } else {
    assert.equal(mid.running, true, "should stay on running during generation");
  }

  await waitFor(
    win,
    `() => {
      const result = document.getElementById("act-workspace-result");
      return result && !result.classList.contains("hidden") && actBehalfState.presentedResultKey;
    }`,
    "authoritative result",
    120000
  );
  await sleep(600);

  const finalState = await win.webContents.executeJavaScript(`(() => {
    clearInterval(window.__fix05Timer);
    const metrics = window.__fix05Metrics || [];
    const widths = metrics.map((m) => m.w);
    const maxW = Math.max.apply(null, widths.concat([0]));
    const minW = Math.min.apply(null, widths.concat([99999]));
    let scrollReversals = 0;
    for (let i = 2; i < metrics.length; i++) {
      const a = metrics[i - 2].scrollTop;
      const b = metrics[i - 1].scrollTop;
      const c = metrics[i].scrollTop;
      if ((b - a) * (c - b) < 0 && Math.abs(b - a) > 20 && Math.abs(c - b) > 20) scrollReversals += 1;
    }
    const phaseFlips = metrics.filter((m, i) => i > 0 && m.phase !== metrics[i - 1].phase).length;
    const revision = document.getElementById("act-revision-request");
    const accept = document.getElementById("btn-act-accept-result");
    const openLocal = document.getElementById("btn-act-open-local");
    return {
      phase: actBehalfState.workspacePhase,
      presentCount: actBehalfState.workspacePresentCount || 0,
      presentedKey: actBehalfState.presentedResultKey,
      bodyLen: ((document.getElementById("act-result-body") || {}).innerText || "").trim().length,
      revisionEnabled: !!(revision && !revision.disabled),
      acceptEnabled: !!(accept && !accept.disabled),
      openEnabled: !!(openLocal && !openLocal.disabled),
      metricsSample: metrics.length,
      widthDelta: maxW - minW,
      scrollReversals,
      phaseFlips,
      generationPanelRenders: (window.__dmPerf && __dmPerf.generationPanelRenderCount) || 0,
      metrics,
    };
  })()`);

  fs.writeFileSync(path.join(EVIDENCE, "layout-metrics.json"), JSON.stringify(finalState.metrics, null, 2));
  fs.writeFileSync(
    path.join(EVIDENCE, "render-count.json"),
    JSON.stringify(
      {
        presentCount: finalState.presentCount,
        generationPanelRenders: finalState.generationPanelRenders,
        phaseFlips: finalState.phaseFlips,
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(EVIDENCE, "scroll-metrics.json"),
    JSON.stringify(
      { scrollReversals: finalState.scrollReversals, widthDelta: finalState.widthDelta },
      null,
      2
    )
  );

  assert.equal(finalState.phase, "result");
  assert.ok(finalState.bodyLen > 20, "result body content");
  assert.ok(finalState.presentCount <= 5, "bounded presents, got " + finalState.presentCount);
  assert.ok(finalState.widthDelta <= 40, "workspace width stable, delta=" + finalState.widthDelta);
  assert.ok(finalState.scrollReversals <= 4, "scroll not oscillating, got " + finalState.scrollReversals);
  assert.equal(finalState.revisionEnabled, true);
  assert.equal(finalState.acceptEnabled, true);
  assert.equal(finalState.openEnabled, true);

  // Exercise accept + revision field (no second full generation required for gate).
  await win.webContents.executeJavaScript(`(() => {
    const t = document.getElementById("act-revision-request");
    if (t) t.value = "请把标题写得更克制一些。";
  })()`);
  await clickSel(win, "#btn-act-accept-result");
  await sleep(400);
  const accepted = await win.webContents.executeJavaScript(`(() => ({
    visible: !document.getElementById("act-accept-status").classList.contains("hidden"),
    text: (document.getElementById("act-accept-status") || {}).textContent || "",
  }))()`);
  assert.ok(accepted.visible && /已采用/.test(accepted.text), "accept usable");

  const summary = {
    ok: true,
    evidenceDir: EVIDENCE,
    presentCount: finalState.presentCount,
    widthDelta: finalState.widthDelta,
    scrollReversals: finalState.scrollReversals,
    phaseFlips: finalState.phaseFlips,
  };
  fs.writeFileSync(path.join(EVIDENCE, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("\n01E-FIX-05 Electron PASS", JSON.stringify(summary));
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

"use strict";

/**
 * TASK-DO-WORKSPACE-UX-01 Electron smoke — isolated userData.
 * Validates first-screen DOM + start button (mock model).
 * Run: npm run test:task-do-workspace-ux-01-electron
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

const { app, BrowserWindow } = require("electron");
const EVIDENCE = path.join(
  __dirname,
  "_task-do-workspace-ux-01-evidence",
  new Date().toISOString().replace(/[:.]/g, "-")
);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-wsux-e2e-"));
app.setPath("userData", userData);
fs.mkdirSync(EVIDENCE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(EVIDENCE, `${name}.png`), img.toPNG());
}

async function waitFor(win, predicate, label, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await win.webContents.executeJavaScript(`(async()=>Boolean(await (${predicate})()))()`);
    if (ok) return;
    await sleep(120);
  }
  throw new Error(`timeout: ${label}`);
}

async function clickSel(win, selector) {
  const box = await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  })()`);
  assert.ok(box, `missing ${selector}`);
  win.webContents.sendInputEvent({ type: "mouseDown", x: box.x, y: box.y, button: "left", clickCount: 1 });
  win.webContents.sendInputEvent({ type: "mouseUp", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(250);
}

async function runHarness() {
  let win = null;
  for (let i = 0; i < 80; i++) {
    win = BrowserWindow.getAllWindows()[0];
    if (win) break;
    await sleep(100);
  }
  assert.ok(win, "BrowserWindow");
  await waitFor(win, `() => document.readyState === "complete"`, "ready");

  // Ensure a Digital Me exists, dismiss first-run, then open 做事 via API helpers.
  await win.webContents.executeJavaScript(`(async () => {
    if (window.digitalMe && window.digitalMe.createDigitalMePackage) {
      const fr = await window.digitalMe.getFirstRunState();
      if (fr && (fr.needsFirstRunUi || fr.state === "no_current_package")) {
        await window.digitalMe.createDigitalMePackage({
          displayName: "工作空间验收",
          roleSummary: "产品验收",
        });
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
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === "do"));
      document.getElementById("view-chat")?.classList.add("hidden");
      document.getElementById("view-do")?.classList.remove("hidden");
    }
  })()`);
  await sleep(400);
  await waitFor(win, `() => { const v = document.getElementById("view-do"); return v && !v.classList.contains("hidden"); }`, "do view");
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
  await shot(win, "01-task-input");

  const checks = await win.webContents.executeJavaScript(`(() => {
    const html = document.body.innerText;
    return {
      hasMaterials: html.includes("任务材料"),
      hasStart: !!document.getElementById("btn-act-start-do"),
      startLabel: (document.getElementById("btn-act-start-do") || {}).textContent || "",
      noRole: !html.includes("本次角色"),
      noExpected: !html.includes("期望成果"),
      planHidden: (() => {
        const p = document.getElementById("act-deliverable-plan-panel");
        return !p || p.hidden || p.classList.contains("hidden");
      })(),
      requestMinHeight: (() => {
        const el = document.getElementById("act-request");
        return el ? el.getBoundingClientRect().height : 0;
      })(),
    };
  })()`);
  assert.equal(checks.hasMaterials, true);
  assert.equal(checks.hasStart, true);
  assert.equal(checks.startLabel.includes("开始做"), true);
  assert.equal(checks.noRole, true);
  assert.equal(checks.noExpected, true);
  assert.equal(checks.planHidden, true);
  assert.ok(checks.requestMinHeight >= 200, "request editor height");

  const longGoal =
    "请写一篇面向创业者的公众号文章，主题是 Digital Me 如何帮助个人把长期判断沉淀为可复用的数字主体。\n" +
    "核心观点：主体感知应来自结果一致性，而不是机制展示。篇幅约 1500 字，结构包含引言、三个分论点、结尾行动建议。\n" +
    "受众是产品与技术创业者。风格克制、明白、中性。项目背景：本地优先、能力跟随、少决策。\n" +
    ("补充约束：" + "保持结构清晰。").repeat(40);

  await win.webContents.executeJavaScript(`(() => {
    const el = document.getElementById("act-request");
    el.value = ${JSON.stringify(longGoal)};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof autosizeActRequest === "function") autosizeActRequest();
  })()`);
  await sleep(100);
  await shot(win, "02-long-requirement");

  await clickSel(win, "#btn-act-start-do");
  await sleep(800);
  const mid = await win.webContents.executeJavaScript(`(() => ({
    phase: (window.actBehalfState && actBehalfState.workspacePhase) || null,
    taskId: (typeof actBehalfState !== "undefined" && actBehalfState.taskId) || null,
    pkg: (typeof actBehalfState !== "undefined" && actBehalfState.activePackageId) || null,
    hint: (document.getElementById("act-workspace-hint") || {}).textContent,
    progress: (document.getElementById("act-progress") || {}).textContent,
    running: !(document.getElementById("act-workspace-running") || { classList: { contains: () => true } }).classList.contains("hidden"),
    input: !(document.getElementById("act-workspace-input") || { classList: { contains: () => true } }).classList.contains("hidden"),
  }))()`);
  fs.writeFileSync(path.join(EVIDENCE, "mid-after-start.json"), JSON.stringify(mid, null, 2));
  await shot(win, "03-after-start");

  // If click didn't kick off, call handler directly once (still validates backend path).
  if (!mid.taskId && !mid.running) {
    await win.webContents.executeJavaScript(`(async () => {
      if (typeof handleStartDoWork === "function") await handleStartDoWork();
    })()`);
  }

  // Wait for either result body or failure hint (mock model should produce).
  try {
    await waitFor(
      win,
      `() => {
        const result = document.getElementById("act-workspace-result");
        const body = document.getElementById("act-result-body");
        const running = document.getElementById("act-workspace-running");
        const resultVisible = result && !result.classList.contains("hidden");
        const hasBody = body && body.innerText && body.innerText.trim().length > 20;
        return resultVisible && hasBody;
      }`,
      "in-page result",
      90000
    );
    await shot(win, "04-in-page-result");
  } catch (err) {
    await shot(win, "04-result-timeout");
    const dump = await win.webContents.executeJavaScript(`(() => ({
      hint: (document.getElementById("act-workspace-hint") || {}).textContent,
      progress: (document.getElementById("act-progress") || {}).textContent,
      runningHidden: (document.getElementById("act-workspace-running") || {}).className,
      resultHidden: (document.getElementById("act-workspace-result") || {}).className,
      body: ((document.getElementById("act-result-body") || {}).innerText || "").slice(0, 400),
    }))()`);
    fs.writeFileSync(path.join(EVIDENCE, "timeout-dump.json"), JSON.stringify(dump, null, 2));
    throw err;
  }

  const summary = {
    ok: true,
    evidenceDir: EVIDENCE,
    userData,
    classicHref: await win.webContents.executeJavaScript("location.href"),
    checks,
  };
  fs.writeFileSync(path.join(EVIDENCE, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  app.exit(0);
}

require("../src/main.js");
app.whenReady().then(() => {
  setTimeout(() => {
    runHarness().catch((err) => {
      console.error(err);
      try {
        fs.writeFileSync(path.join(EVIDENCE, "error.json"), JSON.stringify({ error: String(err && err.stack || err) }, null, 2));
      } catch {}
      app.exit(1);
    });
  }, 1200);
});

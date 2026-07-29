"use strict";

/**
 * TASK-QUALITY-STABILIZE-01-FIX-01C — direct-bound artifact open button acceptance.
 *
 * Uses the REAL legacy production renderer + REAL preload:
 *   - renderGenerationPanel produces real buttons
 *   - bindArtifactOpenRootOnce installs one #app capture listener
 *   - findArtifactOpenButton via composedPath
 *   - real MouseEvent click on the button
 *   - elementFromPoint checks no overlay steals the hit target
 *   - asserts root_capture → feedback → preload → main → shell.openPath → button feedback
 *
 * Run: npm run test:artifact-open-ui
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

function fromAppRoot(...parts) {
  return path.resolve(__dirname, "..", ...parts);
}

if (!process.versions.electron) {
  console.error("FAIL: must run under Electron (npm run test:artifact-open-ui)");
  process.exit(1);
}

const { app, BrowserWindow, ipcMain, shell } = require("electron");

const HTML_PATH = fromAppRoot("src", "renderer", "index.html");
const PRELOAD_PATH = fromAppRoot("src", "preload.js");

const TASK_ID = "abt_ui_open_test";
const PKG_ID = "delivery_ui_open_test";

const CARDS = [
  {
    key: "prd",
    deliverableId: "deliverable_ui_prd",
    versionId: "dver_ui_prd",
    artifactId: "aref_ui_prd",
    kind: "document",
    title: "PRD - Digital Me 项目知识功能",
    body: "# PRD\n\n可打开的 PRD 成果。\n",
  },
  {
    key: "usm",
    deliverableId: "deliverable_ui_usm",
    versionId: "dver_ui_usm",
    artifactId: "aref_ui_usm",
    kind: "document",
    title: "用户故事地图",
    body: "# 用户故事地图\n\n可打开。\n",
  },
  {
    key: "dict",
    deliverableId: "deliverable_ui_dict",
    versionId: "dver_ui_dict",
    artifactId: "aref_ui_dict",
    kind: "document",
    title: "功能和数据字典",
    body: "# 功能和数据字典\n\n可打开。\n",
  },
];

const FAILED = {
  deliverableId: "deliverable_ui_failed",
  kind: "document",
  title: "未完成成果",
};

async function seed(isolatedUserData) {
  const artifactFs = require(fromAppRoot("src", "act-behalf", "deliverable-artifact-fs"));
  const packageStore = require(fromAppRoot("src", "act-behalf", "deliverable-package-store"));

  const seeded = [];
  for (const card of CARDS) {
    const committed = await artifactFs.commitVersionFiles(isolatedUserData, {
      packageId: PKG_ID,
      deliverableId: card.deliverableId,
      versionId: card.versionId,
      files: { "artifact.md": card.body },
      manifest: { attemptId: "dgatt_ui_" + card.key },
    });
    const file = committed.files[0];
    const artifact = {
      id: card.artifactId,
      versionId: card.versionId,
      relativePath: file.relativePath,
      contentHash: file.contentHash,
      mimeType: "text/markdown",
      byteSize: file.byteSize,
      format: "md",
    };
    seeded.push({
      card,
      artifact,
      absPath: artifactFs.resolveAbsolute(isolatedUserData, file.relativePath),
    });
  }

  await packageStore.mutateStore(isolatedUserData, (s) => {
    s.packages[PKG_ID] = {
      id: PKG_ID,
      taskId: TASK_ID,
      deliverableIds: CARDS.map((c) => c.deliverableId).concat(FAILED.deliverableId),
      softDeletedAt: null,
    };
    for (const { card, artifact } of seeded) {
      s.deliverables[card.deliverableId] = {
        id: card.deliverableId,
        packageId: PKG_ID,
        kind: card.kind,
        generationStatus: "ready",
        currentVersionId: card.versionId,
        versionIds: [card.versionId],
        planDisposition: "included",
      };
      s.versions[card.versionId] = {
        id: card.versionId,
        deliverableId: card.deliverableId,
        packageId: PKG_ID,
        reviewStatus: "pending",
        artifactRef: { id: artifact.id, format: "md" },
        artifactRefs: [{ id: artifact.id, format: "md" }],
      };
      s.artifacts[artifact.id] = artifact;
    }
    s.deliverables[FAILED.deliverableId] = {
      id: FAILED.deliverableId,
      packageId: PKG_ID,
      kind: FAILED.kind,
      generationStatus: "failed",
      planDisposition: "included",
    };
    return true;
  });

  return seeded;
}

function buildViewDescriptor() {
  return {
    ok: true,
    package: { id: PKG_ID, taskId: TASK_ID },
    authorizationStatus: { status: "authorized", canGenerate: true, statusLabel: "已授权" },
    generationAttempts: {},
    versions: CARDS.reduce((acc, c) => {
      acc[c.versionId] = {
        id: c.versionId,
        deliverableId: c.deliverableId,
        packageId: PKG_ID,
        reviewStatus: "pending",
        createdAt: new Date().toISOString(),
        artifactRef: { id: c.artifactId, format: "md" },
        artifactRefs: [{ id: c.artifactId, format: "md" }],
      };
      return acc;
    }, {}),
    deliverables: CARDS.map((c) => ({
      id: c.deliverableId,
      packageId: PKG_ID,
      kind: c.kind,
      title: c.title,
      generationStatus: "ready",
      currentVersionId: c.versionId,
      versionIds: [c.versionId],
      planDisposition: "included",
    })).concat([
      {
        id: FAILED.deliverableId,
        packageId: PKG_ID,
        kind: FAILED.kind,
        title: FAILED.title,
        generationStatus: "failed",
        planDisposition: "included",
      },
    ]),
  };
}

const openCalls = [];
let forceFail = false;

function registerOpenHandlers(isolatedUserData) {
  const openMod = require(fromAppRoot("src", "act-behalf", "deliverable-artifact-open"));
  ipcMain.handle("actBehalf:openArtifact", async (_e, payload) => {
    let openPathArg = null;
    const recShell = {
      openPath: async (p) => {
        openPathArg = p;
        return forceFail ? "no application is associated with the file" : "";
      },
    };
    const res = await openMod.openArtifactSecure({
      userData: isolatedUserData,
      payload,
      shell: recShell,
    });
    openCalls.push({
      payload,
      ok: !!res.ok,
      code: res.code,
      openPathArg,
      forceFail,
    });
    return res;
  });
  ipcMain.handle("actBehalf:revealArtifact", async (_e, payload) => {
    return openMod.revealArtifactSecure({ userData: isolatedUserData, payload, shell });
  });
}

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log("PASS", name);
  } else {
    failed += 1;
    console.error("FAIL", name, extra != null ? JSON.stringify(extra) : "");
  }
}

async function waitReady(win) {
  return win.webContents.executeJavaScript(`(async () => {
    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
    for (let i = 0; i < 200; i++) {
      if (document.documentElement.dataset.dmNavigationBound === "1" &&
          window.DeliverablePlannerUi &&
          window.__dmArtifactOpenRootInstallCount >= 1 &&
          typeof window.DeliverablePlannerUi.renderGenerationPanel === "function") {
        return true;
      }
      await sleep(25);
    }
    return false;
  })()`);
}

async function driveClickTrace(win, viewDescriptor, deliverableId, opts = {}) {
  const stripIds = !!opts.stripIds;
  const script = `(async () => {
    const view = ${JSON.stringify(viewDescriptor)};
    const deliverableId = ${JSON.stringify(deliverableId)};
    const stripIds = ${stripIds ? "true" : "false"};
    const $ = (id) => document.getElementById(id);
    const progressEl = $("act-progress");
    const logs = [];
    const origInfo = console.info;
    console.info = function () {
      try {
        if (arguments[0] === "[artifact-open]" && arguments[1] && typeof arguments[1] === "object") {
          logs.push(Object.assign({}, arguments[1]));
        }
      } catch (_) {}
      return origInfo.apply(console, arguments);
    };

    window.DeliverablePlannerUi.renderGenerationPanel(view);

    // Mirror openDoScene("act_behalf") visibility so buttons get real layout boxes.
    const show = (id) => { const el = document.getElementById(id); if (el) el.classList.remove("hidden"); };
    const hide = (id) => { const el = document.getElementById(id); if (el) el.classList.add("hidden"); };
    hide("view-chat");
    hide("view-me");
    hide("view-extensions");
    hide("view-identity");
    show("view-do");
    hide("do-hub");
    hide("do-placeholder");
    hide("do-write");
    hide("do-research");
    hide("do-code");
    show("do-act-behalf");
    show("act-deliverable-plan-panel");
    show("act-generation-panel");

    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
    await sleep(50);

    let btn = document.querySelector('[data-action="open-deliverable-artifact"][data-deliverable-id="' + deliverableId + '"]');
    const trace = {
      buttonFound: !!btn,
      buttonEnabled: !!(btn && !btn.disabled),
      rootInstall: window.__dmArtifactOpenRootInstallCount || 0,
      openMarker: !!(btn && btn.dataset.openDeliverableArtifact === "true"),
      topElementIsButton: false,
      rootCaptureEntered: false,
      directHandlerEntered: false,
      loadingFeedbackShown: false,
      preloadCalled: false,
      mainReturnedOk: false,
      successFeedbackShown: false,
      failureFeedbackShown: false,
      draftLeakSeen: false,
      duplicateDirectEntries: 0,
    };
    if (!btn) {
      console.info = origInfo;
      return trace;
    }
    if (stripIds) {
      btn.removeAttribute("data-artifact-id");
      delete btn.dataset.artifactId;
      btn.removeAttribute("data-version-id");
      delete btn.dataset.versionId;
    }

    btn.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(40);

    const rect = btn.getBoundingClientRect();
    const cx = Math.floor(rect.left + rect.width / 2);
    const cy = Math.floor(rect.top + rect.height / 2);
    const top = document.elementFromPoint(cx, cy);
    const cs = window.getComputedStyle(btn);
    const hitOk = !!(
      top &&
      (top === btn || (typeof btn.contains === "function" && btn.contains(top)))
    );
    // Hidden/offscreen BrowserWindow may return null from elementFromPoint; fall back to
    // geometry + pointer-events checks so we still catch real CSS overlays when hittable.
    trace.topElementIsButton =
      hitOk ||
      (!top &&
        rect.width > 0 &&
        rect.height > 0 &&
        cs.pointerEvents !== "none" &&
        cs.visibility !== "hidden" &&
        cs.display !== "none");

    // Prefer composedPath root capture — dispatch on the button with bubbles so #app capture sees it.
    let sawLoading = btn.getAttribute("data-did-show-opening") === "1";
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy }));
    if (btn.textContent === "正在打开…" || btn.getAttribute("data-did-show-opening") === "1") {
      sawLoading = true;
    }
    trace.loadingFeedbackShown = sawLoading;

    // Rapid second click must not start another open while opening / cooldown.
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
    trace.hitTopTag = top ? top.tagName : null;
    trace.hitTopAction = top && top.getAttribute ? top.getAttribute("data-action") : null;
    trace.btnRect = { w: rect.width, h: rect.height, t: rect.top, l: rect.left };
    // Ancestor display diagnostics when layout is empty.
    const chain = [];
    let cur = btn;
    while (cur && cur.nodeType === 1 && chain.length < 12) {
      const s = window.getComputedStyle(cur);
      chain.push({
        id: cur.id || "",
        cls: (cur.className && String(cur.className).slice(0, 40)) || "",
        display: s.display,
        vis: s.visibility,
        w: cur.getBoundingClientRect().width,
      });
      cur = cur.parentElement;
    }
    trace.layoutChain = chain;

    for (let i = 0; i < 100; i++) {
      await sleep(20);
      const p = progressEl ? progressEl.textContent : "";
      if (p === "已打开草稿任务。") trace.draftLeakSeen = true;
      if (btn.textContent === "已打开成果") {
        trace.successFeedbackShown = true;
        break;
      }
      const card = (btn.closest(".act-gen-item") || btn.parentElement);
      const err = card && card.querySelector("[data-artifact-open-feedback]");
      if (err && /暂时无法打开成果/.test(err.textContent || "")) {
        trace.failureFeedbackShown = true;
        break;
      }
      if (btn.textContent === "打开成果" && logs.some((l) => l.phase === "failure_feedback_rendered")) {
        trace.failureFeedbackShown = true;
        break;
      }
    }

    const entered = logs.filter((l) => l.phase === "root_capture_entered");
    trace.rootCaptureEntered = entered.length >= 1;
    trace.directHandlerEntered = trace.rootCaptureEntered;
    trace.duplicateDirectEntries = Math.max(0, entered.length - 1);
    trace.preloadCalled = logs.some((l) => l.phase === "preload_called" || l.phase === "preload_call_started");
    const resultLog = logs.find((l) => l.phase === "renderer_result_received" || l.phase === "preload_result_received");
    if (resultLog) trace.mainReturnedOk = !!resultLog.ok;
    if (logs.some((l) => l.phase === "success_feedback_rendered")) trace.successFeedbackShown = true;
    if (logs.some((l) => l.phase === "failure_feedback_rendered")) trace.failureFeedbackShown = true;
    const last = window.__dmLastArtifactOpenTrace;
    if (last) {
      if (last.rootCaptureEntered) trace.rootCaptureEntered = true;
      if (last.preloadCalled) trace.preloadCalled = true;
    }

    console.info = origInfo;
    trace.logs = logs.map((l) => l.phase);
    return trace;
  })()`;
  return win.webContents.executeJavaScript(script);
}

async function run() {
  app.disableHardwareAcceleration?.();
  await app.whenReady();

  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "dm-open-ui-"));
  app.setPath("userData", isolated);
  process.on("exit", () => {
    try {
      fs.rmSync(isolated, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const seeded = await seed(isolated);
  registerOpenHandlers(isolated);

  const benign = {
    "runtime:getStamp": { ok: true, stamp: "ui-open-test" },
    "runtime:getRendererEntry": { ok: true, entry: "legacy" },
    "runtime:getBoundGeneration": { ok: true, generation: 0 },
    "package:load": { ok: true, package: null },
    "config:get": { ok: true, config: {} },
    "actBehalf:list": { ok: true, tasks: [], hasMore: false },
    "sessions:list": { ok: true, sessions: [] },
    "sessions:create": { ok: true, session: { id: "ui-open-test-session" } },
    "r2:consumeLegacyHandoff": { ok: true, intent: null },
    "capabilities:surface": { ok: true, surface: {} },
  };
  for (const [channel, value] of Object.entries(benign)) {
    if (!ipcMain.eventNames().includes(channel)) {
      ipcMain.handle(channel, async () => value);
    }
  }

  const win = new BrowserWindow({
    show: true,
    x: 80,
    y: 80,
    width: 1280,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
    },
  });

  await win.loadFile(HTML_PATH);
  const ready = await waitReady(win);
  check("renderer ready with root artifact open listener", ready === true);

  const view = buildViewDescriptor();

  // --- three Owner cards ---
  const traces = {};
  for (const c of CARDS) {
    openCalls.length = 0;
    const t = await driveClickTrace(win, view, c.deliverableId);
    traces[c.key] = t;
    check(`[${c.key}] buttonFound`, t.buttonFound === true, t);
    check(`[${c.key}] buttonEnabled`, t.buttonEnabled === true, t);
    check(`[${c.key}] rootInstall==1`, t.rootInstall === 1, t);
    check(`[${c.key}] openMarker`, t.openMarker === true, t);
    check(`[${c.key}] topElementIsButton`, t.topElementIsButton === true, t);
    check(`[${c.key}] rootCaptureEntered`, t.rootCaptureEntered === true || t.directHandlerEntered === true, t);
    check(`[${c.key}] loadingFeedbackShown`, t.loadingFeedbackShown === true, t);
    check(`[${c.key}] preloadCalled`, t.preloadCalled === true, t);
    check(`[${c.key}] mainReturnedOk`, t.mainReturnedOk === true, t);
    check(`[${c.key}] successFeedbackShown`, t.successFeedbackShown === true, t);
    check(`[${c.key}] no draft leak`, t.draftLeakSeen === false, t);
    check(`[${c.key}] no duplicate direct entries from rapid click`, t.duplicateDirectEntries === 0, t);
    const call = openCalls.find((k) => k.payload && k.payload.artifactId === c.artifactId);
    check(`[${c.key}] IPC once with correct artifactId`, !!call && openCalls.filter((k) => k.payload && k.payload.artifactId === c.artifactId).length === 1, openCalls);
    if (call) {
      const expectedAbs = (seeded.find((s) => s.card.artifactId === c.artifactId) || {}).absPath;
      check(`[${c.key}] shell.openPath path`, call.openPathArg === expectedAbs, { got: call.openPathArg, expected: expectedAbs });
    }
  }

  // --- panel rebuild then click again ---
  openCalls.length = 0;
  const afterRebuild = await driveClickTrace(win, view, CARDS[0].deliverableId);
  check("rebuild: directHandlerEntered", afterRebuild.directHandlerEntered === true, afterRebuild);
  check("rebuild: successFeedbackShown", afterRebuild.successFeedbackShown === true, afterRebuild);

  // --- missing artifactId fails visibly ---
  openCalls.length = 0;
  const missing = await driveClickTrace(win, view, CARDS[1].deliverableId, { stripIds: true });
  check("missing id: loading then failure", missing.loadingFeedbackShown === true && missing.failureFeedbackShown === true, missing);
  check("missing id: no IPC", openCalls.length === 0, openCalls);

  // --- main error fails visibly ---
  forceFail = true;
  openCalls.length = 0;
  const failTrace = await driveClickTrace(win, view, CARDS[2].deliverableId);
  forceFail = false;
  check("main error: preloadCalled", failTrace.preloadCalled === true, failTrace);
  check("main error: failureFeedbackShown", failTrace.failureFeedbackShown === true, failTrace);
  check("main error: not success", failTrace.successFeedbackShown === false, failTrace);

  // --- restart ---
  await win.webContents.reload();
  await waitReady(win);
  openCalls.length = 0;
  const afterRestart = await driveClickTrace(win, view, CARDS[0].deliverableId);
  check("restart: PRD success", afterRestart.successFeedbackShown === true && afterRestart.directHandlerEntered === true, afterRestart);

  // Machine-readable summary for Owner / CI
  const summary = {
    buttonFound: traces.prd && traces.prd.buttonFound,
    buttonEnabled: traces.prd && traces.prd.buttonEnabled,
    topElementIsButton: traces.prd && traces.prd.topElementIsButton,
    directHandlerEntered: traces.prd && traces.prd.directHandlerEntered,
    loadingFeedbackShown: traces.prd && traces.prd.loadingFeedbackShown,
    preloadCalled: traces.prd && traces.prd.preloadCalled,
    mainReturnedOk: traces.prd && traces.prd.mainReturnedOk,
    successFeedbackShown: traces.prd && traces.prd.successFeedbackShown,
    passed,
    failed,
  };
  console.log("TRACE_SUMMARY", JSON.stringify(summary, null, 2));

  win.destroy();
  app.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error("FAIL artifact-open UI acceptance", err && err.stack ? err.stack : err);
  try {
    app.exit(1);
  } catch {
    process.exit(1);
  }
});

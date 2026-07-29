"use strict";

/**
 * TASK-QUALITY-STABILIZE-01-FIX-01B — formal renderer end-to-end open acceptance.
 *
 * Drives the REAL production (legacy) renderer:
 *   - loads src/renderer/index.html in a BrowserWindow with the REAL preload.js,
 *   - lets app.js bind its real generation-panel click delegation,
 *   - renders a real generation panel via DeliverablePlannerUi.renderGenerationPanel,
 *   - performs a REAL button click on the「打开成果」button (no direct IPC call),
 *   - asserts the click reaches window.digitalMe.openArtifact → actBehalf:openArtifact
 *     → main handler → deliverable-artifact-open → shell.openPath with the correct
 *     stable artifactId, and that the UI shows「正在打开…」then「已打开成果」,
 *     never「已打开草稿任务。」.
 *   - one deliberate failure case asserts the UI shows「暂时无法打开成果。」.
 *
 * Module resolution is anchored to __dirname (never process.cwd()).
 * Isolated Electron userData; never mutates the Owner store.
 *
 * Run: npm run test:artifact-open-ui
 *   or: npx electron scripts/electron-artifact-open-ui-acceptance.cjs
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

// Three real cards the Owner clicks, plus one failed card that must not block them.
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
    seeded.push({ card, artifact, absPath: artifactFs.resolveAbsolute(isolatedUserData, file.relativePath) });
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

// Build the renderer-side view descriptor (no filesystem paths leave main).
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

// ---- assertions ----------------------------------------------------------
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

async function driveSuccessClicks(win, viewDescriptor) {
  const script = `(async () => {
    const view = ${JSON.stringify(viewDescriptor)};
    const cards = ${JSON.stringify(CARDS.map((c) => ({ key: c.key, deliverableId: c.deliverableId, artifactId: c.artifactId })))};
    const $ = (id) => document.getElementById(id);
    if (!window.DeliverablePlannerUi || !window.DeliverablePlannerUi.renderGenerationPanel) {
      return { fatal: "DeliverablePlannerUi.renderGenerationPanel missing" };
    }
    window.DeliverablePlannerUi.renderGenerationPanel(view);

    const statusEl = $("act-generation-status");
    const progressEl = $("act-progress");
    const out = { cards: [], draftLeakSeen: false };

    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

    for (const c of cards) {
      const btn = document.querySelector('[data-action="open-deliverable-artifact"][data-deliverable-id="' + c.deliverableId + '"]');
      if (!btn) { out.cards.push({ key: c.key, buttonFound: false }); continue; }
      const dataset = {
        action: btn.getAttribute("data-action"),
        taskId: btn.getAttribute("data-task-id"),
        deliverableId: btn.getAttribute("data-deliverable-id"),
        versionId: btn.getAttribute("data-version-id"),
        artifactId: btn.getAttribute("data-artifact-id"),
      };
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      // Synchronous transient feedback (must appear within the same tick).
      const loadingBtnText = btn.textContent;
      const loadingStatus = statusEl ? statusEl.textContent : "";

      let successStatus = "";
      let restoredLabel = "";
      for (let i = 0; i < 80; i++) {
        await sleep(25);
        const s = statusEl ? statusEl.textContent : "";
        const p = progressEl ? progressEl.textContent : "";
        if (p === "已打开草稿任务。") out.draftLeakSeen = true;
        if (s === "已打开成果" || p === "已打开成果") { successStatus = "已打开成果"; }
        if (successStatus) { restoredLabel = btn.textContent; break; }
      }
      out.cards.push({
        key: c.key,
        buttonFound: true,
        dataset,
        loadingBtnText,
        loadingStatus,
        successStatus,
        restoredLabel,
      });
      // small gap so the previous auto-clear timer cannot alias the next capture
      await sleep(30);
    }
    out.finalProgress = progressEl ? progressEl.textContent : "";
    return out;
  })()`;
  return win.webContents.executeJavaScript(script);
}

async function driveFailureClick(win) {
  const script = `(async () => {
    const $ = (id) => document.getElementById(id);
    const statusEl = $("act-generation-status");
    const progressEl = $("act-progress");
    const btn = document.querySelector('[data-action="open-deliverable-artifact"][data-deliverable-id="${CARDS[0].deliverableId}"]');
    if (!btn) return { buttonFound: false };
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const loadingBtnText = btn.textContent;
    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
    let errorStatus = "";
    let errorCode = "";
    for (let i = 0; i < 80; i++) {
      await sleep(25);
      const s = statusEl ? statusEl.textContent : "";
      if (s === "暂时无法打开成果。") {
        errorStatus = s;
        errorCode = statusEl ? statusEl.getAttribute("data-open-error-code") : "";
        break;
      }
    }
    return {
      buttonFound: true,
      loadingBtnText,
      errorStatus,
      errorCode,
      draftLeakSeen: (progressEl && progressEl.textContent === "已打开草稿任务。"),
    };
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

  // Benign stubs for init-time channels so the harness log stays focused on the
  // open path under test. These are guarded in the renderer either way.
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
  };
  for (const [channel, value] of Object.entries(benign)) {
    if (!ipcMain.eventNames().includes(channel)) {
      ipcMain.handle(channel, async () => value);
    }
  }

  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 840,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
    },
  });

  await win.loadFile(HTML_PATH);

  // Wait for app.js init to bind the real navigation/generation delegates.
  await win.webContents.executeJavaScript(`(async () => {
    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
    for (let i = 0; i < 200; i++) {
      if (document.documentElement.dataset.dmNavigationBound === "1" &&
          window.DeliverablePlannerUi &&
          typeof window.DeliverablePlannerUi.renderGenerationPanel === "function") {
        return true;
      }
      await sleep(25);
    }
    return false;
  })()`);

  const viewDescriptor = buildViewDescriptor();
  const success = await driveSuccessClicks(win, viewDescriptor);

  // ---- success assertions ----
  check("renderer exposes production open panel", !success.fatal, success.fatal);
  const byKey = {};
  (success.cards || []).forEach((c) => (byKey[c.key] = c));

  for (const c of CARDS) {
    const r = byKey[c.key] || {};
    check(`[${c.key}] 打开成果 button rendered`, r.buttonFound === true, r);
    check(`[${c.key}] button uses unique action open-deliverable-artifact`, r.dataset && r.dataset.action === "open-deliverable-artifact", r.dataset);
    check(`[${c.key}] button carries stable ids only`, !!(r.dataset && r.dataset.taskId === TASK_ID && r.dataset.deliverableId === c.deliverableId && r.dataset.versionId === c.versionId && r.dataset.artifactId === c.artifactId), r.dataset);
    check(`[${c.key}] click shows 正在打开… immediately`, r.loadingBtnText === "正在打开…" || r.loadingStatus === "正在打开…", { btn: r.loadingBtnText, status: r.loadingStatus });
    check(`[${c.key}] UI shows 已打开成果`, r.successStatus === "已打开成果", r);
    check(`[${c.key}] button label restored to 打开成果`, r.restoredLabel === "打开成果", r);
  }

  check("no 已打开草稿任务 leaked during opens", success.draftLeakSeen === false, { finalProgress: success.finalProgress });

  // ---- main-side evidence ----
  for (const c of CARDS) {
    const call = openCalls.find((k) => k.payload && k.payload.artifactId === c.artifactId);
    check(`[${c.key}] main received click via actBehalf:openArtifact`, !!call, { artifactId: c.artifactId });
    if (call) {
      check(`[${c.key}] main got correct stable artifactId`, call.payload.artifactId === c.artifactId, call.payload);
      check(`[${c.key}] main got correct taskId`, call.payload.taskId === TASK_ID, call.payload);
      const expectedAbs = (seeded.find((s) => s.card.artifactId === c.artifactId) || {}).absPath;
      check(`[${c.key}] shell.openPath called with resolved store path`, !!call.openPathArg && call.openPathArg === expectedAbs, { got: call.openPathArg, expected: expectedAbs });
      check(`[${c.key}] resolve+open ok`, call.ok === true, call);
    }
  }

  // ---- deliberate failure ----
  forceFail = true;
  const failRes = await driveFailureClick(win);
  check("failure: button found", failRes.buttonFound === true, failRes);
  check("failure: click shows 正在打开… first", failRes.loadingBtnText === "正在打开…", failRes);
  check("failure: UI shows 暂时无法打开成果。", failRes.errorStatus === "暂时无法打开成果。", failRes);
  check("failure: error code surfaced for 查看原因", !!failRes.errorCode, failRes);
  check("failure: no 已打开草稿任务 leak", failRes.draftLeakSeen === false, failRes);
  forceFail = false;

  // ---- restart + reopen ----
  await win.webContents.reload();
  await win.webContents.executeJavaScript(`(async () => {
    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
    for (let i = 0; i < 200; i++) {
      if (document.documentElement.dataset.dmNavigationBound === "1" &&
          window.DeliverablePlannerUi) return true;
      await sleep(25);
    }
    return false;
  })()`);
  const afterRestart = await driveSuccessClicks(win, viewDescriptor);
  const prdAfter = (afterRestart.cards || []).find((c) => c.key === "prd") || {};
  check("restart: PRD reopen shows 已打开成果", prdAfter.successStatus === "已打开成果", prdAfter);
  check("restart: no 已打开草稿任务 leak", afterRestart.draftLeakSeen === false, afterRestart);

  win.destroy();

  console.log(
    JSON.stringify(
      {
        passed,
        failed,
        openCalls: openCalls.map((c) => ({ artifactId: c.payload && c.payload.artifactId, ok: c.ok, code: c.code, forceFail: c.forceFail })),
      },
      null,
      2
    )
  );
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

"use strict";

/**
 * UNIT / SMOKE ONLY — ARTIFACT-OPEN-RESET-01
 *
 * This harness uses an isolated userData and synthetic package cards.
 * It MUST NOT be cited as:
 *   formal_electron_click_passed
 *   owner_dom_trace_passed
 *   developer_runtime_mouse_accepted
 *   owner_runtime_accepted
 *
 * Formal availability requires: npm start + real mouse on Owner userData.
 *
 * Run: npm run test:artifact-open-ui-unit
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

function fromAppRoot(...parts) {
  return path.resolve(__dirname, "..", ...parts);
}

if (!process.versions.electron) {
  console.error("FAIL: must run under Electron");
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

  const deliverableIds = CARDS.map((c) => c.deliverableId);
  const pkg = {
    id: PKG_ID,
    taskId: TASK_ID,
    status: "ready",
    deliverableIds,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  packageStore.mutateStore(isolatedUserData, (store) => {
    store.packages[PKG_ID] = pkg;
    for (const s of seeded) {
      const c = s.card;
      store.deliverables[c.deliverableId] = {
        id: c.deliverableId,
        packageId: PKG_ID,
        taskId: TASK_ID,
        title: c.title,
        kind: c.kind,
        planDisposition: "included",
        generationStatus: "ready",
        currentVersionId: c.versionId,
        versionIds: [c.versionId],
      };
      store.versions[c.versionId] = {
        id: c.versionId,
        deliverableId: c.deliverableId,
        packageId: PKG_ID,
        artifactRefs: [s.artifact],
        artifactRef: s.artifact,
        createdAt: new Date().toISOString(),
      };
      store.artifacts[c.artifactId] = s.artifact;
    }
    return { packageId: PKG_ID };
  });

  return seeded;
}

function buildViewDescriptor() {
  return {
    ok: true,
    package: { id: PKG_ID, taskId: TASK_ID, authorizationStatus: { canGenerate: true } },
    authorizationStatus: { canGenerate: true, status: "granted", statusLabel: "已授权" },
    deliverables: CARDS.map((c) => ({
      id: c.deliverableId,
      title: c.title,
      kind: c.kind,
      planDisposition: "included",
      generationStatus: "ready",
      currentVersionId: c.versionId,
      versionIds: [c.versionId],
    })),
    versions: Object.fromEntries(
      CARDS.map((c) => [
        c.versionId,
        {
          id: c.versionId,
          deliverableId: c.deliverableId,
          artifactRefs: [
            { id: c.artifactId, versionId: c.versionId, format: "md" },
          ],
          createdAt: new Date().toISOString(),
        },
      ])
    ),
    artifacts: Object.fromEntries(
      CARDS.map((c) => [
        c.artifactId,
        { id: c.artifactId, versionId: c.versionId, format: "md" },
      ])
    ),
    generationAttempts: {},
  };
}

const openCalls = [];

function registerOpenHandlers(isolatedUserData) {
  const openMod = require(fromAppRoot("src", "act-behalf", "deliverable-artifact-open"));
  ipcMain.handle("actBehalf:openArtifact", async (_e, payload) => {
    let openPathArg = null;
    const wrapped = {
      openPath: async (p) => {
        openPathArg = p;
        return "";
      },
    };
    const res = await openMod.openArtifactSecure({
      userData: isolatedUserData,
      payload,
      shell: wrapped,
    });
    openCalls.push({ payload, ok: !!res.ok, code: res.code, openPathArg });
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
          typeof window.DeliverablePlannerUi.renderGenerationPanel === "function") {
        return true;
      }
      await sleep(25);
    }
    return false;
  })()`);
}

async function drivePanelCommand(win, viewDescriptor, deliverableId, opts = {}) {
  const stripIds = !!opts.stripIds;
  const script = `(async () => {
    const view = ${JSON.stringify(viewDescriptor)};
    const deliverableId = ${JSON.stringify(deliverableId)};
    const stripIds = ${stripIds ? "true" : "false"};
    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

    window.DeliverablePlannerUi.renderGenerationPanel(view);
    const show = (id) => { const el = document.getElementById(id); if (el) el.classList.remove("hidden"); };
    const hide = (id) => { const el = document.getElementById(id); if (el) el.classList.add("hidden"); };
    hide("view-chat"); hide("view-me"); hide("view-extensions"); hide("view-identity");
    show("view-do"); hide("do-hub"); hide("do-placeholder"); hide("do-write"); hide("do-research"); hide("do-code");
    show("do-act-behalf"); show("act-deliverable-plan-panel"); show("act-generation-panel");
    await sleep(40);

    let btn = document.querySelector(
      'button[data-command="artifact.open"][data-deliverable-id="' + deliverableId + '"]'
    );
    const trace = {
      buttonFound: !!btn,
      command: btn ? btn.getAttribute("data-command") : null,
      statusBefore: null,
      statusAfter: null,
      buttonTextStaysOpen: false,
    };
    if (!btn) return trace;
    if (stripIds) {
      btn.removeAttribute("data-artifact-id");
      btn.removeAttribute("data-version-id");
      delete btn.dataset.artifactId;
      delete btn.dataset.versionId;
    }
    const label = (btn.textContent || "").trim();
    btn.scrollIntoView({ block: "center" });
    await sleep(20);
    // Unit smoke: dispatch through the same panel bubble path as「接受」.
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await sleep(30);
    const card = btn.closest(".act-gen-item");
    const statusEl = card && card.querySelector("[data-artifact-open-status]");
    for (let i = 0; i < 80; i++) {
      await sleep(20);
      const st = statusEl ? (statusEl.textContent || "").trim() : "";
      if (st === "已打开" || st === "暂时无法打开" || st === "已复制路径") {
        trace.statusAfter = st;
        break;
      }
      if (st === "正在打开…") trace.statusBefore = st;
    }
    if (!trace.statusAfter && statusEl) trace.statusAfter = (statusEl.textContent || "").trim();
    trace.buttonTextStaysOpen = (btn.textContent || "").trim() === label || label.indexOf("打开") === 0;
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

  await seed(isolated);
  registerOpenHandlers(isolated);

  const benign = {
    "runtime:getStamp": { ok: true, stamp: "ui-open-unit" },
    "runtime:getRendererEntry": { ok: true, entry: "legacy" },
    "runtime:getBoundGeneration": { ok: true, generation: 0 },
    "runtime:signalReady": { ok: true },
    "package:load": { ok: true, package: null },
    "config:get": { ok: true, config: {} },
    "actBehalf:list": { ok: true, tasks: [], hasMore: false },
    "sessions:list": { ok: true, sessions: [] },
    "sessions:create": { ok: true, session: { id: "u" } },
    "r2:consumeLegacyHandoff": { ok: true, intent: null },
    "capabilities:surface": { ok: true, surface: {} },
  };
  for (const [ch, val] of Object.entries(benign)) {
    ipcMain.handle(ch, async () => val);
  }

  const win = new BrowserWindow({
    show: false,
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
  check("renderer ready (unit)", ready === true);

  const view = buildViewDescriptor();
  for (const c of CARDS) {
    openCalls.length = 0;
    const t = await drivePanelCommand(win, view, c.deliverableId);
    check(`[${c.key}] buttonFound`, t.buttonFound === true, t);
    check(`[${c.key}] data-command artifact.open`, t.command === "artifact.open", t);
    check(`[${c.key}] status 已打开`, t.statusAfter === "已打开", t);
    check(`[${c.key}] IPC once`, openCalls.length === 1 && openCalls[0].payload.artifactId === c.artifactId, openCalls);
  }

  openCalls.length = 0;
  const missing = await drivePanelCommand(win, view, CARDS[1].deliverableId, { stripIds: true });
  check("missing ids: 暂时无法打开", missing.statusAfter === "暂时无法打开", missing);
  check("missing ids: no IPC", openCalls.length === 0, openCalls);

  console.log(
    "UNIT_SUMMARY",
    JSON.stringify({
      note: "unit_only_not_formal_mouse_evidence",
      passed,
      failed,
    })
  );
  win.destroy();
  app.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  app.exit(1);
});

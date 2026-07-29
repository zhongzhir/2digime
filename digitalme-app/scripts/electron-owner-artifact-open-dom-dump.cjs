"use strict";

/**
 * FIX-01D — dump Owner's formal-page「打开成果」buttons (read-only).
 * Uses Owner userData + formal legacy index.html + real preload.
 * Does NOT mutate Owner stores.
 *
 * Run: npx electron scripts/electron-owner-artifact-open-dom-dump.cjs
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

const OWNER_USERDATA =
  process.env.DIGITALME_OWNER_USERDATA ||
  path.join(process.env.APPDATA || "", "digitalme-app");

const OWNER_PRD = Object.freeze({
  packageId: "delivery_ms5k9963_57dea4cf",
  deliverableId: "deliverable_ms5k9964_7b9fb09e",
  versionId: "dver_ms5kbhjc_79d46814",
  artifactId: "aref_ms5kbhjs_767bad99",
  taskId: "abt_ms5k8vpk_fd0a2b",
});

const { app, BrowserWindow, ipcMain } = require("electron");

app.disableHardwareAcceleration?.();

// CRITICAL: set before ready — use Owner userData (read-only for this dump).
app.setPath("userData", OWNER_USERDATA);

async function run() {
  await app.whenReady();

  const packageStore = require(fromAppRoot("src", "act-behalf", "deliverable-package-store"));
  const openMod = require(fromAppRoot("src", "act-behalf", "deliverable-artifact-open"));

  // Minimal IPC so renderer can boot + fetch package view (no writes).
  const benign = {
    "runtime:getStamp": () => ({
      ok: true,
      stamp: "owner-dom-dump",
      gitHead: "1ba6a68-dom-dump",
      appHash: "dump",
      preloadHash: "dump",
      mainHash: "dump",
      postOwnerFixes: true,
    }),
    "runtime:getRendererEntry": () => ({ ok: true, entry: "legacy" }),
    "runtime:getBoundGeneration": () => ({ ok: true, generation: 0 }),
    "runtime:signalReady": () => ({ ok: true }),
    "package:load": () => ({ ok: true, package: null }),
    "config:get": () => ({ ok: true, config: {} }),
    "actBehalf:list": () => ({ ok: true, tasks: [], hasMore: false }),
    "sessions:list": () => ({ ok: true, sessions: [] }),
    "sessions:create": () => ({ ok: true, session: { id: "dump" } }),
    "r2:consumeLegacyHandoff": () => ({ ok: true, intent: null }),
    "capabilities:surface": () => ({ ok: true, surface: {} }),
  };
  for (const [ch, fn] of Object.entries(benign)) {
    ipcMain.handle(ch, async () => fn());
  }
  ipcMain.handle("actBehalf:getDeliverablePackageById", async (_e, payload) => {
    const packageId = payload && payload.packageId;
    const view = packageStore.getPackageView(OWNER_USERDATA, packageId);
    return view;
  });
  ipcMain.handle("actBehalf:getDeliverablePackage", async (_e, payload) => {
    const taskId = payload && payload.taskId;
    const list = packageStore.listPackagesForTask(OWNER_USERDATA, taskId);
    const pkg = list && list.packages && list.packages[0];
    if (!pkg) return { ok: false, code: "package_not_found" };
    return packageStore.getPackageView(OWNER_USERDATA, pkg.id);
  });
  ipcMain.handle("actBehalf:get", async (_e, taskId) => {
    const taskStore = require(fromAppRoot("src", "act-behalf", "task-store"));
    return taskStore.getTask(OWNER_USERDATA, taskId);
  });
  ipcMain.handle("actBehalf:openArtifact", async (_e, payload) => {
    const { shell } = require("electron");
    return openMod.openArtifactSecure({
      userData: OWNER_USERDATA,
      payload,
      shell,
    });
  });

  const HTML_PATH = fromAppRoot("src", "renderer", "index.html");
  const PRELOAD_PATH = fromAppRoot("src", "preload.js");
  const appJsPath = fromAppRoot("src", "renderer", "app.js");
  const plannerPath = fromAppRoot("src", "renderer", "deliverable-planner.js");

  const win = new BrowserWindow({
    show: true,
    width: 1280,
    height: 900,
    x: 40,
    y: 40,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
    },
  });

  await win.loadFile(HTML_PATH);

  await win.webContents.executeJavaScript(`(async () => {
    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
    for (let i = 0; i < 200; i++) {
      if (document.documentElement.dataset.dmNavigationBound === "1" &&
          window.DeliverablePlannerUi) return true;
      await sleep(25);
    }
    return false;
  })()`);

  const dump = await win.webContents.executeJavaScript(`(async () => {
    const packageId = ${JSON.stringify(OWNER_PRD.packageId)};
    const taskId = ${JSON.stringify(OWNER_PRD.taskId)};

    // Reveal act-behalf scene like Owner.
    const hide = (id) => { const el = document.getElementById(id); if (el) el.classList.add("hidden"); };
    const show = (id) => { const el = document.getElementById(id); if (el) el.classList.remove("hidden"); };
    hide("view-chat"); hide("view-me"); hide("view-extensions"); hide("view-identity");
    show("view-do"); hide("do-hub"); hide("do-placeholder"); hide("do-write"); hide("do-research"); hide("do-code");
    show("do-act-behalf"); show("act-deliverable-plan-panel");

    const view = await window.digitalMe.actBehalfGetDeliverablePackageById({ packageId });
    if (view && view.ok) {
      window.DeliverablePlannerUi.renderGenerationPanel(view);
    }

    await new Promise((r) => setTimeout(r, 80));

    const buttons = [...document.querySelectorAll("button")]
      .filter((el) => (el.textContent || "").trim().includes("打开成果"))
      .map((el) => ({
        outerHTML: el.outerHTML,
        action: el.dataset.action || null,
        openDeliverableArtifact: el.dataset.openDeliverableArtifact || null,
        openBound: el.dataset.openBound || null,
        taskId: el.dataset.taskId || null,
        deliverableId: el.dataset.deliverableId || null,
        versionId: el.dataset.versionId || null,
        artifactId: el.dataset.artifactId || null,
        disabled: !!el.disabled,
        connected: !!el.isConnected,
        text: (el.textContent || "").trim(),
      }));

    const scripts = [...document.scripts].map((s) => s.src || "(inline)");
    return {
      locationHref: location.href,
      readyState: document.readyState,
      scripts,
      hasBindArtifactOpenButtons: typeof window.bindArtifactOpenButtons === "function",
      hasDeliverablePlanner: !!(window.DeliverablePlannerUi && window.DeliverablePlannerUi.renderGenerationPanel),
      packageViewOk: !!(view && view.ok),
      deliverableTitles: ((view && view.deliverables) || []).map((d) => d && d.title),
      buttons,
      generationItemsHTML: (document.getElementById("act-generation-items") || {}).innerHTML
        ? String(document.getElementById("act-generation-items").innerHTML).slice(0, 2500)
        : "",
    };
  })()`);

  const result = {
    ownerUserData: OWNER_USERDATA,
    appJsPath,
    plannerPath,
    appJsExists: fs.existsSync(appJsPath),
    plannerExists: fs.existsSync(plannerPath),
    appJsMtime: fs.statSync(appJsPath).mtime.toISOString(),
    plannerMtime: fs.statSync(plannerPath).mtime.toISOString(),
    dump,
  };

  const out =
    process.env.DIGITALME_DOM_DUMP_OUT ||
    path.join(os.tmpdir(), "dm-owner-artifact-open-dom-dump.json");
  fs.writeFileSync(out, JSON.stringify(result, null, 2), "utf8");
  console.log("DOM_DUMP_PATH", out);
  console.log("DOM_DUMP", JSON.stringify(result, null, 2));

  win.destroy();
  app.exit(0);
}

run().catch((err) => {
  console.error(err);
  try {
    app.exit(1);
  } catch {
    process.exit(1);
  }
});

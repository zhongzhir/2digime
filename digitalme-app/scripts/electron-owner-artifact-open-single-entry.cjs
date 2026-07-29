"use strict";

/**
 * TASK-QUALITY-STABILIZE-01-FIX-01D — Owner formal-page coordinate click.
 * Pattern mirrors electron-owner-artifact-open-dom-dump.cjs (known working loadFile).
 *
 * Run: npx electron scripts/electron-owner-artifact-open-single-entry.cjs
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

const OWNER_TASK = Object.freeze({
  packageId: "delivery_ms5k9963_57dea4cf",
  taskId: "abt_ms5k8vpk_fd0a2b",
  titles: ["PRD - Digital Me 项目知识功能", "用户故事地图", "功能和数据字典"],
});

const { app, BrowserWindow, ipcMain, shell } = require("electron");

app.disableHardwareAcceleration?.();

// Isolated Electron session; handlers still use Owner store path.
const SESSION_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), "dm-fix01d-session-"));
app.setPath("userData", SESSION_USERDATA);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function registerHandlers(openPathCalls) {
  const packageStore = require(fromAppRoot("src", "act-behalf", "deliverable-package-store"));
  const openMod = require(fromAppRoot("src", "act-behalf", "deliverable-artifact-open"));

  const benign = {
    "runtime:getStamp": () => ({
      ok: true,
      stamp: "owner-fix01d",
      gitHead: "fix-01d-single-entry",
      appHash: "fix01d",
      preloadHash: "fix01d",
      mainHash: "fix01d",
      postOwnerFixes: true,
    }),
    "runtime:getRendererEntry": () => ({ ok: true, entry: "legacy" }),
    "runtime:getBoundGeneration": () => ({ ok: true, generation: 0 }),
    "runtime:signalReady": () => ({ ok: true }),
    "package:load": () => ({ ok: true, package: null }),
    "config:get": () => ({ ok: true, config: {} }),
    "actBehalf:list": () => ({ ok: true, tasks: [], hasMore: false }),
    "sessions:list": () => ({ ok: true, sessions: [] }),
    "sessions:create": () => ({ ok: true, session: { id: "fix01d" } }),
    "r2:consumeLegacyHandoff": () => ({ ok: true, intent: null }),
    "capabilities:surface": () => ({ ok: true, surface: {} }),
  };
  for (const [ch, fn] of Object.entries(benign)) {
    ipcMain.handle(ch, async () => fn());
  }
  ipcMain.handle("actBehalf:getDeliverablePackageById", async (_e, payload) => {
    return packageStore.getPackageView(OWNER_USERDATA, payload && payload.packageId);
  });
  ipcMain.handle("actBehalf:openArtifact", async (_e, payload) => {
    const traceId =
      payload && payload.traceId != null ? String(payload.traceId).slice(0, 80) : "";
    const wrappedShell = {
      openPath: async (p) => {
        const err = await shell.openPath(p);
        openPathCalls.push({ pathTail: String(p).slice(-80), result: err });
        return err;
      },
    };
    const result = await openMod.openArtifactSecure({
      userData: OWNER_USERDATA,
      payload: payload || {},
      shell: wrappedShell,
    });
    if (traceId && result && typeof result === "object") {
      result._ephemeralTrace = {
        traceId,
        mainHandlerEntered: true,
        main_handler_entered: true,
        artifactResolved: !!(result && result.ok),
        artifact_resolved: !!(result && result.ok),
        openPathResult: result && result.ok ? "" : String((result && (result.detail || result.code)) || "failed"),
        open_path_returned: result && result.ok ? "" : String((result && (result.detail || result.code)) || "failed"),
      };
    }
    return result;
  });
}

async function waitReady(win) {
  return win.webContents.executeJavaScript(`(async () => {
    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
    for (let i = 0; i < 240; i++) {
      if (document.documentElement.dataset.dmNavigationBound === "1" &&
          window.DeliverablePlannerUi &&
          (window.__dmArtifactOpenRootInstallCount || 0) >= 1) return true;
      await sleep(25);
    }
    return false;
  })()`);
}

async function setupScene(win) {
  return win.webContents.executeJavaScript(`(async () => {
    const packageId = ${JSON.stringify(OWNER_TASK.packageId)};
    const hide = (id) => { const el = document.getElementById(id); if (el) el.classList.add("hidden"); };
    const show = (id) => { const el = document.getElementById(id); if (el) el.classList.remove("hidden"); };
    hide("view-chat"); hide("view-me"); hide("view-extensions"); hide("view-identity");
    show("view-do"); hide("do-hub"); hide("do-placeholder"); hide("do-write"); hide("do-research"); hide("do-code");
    show("do-act-behalf"); show("act-deliverable-plan-panel"); show("act-generation-panel");
    const view = await window.digitalMe.actBehalfGetDeliverablePackageById({ packageId });
    if (view && view.ok) window.DeliverablePlannerUi.renderGenerationPanel(view);
    await new Promise((r) => setTimeout(r, 80));
    return {
      ok: !!(view && view.ok),
      rootInstall: window.__dmArtifactOpenRootInstallCount || 0,
      hasOldBind: typeof window.bindArtifactOpenButtons === "function",
      locationHref: location.href,
      readyState: document.readyState,
      scripts: [...document.scripts].map((s) => s.src || "(inline)"),
      titles: ((view && view.deliverables) || []).map((d) => d && d.title),
    };
  })()`);
}

async function locateButton(win, titleNeedle) {
  return win.webContents.executeJavaScript(`(() => {
    const titleNeedle = ${JSON.stringify(titleNeedle)};
    const cards = [...document.querySelectorAll(".act-gen-item")];
    const card = cards.find((c) => (c.textContent || "").includes(titleNeedle));
    if (!card) return { found: false };
    const btn = [...card.querySelectorAll("button")].find((el) =>
      (el.textContent || "").trim().includes("打开成果")
    );
    if (!btn) return { found: false };
    btn.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = btn.getBoundingClientRect();
    return {
      found: true,
      outerHTML: btn.outerHTML,
      action: btn.dataset.action || null,
      openDeliverableArtifact: btn.dataset.openDeliverableArtifact || null,
      taskId: btn.dataset.taskId || null,
      deliverableId: btn.dataset.deliverableId || null,
      versionId: btn.dataset.versionId || null,
      artifactId: btn.dataset.artifactId || null,
      text: (btn.textContent || "").trim(),
      cx: Math.floor(rect.left + rect.width / 2),
      cy: Math.floor(rect.top + rect.height / 2),
      w: rect.width,
      h: rect.height,
    };
  })()`);
}

async function readState(win, deliverableId) {
  return win.webContents.executeJavaScript(`(() => {
    const did = ${JSON.stringify(deliverableId || "")};
    let btn = null;
    if (did) {
      btn = document.querySelector('button[data-action="open-deliverable-artifact"][data-deliverable-id="' + did + '"]');
    }
    if (!btn) {
      btn = [...document.querySelectorAll("button")].find((el) => {
        const t = (el.textContent || "").trim();
        return t === "正在打开…" || t === "已打开成果";
      });
    }
    return {
      text: btn ? (btn.textContent || "").trim() : null,
      didShowOpening: btn ? btn.getAttribute("data-did-show-opening") : null,
      rootInstall: window.__dmArtifactOpenRootInstallCount || 0,
      handlerCalls: (window.__dmPerf && window.__dmPerf.artifactOpenHandlerCalls) || 0,
      trace: window.__dmLastArtifactOpenTrace || null,
    };
  })()`);
}

function coordinateClick(win, cx, cy) {
  win.webContents.sendInputEvent({
    type: "mouseDown",
    x: Math.round(cx),
    y: Math.round(cy),
    button: "left",
    clickCount: 1,
  });
  win.webContents.sendInputEvent({
    type: "mouseUp",
    x: Math.round(cx),
    y: Math.round(cy),
    button: "left",
    clickCount: 1,
  });
}

async function clickPass(win, openPathCalls, label) {
  const scene = await setupScene(win);
  const results = [];
  for (const title of OWNER_TASK.titles) {
    await setupScene(win);
    await sleep(40);
    const loc = await locateButton(win, title);
    if (!loc.found || loc.w < 2 || loc.h < 2) {
      results.push({ title, ok: false, reason: "button_not_found", loc });
      continue;
    }
    const before = openPathCalls.length;
    const handlersBefore = (await readState(win, loc.deliverableId)).handlerCalls;
    coordinateClick(win, loc.cx, loc.cy);
    await sleep(100);
    const mid = await readState(win, loc.deliverableId);
    const loadingOk =
      mid.text === "正在打开…" ||
      mid.didShowOpening === "1" ||
      !!(mid.trace && mid.trace.feedbackRenderedBeforeIpc);

    let final = mid;
    for (let i = 0; i < 50; i++) {
      await sleep(40);
      final = await readState(win, loc.deliverableId);
      if (final.text === "已打开成果" || (final.trace && final.trace.renderer_result_received)) break;
    }
    const openCall = openPathCalls.slice(before);
    const openPathResult =
      openCall.length > 0 ? openCall[openCall.length - 1].result : "(no openPath call)";
    const t = final.trace || {};
    const machine = {
      actualButtonOuterHTML: loc.outerHTML,
      rootListenerInstallCount: final.rootInstall,
      rootCaptureEntered: !!(t.rootCaptureEntered || t.root_capture_entered),
      feedbackRenderedBeforeIpc: !!t.feedbackRenderedBeforeIpc,
      preloadCalled: !!(t.preloadCalled || t.preload_called),
      mainHandlerEntered: !!(t.mainHandlerEntered || t.main_handler_entered),
      artifactResolved: !!(t.artifactResolved || t.artifact_resolved),
      openPathResult,
      rendererReceivedOk: !!(t.rendererReceivedOk || final.text === "已打开成果"),
    };
    const ok =
      loadingOk &&
      machine.rootListenerInstallCount === 1 &&
      machine.rootCaptureEntered &&
      machine.feedbackRenderedBeforeIpc &&
      machine.preloadCalled &&
      machine.mainHandlerEntered &&
      machine.artifactResolved &&
      machine.openPathResult === "" &&
      machine.rendererReceivedOk &&
      final.handlerCalls === handlersBefore + 1;
    results.push({
      title,
      ok,
      loadingOk,
      loadingTextAt100ms: mid.text,
      finalText: final.text,
      action: loc.action,
      ids: {
        taskId: loc.taskId,
        deliverableId: loc.deliverableId,
        versionId: loc.versionId,
        artifactId: loc.artifactId,
      },
      machine,
      handlerCalls: final.handlerCalls,
      handlersBefore,
    });
  }

  const perf = await win.webContents.executeJavaScript(`(() => {
    const before = (window.__dmPerf && window.__dmPerf.artifactOpenHandlerCalls) || 0;
    const root = document.getElementById("app") || document.body;
    const other = document.createElement("button");
    other.type = "button";
    other.textContent = "普通按钮";
    other.style.cssText = "position:fixed;left:8px;top:8px;z-index:99999";
    root.appendChild(other);
    other.click();
    other.remove();
    return {
      rootInstall: window.__dmArtifactOpenRootInstallCount || 0,
      handlerBefore: before,
      handlerAfter: (window.__dmPerf && window.__dmPerf.artifactOpenHandlerCalls) || 0,
      hasOldBind: typeof window.bindArtifactOpenButtons === "function",
    };
  })()`);

  return {
    label,
    ok: results.every((r) => r.ok) && perf.rootInstall === 1 && perf.handlerAfter === perf.handlerBefore && scene.hasOldBind === false,
    scene,
    results,
    perf,
  };
}

async function run() {
  await app.whenReady();
  const openPathCalls = [];
  registerHandlers(openPathCalls);

  const HTML_PATH = fromAppRoot("src", "renderer", "index.html");
  const PRELOAD_PATH = fromAppRoot("src", "preload.js");
  console.log("HTML_PATH", HTML_PATH);
  console.log("OWNER_USERDATA", OWNER_USERDATA);
  console.log("SESSION_USERDATA", SESSION_USERDATA);

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
  console.log("loadFile ok");
  const ready = await waitReady(win);
  console.log("ready", ready);
  if (ready !== true) {
    console.error("renderer not ready");
    app.exit(1);
    return;
  }

  const first = await clickPass(win, openPathCalls, "first");
  console.log("first pass done", first.ok);

  // Restart: reload formal page and click again.
  await win.loadFile(HTML_PATH);
  const ready2 = await waitReady(win);
  console.log("ready2", ready2);
  const second = await clickPass(win, openPathCalls, "restart");
  console.log("second pass done", second.ok);

  const report = {
    ownerUserData: OWNER_USERDATA,
    sessionUserData: SESSION_USERDATA,
    appJsPath: fromAppRoot("src", "renderer", "app.js"),
    plannerPath: fromAppRoot("src", "renderer", "deliverable-planner.js"),
    first,
    second,
    ok: !!(first.ok && second.ok),
  };
  const out =
    process.env.DIGITALME_FIX01D_OUT ||
    path.join(os.tmpdir(), "dm-owner-artifact-open-fix01d.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log("FIX01D_OUT", out);
  console.log(
    "FIX01D_SUMMARY",
    JSON.stringify(
      {
        ok: report.ok,
        firstOk: first.ok,
        restartOk: second.ok,
        first: (first.results || []).map((p) => ({
          title: p.title,
          ok: p.ok,
          loading: p.loadingTextAt100ms,
          final: p.finalText,
          machine: p.machine,
        })),
        restart: (second.results || []).map((p) => ({
          title: p.title,
          ok: p.ok,
          loading: p.loadingTextAt100ms,
          final: p.finalText,
          machine: p.machine,
        })),
        scripts: first.scene && first.scene.scripts,
        rootInstall: first.perf && first.perf.rootInstall,
        hasOldBind: first.scene && first.scene.hasOldBind,
      },
      null,
      2
    )
  );

  win.destroy();
  try {
    fs.rmSync(SESSION_USERDATA, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  app.exit(report.ok ? 0 : 1);
}

run().catch((err) => {
  console.error("FATAL", err);
  try {
    app.exit(1);
  } catch {
    process.exit(1);
  }
});

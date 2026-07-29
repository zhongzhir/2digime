"use strict";

/**
 * ARTIFACT-ACCESS-MIN-01 — developer File-menu acceptance with OS mouse.
 * Formal `electron .` (npm start equivalent) + Owner userData + OS SendInput.
 *
 * Run: node scripts/run-artifact-access-min-file-menu-acceptance.cjs
 */

const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");

const APP_ROOT = path.resolve(__dirname, "..");
const EVIDENCE_DIR = path.join(
  APP_ROOT,
  "scripts",
  "_access-min-evidence",
  new Date().toISOString().replace(/[:.]/g, "-")
);
const OWNER_USERDATA =
  process.env.DIGITALME_OWNER_USERDATA ||
  path.join(process.env.APPDATA || "", "digitalme-app");
const OWNER_TASK = {
  packageId: "delivery_ms5k9963_57dea4cf",
  taskId: "abt_ms5k8vpk_fd0a2b",
};
const DEBUG_PORT = Number(process.env.DIGITALME_ACCESS_MIN_DEBUG_PORT || 9333);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

async function waitDebugger(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const page = (list || []).find((t) => t && t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* retry */
    }
    await sleep(400);
  }
  throw new Error("CDP page not ready");
}

function cdpEvaluate(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    const send = (method, params) =>
      new Promise((res, rej) => {
        const id = ++nextId;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      });

    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error("CDP timeout"));
    }, 45000);

    ws.addEventListener("open", () => {
      send("Runtime.enable")
        .then(() =>
          send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
          })
        )
        .then((result) => {
          clearTimeout(timer);
          ws.close();
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          reject(err);
        });
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    });
    ws.addEventListener("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function runPs(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    let err = "";
    ps.stdout.on("data", (d) => (out += d));
    ps.stderr.on("data", (d) => (err += d));
    ps.on("exit", (code) => resolve({ code, out, err }));
    ps.on("error", reject);
  });
}

async function prepareOwnerTask(wsUrl) {
  const expression = `(async () => {
    const taskId = ${JSON.stringify(OWNER_TASK.taskId)};
    const packageId = ${JSON.stringify(OWNER_TASK.packageId)};
    const hide = (id) => { const el = document.getElementById(id); if (el) el.classList.add("hidden"); };
    const show = (id) => { const el = document.getElementById(id); if (el) el.classList.remove("hidden"); };
    hide("view-chat"); hide("view-me"); hide("view-extensions"); hide("view-identity");
    show("view-do"); hide("do-hub"); hide("do-placeholder"); hide("do-write"); hide("do-research"); hide("do-code");
    show("do-act-behalf"); show("act-deliverable-plan-panel"); show("act-generation-panel");
    if (typeof openActBehalfTask === "function") {
      try { await openActBehalfTask(taskId); } catch (e) {}
    }
    if (window.digitalMe && window.digitalMe.actBehalfGetDeliverablePackageById && window.DeliverablePlannerUi) {
      const view = await window.digitalMe.actBehalfGetDeliverablePackageById({ packageId });
      if (view && view.ok) {
        try {
          if (typeof actBehalfState !== "undefined") {
            actBehalfState.taskId = taskId;
            actBehalfState.activePackageId = packageId;
          }
        } catch (e) {}
        window.DeliverablePlannerUi.renderGenerationPanel(view);
      }
    }
    if (window.digitalMe && window.digitalMe.actBehalfSetSelection) {
      window.digitalMe.actBehalfSetSelection({ taskId, packageId });
    }
    await new Promise((r) => setTimeout(r, 300));
    const openBtns = [...document.querySelectorAll("button")].filter((b) =>
      (b.textContent || "").trim() === "打开成果"
    );
    return {
      href: location.href,
      openButtonCount: openBtns.length,
      hasSetSelection: !!(window.digitalMe && window.digitalMe.actBehalfSetSelection),
      scriptsHaveApp: [...document.scripts].some((s) => /app\\.js/.test(s.src || "")),
    };
  })()`;
  const result = await cdpEvaluate(wsUrl, expression);
  return result && result.result ? result.result.value : null;
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const electronBin = require("electron");
  const child = spawn(electronBin, [".", `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: APP_ROOT,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let bootLog = "";
  child.stdout.on("data", (d) => (bootLog += d));
  child.stderr.on("data", (d) => (bootLog += d));

  const report = {
    startedAt: new Date().toISOString(),
    ownerUserData: OWNER_USERDATA,
    evidenceDir: EVIDENCE_DIR,
    mode: "formal_electron_dot_plus_os_mouse_file_menu",
    prepare: null,
    mouse: null,
    ok: false,
  };

  try {
    const page = await waitDebugger(90000);
    await sleep(3500);
    report.prepare = await prepareOwnerTask(page.webSocketDebuggerUrl);
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "01-prepare.json"),
      JSON.stringify(report.prepare, null, 2),
      "utf8"
    );
    // Allow menu rebuild after selection sync.
    await sleep(800);

    const mouse = await runPs(path.join(__dirname, "artifact-access-min-file-menu-mouse.ps1"), [
      "-EvidenceDir",
      EVIDENCE_DIR,
      "-WindowTitle",
      "Digital Me",
    ]);
    report.mouse = { code: mouse.code, out: mouse.out.slice(0, 4000), err: mouse.err.slice(0, 2000) };
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "02-mouse-raw.txt"),
      `code=${mouse.code}\nOUT:\n${mouse.out}\nERR:\n${mouse.err}\n`,
      "utf8"
    );

    let mouseSummary = null;
    try {
      const raw = fs.readFileSync(path.join(EVIDENCE_DIR, "mouse-summary.json"), "utf8");
      mouseSummary = JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch {
      try {
        mouseSummary = JSON.parse(String(mouse.out || "").replace(/^\uFEFF/, "").trim());
      } catch {
        mouseSummary = null;
      }
    }
    report.mouseSummary = mouseSummary;
    report.ok = !!(
      report.prepare &&
      report.prepare.openButtonCount === 0 &&
      report.prepare.hasSetSelection &&
      mouseSummary &&
      mouseSummary.openClicked &&
      mouseSummary.revealClicked &&
      mouseSummary.menuOpenEnabled !== false &&
      !mouseSummary.error &&
      mouse.code === 0
    );
    report.finishedAt = new Date().toISOString();
    report.bootLogTail = bootLog.slice(-2000);
    fs.writeFileSync(path.join(EVIDENCE_DIR, "summary.json"), JSON.stringify(report, null, 2), "utf8");
    console.log("EVIDENCE_DIR", EVIDENCE_DIR);
    console.log("SUMMARY", JSON.stringify(report, null, 2));
  } catch (err) {
    report.error = String(err && err.stack ? err.stack : err);
    report.bootLogTail = bootLog.slice(-4000);
    fs.writeFileSync(path.join(EVIDENCE_DIR, "summary.json"), JSON.stringify(report, null, 2), "utf8");
    console.error(report.error);
  } finally {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    await sleep(800);
  }
  process.exit(report.ok ? 0 : 1);
}

main();

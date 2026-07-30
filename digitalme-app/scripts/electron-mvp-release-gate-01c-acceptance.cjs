"use strict";

/**
 * MVP-RELEASE-GATE-01C Electron UI evidence — isolated userData.
 * Real mouse/keyboard via sendInputEvent. Same entry as npm start.
 *
 * Run: npm run test:mvp-release-gate-01c-electron
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.versions.electron) {
  console.error("Must run under Electron");
  process.exit(1);
}

const { app, BrowserWindow } = require("electron");

const EVIDENCE = path.join(
  __dirname,
  "_mvp-release-gate-01c-evidence",
  new Date().toISOString().replace(/[:.]/g, "-")
);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-01c-e2e-"));
app.setPath("userData", userData);
fs.mkdirSync(EVIDENCE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  const file = path.join(EVIDENCE, `${name}.png`);
  fs.writeFileSync(file, img.toPNG());
  return file;
}

async function waitFor(win, predicate, label, timeoutMs = 25000) {
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

async function fillInput(win, selector, text) {
  await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error("missing " + ${JSON.stringify(selector)});
    el.focus();
    el.value = ${JSON.stringify(text)};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await sleep(80);
}

async function runHarness() {
  let win = null;
  for (let i = 0; i < 80; i++) {
    win = BrowserWindow.getAllWindows()[0];
    if (win) break;
    await sleep(100);
  }
  assert.ok(win, "BrowserWindow");

  await waitFor(
    win,
    `() => document.readyState === "complete" && !!document.getElementById("first-run-overlay")`,
    "overlay mounted"
  );
  await waitFor(
    win,
    `() => {
      const o = document.getElementById("first-run-overlay");
      return o && !o.classList.contains("hidden");
    }`,
    "overlay visible for clean userData",
    15000
  );
  await shot(win, "01-first-run");

  await clickSel(win, "#btn-first-run-create");
  await waitFor(
    win,
    `() => {
      const p = document.getElementById("first-run-create-panel");
      return p && !p.classList.contains("hidden");
    }`,
    "create panel"
  );
  await shot(win, "02-create-page");

  await fillInput(win, "#first-run-create-name", "验收用户");
  await fillInput(win, "#first-run-create-role", "做产品验收");
  await clickSel(win, "#btn-first-run-create-submit");

  await waitFor(
    win,
    `() => {
      const o = document.getElementById("first-run-overlay");
      const hub = document.getElementById("do-hub");
      const viewDo = document.getElementById("view-do");
      return o && o.classList.contains("hidden") && viewDo && !viewDo.classList.contains("hidden");
    }`,
    "left first-run into product",
    35000
  );
  await shot(win, "03-create-done-hub");

  const afterCreate = await win.webContents.executeJavaScript(`(async () => {
    const pkg = await window.digitalMe.loadPackage();
    const fr = await window.digitalMe.getFirstRunState();
    return {
      exists: !!pkg.exists,
      dir: pkg.dir,
      state: fr.state,
      displayName: fr.displayName,
      needsFirstRunUi: !!fr.needsFirstRunUi,
    };
  })()`);
  assert.equal(afterCreate.exists, true, "package exists");
  assert.equal(afterCreate.state, "package_ready");
  assert.equal(afterCreate.needsFirstRunUi, false);
  assert.ok(!String(afterCreate.dir).toLowerCase().includes("digitalme-app"));

  // Soft restart: reload package + first-run UI (full process restart covered by unit test)
  await win.webContents.executeJavaScript(`(async () => {
    window.pkg = await window.digitalMe.loadPackage();
    if (typeof refreshFirstRunUi === "function") await refreshFirstRunUi();
  })()`);
  await sleep(400);
  const noOnboarding = await win.webContents.executeJavaScript(`(() => {
    const o = document.getElementById("first-run-overlay");
    return !o || o.classList.contains("hidden");
  })()`);
  assert.equal(noOnboarding, true);
  await shot(win, "04-restart-like-no-onboarding");

  // Re-enter import UI with a second clean package (reference import).
  const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dm-01c-docs-"));
  const lifecycle = require("../src/digital-me-lifecycle");
  const second = lifecycle.createDigitalMePackage({
    documentsRoot: docsRoot,
    displayName: "导入样例",
    roleSummary: "用于导入验收",
  });
  const hashBefore = (() => {
    const crypto = require("node:crypto");
    const files = [];
    function walk(rel) {
      const abs = path.join(second.packageDir, rel);
      for (const name of fs.readdirSync(abs)) {
        if (name === ".digitalme-pkgstore") continue;
        const child = path.join(rel, name);
        const full = path.join(second.packageDir, child);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(child);
        else {
          files.push({
            path: child.replace(/\\/g, "/"),
            sha256: crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex"),
          });
        }
      }
    }
    walk(".");
    files.sort((a, b) => a.path.localeCompare(b.path));
    return crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex");
  })();

  await win.webContents.executeJavaScript(`(async () => {
    if (typeof showFirstRunOverlay === "function") showFirstRunOverlay();
    if (typeof showFirstRunPanel === "function") showFirstRunPanel("import");
  })()`);
  await sleep(200);
  await shot(win, "05-import-page");

  const inspected = await win.webContents.executeJavaScript(
    `(async () => window.digitalMe.inspectDigitalMePackage({ packageDir: ${JSON.stringify(second.packageDir)} }))()`
  );
  assert.equal(inspected.ok, true);
  await win.webContents.executeJavaScript(`(() => {
    if (typeof renderFirstRunImportSummary === "function") {
      renderFirstRunImportSummary(${JSON.stringify(inspected)});
    }
  })()`);
  await sleep(200);
  await shot(win, "06-import-summary");

  const activated = await win.webContents.executeJavaScript(
    `(async () => {
      const res = await window.digitalMe.activateDigitalMePackage({
        packageDir: ${JSON.stringify(second.packageDir)},
        applyRepairs: false,
      });
      if (typeof completeFirstRunSetup === "function") await completeFirstRunSetup(res.firstRun);
      return res;
    })()`
  );
  assert.equal(activated.ok, true);
  assert.equal(activated.copied, false);
  await waitFor(
    win,
    `() => {
      const o = document.getElementById("first-run-overlay");
      return o && o.classList.contains("hidden");
    }`,
    "import activated",
    20000
  );
  await shot(win, "07-import-success-hub");

  const afterImport = await win.webContents.executeJavaScript(`(async () => {
    const pkg = await window.digitalMe.loadPackage();
    const fr = await window.digitalMe.getFirstRunState();
    return { dir: pkg.dir, state: fr.state, displayName: fr.displayName };
  })()`);
  assert.equal(path.resolve(afterImport.dir), path.resolve(second.packageDir));
  assert.equal(afterImport.state, "package_ready");

  const hashAfter = (() => {
    const crypto = require("node:crypto");
    const files = [];
    function walk(rel) {
      const abs = path.join(second.packageDir, rel);
      for (const name of fs.readdirSync(abs)) {
        if (name === ".digitalme-pkgstore") continue;
        const child = path.join(rel, name);
        const full = path.join(second.packageDir, child);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(child);
        else {
          files.push({
            path: child.replace(/\\/g, "/"),
            sha256: crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex"),
          });
        }
      }
    }
    walk(".");
    files.sort((a, b) => a.path.localeCompare(b.path));
    return crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex");
  })();
  assert.equal(hashBefore, hashAfter, "import must not modify source package");

  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-01c-bad-"));
  fs.writeFileSync(path.join(badDir, "readme.txt"), "not a package", "utf8");
  const rejected = await win.webContents.executeJavaScript(
    `(async () => window.digitalMe.activateDigitalMePackage({ packageDir: ${JSON.stringify(badDir)} }))()`
  );
  assert.equal(rejected.ok, false);
  const still = await win.webContents.executeJavaScript(`(async () => (await window.digitalMe.loadPackage()).dir)()`);
  assert.equal(path.resolve(still), path.resolve(second.packageDir));
  await win.webContents.executeJavaScript(`(async () => {
    if (typeof showFirstRunOverlay === "function") showFirstRunOverlay();
    if (typeof showFirstRunPanel === "function") showFirstRunPanel("import");
    if (typeof renderFirstRunImportSummary === "function") {
      renderFirstRunImportSummary({
        ok: false,
        blockingIssues: [{ userMessage: "这个文件夹不是可识别的 Digital Me。请选择包含 Digital Me 配置的文件夹，或创建一个新的 Digital Me。" }],
      });
    }
  })()`);
  await sleep(200);
  await shot(win, "08-invalid-import");

  const listing = [];
  function walkList(rel) {
    const abs = path.join(second.packageDir, rel);
    for (const name of fs.readdirSync(abs)) {
      const child = path.join(rel, name);
      const full = path.join(second.packageDir, child);
      if (fs.statSync(full).isDirectory()) walkList(child);
      else listing.push(child.replace(/\\/g, "/"));
    }
  }
  walkList(".");

  const summary = {
    ok: true,
    userData,
    evidenceDir: EVIDENCE,
    createdPackageDir: afterCreate.dir,
    importedPackageDir: second.packageDir,
    displayName: afterImport.displayName,
    importMode: "reference_no_copy",
    sourcePackageHashUnchanged: hashBefore === hashAfter,
    fileListing: listing.sort(),
    classicHref: await win.webContents.executeJavaScript("location.href"),
  };
  fs.writeFileSync(path.join(EVIDENCE, "summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(
    path.join(EVIDENCE, "import-hash-compare.json"),
    JSON.stringify({ hashBefore, hashAfter, unchanged: hashBefore === hashAfter }, null, 2)
  );
  console.log(JSON.stringify(summary, null, 2));
  app.exit(0);
}

process.on("uncaughtException", (err) => {
  try {
    fs.writeFileSync(path.join(EVIDENCE, "error.json"), JSON.stringify({ error: String(err && err.stack || err) }, null, 2));
  } catch {}
});

// Same entry as npm start
require("../src/main.js");

app.whenReady().then(() => {
  setTimeout(() => {
    runHarness().catch((err) => {
      console.error(err);
      try {
        fs.writeFileSync(
          path.join(EVIDENCE, "error.json"),
          JSON.stringify({ error: String(err && err.stack || err) }, null, 2)
        );
      } catch {}
      app.exit(1);
    });
  }, 1200);
});

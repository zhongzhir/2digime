"use strict";

/**
 * MVP-RELEASE-GATE-01E Electron smoke — classic renderer + nav labels.
 * Run: npm run test:mvp-release-gate-01e-electron
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
  "_mvp-release-gate-01e-evidence",
  "electron-" + new Date().toISOString().replace(/[:.]/g, "-")
);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-01e-e2e-"));
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
  throw new Error("timeout: " + label);
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
          displayName: "01E验收",
          roleSummary: "封闭内测",
        });
        window.pkg = await window.digitalMe.loadPackage();
        if (typeof refreshFirstRunUi === "function") await refreshFirstRunUi();
      }
    }
  })()`);
  await sleep(500);
  await shot(win, "01-ready");

  const nav = await win.webContents.executeJavaScript(`(() => {
    const items = [...document.querySelectorAll(".nav-item:not(.hidden)")].map((b) => b.textContent.trim());
    return {
      items,
      hasMe: items.some((t) => t.includes("我的 Digital Me")),
      hasIdentityPrimary: items.includes("身份与协作"),
      hasCapPrimary: items.includes("能力"),
    };
  })()`);
  assert.equal(nav.hasMe, true);
  assert.equal(nav.hasIdentityPrimary, false);
  assert.equal(nav.hasCapPrimary, false);

  fs.writeFileSync(
    path.join(EVIDENCE, "summary.json"),
    JSON.stringify({ ok: true, nav, evidenceDir: EVIDENCE }, null, 2)
  );
  console.log("01E Electron smoke PASS", EVIDENCE);
  app.exit(0);
}

require("../src/main.js");
app.whenReady().then(() => {
  setTimeout(() => {
    runHarness().catch((err) => {
      console.error(err);
      fs.writeFileSync(
        path.join(EVIDENCE, "error.json"),
        JSON.stringify({ message: String(err && err.message || err) }, null, 2)
      );
      app.exit(1);
    });
  }, 800);
});

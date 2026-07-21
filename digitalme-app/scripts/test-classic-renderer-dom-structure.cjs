"use strict";

/**
 * Classic renderer DOM structure regression (Chromium/Electron parsed DOM).
 *
 * Prevents a stray </div> from closing #app early and ejecting
 * #do-act-behalf / #view-me / #view-extensions to <body>.
 *
 * Run: npm run test:classic-renderer-dom
 *   or: npx electron scripts/test-classic-renderer-dom-structure.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

if (!process.versions.electron) {
  console.error("FAIL: must run under Electron (npm run test:classic-renderer-dom)");
  process.exit(1);
}

const { app, BrowserWindow } = require("electron");

const ROOT = path.join(__dirname, "..");
const HTML_PATH = path.join(ROOT, "src", "renderer", "index.html");
const CSS_PATH = path.join(ROOT, "src", "renderer", "styles.css");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-classic-dom-"));
app.setPath("userData", userData);

process.on("exit", () => {
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

async function run() {
  assert.ok(fs.existsSync(HTML_PATH), "index.html exists");
  assert.ok(fs.existsSync(CSS_PATH), "styles.css exists");

  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 780,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadFile(HTML_PATH);

  const result = await win.webContents.executeJavaScript(`(() => {
    const act = document.getElementById("do-act-behalf");
    const ph = document.getElementById("do-placeholder");
    const viewDo = document.getElementById("view-do");
    const main = document.getElementById("main");
    const appEl = document.getElementById("app");
    const viewExt = document.getElementById("view-extensions");
    const viewMe = document.getElementById("view-me");
    const hub = document.getElementById("do-hub");
    const write = document.getElementById("do-write");
    const research = document.getElementById("do-research");
    const code = document.getElementById("do-code");

    function pathIds(el) {
      const ids = [];
      let cur = el;
      while (cur && cur.nodeType === 1) {
        if (cur.id) ids.unshift(cur.id);
        cur = cur.parentElement;
      }
      return ids;
    }

    return {
      actParentId: act && act.parentElement ? act.parentElement.id : null,
      phParentId: ph && ph.parentElement ? ph.parentElement.id : null,
      viewDoParentId: viewDo && viewDo.parentElement ? viewDo.parentElement.id : null,
      mainParentId: main && main.parentElement ? main.parentElement.id : null,
      actPath: act ? pathIds(act) : [],
      phPath: ph ? pathIds(ph) : [],
      extPath: viewExt ? pathIds(viewExt) : [],
      mePath: viewMe ? pathIds(viewMe) : [],
      actIsBodyChild: !!(act && act.parentElement === document.body),
      meIsBodyChild: !!(viewMe && viewMe.parentElement === document.body),
      extIsBodyChild: !!(viewExt && viewExt.parentElement === document.body),
      viewDoChildren: viewDo ? [...viewDo.children].map((c) => c.id) : [],
      mainChildren: main ? [...main.children].map((c) => c.id) : [],
      hasHub: !!hub,
      hasWrite: !!write,
      hasResearch: !!research,
      hasCode: !!code,
      actClosestApp: !!(act && act.closest("#app")),
      meClosestApp: !!(viewMe && viewMe.closest("#app")),
      extClosestApp: !!(viewExt && viewExt.closest("#app")),
    };
  })()`);

  win.destroy();

  let passed = 0;
  let failed = 0;
  function test(name, fn) {
    try {
      fn();
      passed += 1;
      console.log("PASS", name);
    } catch (err) {
      failed += 1;
      console.error("FAIL", name);
      console.error(err && err.stack ? err.stack : err);
    }
  }

  test("1. #do-act-behalf.parentElement.id === view-do", () => {
    assert.equal(result.actParentId, "view-do");
  });
  test("2. #do-placeholder.parentElement.id === view-do", () => {
    assert.equal(result.phParentId, "view-do");
  });
  test("3. #view-do is inside #main", () => {
    assert.equal(result.viewDoParentId, "main");
  });
  test("4. #main is inside #app", () => {
    assert.equal(result.mainParentId, "app");
  });
  test("5. #view-extensions is under #main/#app", () => {
    assert.deepEqual(result.extPath, ["app", "main", "view-extensions"]);
    assert.equal(result.extClosestApp, true);
  });
  test("6. #view-me is under #main/#app", () => {
    assert.deepEqual(result.mePath, ["app", "main", "view-me"]);
    assert.equal(result.meClosestApp, true);
  });
  test("7. #do-act-behalf is not a direct child of body", () => {
    assert.equal(result.actIsBodyChild, false);
    assert.deepEqual(result.actPath, ["app", "main", "view-do", "do-act-behalf"]);
  });
  test("8. #view-me and #view-extensions are not direct children of body", () => {
    assert.equal(result.meIsBodyChild, false);
    assert.equal(result.extIsBodyChild, false);
  });
  test("9. #view-do contains expected scene roots including act-behalf", () => {
    for (const id of [
      "do-hub",
      "do-write",
      "do-research",
      "do-code",
      "do-act-behalf",
      "do-placeholder",
    ]) {
      assert.ok(result.viewDoChildren.includes(id), "missing " + id);
    }
  });
  test("10. #main still hosts chat/do/extensions/me views", () => {
    for (const id of ["view-chat", "view-do", "view-extensions", "view-me"]) {
      assert.ok(result.mainChildren.includes(id), "missing " + id);
    }
  });

  console.log(JSON.stringify({ passed, failed, sample: result }, null, 2));
  app.exit(failed ? 1 : 0);
}

app.whenReady().then(run).catch((err) => {
  console.error("FAIL classic renderer DOM structure", err && err.stack ? err.stack : err);
  app.exit(1);
});

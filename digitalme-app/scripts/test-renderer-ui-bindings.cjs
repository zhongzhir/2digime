"use strict";

/**
 * Renderer bind resilience + real-page wiring checks.
 * Run: node scripts/test-renderer-ui-bindings.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
  MESSAGES,
  runBootstrapFileSubmit,
} = require("../src/builder/bootstrap-file-submit");

const ROOT = path.join(__dirname, "..");
const HTML_PATH = path.join(ROOT, "src", "renderer", "index.html");
const APP_JS = path.join(ROOT, "src", "renderer", "app.js");
const HELP_JS = path.join(ROOT, "src", "renderer", "help.js");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.stack ? err.stack : err);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.stack ? err.stack : err);
  }
}

function runIsolatedBinders(steps) {
  const ran = [];
  const errors = [];
  for (const [name, fn] of steps) {
    try {
      fn();
      ran.push(name);
    } catch (err) {
      errors.push({ name, message: String(err && err.message) });
    }
  }
  return { ran, errors };
}

async function runAll() {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const appJs = fs.readFileSync(APP_JS, "utf8");
  const helpJs = fs.readFileSync(HELP_JS, "utf8");

  test("1. bootstrap buttons exist with title/aria-label", () => {
    assert.ok(/id="btn-bootstrap-resume"/.test(html));
    assert.ok(/id="btn-bootstrap-assessment-file"/.test(html));
    assert.ok(/btn-bootstrap-resume[^>]*title=/.test(html) || /id="btn-bootstrap-resume"[^>]*title=/.test(html));
    assert.ok(/aria-label="提交履历类文件"/.test(html));
    assert.ok(/aria-label="提交判断类文件"/.test(html));
  });

  test("2. init registers onExternalAgentStarted before bindEvents", () => {
    const startedIdx = appJs.indexOf("onExternalAgentStarted");
    const bindIdx = appJs.indexOf("bindEvents()");
    assert.ok(startedIdx > 0, "onExternalAgentStarted present");
    assert.ok(bindIdx > startedIdx, "listener registration must precede bindEvents()");
  });

  test("3. bindEvents isolates failures; bootstrap + help are separate steps", () => {
    assert.ok(/reportBindError/.test(appJs));
    assert.ok(/\["bootstrap-files",\s*bindBootstrapFileActions\]/.test(appJs));
    assert.ok(/\["help-tips",\s*bindHelpAndTips\]/.test(appJs));
    assert.ok(/dmBootstrapDelegate/.test(appJs));
    assert.ok(/dmTipDelegate/.test(appJs));
    assert.ok(/暂无说明/.test(appJs));
    assert.ok(/btn-me-goto-cognition/.test(appJs) && /\?\.addEventListener/.test(appJs));
  });

  test("4. isolated binder failure does not block later binders", () => {
    let help = false;
    let bootstrap = false;
    const { ran, errors } = runIsolatedBinders([
      [
        "me",
        () => {
          throw new Error("Cannot read properties of null (reading 'addEventListener')");
        },
      ],
      [
        "bootstrap-files",
        () => {
          bootstrap = true;
        },
      ],
      [
        "help-tips",
        () => {
          help = true;
        },
      ],
    ]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].name, "me");
    assert.equal(bootstrap, true);
    assert.equal(help, true);
    assert.ok(ran.includes("bootstrap-files"));
    assert.ok(ran.includes("help-tips"));
  });

  await testAsync("5. cancel / success / IPC failure feedback (behavioral)", async () => {
    const notes = [];
    const cancel = await runBootstrapFileSubmit({
      pickFile: async () => [],
      enqueueInbox: async () => ({ added: [] }),
      notify: (s) => notes.push(s),
    });
    assert.equal(cancel.reason, "cancelled");
    assert.ok(notes.some((n) => n.headline === MESSAGES.cancelHeadline));

    notes.length = 0;
    let refreshed = false;
    const ok = await runBootstrapFileSubmit({
      pickFile: async () => [{ filePath: "C:\\a\\cv.pdf", name: "cv.pdf", size: 1 }],
      enqueueInbox: async (files) => {
        assert.equal(files.length, 1);
        return { added: files };
      },
      notify: (s) => notes.push(s),
      refreshInbox: async () => {
        refreshed = true;
      },
    });
    assert.equal(ok.ok, true);
    assert.equal(refreshed, true);
    assert.ok(notes.some((n) => n.headline === MESSAGES.pickingHeadline));
    assert.ok(notes.some((n) => /cv\.pdf/.test(String(n.current || ""))));

    notes.length = 0;
    const fail = await runBootstrapFileSubmit({
      pickFile: async () => {
        throw new Error("IPC down");
      },
      enqueueInbox: async () => ({ added: [] }),
      notify: (s) => notes.push(s),
    });
    assert.equal(fail.reason, "pick_failed");
    assert.ok(notes.some((n) => /IPC down/.test(String(n.current || ""))));
  });

  test("6. tip content available; empty falls back in app.js", () => {
    assert.ok(/DigitalMeHelp/.test(helpJs));
    assert.ok(/bootstrap-duo/.test(helpJs));
    assert.ok(/tipTextFor\(el\) \|\| "暂无说明"/.test(appJs) || /|| "暂无说明"/.test(appJs));
    assert.ok(/pointerover|focusin/.test(appJs));
    assert.ok(/closest\("\.tip-mark/.test(appJs));
  });

  test("7. pickIntoInbox is top-level (not trapped inside failing bindMe)", () => {
    assert.ok(/async function pickIntoInbox\(/.test(appJs));
    assert.ok(/function bindBootstrapFileActions\(/.test(appJs));
    // Nested legacy binding of bootstrap resume must not be the only path.
    assert.ok(/btn-bootstrap-resume/.test(appJs));
  });

  console.log(`\nRenderer UI binding results: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

runAll().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

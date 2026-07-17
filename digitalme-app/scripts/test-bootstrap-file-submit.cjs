"use strict";

/**
 * Bootstrap file submission UX tests (DOM wiring + behavior with mocks).
 * Run: node scripts/test-bootstrap-file-submit.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
  MESSAGES,
  runBootstrapFileSubmit,
} = require("../src/builder/bootstrap-file-submit");

const HTML_PATH = path.join(__dirname, "..", "src", "renderer", "index.html");
const APP_JS = path.join(__dirname, "..", "src", "renderer", "app.js");

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

async function runAll() {
  test("1. bootstrap buttons exist in DOM", () => {
    const html = fs.readFileSync(HTML_PATH, "utf8");
    assert.ok(html.includes('id="btn-bootstrap-resume"'));
    assert.ok(html.includes('id="btn-bootstrap-assessment-file"'));
    assert.ok(html.includes("提交履历类文件"));
    assert.ok(html.includes("提交判断类文件"));
  });

  test("2. renderer binds buttons and uses bootstrap submit helper", () => {
    const appJs = fs.readFileSync(APP_JS, "utf8");
    assert.ok(/btn-bootstrap-resume/.test(appJs));
    assert.ok(/btn-bootstrap-assessment-file/.test(appJs));
    assert.ok(/addEventListener\(\s*"click"/.test(appJs));
    assert.ok(/runBootstrapFileSubmit|bootstrapFileSubmit|正在打开文件选择/.test(appJs));
    assert.ok(appJs.includes(MESSAGES.pickingHeadline));
    assert.ok(appJs.includes(MESSAGES.cancelHeadline));
    assert.ok(/enqueueInbox/.test(appJs));
    assert.ok(/refreshInboxPanel/.test(appJs));
  });

  await testAsync("3. cancel selection shows feedback", async () => {
    const notes = [];
    const result = await runBootstrapFileSubmit({
      pickFile: async () => [],
      enqueueInbox: async () => {
        throw new Error("should not enqueue");
      },
      notify: (s) => notes.push(s),
      refreshInbox: async () => {
        throw new Error("should not refresh");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "cancelled");
    assert.ok(notes.some((n) => n.headline === MESSAGES.pickingHeadline));
    assert.ok(notes.some((n) => n.headline === MESSAGES.cancelHeadline));
  });

  await testAsync("4. successful pick enqueues and refreshes", async () => {
    const notes = [];
    let refreshed = false;
    let enqueued = null;
    const result = await runBootstrapFileSubmit(
      {
        pickFile: async () => [
          { filePath: "C:\\tmp\\resume.pdf", name: "resume.pdf", size: 10 },
          { filePath: "C:\\tmp\\notes.md", name: "notes.md", size: 4 },
        ],
        enqueueInbox: async (files) => {
          enqueued = files;
          return { added: files };
        },
        notify: (s) => notes.push(s),
        refreshInbox: async () => {
          refreshed = true;
        },
      },
      { doneHint: "已提交履历类材料。" }
    );
    assert.equal(result.ok, true);
    assert.equal(result.selectedCount, 2);
    assert.equal(enqueued.length, 2);
    assert.equal(refreshed, true);
    assert.ok(notes.some((n) => n.headline === MESSAGES.selectedHeadline(2)));
    assert.ok(notes.some((n) => /resume\.pdf/.test(String(n.current || ""))));
    assert.ok(notes.some((n) => n.headline === MESSAGES.enrolledHeadline));
    assert.ok(notes.some((n) => /已提交履历类材料/.test(String(n.current || ""))));
  });

  await testAsync("5. pickFile IPC failure shows error", async () => {
    const notes = [];
    const result = await runBootstrapFileSubmit({
      pickFile: async () => {
        throw new Error("对话框不可用");
      },
      enqueueInbox: async () => ({ added: [] }),
      notify: (s) => notes.push(s),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "pick_failed");
    assert.ok(notes.some((n) => n.headline === MESSAGES.pickFailedHeadline));
    assert.ok(notes.some((n) => /对话框不可用/.test(String(n.current || ""))));
  });

  await testAsync("6. enqueueInbox IPC failure shows error", async () => {
    const notes = [];
    let refreshed = false;
    const result = await runBootstrapFileSubmit({
      pickFile: async () => [{ filePath: "C:\\tmp\\a.txt", name: "a.txt", size: 1 }],
      enqueueInbox: async () => {
        throw new Error("入库被拒绝");
      },
      notify: (s) => notes.push(s),
      refreshInbox: async () => {
        refreshed = true;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "enqueue_failed");
    assert.equal(refreshed, false);
    assert.ok(notes.some((n) => n.headline === MESSAGES.enqueueFailedHeadline));
    assert.ok(notes.some((n) => /入库被拒绝/.test(String(n.current || ""))));
  });

  console.log(`\nBootstrap submit results: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

runAll().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

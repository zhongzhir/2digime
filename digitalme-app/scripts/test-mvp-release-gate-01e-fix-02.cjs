"use strict";

/**
 * MVP-RELEASE-GATE-01E-FIX-02 — model onboarding + renderer bind integrity.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { buildRuntimeStamp, readEmbeddedBuildInfo } = require("../src/runtime-stamp");

const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");

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

test("1) bindExtensions does not bind deleted btn-capability-new-task", () => {
  assert.ok(!/btn-capability-new-task\"\)\.addEventListener/.test(appJs));
  assert.ok(!/\$\(\"btn-capability-new-task\"\)\.addEventListener/.test(appJs));
  assert.ok(appJs.includes('btn-capability-new-task was removed'));
  assert.ok(appJs.includes('$("btn-ext-refresh")?.addEventListener'));
});

test("2) formal closed-alpha suppresses debug overlay helpers", () => {
  assert.ok(appJs.includes("isFormalClosedAlphaSurface"));
  assert.ok(appJs.includes('dataset.dmReleaseChannel === "closed-alpha"'));
  assert.match(appJs, /if \(isFormalClosedAlphaSurface\(\)\) \{\s*\/\/ Root causes[\s\S]*?return;/);
});

test("3) first model connection UI present without claiming gpt-4o-mini as current default", () => {
  assert.ok(indexHtml.includes("model-connect-panel"));
  assert.ok(indexHtml.includes("尚未连接模型"));
  assert.ok(indexHtml.includes('data-provider="deepseek"'));
  assert.ok(indexHtml.includes("推荐"));
  assert.ok(indexHtml.includes("cfg-first-connect-key"));
  assert.ok(indexHtml.includes("保存并开始使用"));
  assert.ok(indexHtml.includes("高级模型设置"));
  // Advanced multi-route matrix must not be the first-run headline.
  assert.ok(!/settings-subhead">模型与默认</.test(indexHtml));
});

test("4) DeepSeek is first/recommended provider in onboarding constants", () => {
  assert.ok(appJs.includes('deepseek: {'));
  assert.ok(appJs.includes('recommended: true'));
  assert.ok(appJs.includes("https://api.deepseek.com/v1"));
  assert.ok(appJs.includes("deepseek-chat"));
  assert.ok(appJs.includes("FIRST_CONNECT_PROVIDERS"));
});

test("5) version stamp never falls back to literal unknown", () => {
  assert.ok(!appJs.includes(': "unknown"'));
  assert.ok(!/slice\(0, 7\) : "unknown"/.test(appJs));
  assert.ok(appJs.includes("Closed Alpha ·"));
  assert.ok(appJs.includes("版本 0.1.0"));
});

test("6) runtime stamp reads embedded build-info", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dm-fix02-stamp-"));
  const infoPath = path.join(tmp, "build-info.json");
  fs.writeFileSync(
    infoPath,
    JSON.stringify({
      gitHead: "abcdef0123456789",
      releaseChannel: "closed-alpha",
      productSurface: "classic",
      appVersion: "0.1.0",
      buildId: "test-build",
    })
  );
  const info = readEmbeddedBuildInfo({ resourcesPath: tmp });
  assert.equal(info.gitHead, "abcdef0123456789");
  assert.equal(info.releaseChannel, "closed-alpha");
  const stamp = buildRuntimeStamp({
    resourcesPath: tmp,
    isPackaged: true,
  });
  assert.ok(stamp.buildInfo);
  assert.equal(stamp.gitHead, "abcdef0123456789");
  assert.equal(stamp.releaseChannel, "closed-alpha");
  assert.equal(stamp.isPackaged, true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("7) key field is password input and not a persisted renderer store", () => {
  assert.match(indexHtml, /id="cfg-first-connect-key"[^>]*type="password"/);
  assert.ok(!appJs.includes("localStorage.setItem") || !/first-connect-key/.test(appJs));
  assert.ok(appJs.includes("saveModelRouting"));
  assert.ok(appJs.includes("providerKeys"));
});

console.log(`\n01E-FIX-02 results: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

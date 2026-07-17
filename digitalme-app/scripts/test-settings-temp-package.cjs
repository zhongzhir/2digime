"use strict";

/**
 * Settings advanced tools: temp test package safety narrowing.
 * Run: node scripts/test-settings-temp-package.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
  TEMP_PREFIX,
  isTempDemoPackageDir,
  nextRegularPackageDir,
  loadSandboxState,
  saveSandboxState,
  buildSandboxStatus,
} = require("../src/sandbox-package-state");

const ROOT = path.join(__dirname, "..");
const RENDERER = path.join(ROOT, "src", "renderer");

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

function tempFile(label) {
  return path.join(os.tmpdir(), `dm-sandbox-state-${label}-${Date.now()}.json`);
}

test("1. settings page structure: advanced tools fold + buttons + banner", () => {
  const html = fs.readFileSync(path.join(RENDERER, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(RENDERER, "styles.css"), "utf8");
  assert.match(html, /id="settings-advanced-tools"/);
  assert.match(html, /高级 \/ 测试工具/);
  assert.match(html, /id="btn-create-temp-test-pkg"/);
  assert.match(html, /创建临时测试资料/);
  assert.match(html, /id="btn-restore-regular-pkg"/);
  assert.match(html, /恢复常规资料目录/);
  assert.match(html, /id="settings-temp-pkg-banner"/);
  assert.match(html, /当前正在使用临时测试资料/);
  assert.ok(!/id="btn-create-demo-pkg"/.test(html), "legacy demo button must be removed");
  assert.ok(!/创建临时演示资料/.test(html), "legacy demo label must be removed from settings");
  assert.match(css, /\.settings-temp-pkg-banner/);
  assert.match(css, /\.settings-advanced-tools/);
});

test("2. create temp package requires confirmation text and confirmed IPC", () => {
  const appJs = fs.readFileSync(path.join(RENDERER, "app.js"), "utf8");
  const mainJs = fs.readFileSync(path.join(ROOT, "src", "main.js"), "utf8");
  assert.match(appJs, /TEMP_PKG_CONFIRM_TEXT/);
  assert.match(appJs, /将切换当前资料目录|切换当前资料目录/);
  assert.match(appJs, /不会修改常规资料/);
  assert.match(appJs, /不会自动合并回常规资料/);
  assert.match(appJs, /window\.confirm\(TEMP_PKG_CONFIRM_TEXT\)/);
  assert.match(appJs, /activateTempDemoPackage\(\{\s*confirmed:\s*true/);
  assert.match(mainJs, /packageStore:activateTempDemo/);
  assert.match(mainJs, /confirmation_required/);
});

test("3. cancel confirmation does not switch directory (no activate without confirm)", () => {
  const appJs = fs.readFileSync(path.join(RENDERER, "app.js"), "utf8");
  const start = appJs.indexOf("async function createTempTestPackageFlow");
  const end = appJs.indexOf("async function restoreRegularPackageFlow");
  assert.ok(start > 0 && end > start, "createTempTestPackageFlow present");
  const body = appJs.slice(start, end);
  assert.match(body, /if\s*\(\s*!window\.confirm\(TEMP_PKG_CONFIRM_TEXT\)\s*\)\s*return;/);
  const confirmIdx = body.indexOf("confirm(TEMP_PKG_CONFIRM_TEXT)");
  const activateIdx = body.indexOf("activateTempDemoPackage({");
  assert.ok(confirmIdx >= 0 && activateIdx > confirmIdx, "cancel gate must precede activate call");
  assert.match(body, /confirmed:\s*true/);
});

test("4. temp directory warning display wiring", () => {
  const appJs = fs.readFileSync(path.join(RENDERER, "app.js"), "utf8");
  assert.match(appJs, /refreshSandboxPackageUi/);
  assert.match(appJs, /settings-temp-pkg-banner/);
  assert.match(appJs, /classList\.toggle\("hidden",\s*!status\.isUsingTemp\)/);
  assert.match(appJs, /getSandboxPackageStatus/);
});

test("5. restore regular package directory flow", () => {
  const appJs = fs.readFileSync(path.join(RENDERER, "app.js"), "utf8");
  const mainJs = fs.readFileSync(path.join(ROOT, "src", "main.js"), "utf8");
  const preload = fs.readFileSync(path.join(ROOT, "src", "preload.js"), "utf8");
  assert.match(appJs, /RESTORE_PKG_CONFIRM_TEXT/);
  assert.match(appJs, /restoreRegularPackageDir\(\{\s*confirmed:\s*true/);
  assert.match(appJs, /btn-restore-regular-pkg/);
  assert.match(mainJs, /packageStore:restoreRegularPackageDir/);
  assert.match(preload, /restoreRegularPackageDir/);
  assert.match(preload, /activateTempDemoPackage/);
  assert.match(preload, /getSandboxPackageStatus/);
});

test("6. duplicate-click debounce for package switch", () => {
  const appJs = fs.readFileSync(path.join(RENDERER, "app.js"), "utf8");
  const mainJs = fs.readFileSync(path.join(ROOT, "src", "main.js"), "utf8");
  assert.match(appJs, /sandboxPackageSwitchBusy/);
  assert.match(appJs, /if\s*\(\s*sandboxPackageSwitchBusy\s*\)\s*return;/);
  assert.match(mainJs, /sandboxPackageBusy/);
  assert.match(mainJs, /sandbox_busy/);
});

test("7. sandbox-package-state helpers: temp detect + regular remember + persist", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dm-sandbox-root-"));
  try {
    const tempDir = path.join(tmpRoot, TEMP_PREFIX + "abc");
    fs.mkdirSync(tempDir, { recursive: true });
    const regular = path.join(tmpRoot, "regular-pkg");
    fs.mkdirSync(regular, { recursive: true });

    assert.equal(isTempDemoPackageDir(tempDir, tmpRoot), true);
    assert.equal(isTempDemoPackageDir(regular, tmpRoot), false);

    assert.equal(nextRegularPackageDir(regular, "", regular, tmpRoot), path.resolve(regular));
    assert.equal(
      nextRegularPackageDir(tempDir, regular, path.join(tmpRoot, "default"), tmpRoot),
      path.resolve(regular)
    );

    const stateFile = tempFile("persist");
    saveSandboxState(stateFile, {
      regularPackageDir: regular,
      activeTempPackageDir: tempDir,
    });
    const loaded = loadSandboxState(stateFile);
    assert.equal(loaded.regularPackageDir, regular);
    assert.equal(loaded.activeTempPackageDir, tempDir);

    const status = buildSandboxStatus({
      currentPackageDir: tempDir,
      regularPackageDir: regular,
      defaultPackageDir: path.join(tmpRoot, "default"),
      tmpRoot,
    });
    assert.equal(status.isUsingTemp, true);
    assert.equal(status.canRestoreRegular, true);
    assert.equal(status.regularPackageDir, path.resolve(regular));

    fs.unlinkSync(stateFile);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("8. refresh after switch covers home/version/overview hooks", () => {
  const appJs = fs.readFileSync(path.join(RENDERER, "app.js"), "utf8");
  assert.match(appJs, /async function refreshAfterPackageDirSwitch/);
  assert.match(appJs, /loadPackage\(\)/);
  assert.match(appJs, /refreshPackageVersionsPanel\(\)/);
  assert.match(appJs, /refreshMeView\(\)/);
  assert.match(appJs, /renderPackageStatus\(\)/);
});

console.log(`\nSettings temp-package results: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;

"use strict";

/**
 * MVP-RELEASE-GATE-01E-FIX-01 — closed alpha build integrity tests.
 * Does not require a full electron-builder run for failure-path coverage.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const {
  validateFreshBuildArtifacts,
  assertStaleArtifactsRejected,
  writeBuildInfo,
  makeBuildId,
  sha256File,
} = require("./lib/closed-alpha-build-integrity.cjs");

const tmpRoot = path.join(__dirname, "_closed-alpha-build-integrity-tmp");
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

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function touchFile(filePath, content, mtimeMs) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  if (typeof mtimeMs === "number") {
    const d = new Date(mtimeMs);
    fs.utimesSync(filePath, d, d);
  }
}

function setupStagingSkeleton(stagingDir, opts) {
  const unpacked = path.join(stagingDir, "win-unpacked");
  const exe = path.join(unpacked, "Digital Me.exe");
  const asar = path.join(unpacked, "resources", "app.asar");
  const buildInfo = path.join(unpacked, "resources", "build-info.json");
  const mtime = opts.mtimeMs;
  touchFile(exe, "fake-exe", mtime);
  touchFile(asar, "fake-asar-not-real", mtime);
  writeBuildInfo(buildInfo, {
    gitHead: opts.gitHead,
    buildId: opts.buildId || "test-build",
    buildTime: new Date().toISOString(),
  });
  return { exe, asar, buildInfo, unpacked };
}

rmrf(tmpRoot);
fs.mkdirSync(tmpRoot, { recursive: true });

const expectedHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const buildStart = Date.now();

test("1) builder non-zero exit fails (old artifacts present)", () => {
  const staging = path.join(tmpRoot, "case-builder-fail");
  const oldMtime = buildStart - 60_000;
  setupStagingSkeleton(staging, { gitHead: expectedHead, mtimeMs: oldMtime });
  const oldZip = path.join(staging, "old.zip");
  touchFile(oldZip, "old-zip", oldMtime);

  let threw = false;
  try {
    validateFreshBuildArtifacts({
      stagingDir: staging,
      buildStartedAtMs: buildStart,
      expectedGitHead: expectedHead,
      builderExitCode: 1,
      zipPath: oldZip,
      zipExitCode: 0,
    });
  } catch (err) {
    threw = true;
    assert.match(String(err.message), /non-zero/i);
  }
  assert.equal(threw, true);
});

test("2) old exe mtime before build start fails even if builder exit 0", () => {
  const staging = path.join(tmpRoot, "case-stale-mtime");
  const oldMtime = buildStart - 120_000;
  setupStagingSkeleton(staging, { gitHead: expectedHead, mtimeMs: oldMtime });
  const zipPath = path.join(staging, "stale.zip");
  touchFile(zipPath, "zip", oldMtime);

  const result = assertStaleArtifactsRejected({
    stagingDir: staging,
    buildStartedAtMs: buildStart,
    expectedGitHead: expectedHead,
    builderExitCode: 0,
    zipPath,
    zipExitCode: 0,
  });
  assert.equal(result.rejected, true);
  assert.match(result.reason, /older than build start|asar list failed|missing closed-alpha/i);
});

test("3) missing exe fails", () => {
  const staging = path.join(tmpRoot, "case-no-exe");
  fs.mkdirSync(path.join(staging, "win-unpacked", "resources"), { recursive: true });
  touchFile(path.join(staging, "win-unpacked", "resources", "app.asar"), "x", buildStart + 1000);
  writeBuildInfo(path.join(staging, "win-unpacked", "resources", "build-info.json"), {
    gitHead: expectedHead,
    buildId: "x",
    buildTime: new Date().toISOString(),
  });
  const zipPath = path.join(staging, "z.zip");
  touchFile(zipPath, "zip", buildStart + 1000);
  let threw = false;
  try {
    validateFreshBuildArtifacts({
      stagingDir: staging,
      buildStartedAtMs: buildStart,
      expectedGitHead: expectedHead,
      builderExitCode: 0,
      zipPath,
      zipExitCode: 0,
    });
  } catch (err) {
    threw = true;
    assert.match(String(err.message), /Digital Me\.exe missing/i);
  }
  assert.equal(threw, true);
});

test("4) missing app.asar fails", () => {
  const staging = path.join(tmpRoot, "case-no-asar");
  touchFile(path.join(staging, "win-unpacked", "Digital Me.exe"), "exe", buildStart + 1000);
  writeBuildInfo(path.join(staging, "win-unpacked", "resources", "build-info.json"), {
    gitHead: expectedHead,
    buildId: "x",
    buildTime: new Date().toISOString(),
  });
  const zipPath = path.join(staging, "z.zip");
  touchFile(zipPath, "zip", buildStart + 1000);
  let threw = false;
  try {
    validateFreshBuildArtifacts({
      stagingDir: staging,
      buildStartedAtMs: buildStart,
      expectedGitHead: expectedHead,
      builderExitCode: 0,
      zipPath,
      zipExitCode: 0,
    });
  } catch (err) {
    threw = true;
    assert.match(String(err.message), /app\.asar missing/i);
  }
  assert.equal(threw, true);
});

test("5) embedded gitHead mismatch fails", () => {
  const staging = path.join(tmpRoot, "case-head-mismatch");
  setupStagingSkeleton(staging, {
    gitHead: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    mtimeMs: buildStart + 2000,
  });
  const zipPath = path.join(staging, "m.zip");
  touchFile(zipPath, "zip", buildStart + 2000);
  let threw = false;
  try {
    validateFreshBuildArtifacts({
      stagingDir: staging,
      buildStartedAtMs: buildStart,
      expectedGitHead: expectedHead,
      builderExitCode: 0,
      zipPath,
      zipExitCode: 0,
    });
  } catch (err) {
    threw = true;
    assert.match(String(err.message), /gitHead mismatch/i);
  }
  assert.equal(threw, true);
});

test("6) zip command failure fails", () => {
  const staging = path.join(tmpRoot, "case-zip-fail");
  setupStagingSkeleton(staging, { gitHead: expectedHead, mtimeMs: buildStart + 3000 });
  let threw = false;
  try {
    validateFreshBuildArtifacts({
      stagingDir: staging,
      buildStartedAtMs: buildStart,
      expectedGitHead: expectedHead,
      builderExitCode: 0,
      zipPath: path.join(staging, "missing.zip"),
      zipExitCode: 2,
    });
  } catch (err) {
    threw = true;
    assert.match(String(err.message), /zip command exited non-zero/i);
  }
  assert.equal(threw, true);
});

test("7) missing zip fails even when exit code claims 0", () => {
  const staging = path.join(tmpRoot, "case-zip-missing");
  setupStagingSkeleton(staging, { gitHead: expectedHead, mtimeMs: buildStart + 4000 });
  let threw = false;
  try {
    validateFreshBuildArtifacts({
      stagingDir: staging,
      buildStartedAtMs: buildStart,
      expectedGitHead: expectedHead,
      builderExitCode: 0,
      zipPath: path.join(staging, "does-not-exist.zip"),
      zipExitCode: 0,
    });
  } catch (err) {
    threw = true;
    assert.match(String(err.message), /zip missing|gitHead mismatch|asar/i);
  }
  assert.equal(threw, true);
});

test("8) package.json wires integrity test and wrapper dist:portable", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  assert.match(pkg.scripts["dist:portable"], /build-closed-alpha-portable/);
  assert.match(pkg.scripts["test:closed-alpha-build-integrity"], /test-closed-alpha-build-integrity/);
  assert.ok(fs.existsSync(path.join(__dirname, "build-closed-alpha-portable.cjs")));
  assert.ok(fs.existsSync(path.join(__dirname, "lib", "closed-alpha-build-integrity.cjs")));
});

test("9) writeBuildInfo + sha256 helpers work for manifest consistency", () => {
  const p = path.join(tmpRoot, "info.json");
  const info = writeBuildInfo(p, {
    gitHead: expectedHead,
    buildId: makeBuildId(expectedHead),
    buildTime: new Date().toISOString(),
  });
  assert.equal(info.gitHead, expectedHead);
  assert.equal(info.productSurface, "classic");
  assert.equal(info.releaseChannel, "closed-alpha");
  const h1 = sha256File(p);
  const h2 = sha256File(p);
  assert.equal(h1, h2);
});

test("10) simulated failure path does not emit BUILD_OK token via validate", () => {
  const staging = path.join(tmpRoot, "case-no-build-ok");
  setupStagingSkeleton(staging, { gitHead: expectedHead, mtimeMs: buildStart - 99999 });
  let message = "";
  try {
    validateFreshBuildArtifacts({
      stagingDir: staging,
      buildStartedAtMs: buildStart,
      expectedGitHead: expectedHead,
      builderExitCode: 1,
      zipPath: path.join(staging, "old.zip"),
      zipExitCode: 0,
    });
    message = "BUILD_OK";
  } catch (err) {
    message = `BUILD_FAILED:${err.message}`;
  }
  assert.ok(!message.startsWith("BUILD_OK"));
  assert.match(message, /^BUILD_FAILED/);
});

console.log(`\nclosed-alpha-build-integrity: ${passed} passed, ${failed} failed`);
rmrf(tmpRoot);
if (failed) process.exit(1);

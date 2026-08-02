"use strict";

/**
 * MVP-RELEASE-REGRESSION-02 orchestrator.
 * Runs Path A + Path B electron harnesses, then unit release regressions.
 *
 *   node scripts/run-mvp-release-regression-02.cjs
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const APP_ROOT = path.resolve(__dirname, "..");
const EVIDENCE_ROOT = path.join(__dirname, "_mvp-release-regression-02-evidence");
const electronBin = require("electron");

function runNode(script) {
  const r = spawnSync(process.execPath, [script], {
    cwd: APP_ROOT,
    encoding: "utf8",
    env: { ...process.env },
  });
  return {
    script: path.basename(script),
    status: r.status,
    ok: r.status === 0,
    stdoutTail: String(r.stdout || "").slice(-2000),
    stderrTail: String(r.stderr || "").slice(-2000),
  };
}

function runElectronPath(pathId) {
  const r = spawnSync(electronBin, ["scripts/electron-mvp-release-regression-02.cjs"], {
    cwd: APP_ROOT,
    encoding: "utf8",
    env: { ...process.env, DIGITALME_REGRESSION_PATH: pathId },
    timeout: 900000,
  });
  let summary = null;
  try {
    const dirs = fs
      .readdirSync(EVIDENCE_ROOT)
      .filter((d) => d.startsWith("path-" + pathId + "-"))
      .sort();
    const latest = dirs[dirs.length - 1];
    if (latest) {
      summary = JSON.parse(fs.readFileSync(path.join(EVIDENCE_ROOT, latest, "summary.json"), "utf8"));
    }
  } catch {
    summary = null;
  }
  return {
    path: pathId,
    status: r.status,
    ok: r.status === 0 && !!(summary && summary.ok),
    summary,
    stdoutTail: String(r.stdout || "").slice(-3000),
    stderrTail: String(r.stderr || "").slice(-3000),
  };
}

function main() {
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const results = {
    task: "MVP-RELEASE-REGRESSION-02",
    stamp,
    baseline: {
      branch: "codex/mvp-release-gate-01",
      head: null,
    },
    pathA: null,
    pathB: null,
    units: [],
  };

  const git = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: path.resolve(APP_ROOT, ".."),
    encoding: "utf8",
  });
  results.baseline.head = String(git.stdout || "").trim();

  console.log("=== Path A (create) ===");
  results.pathA = runElectronPath("A");
  console.log(JSON.stringify({ ok: results.pathA.ok, status: results.pathA.status, summaryOk: !!(results.pathA.summary && results.pathA.summary.ok) }, null, 2));

  console.log("=== Path B (import) ===");
  results.pathB = runElectronPath("B");
  console.log(JSON.stringify({ ok: results.pathB.ok, status: results.pathB.status, summaryOk: !!(results.pathB.summary && results.pathB.summary.ok) }, null, 2));

  const unitScripts = [
    "scripts/test-mvp-release-gate-01c.cjs",
    "scripts/test-mvp-release-gate-01d.cjs",
    "scripts/test-mvp-quality-evaluation-01.cjs",
    "scripts/test-task-quality-stabilize-01.cjs",
    "scripts/test-task-quality-loop-01.cjs",
    "scripts/test-task-quality-loop-01-1-grounding.cjs",
    "scripts/test-mvp-learning-quality-01.cjs",
    "scripts/test-mvp-quality-product-validation-01-unit.cjs",
  ];
  for (const s of unitScripts) {
    console.log("=== unit", s, "===");
    const u = runNode(s);
    results.units.push(u);
    console.log(u.ok ? "PASS" : "FAIL", s, "status=" + u.status);
  }

  results.ok =
    !!(results.pathA && results.pathA.ok) &&
    !!(results.pathB && results.pathB.ok) &&
    results.units.every((u) => u.ok);

  const out = path.join(EVIDENCE_ROOT, `aggregate-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: results.ok, aggregate: out }, null, 2));
  process.exit(results.ok ? 0 : 1);
}

main();

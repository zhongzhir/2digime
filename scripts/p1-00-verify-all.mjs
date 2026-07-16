#!/usr/bin/env node
/**
 * P1-00 automatic verification runner (read-only against Package subject files).
 * Does not commit, push, or modify digital-me-package content.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PKG = path.join(ROOT, "digital-me-package");
const APP_SRC = path.join(ROOT, "digitalme-app", "src");

function run(cmd, args, opts = {}) {
  // Do not use shell:true — workspace paths may contain spaces (e.g. "Digital Me").
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    ...opts,
  });
  return res;
}

function walk(dir, pred) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        stack.push(full);
      } else if (ent.isFile() && pred(full)) out.push(full);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function packageDigest() {
  const files = walk(PKG, () => true);
  const lines = [];
  let totalBytes = 0;
  for (const full of files) {
    const buf = fs.readFileSync(full);
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const rel = path.relative(PKG, full).split(path.sep).join("/");
    totalBytes += buf.length;
    lines.push(`${sha}  ${buf.length}  ${rel}`);
  }
  const manifest = lines.join("\n");
  return {
    fileCount: files.length,
    totalBytes,
    manifestSha256: crypto.createHash("sha256").update(manifest, "utf8").digest("hex"),
    lines,
  };
}

function checkJsSyntax() {
  const files = walk(APP_SRC, (f) => f.endsWith(".js") || f.endsWith(".mjs"));
  const failures = [];
  for (const f of files) {
    const res = run("node", ["--check", f]);
    if (res.status !== 0) {
      failures.push({
        file: path.relative(ROOT, f).split(path.sep).join("/"),
        stderr: (res.stderr || "").slice(0, 300),
      });
    }
  }
  return { ok: failures.length === 0, checked: files.length, failures };
}

function main() {
  const results = [];
  const started = new Date().toISOString();

  // 1) App JS syntax
  const js = checkJsSyntax();
  results.push({
    name: "app_js_syntax",
    ok: js.ok,
    detail: { checked: js.checked, failures: js.failures },
  });

  // 2) Package JSON/JSONL via baseline script (run 1)
  const before = packageDigest();
  const baseline1 = run("node", [
    "scripts/p1-00-package-baseline.mjs",
    "--quiet",
    "--out",
    "build/reports/p1-00-package-baseline.json",
  ]);
  const after1 = packageDigest();
  const baselineOk = baseline1.status === 0;
  results.push({
    name: "package_json_jsonl_parse",
    ok: baselineOk,
    detail: {
      exitCode: baseline1.status,
      stdout: (baseline1.stdout || "").trim(),
      stderr: (baseline1.stderr || "").slice(0, 400),
    },
  });

  // 3) Baseline twice → subject hash identical when data unchanged
  const baseline2 = run("node", [
    "scripts/p1-00-package-baseline.mjs",
    "--quiet",
    "--out",
    "build/reports/p1-00-package-baseline-run2.json",
  ]);
  const after2 = packageDigest();
  const hashStable =
    before.manifestSha256 === after1.manifestSha256 &&
    after1.manifestSha256 === after2.manifestSha256 &&
    before.fileCount === after2.fileCount &&
    before.totalBytes === after2.totalBytes;
  results.push({
    name: "baseline_twice_hash_stable",
    ok: baseline2.status === 0 && hashStable,
    detail: {
      before: before.manifestSha256,
      afterRun1: after1.manifestSha256,
      afterRun2: after2.manifestSha256,
      fileCount: before.fileCount,
      totalBytes: before.totalBytes,
    },
  });

  // 4) Snapshot consistency (if snapshot path provided via env)
  const snapshotRoot = process.env.P1_00_SNAPSHOT_ROOT || "";
  if (snapshotRoot && fs.existsSync(snapshotRoot)) {
    const snapPkg = path.join(snapshotRoot, "digital-me-package");
    const snapFiles = walk(snapPkg, () => true);
    const snapLines = [];
    let snapBytes = 0;
    for (const full of snapFiles) {
      const buf = fs.readFileSync(full);
      const sha = crypto.createHash("sha256").update(buf).digest("hex");
      const rel = path.relative(snapPkg, full).split(path.sep).join("/");
      snapBytes += buf.length;
      snapLines.push(`${sha}  ${buf.length}  ${rel}`);
    }
    const snapManifest = snapLines.join("\n");
    const snapSha = crypto.createHash("sha256").update(snapManifest, "utf8").digest("hex");
    const snapOk =
      snapFiles.length === before.fileCount &&
      snapBytes === before.totalBytes &&
      snapSha === before.manifestSha256;
    results.push({
      name: "snapshot_matches_source_package",
      ok: snapOk,
      detail: {
        snapshotRootHint: snapshotRoot.split(/[/\\]/).slice(-2).join("/"),
        source: {
          fileCount: before.fileCount,
          totalBytes: before.totalBytes,
          manifestSha256: before.manifestSha256,
        },
        snapshot: {
          fileCount: snapFiles.length,
          totalBytes: snapBytes,
          manifestSha256: snapSha,
        },
      },
    });
  } else {
    results.push({
      name: "snapshot_matches_source_package",
      ok: false,
      detail: { skipped: false, reason: "P1_00_SNAPSHOT_ROOT not set or missing" },
    });
  }

  // 5) git status must not include forbidden paths
  const gs = run("git", ["status", "--porcelain"]);
  const statusText = `${gs.stdout || ""}\n${gs.stderr || ""}`;
  const statusLines = (gs.stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const forbidden = [
    /node_modules/,
    /(^|\/)secrets?\//i,
    /config\.local\.json/i,
    /\.env(\.|$)/,
    /package-snapshots/,
    /\.digitalme-snapshots/,
    /build\/_p1_00_scratch/,
    /build\/p1-00-diagnostics/,
    /source-materials\//,
  ];
  const bad = statusLines.filter((line) => forbidden.some((re) => re.test(line)));
  results.push({
    name: "git_status_excludes_sensitive",
    ok: gs.status === 0 && bad.length === 0,
    detail: {
      trackedCandidates: statusLines.length,
      forbiddenHits: bad.slice(0, 20),
    },
  });

  // 6) Package hash unchanged across this verification itself
  const finalDigest = packageDigest();
  results.push({
    name: "package_unchanged_after_task_checks",
    ok: finalDigest.manifestSha256 === before.manifestSha256,
    detail: {
      before: before.manifestSha256,
      after: finalDigest.manifestSha256,
      fileCount: finalDigest.fileCount,
      totalBytes: finalDigest.totalBytes,
    },
  });

  const allOk = results.every((r) => r.ok);
  const report = {
    task: "P1-00",
    startedAtUtc: started,
    finishedAtUtc: new Date().toISOString(),
    ok: allOk,
    results,
    packageDigest: {
      fileCount: finalDigest.fileCount,
      totalBytes: finalDigest.totalBytes,
      manifestSha256: finalDigest.manifestSha256,
    },
  };

  const outDir = path.join(ROOT, "build", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "p1-00-verify-all.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({ ok: allOk, out: path.relative(ROOT, outFile).split(path.sep).join("/"), results: results.map((r) => ({ name: r.name, ok: r.ok })) }, null, 2));
  process.exitCode = allOk ? 0 : 1;
}

main();

#!/usr/bin/env node
/**
 * P1-00 create read-only Package snapshot OUTSIDE the Git worktree tracking set.
 * Default target: %USERPROFILE%/DigitalMe-baselines/<name>
 * Also writes recovery notes. Does not modify source Package.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PKG = path.join(ROOT, "digital-me-package");

function walk(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      if (ent.name === ".git") continue;
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) out.push(full);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function sha256File(full) {
  const buf = fs.readFileSync(full);
  return {
    size: buf.length,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
  };
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyRecursive(from, to);
    else if (ent.isFile()) fs.copyFileSync(from, to);
  }
}

function digestOf(dir) {
  const files = walk(dir);
  const lines = [];
  let totalBytes = 0;
  for (const full of files) {
    const { size, sha256 } = sha256File(full);
    const rel = path.relative(dir, full).split(path.sep).join("/");
    totalBytes += size;
    lines.push(`${sha256}  ${size}  ${rel}`);
  }
  const manifest = lines.join("\n");
  return {
    fileCount: files.length,
    totalBytes,
    manifestSha256: crypto.createHash("sha256").update(manifest, "utf8").digest("hex"),
    lines,
  };
}

function readPackageVersion() {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(PKG, "manifest.json"), "utf8"));
    return String(m.packageVersion || "unknown");
  } catch {
    return "unknown";
  }
}

function assertOutsideGitOrIgnored(targetRoot) {
  const resolved = path.resolve(targetRoot);
  const rootResolved = path.resolve(ROOT);
  const insideWorkspace = resolved === rootResolved || resolved.startsWith(rootResolved + path.sep);
  if (!insideWorkspace) return { ok: true, mode: "outside-workspace" };

  // If inside workspace, must be under an ignored snapshot directory name.
  const rel = path.relative(rootResolved, resolved).split(path.sep).join("/");
  const allowedPrefix = [".digitalme-snapshots/", "build/package-snapshots/"];
  if (allowedPrefix.some((p) => rel === p.slice(0, -1) || rel.startsWith(p))) {
    return { ok: true, mode: "gitignored-inside-workspace", relative: rel };
  }
  return {
    ok: false,
    mode: "blocked",
    reason: `Snapshot target is inside workspace but not under ignored snapshot dirs: ${rel}`,
  };
}

function main() {
  if (!fs.existsSync(PKG)) {
    console.error("digital-me-package not found");
    process.exit(2);
  }

  const version = readPackageVersion();
  const utc = new Date().toISOString().replace(/[:.]/g, "-");
  const stamp = utc.replace(/\.\d+Z$/, "Z");
  const dirName = `digital-me-package-v${version}-${stamp}`;

  const defaultRoot = path.join(os.homedir(), "DigitalMe-baselines");
  const baseRoot = process.env.P1_00_SNAPSHOT_BASE || defaultRoot;
  const snapshotRoot = path.join(baseRoot, dirName);

  const gate = assertOutsideGitOrIgnored(snapshotRoot);
  if (!gate.ok) {
    console.error(gate.reason);
    process.exit(3);
  }

  if (fs.existsSync(snapshotRoot)) {
    console.error("Snapshot directory already exists; refusing to overwrite.");
    process.exit(4);
  }

  const before = digestOf(PKG);
  fs.mkdirSync(snapshotRoot, { recursive: true });
  copyRecursive(PKG, path.join(snapshotRoot, "digital-me-package"));

  // Copy redacted baseline report if present
  const reportSrc = path.join(ROOT, "build", "reports", "p1-00-package-baseline.json");
  const summarySrc = path.join(ROOT, "build", "reports", "p1-00-package-baseline.summary.md");
  if (fs.existsSync(reportSrc)) {
    fs.copyFileSync(reportSrc, path.join(snapshotRoot, "p1-00-package-baseline.json"));
  }
  if (fs.existsSync(summarySrc)) {
    fs.copyFileSync(summarySrc, path.join(snapshotRoot, "p1-00-package-baseline.summary.md"));
  }

  const afterSnap = digestOf(path.join(snapshotRoot, "digital-me-package"));
  const inventoryPath = path.join(snapshotRoot, "FILE_INVENTORY_SHA256.txt");
  fs.writeFileSync(inventoryPath, afterSnap.lines.join("\n") + "\n", "utf8");
  const inventoryHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(inventoryPath))
    .digest("hex");

  const match =
    before.fileCount === afterSnap.fileCount &&
    before.totalBytes === afterSnap.totalBytes &&
    before.manifestSha256 === afterSnap.manifestSha256;

  const recovery = [
    "# Package 快照恢复说明（P1-00）",
    "",
    "本快照仅用于迁移与回滚基线。**P1-00 不执行恢复覆盖。**",
    "",
    "## 快照信息",
    "",
    `- 目录名：\`${dirName}\``,
    `- Package version：${version}`,
    `- 源文件数：${before.fileCount}`,
    `- 源总字节：${before.totalBytes}`,
    `- 源清单 SHA-256：\`${before.manifestSha256}\``,
    `- 快照清单 SHA-256：\`${afterSnap.manifestSha256}\``,
    `- 清单文件自身 SHA-256：\`${inventoryHash}\``,
    `- 复制一致性：${match ? "一致" : "不一致（任务失败）"}`,
    `- 存放模式：${gate.mode}`,
    "",
    "## 恢复步骤（仅在 Owner 明确要求时执行）",
    "",
    "1. 停止 Digital Me App；",
    "2. 将当前 `digital-me-package/` 另行另存为应急副本；",
    "3. 用本快照内 `digital-me-package/` 整目录替换工作区同名目录；",
    "4. 重新运行 `node scripts/p1-00-package-baseline.mjs`，确认清单 SHA-256 与本说明一致；",
    "5. 再启动应用。",
    "",
    "## 注意",
    "",
    "- 本目录应保持在 Git 跟踪范围之外；",
    "- 不要把快照同步到公开位置；",
    "- 恢复会覆盖工作区 Package，务必先二次备份。",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(snapshotRoot, "RESTORE.md"), recovery, "utf8");

  const meta = {
    task: "P1-00",
    createdAtUtc: new Date().toISOString(),
    snapshotRoot,
    packageVersion: version,
    gate,
    source: before,
    snapshot: afterSnap,
    inventoryFileSha256: inventoryHash,
    match,
  };
  fs.writeFileSync(path.join(snapshotRoot, "SNAPSHOT_META.json"), JSON.stringify(meta, null, 2), "utf8");

  // Pointer inside workspace (gitignored diagnostics only stores absolute path for Owner)
  const pointerDir = path.join(ROOT, "build", "reports");
  fs.mkdirSync(pointerDir, { recursive: true });
  fs.writeFileSync(
    path.join(pointerDir, "p1-00-snapshot-pointer.json"),
    JSON.stringify(
      {
        snapshotRoot,
        packageVersion: version,
        manifestSha256: afterSnap.manifestSha256,
        match,
        createdAtUtc: meta.createdAtUtc,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        ok: match,
        snapshotRoot,
        fileCount: afterSnap.fileCount,
        totalBytes: afterSnap.totalBytes,
        manifestSha256: afterSnap.manifestSha256,
        match,
      },
      null,
      2
    )
  );
  process.exitCode = match ? 0 : 1;
}

main();

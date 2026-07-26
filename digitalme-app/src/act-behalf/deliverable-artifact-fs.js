"use strict";

/**
 * DVL2-03 artifact filesystem — relative paths under <userData>/deliverable-artifacts/
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function artifactsRoot(userData) {
  return path.join(userData, "deliverable-artifacts");
}

function versionRelDir(packageId, deliverableId, versionId) {
  return path
    .join("deliverable-artifacts", String(packageId), String(deliverableId), String(versionId))
    .replace(/\\/g, "/");
}

function assertSafeRelative(rel) {
  const s = String(rel || "").replace(/\\/g, "/");
  if (!s || s.startsWith("/") || /^[a-zA-Z]:/.test(s)) {
    const e = new Error("成果路径无效。");
    e.code = "unsafe_artifact_path";
    throw e;
  }
  const parts = s.split("/");
  if (parts.some((p) => p === ".." || p === "")) {
    const e = new Error("成果路径包含非法片段。");
    e.code = "path_traversal_rejected";
    throw e;
  }
  if (!s.startsWith("deliverable-artifacts/")) {
    const e = new Error("成果路径必须位于成果目录内。");
    e.code = "unsafe_artifact_path";
    throw e;
  }
  return s;
}

function resolveAbsolute(userData, relativePath) {
  const rel = assertSafeRelative(relativePath);
  const abs = path.resolve(userData, rel);
  const root = path.resolve(artifactsRoot(userData));
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    const e = new Error("成果路径越界。");
    e.code = "path_traversal_rejected";
    throw e;
  }
  return abs;
}

function sha256Hex(buf) {
  return "sha256:" + crypto.createHash("sha256").update(buf).digest("hex");
}

function contentHashOfFile(absPath) {
  return sha256Hex(fs.readFileSync(absPath));
}

/**
 * Write files into staging then atomically rename to final version directory.
 * @param {object} files map of filename -> Buffer|string
 */
async function commitVersionFiles(userData, { packageId, deliverableId, versionId, files, manifest }) {
  const relDir = versionRelDir(packageId, deliverableId, versionId);
  const finalAbs = resolveAbsolute(userData, relDir);
  const stagingAbs = finalAbs + ".staging." + process.pid + "." + Date.now();
  fs.mkdirSync(stagingAbs, { recursive: true });
  try {
    const written = [];
    for (const [name, data] of Object.entries(files || {})) {
      if (name.includes("..") || name.includes("/") || name.includes("\\")) {
        const e = new Error("非法文件名。");
        e.code = "unsafe_artifact_path";
        throw e;
      }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
      const p = path.join(stagingAbs, name);
      fs.writeFileSync(p, buf);
      written.push({
        name,
        relativePath: (relDir + "/" + name).replace(/\\/g, "/"),
        contentHash: sha256Hex(buf),
        byteSize: buf.length,
      });
    }
    const man = {
      ...(manifest || {}),
      schemaVersion: 1,
      packageId,
      deliverableId,
      versionId,
      createdAt: new Date().toISOString(),
      files: written.map((w) => ({
        name: w.name,
        relativePath: w.relativePath,
        contentHash: w.contentHash,
        byteSize: w.byteSize,
      })),
    };
    fs.writeFileSync(path.join(stagingAbs, "manifest.json"), JSON.stringify(man, null, 2), "utf8");
    if (fs.existsSync(finalAbs)) {
      const e = new Error("版本目录已存在，禁止覆盖。");
      e.code = "version_dir_exists";
      throw e;
    }
    fs.renameSync(stagingAbs, finalAbs);
    return { relDir, files: written, manifest: man };
  } catch (err) {
    try {
      fs.rmSync(stagingAbs, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** Minimal 1x1 PNG for mock image tests only. */
function minimalPngBuffer() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
}

module.exports = {
  artifactsRoot,
  versionRelDir,
  assertSafeRelative,
  resolveAbsolute,
  sha256Hex,
  contentHashOfFile,
  commitVersionFiles,
  minimalPngBuffer,
};

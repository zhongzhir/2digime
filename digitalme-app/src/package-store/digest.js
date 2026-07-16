"use strict";

/**
 * Package content digest (integrity only — not a signature).
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { isExcludedName } = require("./paths");

const DIGEST_ALG = "sha256";

function hashBuffer(buf) {
  return crypto.createHash(DIGEST_ALG).update(buf).digest("hex");
}

function listContentFiles(packageDir) {
  const rootDir = path.resolve(packageDir);
  const files = [];

  function walk(dir, relBase) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (isExcludedName(ent.name)) continue;
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!ent.isFile()) continue;
      // Normalize any Windows separators that may appear in constructed paths.
      files.push(String(rel).replace(/\\/g, "/"));
    }
  }

  walk(rootDir, "");
  files.sort();
  return files;
}

function computeContentDigest(packageDir) {
  const files = listContentFiles(packageDir);
  const entries = [];
  const rootDir = path.resolve(packageDir);
  for (const rel of files) {
    const full = path.join(rootDir, ...rel.split("/"));
    const buf = fs.readFileSync(full);
    entries.push({ path: rel, sha256: hashBuffer(buf), bytes: buf.length });
  }
  const lines = entries.map((e) => `${e.sha256}  ${e.path}`).join("\n");
  const rootSha256 = hashBuffer(Buffer.from(lines, "utf8"));
  return {
    algorithm: DIGEST_ALG,
    rootSha256,
    fileCount: entries.length,
    files: entries,
  };
}

module.exports = {
  DIGEST_ALG,
  hashBuffer,
  listContentFiles,
  computeContentDigest,
};

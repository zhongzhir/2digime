"use strict";

/**
 * Deterministic temporary Package fixtures for hermetic Phase 1 tests.
 * Never points at or copies the real digital-me-package tree.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const FIXED_UPDATED_AT = "2026-01-01T00:00:00.000Z";
const HERMETIC_PREFIX = "dm-hermetic-pkg-";

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function hermeticFileContents() {
  return {
    "manifest.json":
      JSON.stringify(
        {
          name: "hermetic-digital-me",
          digitalMeId: "hermetic-dm",
          packageVersion: "0.1.0",
          revision: 0,
          updatedAt: FIXED_UPDATED_AT,
        },
        null,
        2
      ) + "\n",
    "persona.md": "# 人格\n\n确定性测试用人格说明。\n",
    "style-guide.md": "# 表达风格\n\n确定性测试用表达风格说明。\n",
    "identity.json":
      JSON.stringify(
        {
          displayName: "测试主体",
          digitalMeId: "hermetic-dm",
        },
        null,
        2
      ) + "\n",
    "decision-frameworks.json": JSON.stringify({ frameworks: [] }, null, 2) + "\n",
    "sources/source-index.json": JSON.stringify({ sources: [] }, null, 2) + "\n",
    "memory/long-term-memory.jsonl": "",
  };
}

function fingerprintFromContents(contents) {
  const files = Object.keys(contents)
    .sort((a, b) => a.localeCompare(b))
    .map((relativePath) => {
      const buf = Buffer.from(contents[relativePath], "utf8");
      return {
        relativePath,
        size: buf.length,
        sha256: sha256Buffer(buf),
      };
    });
  const manifest = files.map((f) => `${f.sha256}  ${f.size}  ${f.relativePath}`).join("\n");
  return {
    fileCount: files.length,
    totalBytes: files.reduce((n, f) => n + f.size, 0),
    manifestSha256: sha256Buffer(Buffer.from(manifest, "utf8")),
    files,
  };
}

function walkPackageFiles(packageDir) {
  const out = [];
  function walk(rel) {
    const abs = path.join(packageDir, rel);
    const st = fs.lstatSync(abs);
    if (st.isDirectory()) {
      if (rel === ".digitalme-pkgstore") return;
      for (const name of fs.readdirSync(abs).sort()) {
        walk(rel ? `${rel}/${name}` : name);
      }
      return;
    }
    if (!st.isFile()) return;
    const buf = fs.readFileSync(abs);
    out.push({
      relativePath: rel.replace(/\\/g, "/"),
      size: buf.length,
      sha256: sha256Buffer(buf),
    });
  }
  walk("");
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function fingerprintPackage(packageDir) {
  const files = walkPackageFiles(packageDir);
  const manifest = files.map((f) => `${f.sha256}  ${f.size}  ${f.relativePath}`).join("\n");
  return {
    fileCount: files.length,
    totalBytes: files.reduce((n, f) => n + f.size, 0),
    manifestSha256: sha256Buffer(Buffer.from(manifest, "utf8")),
    files,
  };
}

/**
 * Create a deterministic Package under os.tmpdir().
 * @param {string} [label]
 * @returns {{ packageDir: string, expected: object, fingerprint: object }}
 */
function createHermeticPackageFixture(label = "pkg") {
  const contents = hermeticFileContents();
  const expected = fingerprintFromContents(contents);
  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), `${HERMETIC_PREFIX}${label}-`));
  for (const [rel, body] of Object.entries(contents)) {
    const abs = path.join(packageDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  }
  const fingerprint = fingerprintPackage(packageDir);
  return { packageDir, expected, fingerprint };
}

function cleanupHermeticPackageFixture(packageDir) {
  if (!packageDir) return;
  try {
    fs.rmSync(packageDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

module.exports = {
  FIXED_UPDATED_AT,
  HERMETIC_PREFIX,
  hermeticFileContents,
  fingerprintFromContents,
  fingerprintPackage,
  walkPackageFiles,
  createHermeticPackageFixture,
  cleanupHermeticPackageFixture,
};

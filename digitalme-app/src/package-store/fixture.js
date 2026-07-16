"use strict";

/**
 * Minimal Digital Me Package fixtures for sandbox + tests.
 * Never point these helpers at the real digital-me-package tree.
 */

const fs = require("node:fs");
const path = require("node:path");

/**
 * @param {string} dir Absolute directory to populate (must already exist or be creatable).
 * @param {{ schemaVersion?: string, withMemoryLine?: boolean }} [opts]
 */
function createMinimalFixture(dir, opts = {}) {
  const root = path.resolve(dir);
  fs.mkdirSync(path.join(root, "memory"), { recursive: true });

  const now = new Date().toISOString();
  const manifest = {
    name: "demo-digital-me",
    digitalMeId: "demo-dm",
    packageVersion: "0.1.0",
    revision: 0,
    updatedAt: now,
  };
  if (opts.schemaVersion) {
    manifest.schemaVersion = opts.schemaVersion;
  }

  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(
    path.join(root, "persona.md"),
    "# 人格\n\n演示用人格说明。\n\n## 不应代表本人做出的事项\n\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, "style-guide.md"),
    "# 表达风格\n\n演示用表达风格说明。\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, "identity.json"),
    JSON.stringify(
      {
        displayName: "演示",
        digitalMeId: "demo-dm",
      },
      null,
      2
    ),
    "utf8"
  );

  const memPath = path.join(root, "memory", "long-term-memory.jsonl");
  if (opts.withMemoryLine) {
    const row = {
      id: "core_001",
      type: "long_term",
      content: "演示记忆：仅用于沙盒。",
      theme: "演示",
      confidence: "medium",
      sensitivity: "private",
      createdAt: now,
      sourceRefs: ["fixture"],
      expiresAt: null,
    };
    fs.writeFileSync(memPath, JSON.stringify(row) + "\n", "utf8");
  } else {
    fs.writeFileSync(memPath, "", "utf8");
  }

  return root;
}

module.exports = { createMinimalFixture };

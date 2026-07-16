"use strict";

/**
 * PackageStore read helpers with a strict no-write contract.
 * These functions never create the package store or normalize its contents.
 */

const fs = require("node:fs");
const path = require("node:path");
const { SCHEMA_VERSION, assertManifestShape } = require("./schema");
const {
  listContentFiles,
  assertNoSymlinksOrEscapes,
  hashBuffer,
} = require("./digest");
const { storeRootFor } = require("./paths");

function readJsonStrict(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function inspectPackageReadOnly(packageDir) {
  const dir = path.resolve(packageDir);
  const issues = [];
  const result = {
    packageDir: dir,
    exists: fs.existsSync(dir),
    schemaVersion: null,
    packageVersion: null,
    revision: null,
    digitalMeId: null,
    updatedAt: null,
    contentDigest: null,
    fileCount: 0,
    healthy: false,
    issues,
  };
  if (!result.exists) {
    issues.push({ code: "package_missing", message: "package_missing" });
    return result;
  }

  try {
    assertNoSymlinksOrEscapes(dir);
  } catch (e) {
    issues.push({ code: e.code || "symlink_rejected", message: e.message, path: e.path });
  }

  let manifest = null;
  try {
    manifest = readJsonStrict(path.join(dir, "manifest.json"));
  } catch (e) {
    issues.push({
      code: e && e.code === "ENOENT" ? "manifest_missing" : "manifest_parse_error",
      message: e.message,
    });
    return result;
  }

  try {
    assertManifestShape(manifest, { requireV02: false });
  } catch (e) {
    issues.push({ code: e.code || "manifest_invalid", message: e.message });
  }
  result.schemaVersion = manifest.schemaVersion ?? null;
  result.packageVersion = manifest.packageVersion ?? null;
  result.revision = typeof manifest.revision === "number" ? manifest.revision : null;
  result.digitalMeId = manifest.digitalMeId ?? null;
  result.updatedAt = manifest.updatedAt ?? null;
  result.contentDigest = manifest.contentDigest || null;

  if (manifest.schemaVersion === SCHEMA_VERSION) {
    try {
      assertManifestShape(manifest, { requireV02: true });
    } catch (e) {
      issues.push({ code: e.code || "manifest_v02_invalid", message: e.message });
    }
  } else if (manifest.schemaVersion != null) {
    issues.push({ code: "schema_not_v02", message: `schemaVersion=${manifest.schemaVersion}` });
  } else {
    issues.push({ code: "schema_unversioned_or_v01", message: "schema_unversioned_or_v01" });
  }

  try {
    const files = listContentFiles(dir);
    result.fileCount = files.length;
    for (const rel of files) {
      const abs = path.join(dir, ...rel.split("/"));
      try {
        if (rel.endsWith(".json")) {
          readJsonStrict(abs);
        } else if (rel.endsWith(".jsonl")) {
          const lines = fs
            .readFileSync(abs, "utf8")
            .split(/\r?\n/)
            .filter((line) => line.trim());
          for (const line of lines) JSON.parse(line);
        }
      } catch (e) {
        issues.push({
          code: rel.endsWith(".jsonl") ? "jsonl_invalid" : "json_invalid",
          path: rel,
          message: e.message,
        });
      }
    }
  } catch (e) {
    issues.push({ code: e.code || "list_files_failed", message: e.message });
  }

  if (manifest.contentDigest && manifest.contentDigest.rootSha256) {
    try {
      const entries = [];
      for (const rel of listContentFiles(dir)) {
        let buf;
        if (rel === "manifest.json") {
          const canonical = { ...manifest };
          delete canonical.contentDigest;
          buf = Buffer.from(JSON.stringify(canonical, null, 2), "utf8");
        } else {
          buf = fs.readFileSync(path.join(dir, ...rel.split("/")));
        }
        entries.push({ path: rel, sha256: hashBuffer(buf) });
      }
      const actualRoot = hashBuffer(
        Buffer.from(entries.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n"), "utf8")
      );
      if (actualRoot !== manifest.contentDigest.rootSha256) {
        issues.push({
          code: "content_digest_mismatch",
          message: "content_digest_mismatch",
        });
      }
    } catch (e) {
      issues.push({ code: e.code || "content_digest_mismatch", message: e.message });
    }
  }

  result.healthy = issues.length === 0 && manifest.schemaVersion === SCHEMA_VERSION;
  return result;
}

function listPackageVersionsReadOnly(packageDir) {
  const dir = path.resolve(packageDir);
  const storeRoot = storeRootFor(dir);
  const snapshotRoot = path.join(storeRoot, "snapshots");
  const versions = [];

  let names = [];
  try {
    names = fs.readdirSync(snapshotRoot);
  } catch {
    names = [];
  }
  for (const name of names) {
    if (!/^v\d+$/.test(name)) continue;
    const full = path.join(snapshotRoot, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let manifest = null;
    let meta = null;
    try {
      manifest = readJsonStrict(path.join(full, "manifest.json"));
    } catch {
      /* malformed snapshot remains unavailable */
    }
    try {
      meta = readJsonStrict(path.join(full, ".snapshot-meta.json"));
    } catch {
      /* optional */
    }
    const revision = Number.parseInt(name.slice(1), 10);
    versions.push({
      versionId: name,
      revision,
      kind: "snapshot",
      capturedAt: meta && meta.capturedAt ? meta.capturedAt : null,
      rootSha256:
        (meta && meta.rootSha256) ||
        (manifest && manifest.contentDigest && manifest.contentDigest.rootSha256) ||
        null,
      updatedAt: manifest && manifest.updatedAt ? manifest.updatedAt : null,
    });
  }

  versions.sort((a, b) => a.revision - b.revision);
  if (fs.existsSync(dir)) {
    let manifest = null;
    try {
      manifest = readJsonStrict(path.join(dir, "manifest.json"));
    } catch {
      /* represented as revision zero when unreadable */
    }
    versions.push({
      versionId: `v${
        manifest && Number.isInteger(manifest.revision) ? manifest.revision : 0
      }`,
      revision: manifest && Number.isInteger(manifest.revision) ? manifest.revision : 0,
      kind: "live",
      capturedAt: null,
      rootSha256:
        manifest && manifest.contentDigest ? manifest.contentDigest.rootSha256 || null : null,
      updatedAt: manifest && manifest.updatedAt ? manifest.updatedAt : null,
    });
  }
  return versions;
}

module.exports = { inspectPackageReadOnly, listPackageVersionsReadOnly };

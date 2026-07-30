"use strict";

/**
 * MVP-RELEASE-GATE-01D — bounded artifact ↔ Store reconciliation.
 * Authority remains DeliverableVersion / ArtifactRef in Store.
 * Disk-only trees are isolated, never auto-promoted.
 */

const fs = require("node:fs");
const path = require("node:path");

const packageStore = require("./deliverable-package-store");
const artifactFs = require("./deliverable-artifact-fs");

const DEFAULT_STAGING_MAX_AGE_MS = 60 * 60 * 1000; // 1h

function nowIso() {
  return new Date().toISOString();
}

function listVersionDirs(userData) {
  const root = artifactFs.artifactsRoot(userData);
  const out = [];
  if (!fs.existsSync(root)) return out;

  let packages;
  try {
    packages = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const pkgEnt of packages) {
    if (!pkgEnt.isDirectory()) continue;
    if (pkgEnt.name === "_orphaned" || pkgEnt.name === "_quarantine") continue;
    const pkgPath = path.join(root, pkgEnt.name);
    let dels;
    try {
      dels = fs.readdirSync(pkgPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const delEnt of dels) {
      if (!delEnt.isDirectory()) continue;
      const delPath = path.join(pkgPath, delEnt.name);
      let vers;
      try {
        vers = fs.readdirSync(delPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const verEnt of vers) {
        if (!verEnt.isDirectory()) continue;
        const name = verEnt.name;
        const abs = path.join(delPath, name);
        const isStaging = /\.staging\./.test(name);
        const versionId = isStaging ? name.split(".staging.")[0] : name;
        out.push({
          abs,
          name,
          packageId: pkgEnt.name,
          deliverableId: delEnt.name,
          versionId,
          isStaging,
          rel: path
            .join("deliverable-artifacts", pkgEnt.name, delEnt.name, name)
            .replace(/\\/g, "/"),
        });
      }
    }
  }
  return out;
}

function collectReferencedVersionIds(store) {
  const ids = new Set();
  for (const v of Object.values(store.versions || {})) {
    if (v && v.id) ids.add(String(v.id));
  }
  for (const art of Object.values(store.artifacts || {})) {
    if (art && art.versionId) ids.add(String(art.versionId));
  }
  return ids;
}

function collectActiveAttemptIds(store) {
  const ids = new Set();
  for (const a of Object.values(store.generationAttempts || {})) {
    if (a && (a.status === "generating" || a.status === "repairing")) {
      ids.add(String(a.id));
    }
  }
  return ids;
}

function isolatePath(userData, abs, reason) {
  const root = artifactFs.artifactsRoot(userData);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destRoot = path.join(root, "_orphaned", stamp);
  fs.mkdirSync(destRoot, { recursive: true });
  const base = path.basename(abs);
  let dest = path.join(destRoot, base);
  let n = 2;
  while (fs.existsSync(dest)) {
    dest = path.join(destRoot, base + "_" + n);
    n += 1;
  }
  try {
    fs.renameSync(abs, dest);
    return { ok: true, from: abs, to: dest, reason };
  } catch (err) {
    return { ok: false, from: abs, reason, error: err && err.message };
  }
}

function artifactFileMissing(userData, artifact) {
  if (!artifact || !artifact.relativePath) return true;
  try {
    const abs = artifactFs.resolveAbsolute(userData, artifact.relativePath);
    return !(fs.existsSync(abs) && fs.statSync(abs).isFile());
  } catch {
    return true;
  }
}

/**
 * @returns {{
 *   ok: true,
 *   matched: number,
 *   missingFiles: Array<object>,
 *   orphansIsolated: Array<object>,
 *   stagingIsolated: Array<object>,
 *   stagingKept: Array<object>,
 * }}
 */
function reconcileArtifactFilesystem(userData, opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const isolateOrphans = options.isolateOrphans !== false;
  const stagingMaxAgeMs =
    options.stagingMaxAgeMs != null ? Number(options.stagingMaxAgeMs) : DEFAULT_STAGING_MAX_AGE_MS;

  let store;
  try {
    store = packageStore.loadStore(userData);
  } catch (err) {
    return {
      ok: false,
      code: err && err.code,
      message: err && err.message,
      matched: 0,
      missingFiles: [],
      orphansIsolated: [],
      stagingIsolated: [],
      stagingKept: [],
    };
  }

  const referenced = collectReferencedVersionIds(store);
  const activeAttempts = collectActiveAttemptIds(store);
  const dirs = listVersionDirs(userData);

  const missingFiles = [];
  for (const art of Object.values(store.artifacts || {})) {
    if (!art) continue;
    if (artifactFileMissing(userData, art)) {
      missingFiles.push({
        artifactId: art.id,
        versionId: art.versionId,
        relativePath: art.relativePath,
      });
    }
  }

  let matched = 0;
  const orphansIsolated = [];
  const stagingIsolated = [];
  const stagingKept = [];

  for (const dir of dirs) {
    if (dir.isStaging) {
      let ageMs = 0;
      try {
        ageMs = Date.now() - fs.statSync(dir.abs).mtimeMs;
      } catch {
        ageMs = stagingMaxAgeMs + 1;
      }
      // Keep staging if a generation is still marked active (heal should clear first).
      if (activeAttempts.size > 0 && ageMs < stagingMaxAgeMs) {
        stagingKept.push({ rel: dir.rel, reason: "active_attempt_or_fresh" });
        continue;
      }
      if (ageMs >= stagingMaxAgeMs || activeAttempts.size === 0) {
        if (isolateOrphans) {
          const moved = isolatePath(userData, dir.abs, "stale_staging");
          stagingIsolated.push(moved);
        }
      }
      continue;
    }

    if (referenced.has(String(dir.versionId))) {
      matched += 1;
      continue;
    }

    // Disk tree without Store entry — never auto-promote.
    if (isolateOrphans) {
      const moved = isolatePath(userData, dir.abs, "orphan_version_dir");
      orphansIsolated.push({
        ...moved,
        packageId: dir.packageId,
        deliverableId: dir.deliverableId,
        versionId: dir.versionId,
      });
    }
  }

  return {
    ok: true,
    matched,
    missingFiles,
    orphansIsolated,
    stagingIsolated,
    stagingKept,
    reconciledAt: nowIso(),
  };
}

/**
 * Runtime projection for UI — does not mutate Store.
 */
function projectArtifactAvailability(userData, artifactId) {
  const store = packageStore.loadStore(userData);
  const art = store.artifacts && store.artifacts[String(artifactId || "")];
  if (!art) {
    return { available: false, code: "artifact_not_found", message: "成果文件不存在。" };
  }
  if (artifactFileMissing(userData, art)) {
    return {
      available: false,
      code: "file_missing",
      message: "这个成果的本地文件暂时不可用。你可以重新生成。",
      artifactId: art.id,
      versionId: art.versionId,
    };
  }
  return { available: true, artifactId: art.id, versionId: art.versionId };
}

module.exports = {
  reconcileArtifactFilesystem,
  projectArtifactAvailability,
  listVersionDirs,
  artifactFileMissing,
  DEFAULT_STAGING_MAX_AGE_MS,
};

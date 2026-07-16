"use strict";

/**
 * PackageStore — unique write entry for Digital Me Package (P1-02).
 * Candidate change sets → confirmed commit → journaled same-volume swap.
 * Content digest is integrity only, never a signature.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  SCHEMA_VERSION,
  PACKAGE_VERSION_DEFAULT,
  DATA_KINDS,
  MAX_REASON_LEN,
  MAX_CONTENT_LEN,
  MAX_CHANGESET_OPS,
  assertManifestShape,
  assertActor,
  assertSourceRefs,
  assertDataKinds,
  assertMigrationMetadata,
  assertChangeSetSize,
} = require("./schema");
const {
  normalizeRel,
  resolveInsidePackage,
  storeRootFor,
} = require("./paths");
const {
  computeContentDigest,
  listContentFiles,
  hashBuffer,
  assertNoSymlinksOrEscapes,
} = require("./digest");
const {
  ensureDir,
  rmrf,
  copyTree,
  writeJsonAtomic,
  readJson,
  dirByteFingerprint,
} = require("./fs-util");
const { PackageLock } = require("./lock");
const { applyOps } = require("./apply-ops");
const {
  writeJournalRecord,
  clearJournal,
  cleanupJournalArtifacts,
  recoverJournalState,
  readLatestJournal,
  journalsDir,
} = require("./journal");

const ALLOWED_OPS = new Set([
  "append_jsonl",
  "ensure_section_append",
  "write_text",
]);

const MAX_DIFF_CHARS = 4000;
const PREVIEW_TMP = "preview-tmp";

function err(code, message, extra) {
  const e = new Error(message || code);
  e.code = code;
  if (extra && typeof extra === "object") Object.assign(e, extra);
  return e;
}

function isoNow() {
  return new Date().toISOString();
}

function readManifest(packageDir) {
  return readJson(path.join(packageDir, "manifest.json"), null);
}

function fileSha256IfExists(packageDir, rel) {
  try {
    const abs = resolveInsidePackage(packageDir, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return hashBuffer(fs.readFileSync(abs));
  } catch {
    return null;
  }
}

function readTextIfExists(packageDir, rel) {
  try {
    const abs = resolveInsidePackage(packageDir, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function truncateText(s, max = MAX_DIFF_CHARS) {
  if (s == null) return null;
  const t = String(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…（已截断）`;
}

function newChangeSetId() {
  const t = Date.now().toString(36);
  const r = crypto.randomBytes(4).toString("hex");
  return `cs_${t}_${r}`;
}

function snapshotDirName(revision) {
  return `v${revision}`;
}

function parseVersionId(versionId) {
  const s = String(versionId || "").trim();
  const m = /^v?(\d+)$/i.exec(s);
  if (!m) throw err("version_invalid", "version_invalid");
  return parseInt(m[1], 10);
}

function safeDigest(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  try {
    return computeContentDigest(dir);
  } catch {
    return null;
  }
}

function safeRevision(dir) {
  try {
    const m = readManifest(dir);
    if (m && typeof m.revision === "number" && Number.isInteger(m.revision)) return m.revision;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Digest was computed while manifest lacked contentDigest.
 * Verify by hashing a canonical manifest without that field.
 */
function verifyStoredContentDigest(packageDir) {
  const manifest = readManifest(packageDir);
  assertManifestShape(manifest, { requireV02: true });
  const stored = manifest.contentDigest;
  if (!stored || stored.algorithm !== "sha256" || typeof stored.rootSha256 !== "string") {
    throw err("content_digest_missing", "content_digest_missing");
  }

  const files = listContentFiles(packageDir);
  const entries = [];
  const rootDir = path.resolve(packageDir);
  for (const rel of files) {
    let buf;
    if (rel === "manifest.json") {
      const canonical = { ...manifest };
      delete canonical.contentDigest;
      buf = Buffer.from(JSON.stringify(canonical, null, 2), "utf8");
    } else {
      try {
        buf = fs.readFileSync(path.join(rootDir, ...rel.split("/")));
      } catch (e) {
        throw err("read_failed", "read_failed", { path: rel, cause: e && e.message });
      }
    }
    entries.push({ path: rel, sha256: hashBuffer(buf), bytes: buf.length });
  }
  const lines = entries.map((e) => `${e.sha256}  ${e.path}`).join("\n");
  const rootSha256 = hashBuffer(Buffer.from(lines, "utf8"));
  if (rootSha256 !== stored.rootSha256) {
    throw err("content_digest_mismatch", "content_digest_mismatch", {
      expected: stored.rootSha256,
      actual: rootSha256,
    });
  }
  return { rootSha256, fileCount: entries.length };
}

function writeManifestWithDigest(packageDir, manifestFields) {
  const manifestPath = path.join(packageDir, "manifest.json");
  const base = { ...manifestFields };
  delete base.contentDigest;
  writeJsonAtomic(manifestPath, base);
  const digest = computeContentDigest(packageDir);
  const finalManifest = {
    ...base,
    contentDigest: {
      algorithm: digest.algorithm,
      rootSha256: digest.rootSha256,
      fileCount: digest.fileCount,
      files: digest.files,
    },
  };
  writeJsonAtomic(manifestPath, finalManifest);
  return finalManifest;
}

function validateJsonFile(abs) {
  const text = fs.readFileSync(abs, "utf8");
  JSON.parse(text);
}

function validateJsonlFile(abs) {
  const text = fs.readFileSync(abs, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    JSON.parse(line);
  }
}

function validatePackageTree(packageDir) {
  assertNoSymlinksOrEscapes(packageDir);
  const issues = [];
  const root = path.resolve(packageDir);
  const files = listContentFiles(packageDir);
  for (const rel of files) {
    const abs = path.join(root, ...rel.split("/"));
    if (rel.endsWith(".json")) {
      try {
        validateJsonFile(abs);
      } catch (e) {
        issues.push({ code: "json_invalid", path: rel, message: e.message });
      }
    } else if (rel.endsWith(".jsonl")) {
      try {
        validateJsonlFile(abs);
      } catch (e) {
        issues.push({ code: "jsonl_invalid", path: rel, message: e.message });
      }
    }
  }
  const manifest = readManifest(packageDir);
  try {
    assertManifestShape(manifest, { requireV02: true });
  } catch (e) {
    issues.push({ code: e.code || "manifest_invalid", path: "manifest.json", message: e.message });
  }
  if (issues.length) {
    throw err("staging_validation_failed", "staging_validation_failed", { issues });
  }
  verifyStoredContentDigest(packageDir);
}

class PackageStore {
  /**
   * @param {{ packageDir: string, hooks?: object, actor?: string, ownerId?: string }} opts
   * `actor` / `ownerId` are logical identifiers only; each commit/rollback/recover
   * acquires a fresh lock operationToken.
   */
  constructor(opts = {}) {
    if (!opts || !opts.packageDir) {
      throw err("package_dir_required", "package_dir_required");
    }
    this.packageDir = path.resolve(opts.packageDir);
    this.hooks = opts.hooks || {};
    this.actor = opts.actor || opts.ownerId || `pid:${process.pid}`;
    this.ownerId = this.actor;
    this.storeRoot = storeRootFor(this.packageDir);
    this.lock = new PackageLock(this.storeRoot, this.hooks);
    this._ensureStoreLayout();
  }

  _ensureStoreLayout() {
    ensureDir(this.storeRoot);
    ensureDir(path.join(this.storeRoot, "changesets"));
    ensureDir(path.join(this.storeRoot, "snapshots"));
    ensureDir(journalsDir(this.storeRoot));
  }

  _hook(name, ...args) {
    const fn = this.hooks[name];
    if (typeof fn === "function") fn(...args);
  }

  _readJournal() {
    // Promote complete publishing files left by a crash, then read highest generation.
    recoverJournalState(this.storeRoot);
    return readLatestJournal(this.storeRoot);
  }

  _writeJournal(body) {
    writeJournalRecord(this.storeRoot, body, {
      beforeWriteJournal: (b) => this._hook("beforeWriteJournal", b),
      beforeJournalPublish: (info) => this._hook("beforeJournalPublish", info),
      beforeJournalRename: (info) => this._hook("beforeJournalRename", info),
      afterWriteJournal: (rec, p) => this._hook("afterWriteJournal", rec, p),
    });
  }

  _clearJournal() {
    clearJournal(this.storeRoot);
    cleanupJournalArtifacts(this.storeRoot);
  }

  _cleanupStoreArtifacts() {
    cleanupJournalArtifacts(this.storeRoot);
  }

  _changeSetPath(id) {
    return path.join(this.storeRoot, "changesets", `${id}.json`);
  }

  _loadChangeSet(changeSetId) {
    const id = String(changeSetId || "").trim();
    if (!id) throw err("changeset_not_found", "changeset_not_found");
    const cs = readJson(this._changeSetPath(id), null);
    if (!cs || cs.id !== id) throw err("changeset_not_found", "changeset_not_found");
    return cs;
  }

  _saveChangeSet(cs) {
    writeJsonAtomic(this._changeSetPath(cs.id), cs);
  }

  _stagingPath() {
    return path.join(this.storeRoot, "staging");
  }

  _backupPath() {
    return path.join(this.storeRoot, "swap-backup");
  }

  _snapshotPath(revision) {
    return path.join(this.storeRoot, "snapshots", snapshotDirName(revision));
  }

  /**
   * Publish snapshot without deleting existing vN.
   * Writes to snapshots/.publishing-vN-<token>/ then renames to vN.
   * If vN already exists: verify package content (excluding .snapshot-meta.json)
   * matches source; mismatch → snapshot_conflict. Never rmrf(vN).
   */
  _publishSnapshot(revision, sourceDir, meta) {
    const snapRoot = path.join(this.storeRoot, "snapshots");
    ensureDir(snapRoot);
    const finalPath = this._snapshotPath(revision);
    const token = crypto.randomBytes(8).toString("hex");
    const publishing = path.join(snapRoot, `.publishing-v${revision}-${token}`);

    this._hook("beforeSnapshot", { revision, publishing, finalPath });

    const sourceDigest = computeContentDigest(sourceDir);

    if (fs.existsSync(finalPath)) {
      const existingDigest = this._snapshotContentDigest(finalPath);
      if (existingDigest.rootSha256 !== sourceDigest.rootSha256) {
        throw err("snapshot_conflict", "snapshot_conflict", {
          revision,
          existingRootSha256: existingDigest.rootSha256,
          intendedRootSha256: sourceDigest.rootSha256,
        });
      }
      // Identical package content — keep existing vN byte-identical.
      return finalPath;
    }

    rmrf(publishing);
    copyTree(sourceDir, publishing);
    this._hook("afterSnapshotCopy", { revision, publishing, finalPath });
    writeJsonAtomic(path.join(publishing, ".snapshot-meta.json"), {
      ...meta,
      revision,
      rootSha256: (meta && meta.rootSha256) || sourceDigest.rootSha256,
      capturedAt: meta && meta.capturedAt ? meta.capturedAt : isoNow(),
    });

    // Verify publishing content (sans meta) still matches source before rename.
    const publishedDigest = this._snapshotContentDigest(publishing);
    if (publishedDigest.rootSha256 !== sourceDigest.rootSha256) {
      rmrf(publishing);
      throw err("snapshot_publish_mismatch", "snapshot_publish_mismatch");
    }

    this._hook("beforeSnapshotRename", { publishing, finalPath });
    fs.renameSync(publishing, finalPath);
    return finalPath;
  }

  /** Content digest of a snapshot dir, ignoring .snapshot-meta.json. */
  _snapshotContentDigest(dir) {
    const files = listContentFiles(dir).filter((f) => f !== ".snapshot-meta.json");
    const entries = [];
    const rootDir = path.resolve(dir);
    for (const rel of files) {
      const full = path.join(rootDir, ...rel.split("/"));
      let buf;
      try {
        buf = fs.readFileSync(full);
      } catch (e) {
        throw err("read_failed", "read_failed", { path: full, cause: e && e.message });
      }
      entries.push({ path: rel, sha256: hashBuffer(buf), bytes: buf.length });
    }
    const lines = entries.map((e) => `${e.sha256}  ${e.path}`).join("\n");
    const rootSha256 = hashBuffer(Buffer.from(lines, "utf8"));
    return {
      algorithm: "sha256",
      rootSha256,
      fileCount: entries.length,
      files: entries,
    };
  }

  _currentLiveState() {
    const manifest = readManifest(this.packageDir);
    let digest = null;
    let rootSha256 = null;
    let revision = 0;
    if (manifest && typeof manifest === "object") {
      if (typeof manifest.revision === "number" && Number.isInteger(manifest.revision)) {
        revision = manifest.revision;
      }
      if (manifest.contentDigest && manifest.contentDigest.rootSha256) {
        digest = manifest.contentDigest;
        rootSha256 = digest.rootSha256;
      }
    }
    if (!rootSha256 && fs.existsSync(this.packageDir)) {
      try {
        const computed = computeContentDigest(this.packageDir);
        rootSha256 = computed.rootSha256;
        digest = digest || computed;
      } catch {
        /* inspect/create may handle */
      }
    }
    return { manifest, revision, rootSha256, digest };
  }

  /**
   * Read-only package health / version report.
   * @param {string} [packageDir]
   */
  inspect(packageDir) {
    const dir = path.resolve(packageDir || this.packageDir);
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
      manifest = readManifest(dir);
    } catch (e) {
      issues.push({ code: "manifest_parse_error", message: e.message });
      return result;
    }

    if (!manifest) {
      issues.push({ code: "manifest_missing", message: "manifest_missing" });
    } else {
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
      } else if (manifest.schemaVersion != null && manifest.schemaVersion !== SCHEMA_VERSION) {
        issues.push({
          code: "schema_not_v02",
          message: `schemaVersion=${manifest.schemaVersion}`,
        });
      } else {
        issues.push({ code: "schema_unversioned_or_v01", message: "schema_unversioned_or_v01" });
      }
    }

    try {
      const files = listContentFiles(dir);
      result.fileCount = files.length;
      for (const rel of files) {
        const abs = path.join(dir, ...rel.split("/"));
        if (rel.endsWith(".json")) {
          try {
            validateJsonFile(abs);
          } catch (e) {
            issues.push({ code: "json_invalid", path: rel, message: e.message });
          }
        } else if (rel.endsWith(".jsonl")) {
          try {
            validateJsonlFile(abs);
          } catch (e) {
            issues.push({ code: "jsonl_invalid", path: rel, message: e.message });
          }
        }
      }
    } catch (e) {
      issues.push({ code: e.code || "list_files_failed", message: e.message });
    }

    if (manifest && manifest.contentDigest && manifest.contentDigest.rootSha256) {
      try {
        verifyStoredContentDigest(dir);
      } catch (e) {
        issues.push({ code: e.code || "content_digest_mismatch", message: e.message });
      }
    }

    result.healthy = issues.length === 0 && manifest && manifest.schemaVersion === SCHEMA_VERSION;
    return result;
  }

  /**
   * Explicit v0.1 → v0.2 migration via the normal commit path.
   * Idempotent when already schema 0.2 with a content digest.
   */
  migrateToV02({ actor, toolVersion } = {}) {
    const live = this._currentLiveState();
    const m = live.manifest;
    if (
      m &&
      m.schemaVersion === SCHEMA_VERSION &&
      m.contentDigest &&
      m.contentDigest.rootSha256
    ) {
      return {
        migrated: false,
        idempotent: true,
        revision: live.revision,
        schemaVersion: SCHEMA_VERSION,
        rootSha256: m.contentDigest.rootSha256,
      };
    }

    const who = assertActor(String(actor || this.actor || "migration"));
    const tool = String(toolVersion || "package-store");
    const cs = this.createChangeSet({
      actor: who,
      reason: `显式迁移至 schema ${SCHEMA_VERSION}`,
      sourceRefs: [
        {
          type: "migration",
          from: (m && m.schemaVersion) || "0.1",
          to: SCHEMA_VERSION,
          toolVersion: tool,
        },
      ],
      dataKinds: ["capability_policy"],
      ops: [],
      migration: {
        from: (m && m.schemaVersion) || "0.1",
        to: SCHEMA_VERSION,
        toolVersion: tool,
      },
    });

    const committed = this.commit(cs.id, {
      confirmed: true,
      actor: who,
      reason: `显式迁移至 schema ${SCHEMA_VERSION}`,
    });

    return {
      migrated: true,
      idempotent: false,
      changeSetId: cs.id,
      revision: committed.revision,
      schemaVersion: SCHEMA_VERSION,
      rootSha256: committed.rootSha256,
      migration: {
        from: (m && m.schemaVersion) || "0.1",
        to: SCHEMA_VERSION,
        toolVersion: tool,
        at: isoNow(),
        result: "ok",
      },
    };
  }

  /**
   * Build a candidate change set. Does not modify the live Package.
   */
  createChangeSet(intent = {}) {
    const actor = assertActor(intent.actor);
    const reason = String(intent.reason || "");
    if (!reason || reason.length > MAX_REASON_LEN) {
      throw err("reason_invalid", "reason_invalid");
    }

    const opsIn = Array.isArray(intent.ops) ? intent.ops : [];
    if (opsIn.length > MAX_CHANGESET_OPS) {
      throw err("too_many_ops", "too_many_ops");
    }

    const dataKinds = assertDataKinds(intent.dataKinds);
    const sourceRefs = assertSourceRefs(intent.sourceRefs);
    const migration = assertMigrationMetadata(intent.migration);

    const ops = [];
    const affectedPaths = [];
    for (const raw of opsIn) {
      if (!raw || typeof raw !== "object") throw err("op_invalid", "op_invalid");
      const type = String(raw.type || "");
      if (!ALLOWED_OPS.has(type)) throw err("op_not_allowed", "op_not_allowed", { type });

      // Manifest only via writeManifestWithDigest — forbid in change-set ops.
      const rel = normalizeRel(raw.path, { allowManifest: false });
      resolveInsidePackage(this.packageDir, rel);

      if (type === "append_jsonl") {
        if (!raw.row || typeof raw.row !== "object" || Array.isArray(raw.row)) {
          throw err("op_row_invalid", "op_row_invalid");
        }
        const rowJson = JSON.stringify(raw.row);
        if (rowJson.length > MAX_CONTENT_LEN) throw err("content_too_large", "content_too_large");
        ops.push({ type, path: rel, row: { ...raw.row } });
      } else if (type === "ensure_section_append") {
        const section = String(raw.section || "");
        const line = String(raw.line || "");
        if (!section || !line) throw err("op_section_invalid", "op_section_invalid");
        if (section.length > MAX_CONTENT_LEN || line.length > MAX_CONTENT_LEN) {
          throw err("content_too_large", "content_too_large");
        }
        ops.push({ type, path: rel, section, line });
      } else if (type === "write_text") {
        const content = String(raw.content ?? "");
        if (content.length > MAX_CONTENT_LEN) throw err("content_too_large", "content_too_large");
        ops.push({ type, path: rel, content });
      }
      affectedPaths.push(rel);
    }

    const uniquePaths = [...new Set(affectedPaths)];
    const live = this._currentLiveState();
    const beforeHashes = {};
    for (const rel of uniquePaths) {
      beforeHashes[rel] = fileSha256IfExists(this.packageDir, rel);
    }

    const id = newChangeSetId();
    const cs = {
      id,
      baseRevision: live.revision,
      baseRootSha256: live.rootSha256,
      actor,
      reason,
      sourceRefs,
      dataKinds,
      ops,
      affectedPaths: uniquePaths,
      beforeHashes,
      afterHashes: null,
      createdAt: isoNow(),
      status: "candidate",
    };
    if (migration) cs.migration = migration;

    assertChangeSetSize(cs);

    this._ensureStoreLayout();
    this._saveChangeSet(cs);
    return { ...cs };
  }

  /**
   * Human-readable preview diffs. Relative package paths only.
   */
  preview(changeSetId) {
    const cs = this._loadChangeSet(changeSetId);
    const tmp = path.join(this.storeRoot, PREVIEW_TMP);
    rmrf(tmp);
    ensureDir(path.dirname(tmp));
    copyTree(this.packageDir, tmp);

    const beforeTexts = {};
    for (const rel of cs.affectedPaths || []) {
      beforeTexts[rel] = readTextIfExists(tmp, rel);
    }

    if (cs.ops && cs.ops.length) {
      applyOps(tmp, cs.ops);
    }

    const diffs = [];
    const paths = cs.affectedPaths && cs.affectedPaths.length
      ? cs.affectedPaths
      : [];
    for (const rel of paths) {
      const afterText = readTextIfExists(tmp, rel);
      const beforeText = beforeTexts[rel];
      let change = "unchanged";
      if (beforeText == null && afterText != null) change = "created";
      else if (beforeText != null && afterText == null) change = "removed";
      else if (beforeText !== afterText) change = "modified";
      diffs.push({
        path: rel,
        change,
        before: truncateText(beforeText),
        after: truncateText(afterText),
      });
    }

    rmrf(tmp);

    return {
      changeSetId: cs.id,
      baseRevision: cs.baseRevision,
      actor: cs.actor,
      reason: cs.reason,
      dataKinds: cs.dataKinds,
      sourceRefs: cs.sourceRefs,
      affectedPaths: cs.affectedPaths,
      diffs,
    };
  }

  /**
   * Commit a previously created change set. Requires confirmation.confirmed === true.
   */
  commit(changeSetId, confirmation = {}) {
    if (!confirmation || confirmation.confirmed !== true) {
      throw err("confirmation_required", "confirmation_required");
    }

    const cs = this._loadChangeSet(changeSetId);
    if (cs.status === "committed") {
      throw err("changeset_already_committed", "changeset_already_committed");
    }

    this._ensureStoreLayout();
    const lockInfo = this.lock.acquire(this.actor);

    const staging = this._stagingPath();
    const backup = this._backupPath();
    let revisionBefore = 0;
    let revisionAfter = 0;
    let finalManifest = null;
    let swapped = false;

    try {
      this.lock.heartbeat(lockInfo.operationToken);
      const live = this._currentLiveState();
      revisionBefore = live.revision;

      if (cs.baseRevision !== live.revision) {
        throw err("conflict_revision", "conflict_revision", {
          baseRevision: cs.baseRevision,
          currentRevision: live.revision,
        });
      }
      if (cs.baseRootSha256 && live.rootSha256 && cs.baseRootSha256 !== live.rootSha256) {
        throw err("conflict_root_hash", "conflict_root_hash");
      }
      for (const rel of cs.affectedPaths || []) {
        const nowHash = fileSha256IfExists(this.packageDir, rel);
        const baseHash = cs.beforeHashes ? cs.beforeHashes[rel] : undefined;
        if ((baseHash || null) !== (nowHash || null)) {
          throw err("conflict_before_hash", "conflict_before_hash", { path: rel });
        }
      }

      assertNoSymlinksOrEscapes(this.packageDir);

      // Snapshot current live (immutable history) — never rmrf existing vN.
      const snapPath = this._publishSnapshot(revisionBefore, this.packageDir, {
        changeSetId: cs.id,
        rootSha256: live.rootSha256,
      });

      this.lock.heartbeat(lockInfo.operationToken);

      this._writeJournal({
        phase: "staging",
        op: "commit",
        changeSetId: cs.id,
        revisionBefore,
        livePath: this.packageDir,
        stagingPath: staging,
        backupPath: backup,
        snapshotPath: snapPath,
        backupRootSha256: live.rootSha256,
      });

      this._hook("beforeStaging", { changeSetId: cs.id });
      rmrf(staging);
      copyTree(this.packageDir, staging);
      if (cs.ops && cs.ops.length) {
        applyOps(staging, cs.ops);
      }

      revisionAfter = revisionBefore + 1;
      const prevManifest = readManifest(staging) || {};
      const nextFields = {
        ...prevManifest,
        schemaVersion: SCHEMA_VERSION,
        packageVersion: prevManifest.packageVersion || PACKAGE_VERSION_DEFAULT,
        revision: revisionAfter,
        digitalMeId: prevManifest.digitalMeId || prevManifest.id || "unknown",
        updatedAt: isoNow(),
      };
      if (cs.migration) {
        nextFields.migration = {
          ...(prevManifest.migration || {}),
          last: {
            ...cs.migration,
            at: isoNow(),
            changeSetId: cs.id,
            result: "ok",
          },
        };
      }
      finalManifest = writeManifestWithDigest(staging, nextFields);

      this._hook("beforeValidateStaging", { staging });
      validatePackageTree(staging);

      const afterHashes = {};
      for (const rel of cs.affectedPaths || []) {
        afterHashes[rel] = fileSha256IfExists(staging, rel);
      }

      const expectedRootSha256 = finalManifest.contentDigest.rootSha256;
      const backupRootSha256 = live.rootSha256;

      this._writeJournal({
        phase: "swapping",
        op: "commit",
        changeSetId: cs.id,
        revisionBefore,
        revisionAfter,
        livePath: this.packageDir,
        stagingPath: staging,
        backupPath: backup,
        snapshotPath: snapPath,
        expectedRootSha256,
        backupRootSha256,
      });

      this.lock.heartbeat(lockInfo.operationToken);

      this._hook("beforeSwap", {
        live: this.packageDir,
        staging,
        backup,
      });

      rmrf(backup);
      // Two-step directory rename on the same volume.
      fs.renameSync(this.packageDir, backup);
      try {
        this._hook("injectSwapFailureAfterBackup");
        fs.renameSync(staging, this.packageDir);
        swapped = true;
      } catch (swapErr) {
        // Best-effort restore from backup; never claim success.
        try {
          if (!fs.existsSync(this.packageDir) && fs.existsSync(backup)) {
            fs.renameSync(backup, this.packageDir);
          }
        } catch {
          /* recover() will handle ambiguous state */
        }
        this._writeJournal({
          phase: "swapping",
          op: "commit",
          changeSetId: cs.id,
          revisionBefore,
          revisionAfter,
          livePath: this.packageDir,
          stagingPath: staging,
          backupPath: backup,
          expectedRootSha256,
          backupRootSha256,
          swapError: swapErr.code || swapErr.message,
          failed: true,
        });
        throw err("swap_failed", "swap_failed", { cause: swapErr });
      }

      this._hook("beforePostVerify");
      verifyStoredContentDigest(this.packageDir);
      const post = readManifest(this.packageDir);
      if (!post || post.revision !== revisionAfter) {
        throw err("post_verify_failed", "post_verify_failed");
      }

      cs.status = "committed";
      cs.committedAt = isoNow();
      cs.afterHashes = afterHashes;
      cs.resultRevision = revisionAfter;
      cs.resultRootSha256 = finalManifest.contentDigest.rootSha256;
      this._saveChangeSet(cs);

      this._writeJournal({
        phase: "committed",
        op: "commit",
        changeSetId: cs.id,
        revisionBefore,
        revisionAfter,
        livePath: this.packageDir,
        backupPath: backup,
        expectedRootSha256,
        backupRootSha256,
      });

      // Cleanup: drop swap-backup and any staging residue after success.
      rmrf(backup);
      rmrf(staging);
      this._clearJournal();

      return {
        ok: true,
        changeSetId: cs.id,
        revision: revisionAfter,
        previousRevision: revisionBefore,
        affectedPaths: cs.affectedPaths,
        rootSha256: finalManifest.contentDigest.rootSha256,
        rollbackVersion: snapshotDirName(revisionBefore),
      };
    } catch (e) {
      if (!swapped) {
        // Live should be unchanged; discard incomplete staging when safe.
        try {
          if (fs.existsSync(this.packageDir)) rmrf(staging);
        } catch {
          /* ignore */
        }
      }
      throw e;
    } finally {
      this.lock.release(lockInfo.operationToken);
    }
  }

  listVersions() {
    const snapRoot = path.join(this.storeRoot, "snapshots");
    ensureDir(snapRoot);
    const live = this._currentLiveState();
    const versions = [];

    let names = [];
    try {
      names = fs.readdirSync(snapRoot);
    } catch {
      names = [];
    }

    for (const name of names) {
      if (name.startsWith(".publishing-")) continue;
      const full = path.join(snapRoot, name);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      let rev;
      try {
        rev = parseVersionId(name);
      } catch {
        continue;
      }
      const meta = readJson(path.join(full, ".snapshot-meta.json"), null);
      const man = readManifest(full);
      versions.push({
        versionId: snapshotDirName(rev),
        revision: rev,
        kind: "snapshot",
        capturedAt: meta && meta.capturedAt ? meta.capturedAt : null,
        rootSha256:
          (meta && meta.rootSha256) ||
          (man && man.contentDigest && man.contentDigest.rootSha256) ||
          null,
        updatedAt: man && man.updatedAt ? man.updatedAt : null,
      });
    }

    versions.sort((a, b) => a.revision - b.revision);
    versions.push({
      versionId: snapshotDirName(live.revision),
      revision: live.revision,
      kind: "live",
      capturedAt: null,
      rootSha256: live.rootSha256,
      updatedAt: live.manifest && live.manifest.updatedAt ? live.manifest.updatedAt : null,
    });
    return versions;
  }

  diffVersions(from, to) {
    const fromRev = parseVersionId(from);
    const toRev = parseVersionId(to);
    const live = this._currentLiveState();

    const resolveDir = (rev) => {
      if (rev === live.revision) return this.packageDir;
      const p = this._snapshotPath(rev);
      if (!fs.existsSync(p)) throw err("version_not_found", "version_not_found", { versionId: snapshotDirName(rev) });
      return p;
    };

    const fromDir = resolveDir(fromRev);
    const toDir = resolveDir(toRev);
    const fromDigest = computeContentDigest(fromDir);
    const toDigest = computeContentDigest(toDir);
    const fromMap = new Map(fromDigest.files.map((f) => [f.path, f]));
    const toMap = new Map(toDigest.files.map((f) => [f.path, f]));
    const paths = [...new Set([...fromMap.keys(), ...toMap.keys()])].sort();
    const changes = [];
    for (const p of paths) {
      const a = fromMap.get(p);
      const b = toMap.get(p);
      if (!a && b) changes.push({ path: p, change: "added", afterSha256: b.sha256 });
      else if (a && !b) changes.push({ path: p, change: "removed", beforeSha256: a.sha256 });
      else if (a.sha256 !== b.sha256) {
        changes.push({
          path: p,
          change: "modified",
          beforeSha256: a.sha256,
          afterSha256: b.sha256,
        });
      }
    }
    return {
      from: snapshotDirName(fromRev),
      to: snapshotDirName(toRev),
      fromRootSha256: fromDigest.rootSha256,
      toRootSha256: toDigest.rootSha256,
      changes,
    };
  }

  /**
   * Rollback creates a new revision from a snapshot; history is not rewritten.
   */
  rollback(versionId, confirmation = {}) {
    if (!confirmation || confirmation.confirmed !== true) {
      throw err("confirmation_required", "confirmation_required");
    }

    const targetRev = parseVersionId(versionId);
    const snapPath = this._snapshotPath(targetRev);
    if (!fs.existsSync(snapPath)) {
      throw err("version_not_found", "version_not_found", { versionId: snapshotDirName(targetRev) });
    }

    this._ensureStoreLayout();
    const lockInfo = this.lock.acquire(this.actor);

    const staging = this._stagingPath();
    const backup = this._backupPath();
    let revisionBefore = 0;
    let revisionAfter = 0;
    let swapped = false;
    let finalManifest = null;

    try {
      this.lock.heartbeat(lockInfo.operationToken);
      const live = this._currentLiveState();
      revisionBefore = live.revision;

      // Ensure current live is snapshotted without destroying existing vN.
      this._publishSnapshot(revisionBefore, this.packageDir, {
        reason: "pre-rollback",
        rootSha256: live.rootSha256,
      });

      this._writeJournal({
        phase: "staging",
        op: "rollback",
        targetVersion: snapshotDirName(targetRev),
        revisionBefore,
        livePath: this.packageDir,
        stagingPath: staging,
        backupPath: backup,
        backupRootSha256: live.rootSha256,
      });

      this._hook("beforeStaging", { op: "rollback" });
      rmrf(staging);
      copyTree(snapPath, staging);
      // Strip snapshot meta from candidate package content.
      rmrf(path.join(staging, ".snapshot-meta.json"));

      revisionAfter = revisionBefore + 1;
      const prevManifest = readManifest(staging) || {};
      finalManifest = writeManifestWithDigest(staging, {
        ...prevManifest,
        schemaVersion: SCHEMA_VERSION,
        packageVersion: prevManifest.packageVersion || PACKAGE_VERSION_DEFAULT,
        revision: revisionAfter,
        digitalMeId: prevManifest.digitalMeId || prevManifest.id || "unknown",
        updatedAt: isoNow(),
        rollback: {
          fromRevision: revisionBefore,
          restoredSnapshot: snapshotDirName(targetRev),
          at: isoNow(),
        },
      });

      this._hook("beforeValidateStaging", { staging });
      validatePackageTree(staging);

      const expectedRootSha256 = finalManifest.contentDigest.rootSha256;
      const backupRootSha256 = live.rootSha256;

      this._writeJournal({
        phase: "swapping",
        op: "rollback",
        targetVersion: snapshotDirName(targetRev),
        revisionBefore,
        revisionAfter,
        livePath: this.packageDir,
        stagingPath: staging,
        backupPath: backup,
        expectedRootSha256,
        backupRootSha256,
      });

      this.lock.heartbeat(lockInfo.operationToken);

      this._hook("beforeSwap", { op: "rollback" });
      rmrf(backup);
      fs.renameSync(this.packageDir, backup);
      try {
        this._hook("injectSwapFailureAfterBackup");
        fs.renameSync(staging, this.packageDir);
        swapped = true;
      } catch (swapErr) {
        try {
          if (!fs.existsSync(this.packageDir) && fs.existsSync(backup)) {
            fs.renameSync(backup, this.packageDir);
          }
        } catch {
          /* recover() */
        }
        this._writeJournal({
          phase: "swapping",
          op: "rollback",
          targetVersion: snapshotDirName(targetRev),
          revisionBefore,
          revisionAfter,
          livePath: this.packageDir,
          stagingPath: staging,
          backupPath: backup,
          expectedRootSha256,
          backupRootSha256,
          swapError: swapErr.code || swapErr.message,
          failed: true,
        });
        throw err("swap_failed", "swap_failed", { cause: swapErr });
      }

      this._hook("beforePostVerify");
      verifyStoredContentDigest(this.packageDir);

      this._writeJournal({
        phase: "committed",
        op: "rollback",
        revisionBefore,
        revisionAfter,
        targetVersion: snapshotDirName(targetRev),
        expectedRootSha256,
        backupRootSha256,
      });
      rmrf(backup);
      rmrf(staging);
      this._clearJournal();

      return {
        ok: true,
        revision: revisionAfter,
        previousRevision: revisionBefore,
        restoredSnapshot: snapshotDirName(targetRev),
        rootSha256: finalManifest.contentDigest.rootSha256,
        rollbackVersion: snapshotDirName(revisionBefore),
      };
    } catch (e) {
      if (!swapped) {
        try {
          if (fs.existsSync(this.packageDir)) rmrf(staging);
        } catch {
          /* ignore */
        }
      }
      throw e;
    } finally {
      this.lock.release(lockInfo.operationToken);
    }
  }

  /**
   * Recover from an interrupted journal. Fail closed on ambiguous states.
   * Always acquires lock with a fresh operationToken.
   */
  recover() {
    this._ensureStoreLayout();
    const lockInfo = this.lock.acquire(this.actor);
    try {
      return this._recoverLocked();
    } finally {
      this.lock.release(lockInfo.operationToken);
    }
  }

  _recoverLocked() {
    this._cleanupStoreArtifacts();
    const journal = this._readJournal();
    const staging = this._stagingPath();
    const backup = this._backupPath();
    const liveExists = fs.existsSync(this.packageDir);
    const backupExists = fs.existsSync(backup);
    const stagingExists = fs.existsSync(staging);

    if (!journal || !journal.phase) {
      // Fail closed when multiple version candidates exist without a journal.
      if (liveExists && backupExists) {
        throw err("recover_ambiguous", "recover_ambiguous", {
          phase: null,
          hint: "no_journal_live_and_backup",
          liveExists: true,
          backupExists: true,
          stagingExists,
        });
      }
      if (!liveExists && backupExists && stagingExists) {
        throw err("recover_ambiguous", "recover_ambiguous", {
          phase: null,
          hint: "no_journal_multiple_candidates",
          liveExists: false,
          backupExists: true,
          stagingExists: true,
        });
      }
      // Unique live + orphan staging only: discard staging.
      if (liveExists && stagingExists && !backupExists) {
        rmrf(staging);
        return { ok: true, action: "cleared_orphan_staging", phase: null };
      }
      // Unique backup, no live, no staging: restore after digest+revision check.
      if (!liveExists && backupExists && !stagingExists) {
        const dig = safeDigest(backup);
        const rev = safeRevision(backup);
        if (!dig || rev == null) {
          throw err("recover_ambiguous", "recover_ambiguous", {
            phase: null,
            hint: "no_journal_backup_unverified",
          });
        }
        fs.renameSync(backup, this.packageDir);
        return {
          ok: true,
          action: "restored_unique_verified_backup",
          phase: null,
          revision: rev,
          rootSha256: dig.rootSha256,
        };
      }
      if (!liveExists && (backupExists || stagingExists)) {
        throw err("recover_ambiguous", "recover_ambiguous", {
          liveExists,
          backupExists,
          stagingExists,
        });
      }
      return { ok: true, action: "noop", phase: null };
    }

    const phase = journal.phase;

    if (phase === "staging") {
      // Staging incomplete — live is authoritative.
      if (!liveExists) {
        if (backupExists) {
          fs.renameSync(backup, this.packageDir);
          rmrf(staging);
          this._clearJournal();
          return { ok: true, action: "restored_backup", phase };
        }
        throw err("recover_ambiguous", "recover_ambiguous", { phase, liveExists, backupExists });
      }
      rmrf(staging);
      this._clearJournal();
      return { ok: true, action: "discarded_staging", phase };
    }

    if (phase === "swapping") {
      return this._recoverSwapping(journal, {
        staging,
        backup,
        liveExists,
        backupExists,
        stagingExists,
      });
    }

    if (phase === "committed") {
      rmrf(backup);
      rmrf(staging);
      this._clearJournal();
      return { ok: true, action: "cleaned_after_committed", phase };
    }

    throw err("recover_ambiguous", "recover_ambiguous", { phase });
  }

  _recoverSwapping(journal, ctx) {
    const { staging, backup, liveExists, backupExists, stagingExists } = ctx;
    const expected = journal.expectedRootSha256;
    const backupHash = journal.backupRootSha256;
    const revisionBefore = journal.revisionBefore;
    const revisionAfter = journal.revisionAfter;
    const phase = journal.phase;

    const liveDigest = liveExists ? safeDigest(this.packageDir) : null;
    const backupDigest = backupExists ? safeDigest(backup) : null;
    const liveRev = liveExists ? safeRevision(this.packageDir) : null;

    // live matches expected + revisionAfter → finalize cleanup
    if (
      liveExists &&
      liveDigest &&
      expected &&
      liveDigest.rootSha256 === expected &&
      (revisionAfter == null || liveRev === revisionAfter)
    ) {
      rmrf(staging);
      rmrf(backup);
      this._clearJournal();
      return { ok: true, action: "finalize_swap_live_present", phase };
    }

    // live matches backup hash + revisionBefore → discard staging (swap never completed / rolled back)
    if (
      liveExists &&
      liveDigest &&
      backupHash &&
      liveDigest.rootSha256 === backupHash &&
      (revisionBefore == null || liveRev === revisionBefore)
    ) {
      rmrf(staging);
      // If backup also present and matches, drop it; otherwise keep evidence if mismatch.
      if (backupExists) {
        if (backupDigest && backupDigest.rootSha256 === backupHash) {
          rmrf(backup);
        } else if (!backupDigest) {
          // unreadable backup with live already restored — ambiguous
          throw err("recover_ambiguous", "recover_ambiguous", {
            phase,
            hint: "live_matches_backup_hash_but_backup_unreadable",
          });
        } else {
          throw err("recover_ambiguous", "recover_ambiguous", {
            phase,
            hint: "live_and_backup_both_present_hash_mismatch",
          });
        }
      }
      this._clearJournal();
      return { ok: true, action: "discarded_staging_after_swap_interrupt", phase };
    }

    // live missing + backup matches backupRootSha256 → restore backup
    if (!liveExists && backupExists) {
      if (!backupHash) {
        // Legacy journal without hash — still restore unique backup if staging alone isn't claiming victory.
        fs.renameSync(backup, this.packageDir);
        rmrf(staging);
        this._clearJournal();
        return { ok: true, action: "restored_backup_after_swap_interrupt", phase };
      }
      if (backupDigest && backupDigest.rootSha256 === backupHash) {
        fs.renameSync(backup, this.packageDir);
        rmrf(staging);
        this._clearJournal();
        return { ok: true, action: "restored_backup_after_swap_interrupt", phase };
      }
      throw err("recover_ambiguous", "recover_ambiguous", {
        phase,
        hint: "backup_hash_mismatch",
        expectedBackup: backupHash,
        actualBackup: backupDigest && backupDigest.rootSha256,
      });
    }

    // live destroyed/unreadable and backup missing → integrity / ambiguous, keep journal
    if (!liveExists && !backupExists) {
      throw err("recover_ambiguous", "recover_ambiguous", {
        phase,
        hint: stagingExists ? "only_staging_present" : "live_and_backup_missing",
      });
    }

    // live exists but unreadable
    if (liveExists && !liveDigest) {
      throw err("recover_ambiguous", "recover_ambiguous", {
        phase,
        hint: "live_unreadable",
        backupExists,
      });
    }

    // live exists but digest/revision mismatch → do not clear journal
    throw err("recover_ambiguous", "recover_ambiguous", {
      phase,
      liveExists,
      backupExists,
      stagingExists,
      liveRootSha256: liveDigest && liveDigest.rootSha256,
      liveRevision: liveRev,
      expectedRootSha256: expected,
      backupRootSha256: backupHash,
      revisionBefore,
      revisionAfter,
      hint: "live_digest_or_revision_mismatch",
    });
  }
}

module.exports = {
  PackageStore,
  SCHEMA_VERSION,
  DATA_KINDS,
  computeContentDigest,
  storeRootFor,
  normalizeRel,
  resolveInsidePackage,
  dirByteFingerprint,
  readManifest,
  assertNoSymlinksOrEscapes,
  writeManifestWithDigest,
};

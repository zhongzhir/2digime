"use strict";

/**
 * DVL2-02/03 Package Store — <userData>/deliverable-packages.json
 * Atomic write + write queue + store-level CAS (expectAbsent / expectedRevision).
 * DVL2-03 adds versions / artifacts / generationAttempts collections.
 */

const fs = require("node:fs");
const path = require("node:path");
const { nowIso, isActivePackage } = require("./deliverable-package-schema");

const STORE_SCHEMA_VERSION = 1;
const RENAME_RETRY_WAITS_MS = Object.freeze([50, 150, 350]);
const RENAME_RETRY_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

/** @type {Promise<void>} */
let writeQueueTail = Promise.resolve();

/** In-memory cache — avoid sync re-parse of multi-MB store on every IPC. */
let storeCache = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storePath(userData) {
  return path.join(userData, "deliverable-packages.json");
}

function emptyStore() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    revision: 0,
    packages: {},
    deliverables: {},
    preparationAttempts: {},
    versions: {},
    artifacts: {},
    generationAttempts: {},
    updatedAt: nowIso(),
  };
}

function normalizeStoreShape(parsed) {
  if (!parsed.versions || typeof parsed.versions !== "object") parsed.versions = {};
  if (!parsed.artifacts || typeof parsed.artifacts !== "object") parsed.artifacts = {};
  if (!parsed.generationAttempts || typeof parsed.generationAttempts !== "object") {
    parsed.generationAttempts = {};
  }
  return parsed;
}

function invalidateStoreCache() {
  storeCache = null;
}

function setStoreCache(userData, store, meta) {
  storeCache = {
    userData: String(userData || ""),
    store,
    mtimeMs: meta && meta.mtimeMs != null ? meta.mtimeMs : null,
    size: meta && meta.size != null ? meta.size : null,
    raw: meta && meta.raw != null ? meta.raw : null,
  };
}

function loadStore(userData) {
  const p = storePath(userData);
  if (!fs.existsSync(p)) {
    invalidateStoreCache();
    return emptyStore();
  }
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    invalidateStoreCache();
    return emptyStore();
  }
  const key = String(userData || "");
  if (
    storeCache &&
    storeCache.userData === key &&
    storeCache.mtimeMs === st.mtimeMs &&
    storeCache.size === st.size &&
    storeCache.store
  ) {
    return storeCache.store;
  }
  let raw;
  let parsed;
  try {
    raw = fs.readFileSync(p);
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (err) {
    invalidateStoreCache();
    const e = new Error("成果包存档无法解析，请勿覆盖。");
    e.code = "deliverable_package_parse_failed";
    e.cause = err;
    throw e;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !parsed.packages ||
    typeof parsed.packages !== "object" ||
    !parsed.deliverables ||
    typeof parsed.deliverables !== "object" ||
    !parsed.preparationAttempts ||
    typeof parsed.preparationAttempts !== "object"
  ) {
    invalidateStoreCache();
    const e = new Error("成果包存档格式无效。");
    e.code = "deliverable_package_invalid_store";
    throw e;
  }
  if (parsed.schemaVersion != null && Number(parsed.schemaVersion) !== STORE_SCHEMA_VERSION) {
    invalidateStoreCache();
    const e = new Error("成果包存档版本不受支持。");
    e.code = "deliverable_package_unsupported_schema";
    throw e;
  }
  const store = normalizeStoreShape(parsed);
  setStoreCache(userData, store, { mtimeMs: st.mtimeMs, size: st.size, raw });
  return store;
}

async function persistStoreAtomic(userData, store) {
  const target = storePath(userData);
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = target + ".tmp." + process.pid + "." + Date.now();
  // Compact JSON: pretty-print of multi-MB stores blocks the Electron main thread
  // long enough to freeze OS menus (Owner: 2–3s File menu lag).
  const payload = JSON.stringify(store);
  fs.writeFileSync(tmp, payload, "utf8");
  let lastErr = null;
  for (let attempt = 0; attempt < RENAME_RETRY_WAITS_MS.length + 1; attempt += 1) {
    try {
      fs.renameSync(tmp, target);
      let st = null;
      try {
        st = fs.statSync(target);
      } catch {
        st = null;
      }
      setStoreCache(userData, store, {
        mtimeMs: st ? st.mtimeMs : Date.now(),
        size: st ? st.size : Buffer.byteLength(payload),
        raw: Buffer.from(payload, "utf8"),
      });
      return;
    } catch (err) {
      lastErr = err;
      if (!err || !RENAME_RETRY_CODES.has(err.code)) break;
      if (attempt < RENAME_RETRY_WAITS_MS.length) await sleep(RENAME_RETRY_WAITS_MS[attempt]);
    }
  }
  try {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  invalidateStoreCache();
  throw lastErr || new Error("成果包存档写入失败");
}

function enqueueWrite(task) {
  const run = writeQueueTail.then(
    () => task(),
    () => task()
  );
  writeQueueTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getPackage(userData, packageId) {
  const store = loadStore(userData);
  const pkg = store.packages[String(packageId || "")];
  if (!pkg) return { ok: false, code: "package_not_found", message: "未找到成果包。" };
  return { ok: true, package: clone(pkg), revision: store.revision };
}

function listPackagesForTask(userData, taskId) {
  const store = loadStore(userData);
  const tid = String(taskId || "");
  return Object.values(store.packages || {})
    .filter((p) => p && String(p.taskId) === tid)
    .map(clone);
}

function findPackagesForConfirmed(userData, taskId, planId, versionId) {
  const store = loadStore(userData);
  return Object.values(store.packages || {}).filter(
    (p) =>
      p &&
      String(p.taskId) === String(taskId) &&
      String(p.sourcePlanId) === String(planId) &&
      String(p.sourcePlanVersionId) === String(versionId)
  );
}

function findActivePackageForConfirmed(userData, taskId, planId, versionId) {
  return findPackagesForConfirmed(userData, taskId, planId, versionId).filter(isActivePackage);
}

function getDeliverablesForPackage(userData, packageId) {
  const store = loadStore(userData);
  const pkg = store.packages[String(packageId || "")];
  if (!pkg) return [];
  return (pkg.deliverableIds || [])
    .map((id) => store.deliverables[String(id)])
    .filter(Boolean)
    .map(clone);
}

/**
 * Mutate store inside write queue with CAS.
 * @param {object} [opts]
 * @param {number|null} [opts.expectedRevision] — required for updates when provided
 * @param {boolean} [opts.expectAbsent] — if true, reject when revision>0 AND packages already has key expectAbsentPackageId
 * @param {string} [opts.expectAbsentPackageId]
 */
async function mutateStore(userData, mutator, opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  return enqueueWrite(async () => {
    const store = loadStore(userData);
    const key = String(userData || "");
    const beforeBytes =
      storeCache && storeCache.userData === key && storeCache.raw
        ? storeCache.raw
        : fs.existsSync(storePath(userData))
          ? fs.readFileSync(storePath(userData))
          : Buffer.from("");

    if (options.expectAbsent === true && options.expectAbsentPackageId) {
      if (store.packages[String(options.expectAbsentPackageId)]) {
        const e = new Error("成果包已存在，无法按首次创建写入。");
        e.code = "stale_store_revision";
        e.currentRevision = store.revision;
        throw e;
      }
    }

    if (options.expectedRevision != null) {
      if (Number(options.expectedRevision) !== Number(store.revision)) {
        const e = new Error("成果包存档已变化，请重新加载后再试。");
        e.code = "stale_store_revision";
        e.currentRevision = store.revision;
        // Ensure no write occurred
        const afterExists = fs.existsSync(storePath(userData));
        if (afterExists) {
          const afterBytes = fs.readFileSync(storePath(userData));
          if (!beforeBytes.equals(afterBytes)) {
            /* should not happen — we haven't written */
          }
        }
        throw e;
      }
    }

    const result = mutator(store);
    store.revision = Number(store.revision || 0) + 1;
    store.updatedAt = nowIso();
    store.schemaVersion = STORE_SCHEMA_VERSION;
    await persistStoreAtomic(userData, store);
    return { ok: true, revision: store.revision, result };
  });
}

async function saveNewPackageBundle(userData, { package: pkg, deliverables, attempt, expectedRevision }) {
  return mutateStore(
    userData,
    (store) => {
      const activeSame = Object.values(store.packages).filter(
        (p) =>
          isActivePackage(p) &&
          String(p.taskId) === String(pkg.taskId) &&
          String(p.sourcePlanId) === String(pkg.sourcePlanId) &&
          String(p.sourcePlanVersionId) === String(pkg.sourcePlanVersionId)
      );
      if (activeSame.length > 0) {
        const e = new Error("该确认计划已有有效成果包。");
        e.code = "duplicate_active_package";
        throw e;
      }
      store.packages[pkg.id] = pkg;
      for (const d of deliverables || []) {
        store.deliverables[d.id] = d;
      }
      if (attempt) store.preparationAttempts[attempt.id] = attempt;
      return { packageId: pkg.id, attemptId: attempt && attempt.id };
    },
    { expectedRevision, expectAbsent: true, expectAbsentPackageId: pkg.id }
  );
}

async function appendPreparationAttempt(userData, attempt, expectedRevision) {
  return mutateStore(
    userData,
    (store) => {
      if (store.preparationAttempts[attempt.id]) {
        const e = new Error("准备记录已存在，禁止覆盖。");
        e.code = "attempt_overwrite_forbidden";
        throw e;
      }
      store.preparationAttempts[attempt.id] = attempt;
      return { attemptId: attempt.id };
    },
    { expectedRevision }
  );
}

function getPackageView(userData, packageId) {
  const store = loadStore(userData);
  const pkg = store.packages[String(packageId || "")];
  if (!pkg) return { ok: false, code: "package_not_found", message: "未找到成果包。" };
  const deliverables = (pkg.deliverableIds || [])
    .map((id) => store.deliverables[String(id)])
    .filter(Boolean)
    .map(clone);
  const versions = {};
  const artifacts = {};
  for (const d of deliverables) {
    for (const vid of d.versionIds || []) {
      if (store.versions[vid]) versions[vid] = clone(store.versions[vid]);
    }
    if (d.currentVersionId && store.versions[d.currentVersionId]) {
      versions[d.currentVersionId] = clone(store.versions[d.currentVersionId]);
    }
  }
  for (const v of Object.values(versions)) {
    if (v.artifactRef && v.artifactRef.id && store.artifacts[v.artifactRef.id]) {
      artifacts[v.artifactRef.id] = clone(store.artifacts[v.artifactRef.id]);
    }
    if (v.previewRef && v.previewRef.id && store.artifacts[v.previewRef.id]) {
      artifacts[v.previewRef.id] = clone(store.artifacts[v.previewRef.id]);
    }
    for (const a of v.artifactRefs || []) {
      if (a && a.id && store.artifacts[a.id]) artifacts[a.id] = clone(store.artifacts[a.id]);
    }
  }
  const generationAttempts = {};
  const attemptIds = new Set();
  for (const d of deliverables) {
    if (d.latestGenerationAttemptId) attemptIds.add(d.latestGenerationAttemptId);
  }
  for (const [id, att] of Object.entries(store.generationAttempts || {})) {
    if ((pkg.deliverableIds || []).includes(att.deliverableId)) {
      attemptIds.add(id);
    }
  }
  for (const id of attemptIds) {
    if (store.generationAttempts[id]) generationAttempts[id] = clone(store.generationAttempts[id]);
  }
  return {
    ok: true,
    package: clone(pkg),
    deliverables,
    versions,
    artifacts,
    generationAttempts,
    revision: store.revision,
  };
}

function listVersionsForDeliverable(userData, deliverableId) {
  const store = loadStore(userData);
  const d = store.deliverables[String(deliverableId || "")];
  if (!d) return { ok: false, code: "deliverable_not_found", message: "未找到该项成果。" };
  const versions = (d.versionIds || [])
    .map((id) => store.versions[id])
    .filter(Boolean)
    .map(clone);
  return {
    ok: true,
    deliverableId: d.id,
    currentVersionId: d.currentVersionId || null,
    versions,
  };
}

function getArtifact(userData, artifactRefId) {
  const store = loadStore(userData);
  const art = store.artifacts && store.artifacts[String(artifactRefId || "")];
  if (!art) return { ok: false, code: "artifact_not_found", message: "未找到成果文件引用。" };
  return { ok: true, artifact: clone(art) };
}

module.exports = {
  STORE_SCHEMA_VERSION,
  storePath,
  emptyStore,
  loadStore,
  invalidateStoreCache,
  enqueueWrite,
  mutateStore,
  getPackage,
  getPackageView,
  listPackagesForTask,
  findPackagesForConfirmed,
  findActivePackageForConfirmed,
  getDeliverablesForPackage,
  listVersionsForDeliverable,
  getArtifact,
  saveNewPackageBundle,
  appendPreparationAttempt,
  isActivePackage,
};

"use strict";

/**
 * IDCOLLAB-MIN-01 — Local Authorization Store
 * <userData>/authorizations.json
 * Atomic write + write queue + store-level CAS.
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  SCHEMA_VERSION,
  AUTH_STATUSES,
  LOCAL_ACTION_TYPES,
  ACTION_TYPES,
  nowIso,
  newId,
  clone,
  makeAuthorizationRef,
} = require("./action-identity-schema");

const STORE_SCHEMA_VERSION = 1;
const RENAME_RETRY_WAITS_MS = Object.freeze([50, 150, 350]);
const RENAME_RETRY_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

/** @type {Promise<void>} */
let writeQueueTail = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storePath(userData) {
  return path.join(userData, "authorizations.json");
}

function emptyStore() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    revision: 0,
    authorizations: {},
    updatedAt: nowIso(),
  };
}

function loadStore(userData) {
  const p = storePath(userData);
  if (!fs.existsSync(p)) return emptyStore();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    const e = new Error("授权存档无法解析，请勿覆盖。");
    e.code = "authorization_parse_failed";
    e.cause = err;
    throw e;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !parsed.authorizations ||
    typeof parsed.authorizations !== "object"
  ) {
    const e = new Error("授权存档格式无效。");
    e.code = "authorization_invalid_store";
    throw e;
  }
  if (parsed.schemaVersion != null && Number(parsed.schemaVersion) !== STORE_SCHEMA_VERSION) {
    const e = new Error("授权存档版本不受支持。");
    e.code = "authorization_unsupported_schema";
    throw e;
  }
  return parsed;
}

async function persistStoreAtomic(userData, store) {
  const target = storePath(userData);
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = target + ".tmp." + process.pid + "." + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  let lastErr = null;
  for (let attempt = 0; attempt < RENAME_RETRY_WAITS_MS.length + 1; attempt += 1) {
    try {
      fs.renameSync(tmp, target);
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
  throw lastErr || new Error("授权存档写入失败");
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

async function mutateStore(userData, mutator, opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  return enqueueWrite(async () => {
    const store = loadStore(userData);
    if (options.expectedRevision != null) {
      if (Number(options.expectedRevision) !== Number(store.revision)) {
        const e = new Error("授权存档已变化，请重新加载后再试。");
        e.code = "stale_store_revision";
        e.currentRevision = store.revision;
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

function normalizeRecord(input) {
  const actions = Array.isArray(input.actionTypes) ? input.actionTypes.map(String) : [];
  for (const a of actions) {
    if (!ACTION_TYPES.includes(a)) {
      const e = new Error("actionType 无效：" + a);
      e.code = "invalid_action_type";
      throw e;
    }
  }
  const status = String(input.status || "proposed");
  if (!AUTH_STATUSES.includes(status)) {
    const e = new Error("authorization status 无效。");
    e.code = "invalid_auth_status";
    throw e;
  }
  const scope = input.scope && typeof input.scope === "object" ? clone(input.scope) : {};
  if (!scope.taskId) {
    const e = new Error("授权必须绑定 taskId。");
    e.code = "auth_task_required";
    throw e;
  }
  return {
    authorizationId: String(input.authorizationId || newId("auth_")),
    schemaVersion: SCHEMA_VERSION,
    grantorSubjectId: String(input.grantorSubjectId || ""),
    granteeSubjectId: String(input.granteeSubjectId || ""),
    scope: {
      taskId: String(scope.taskId),
      planVersionId: scope.planVersionId ? String(scope.planVersionId) : null,
      materialRefs: Array.isArray(scope.materialRefs) ? scope.materialRefs.map(String) : [],
      outputRoot: scope.outputRoot ? String(scope.outputRoot) : "userData/deliverable-artifacts",
      oneTime: !!scope.oneTime,
    },
    resourceRefs: Array.isArray(input.resourceRefs)
      ? input.resourceRefs.map(String)
      : ["task:" + String(scope.taskId)],
    actionTypes: actions,
    issuedAt: String(input.issuedAt || nowIso()),
    expiresAt: input.expiresAt ? String(input.expiresAt) : null,
    revokedAt: input.revokedAt ? String(input.revokedAt) : null,
    consumedAt: input.consumedAt ? String(input.consumedAt) : null,
    status,
    confirmationRef: input.confirmationRef != null ? String(input.confirmationRef) : null,
    policyRef: input.policyRef != null ? String(input.policyRef) : null,
  };
}

function isExpired(record, atIso) {
  if (!record || !record.expiresAt) return false;
  const at = atIso ? Date.parse(atIso) : Date.now();
  const exp = Date.parse(record.expiresAt);
  return Number.isFinite(exp) && at >= exp;
}

function deriveEffectiveStatus(record, atIso) {
  if (!record) return null;
  if (record.status === "revoked") return "revoked";
  if (record.status === "denied") return "denied";
  if (record.status === "consumed") return "consumed";
  if (isExpired(record, atIso)) return "expired";
  return record.status;
}

function toAuthorizationRef(record) {
  return makeAuthorizationRef({
    authorizationId: record.authorizationId,
    authorizationType: (record.actionTypes && record.actionTypes[0]) || null,
    grantorSubjectId: record.grantorSubjectId,
    granteeSubjectId: record.granteeSubjectId,
    scope: record.scope,
    resourceRefs: record.resourceRefs,
    actionTypes: record.actionTypes,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    status: deriveEffectiveStatus(record),
    confirmationRef: record.confirmationRef,
    policyRef: record.policyRef,
  });
}

/**
 * Idempotent grant for a task + planVersion + actionTypes set.
 * If an active matching grant exists, return it.
 */
async function grantTaskAuthorization(userData, input) {
  const desired = normalizeRecord({
    ...input,
    status: "granted",
    actionTypes: input.actionTypes || LOCAL_ACTION_TYPES.slice(0, 4),
  });
  return mutateStore(userData, (store) => {
    const existing = Object.values(store.authorizations || {}).find((a) => {
      if (!a) return false;
      if (String(a.scope && a.scope.taskId) !== String(desired.scope.taskId)) return false;
      if (String(a.scope && a.scope.planVersionId || "") !== String(desired.scope.planVersionId || "")) {
        return false;
      }
      const eff = deriveEffectiveStatus(a);
      return eff === "granted" || eff === "proposed";
    });
    if (existing) {
      return { outcome: "existing", record: clone(existing) };
    }
    store.authorizations[desired.authorizationId] = desired;
    return { outcome: "created", record: clone(desired) };
  });
}

async function revokeAuthorization(userData, authorizationId, opts) {
  const id = String(authorizationId || "");
  if (!id) {
    return { ok: false, code: "authorization_required", message: "缺少授权。" };
  }
  try {
    const out = await mutateStore(
      userData,
      (store) => {
        const rec = store.authorizations[id];
        if (!rec) {
          const e = new Error("未找到授权。");
          e.code = "authorization_not_found";
          throw e;
        }
        if (rec.status === "revoked") {
          return { outcome: "already_revoked", record: clone(rec) };
        }
        rec.status = "revoked";
        rec.revokedAt = nowIso();
        return { outcome: "revoked", record: clone(rec) };
      },
      opts && opts.expectedRevision != null ? { expectedRevision: opts.expectedRevision } : {}
    );
    return {
      ok: true,
      outcome: out.result.outcome,
      record: out.result.record,
      revision: out.revision,
      message:
        out.result.outcome === "already_revoked"
          ? "本次授权此前已撤销。"
          : "已撤销本次授权。撤销后，Digital Me 将不能继续生成或学习本次任务的新成果；已经生成的文件不会被删除。",
    };
  } catch (err) {
    return {
      ok: false,
      code: (err && err.code) || "revoke_failed",
      message: (err && err.message) || "撤销授权失败。",
    };
  }
}

function getAuthorization(userData, authorizationId) {
  const store = loadStore(userData);
  const rec = store.authorizations[String(authorizationId || "")];
  if (!rec) return { ok: false, code: "authorization_not_found", message: "未找到授权。" };
  return {
    ok: true,
    record: clone(rec),
    effectiveStatus: deriveEffectiveStatus(rec),
    revision: store.revision,
  };
}

function listAuthorizationsForTask(userData, taskId) {
  const store = loadStore(userData);
  const tid = String(taskId || "");
  return Object.values(store.authorizations || {})
    .filter((a) => a && String(a.scope && a.scope.taskId) === tid)
    .map((a) => ({
      ...clone(a),
      effectiveStatus: deriveEffectiveStatus(a),
    }));
}

function findActiveGrantForPlan(userData, taskId, planVersionId) {
  const list = listAuthorizationsForTask(userData, taskId);
  return (
    list.find(
      (a) =>
        a.effectiveStatus === "granted" &&
        String(a.scope && a.scope.planVersionId || "") === String(planVersionId || "")
    ) || null
  );
}

/**
 * Fail-closed gate for generation / regenerate / learn writeback.
 */
function assertAuthorizationAllows(userData, { authorizationId, taskId, planVersionId, actionType }) {
  const got = getAuthorization(userData, authorizationId);
  if (!got.ok) {
    return {
      ok: false,
      code: "authorization_not_found",
      message: "缺少有效授权，无法继续。",
    };
  }
  const rec = got.record;
  const eff = deriveEffectiveStatus(rec);
  if (eff === "revoked") {
    return {
      ok: false,
      code: "authorization_revoked",
      message: "本次授权已撤销，不能继续生成或学习新成果。",
    };
  }
  if (eff === "expired") {
    return {
      ok: false,
      code: "authorization_expired",
      message: "本次授权已过期，不能继续。",
    };
  }
  if (eff === "denied") {
    return {
      ok: false,
      code: "authorization_denied",
      message: "本次授权未获准，不能继续。",
    };
  }
  if (eff !== "granted") {
    return {
      ok: false,
      code: "authorization_not_granted",
      message: "本次授权尚未生效，不能继续。",
    };
  }
  if (taskId && String(rec.scope.taskId) !== String(taskId)) {
    return {
      ok: false,
      code: "authorization_task_mismatch",
      message: "授权不属于当前任务。",
    };
  }
  if (
    planVersionId &&
    rec.scope.planVersionId &&
    String(rec.scope.planVersionId) !== String(planVersionId)
  ) {
    return {
      ok: false,
      code: "authorization_plan_mismatch",
      message: "授权不属于当前计划版本。",
    };
  }
  if (actionType && !(rec.actionTypes || []).includes(String(actionType))) {
    return {
      ok: false,
      code: "authorization_action_denied",
      message: "当前授权不允许此操作。",
    };
  }
  return { ok: true, record: rec, ref: toAuthorizationRef(rec) };
}

/**
 * Soft reconciliation: mark expired granted records.
 */
async function reconcileAuthorizations(userData) {
  return mutateStore(userData, (store) => {
    let changed = 0;
    for (const id of Object.keys(store.authorizations || {})) {
      const rec = store.authorizations[id];
      if (!rec) continue;
      if (rec.status === "granted" && isExpired(rec)) {
        rec.status = "expired";
        changed += 1;
      }
    }
    return { changed };
  });
}

module.exports = {
  STORE_SCHEMA_VERSION,
  storePath,
  loadStore,
  emptyStore,
  mutateStore,
  normalizeRecord,
  grantTaskAuthorization,
  revokeAuthorization,
  getAuthorization,
  listAuthorizationsForTask,
  findActiveGrantForPlan,
  assertAuthorizationAllows,
  reconcileAuthorizations,
  toAuthorizationRef,
  deriveEffectiveStatus,
  isExpired,
};

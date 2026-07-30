"use strict";

/**
 * DVL2-01 Plan Store — <userData>/deliverable-plans.json
 * Atomic write + write queue + strict validation + Store-level CAS.
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  PLAN_VERSION_STATUSES,
  validateDependencyGraph,
  assertPointersInvariant,
} = require("./deliverable-plan-schema");
const {
  writeJsonStoreAtomic,
  readJsonStoreWithBackup,
} = require("../json-store-persistence");

const STORE_VERSION = 1;
const LIFECYCLE = new Set(["active", "archived", "soft_deleted", "orphaned"]);
const DRAFT_POINTER_STATUSES = new Set(["draft", "needs_user_input", "ready_for_confirmation"]);

/** @type {Promise<void>} */
let writeQueueTail = Promise.resolve();
let storeCache = null;

function storePath(userData) {
  return path.join(userData, "deliverable-plans.json");
}

function emptyStore() {
  return { version: STORE_VERSION, plans: {} };
}

function invalidateStoreCache() {
  storeCache = null;
}

function validatePlanStore(parsed) {
  return !!(parsed && typeof parsed === "object" && parsed.plans && typeof parsed.plans === "object");
}

function loadStore(userData) {
  const p = storePath(userData);
  const key = String(userData || "");
  if (fs.existsSync(p)) {
    try {
      const st = fs.statSync(p);
      if (
        storeCache &&
        storeCache.userData === key &&
        storeCache.mtimeMs === st.mtimeMs &&
        storeCache.size === st.size &&
        storeCache.store
      ) {
        return storeCache.store;
      }
    } catch {
      /* fall through */
    }
  }

  let loaded;
  try {
    loaded = readJsonStoreWithBackup({
      targetPath: p,
      validate: validatePlanStore,
      emptyWhenMissing: emptyStore,
      corruptCode: "deliverable_plan_parse_failed",
    });
  } catch (err) {
    invalidateStoreCache();
    const e = new Error(err && err.message ? err.message : "成果计划存档无法解析，请勿覆盖。");
    e.code = err && err.code ? err.code : "deliverable_plan_parse_failed";
    e.cause = err;
    throw e;
  }

  storeCache = {
    userData: key,
    mtimeMs: loaded.mtimeMs != null ? loaded.mtimeMs : Date.now(),
    size: loaded.size != null ? loaded.size : 0,
    store: loaded.parsed,
  };
  return loaded.parsed;
}

async function persistStoreAtomic(userData, store) {
  const target = storePath(userData);
  const payload = JSON.stringify(store);
  await writeJsonStoreAtomic({ targetPath: target, data: payload });
  let st = null;
  try {
    st = fs.statSync(target);
  } catch {
    st = null;
  }
  storeCache = {
    userData: String(userData || ""),
    mtimeMs: st ? st.mtimeMs : Date.now(),
    size: st ? st.size : Buffer.byteLength(payload),
    store,
  };
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

function cloneRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

function getPlan(userData, planId) {
  const store = loadStore(userData);
  const rec = store.plans[String(planId || "")];
  if (!rec) return { ok: false, code: "plan_not_found", message: "未找到成果计划。" };
  return { ok: true, plan: cloneRecord(rec) };
}

function findPlanByTaskId(userData, taskId) {
  const store = loadStore(userData);
  const tid = String(taskId || "");
  const matches = Object.values(store.plans || {}).filter((p) => p && p.taskId === tid);
  return matches.map(cloneRecord);
}

function revisionSnapshot(plan) {
  if (!plan) {
    return {
      updatedAt: null,
      currentDraftVersionId: null,
      activeConfirmedVersionId: null,
    };
  }
  return {
    updatedAt: plan.updatedAt || null,
    currentDraftVersionId: plan.currentDraftVersionId || null,
    activeConfirmedVersionId: plan.activeConfirmedVersionId || null,
  };
}

function compareRevision(existing, expected) {
  if (!expected || typeof expected !== "object") {
    return {
      ok: false,
      code: "stale_plan_state",
      message: "成果计划已变化，请重新加载后再试。",
    };
  }
  const cur = revisionSnapshot(existing);
  const expUpdatedAt =
    expected.expectedPlanUpdatedAt != null ? expected.expectedPlanUpdatedAt : expected.updatedAt;
  const expDraft =
    expected.expectedCurrentDraftVersionId != null
      ? expected.expectedCurrentDraftVersionId
      : expected.currentDraftVersionId;
  const expConfirmed =
    expected.expectedActiveConfirmedVersionId != null
      ? expected.expectedActiveConfirmedVersionId
      : expected.activeConfirmedVersionId;
  if (
    String(expUpdatedAt || "") !== String(cur.updatedAt || "") ||
    String(expDraft || "") !== String(cur.currentDraftVersionId || "") ||
    String(expConfirmed || "") !== String(cur.activeConfirmedVersionId || "")
  ) {
    return {
      ok: false,
      code: "stale_plan_state",
      message: "成果计划已变化，请重新加载后再试。",
      current: cur,
    };
  }
  return { ok: true, current: cur };
}

/**
 * Strict pre-write validation. Does not mutate store.
 */
function validatePlanRecordForWrite(store, record) {
  const errors = [];
  if (!record || typeof record !== "object") {
    return { ok: false, code: "invalid_plan_record", message: "计划记录无效。", errors };
  }
  if (!record.planId || !String(record.planId).trim()) {
    return { ok: false, code: "missing_plan_id", message: "缺少 planId。", errors };
  }
  if (!record.taskId || !String(record.taskId).trim()) {
    return { ok: false, code: "missing_task_id", message: "缺少 taskId。", errors };
  }
  if (!record.versions || typeof record.versions !== "object") {
    return { ok: false, code: "missing_versions", message: "缺少版本表。", errors };
  }
  if (!Array.isArray(record.versionIds)) {
    return { ok: false, code: "missing_version_ids", message: "缺少 versionIds。", errors };
  }

  const versionIds = record.versionIds.map(String);
  const seenIds = new Set();
  for (const id of versionIds) {
    if (seenIds.has(id)) {
      return {
        ok: false,
        code: "duplicate_version_id",
        message: "versionIds 存在重复。",
        errors: [{ versionId: id }],
      };
    }
    seenIds.add(id);
  }

  const versionKeys = Object.keys(record.versions);
  for (const id of versionIds) {
    if (!record.versions[id]) errors.push({ code: "version_id_missing_body", versionId: id });
  }
  for (const id of versionKeys) {
    if (!versionIds.includes(id)) errors.push({ code: "version_body_not_listed", versionId: id });
  }
  if (errors.length) {
    return {
      ok: false,
      code: "version_index_mismatch",
      message: "versionIds 与 versions 不一致。",
      errors,
    };
  }

  if (record.lifecycleStatus && !LIFECYCLE.has(String(record.lifecycleStatus))) {
    return { ok: false, code: "invalid_lifecycle", message: "计划生命周期状态不合法。" };
  }

  const planVersions = new Set();
  for (const id of versionIds) {
    const v = record.versions[id];
    if (!v || typeof v !== "object") {
      return { ok: false, code: "invalid_version", message: "版本结构无效。", errors: [{ versionId: id }] };
    }
    if (String(v.versionId || "") !== String(id)) {
      return {
        ok: false,
        code: "version_id_mismatch",
        message: "versions 键与 version.versionId 不一致。",
        errors: [{ key: id, versionId: v.versionId }],
      };
    }
    if (String(v.planId || "") !== String(record.planId)) {
      return {
        ok: false,
        code: "version_plan_id_mismatch",
        message: "版本 planId 与记录不一致。",
        errors: [{ versionId: id }],
      };
    }
    if (String(v.taskId || "") !== String(record.taskId)) {
      return {
        ok: false,
        code: "version_task_id_mismatch",
        message: "版本 taskId 与记录不一致。",
        errors: [{ versionId: id }],
      };
    }
    if (!PLAN_VERSION_STATUSES.includes(String(v.status))) {
      return {
        ok: false,
        code: "invalid_version_status",
        message: "版本状态不合法。",
        errors: [{ versionId: id, status: v.status }],
      };
    }
    const planVersion = Number(v.planVersion != null ? v.planVersion : v.versionNumber);
    if (!Number.isInteger(planVersion) || planVersion < 1) {
      return {
        ok: false,
        code: "invalid_plan_version",
        message: "planVersion / versionNumber 必须为正整数。",
        errors: [{ versionId: id, planVersion }],
      };
    }
    if (planVersions.has(planVersion)) {
      return {
        ok: false,
        code: "duplicate_plan_version",
        message: "同一计划中 planVersion 必须唯一。",
        errors: [{ versionId: id, planVersion }],
      };
    }
    planVersions.add(planVersion);

    const graph = validateDependencyGraph(v.items || []);
    if (!graph.ok) {
      return {
        ok: false,
        code: "graph_invalid",
        message: "预计交付依赖关系无效。",
        errors: graph.errors,
      };
    }
  }

  if (record.currentDraftVersionId) {
    const draft = record.versions[record.currentDraftVersionId];
    if (!draft) {
      return { ok: false, code: "draft_pointer_invalid", message: "草稿指针无效。" };
    }
    if (!DRAFT_POINTER_STATUSES.has(String(draft.status))) {
      return {
        ok: false,
        code: "draft_status_invalid",
        message: "currentDraft 只能指向未确认草稿状态。",
        errors: [{ versionId: record.currentDraftVersionId, status: draft.status }],
      };
    }
  }

  if (record.activeConfirmedVersionId) {
    const conf = record.versions[record.activeConfirmedVersionId];
    if (!conf) {
      return { ok: false, code: "confirmed_pointer_invalid", message: "确认指针无效。" };
    }
    if (conf.status !== "confirmed") {
      return {
        ok: false,
        code: "confirmed_status_invalid",
        message: "有效确认指针必须指向 confirmed 版本。",
      };
    }
  }

  if (
    record.currentDraftVersionId &&
    record.activeConfirmedVersionId &&
    String(record.currentDraftVersionId) === String(record.activeConfirmedVersionId)
  ) {
    return {
      ok: false,
      code: "draft_status_invalid",
      message: "同一版本不能同时作为 current draft 与 active confirmed。",
    };
  }

  const confirmedActive = Object.values(record.versions).filter((v) => v && v.status === "confirmed");
  if (confirmedActive.length > 1) {
    return {
      ok: false,
      code: "multiple_active_confirmed",
      message: "同一计划不得有多个未替代的确认版本。",
    };
  }

  const inv = assertPointersInvariant(record);
  if (!inv.ok) {
    return {
      ok: false,
      code: "pointer_invariant_failed",
      message: "计划指针不变量不满足。",
      errors: inv.errors,
    };
  }

  const existingSameId = store.plans[String(record.planId)];
  if (existingSameId && String(existingSameId.taskId) !== String(record.taskId)) {
    return {
      ok: false,
      code: "plan_task_rebind_forbidden",
      message: "已存在的 planId 不得改绑到其他任务。",
    };
  }

  const others = Object.values(store.plans || {}).filter(
    (p) => p && String(p.taskId) === String(record.taskId) && String(p.planId) !== String(record.planId)
  );
  if (others.length > 0) {
    return {
      ok: false,
      code: "duplicate_plan_for_task",
      message: "同一任务已存在另一条成果计划，禁止写入。",
    };
  }

  return { ok: true };
}

/**
 * Persist plan with Store-level CAS inside the write queue.
 * @param {object} [options]
 * @param {boolean} [options.expectAbsent] — create first plan; reject if planId already exists
 * @param {object} [options.expectedRevision] — required for updates (updatedAt + draft/confirmed pointers)
 */
async function savePlanRecord(userData, record, options) {
  const opts = options && typeof options === "object" ? options : {};
  return enqueueWrite(async () => {
    const store = loadStore(userData);
    const next = cloneRecord(record);
    const planId = String(next.planId || "");
    const existing = store.plans[planId];

    if (opts.expectAbsent === true) {
      if (existing) {
        const e = new Error("成果计划已存在，无法按首次创建写入。");
        e.code = "stale_plan_state";
        e.current = revisionSnapshot(existing);
        throw e;
      }
    } else {
      if (!existing) {
        const e = new Error("更新成果计划时找不到原记录；首次创建须 expectAbsent=true。");
        e.code = "stale_plan_state";
        throw e;
      }
      const cas = compareRevision(existing, opts.expectedRevision);
      if (!cas.ok) {
        const e = new Error(cas.message || "成果计划已变化，请重新加载后再试。");
        e.code = "stale_plan_state";
        e.current = cas.current;
        throw e;
      }
    }

    const check = validatePlanRecordForWrite(store, next);
    if (!check.ok) {
      const e = new Error(check.message || "计划校验失败。");
      e.code = check.code || "plan_validation_failed";
      e.errors = check.errors;
      throw e;
    }
    next.updatedAt = new Date().toISOString();
    store.plans[next.planId] = next;
    await persistStoreAtomic(userData, store);
    return { ok: true, plan: cloneRecord(next) };
  });
}

function listOrphanPlans(userData, knownTaskIds) {
  const store = loadStore(userData);
  const known = new Set((knownTaskIds || []).map(String));
  return Object.values(store.plans || {})
    .filter((p) => p && !known.has(String(p.taskId)))
    .map(cloneRecord);
}

module.exports = {
  STORE_VERSION,
  storePath,
  emptyStore,
  loadStore,
  invalidateStoreCache,
  persistStoreAtomic,
  enqueueWrite,
  getPlan,
  findPlanByTaskId,
  savePlanRecord,
  validatePlanRecordForWrite,
  compareRevision,
  revisionSnapshot,
  listOrphanPlans,
  cloneRecord,
  DRAFT_POINTER_STATUSES,
};

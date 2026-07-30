"use strict";

/**
 * Act-behalf / research-express task store — hermetic userData JSON with atomic rename.
 * File: <userData>/act-behalf-tasks.json
 * schemaVersion 2: Task Intent + Subject Context contracts (block 1).
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { normalizeTaskIntent } = require("./task-intent");
const { healRunningInvocations } = require("./research-run");
const { healRunningResults } = require("./result-generation");
const { healAndReconcileProposals } = require("./experience-proposal");
const { normalizeReferenceMaterials } = require("./deliverable-context");
const {
  writeJsonStoreAtomic,
  readJsonStoreWithBackup,
} = require("../json-store-persistence");

const STORE_VERSION = 2;
const TASK_SCHEMA_VERSION = 2;

/** @type {Promise<void>} */
let writeQueueTail = Promise.resolve();
let storeCache = null;

function storePath(userData) {
  return path.join(userData, "act-behalf-tasks.json");
}

function emptyStore() {
  return { version: STORE_VERSION, tasks: [] };
}

function newTaskId() {
  return "abt_" + Date.now().toString(36) + "_" + crypto.randomBytes(3).toString("hex");
}

function invalidateStoreCache() {
  storeCache = null;
}

function validateTaskStore(parsed) {
  return !!(parsed && typeof parsed === "object" && Array.isArray(parsed.tasks));
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
      validate: validateTaskStore,
      emptyWhenMissing: emptyStore,
      corruptCode: "act_behalf_parse_failed",
    });
  } catch (err) {
    invalidateStoreCache();
    const e = new Error(err && err.message ? err.message : "任务存档无法解析，请勿覆盖。");
    e.code = err && err.code ? err.code : "act_behalf_parse_failed";
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

function migrateLegacySelectedSelfContext(legacy) {
  if (!legacy || typeof legacy !== "object") return null;
  if (Array.isArray(legacy.claims)) return legacy;
  const items = Array.isArray(legacy.items) ? legacy.items : [];
  if (!items.length && !legacy.combinedText) return null;
  return {
    subjectId: "legacy:unknown",
    version: "legacy",
    subjectVersion: "legacy",
    claims: items.map((it, idx) => ({
      id: "legacy_" + idx,
      kind: "other",
      label: String(it.label || it.source || "摘录"),
      text: String(it.text || ""),
      sourceRefs: [{ source: String(it.source || "unknown") }],
      confidence: "unknown",
      confirmationState: legacy.userEdited ? "user_edited" : "proposed",
    })),
    sourceRefs: items.map((it) => ({ source: String(it.source || "unknown") })),
    confidence: "unknown",
    confirmationState: legacy.userEdited ? "user_edited" : "proposed",
    scope: "从旧版摘录迁移的候选（未必已确认）",
    prohibitedUses: [],
    rankingMeta: { method: "legacy_migration", degraded: true },
  };
}

function normalizeTask(input) {
  const now = new Date().toISOString();
  const taskId = String((input && input.taskId) || newTaskId());
  const goalFromRequest = String((input && (input.goal || input.request)) || "").trim();
  const title =
    String((input && input.title) || "").trim() ||
    (goalFromRequest ? goalFromRequest.slice(0, 40) + (goalFromRequest.length > 40 ? "…" : "") : "") ||
    "未命名任务";

  const intentInput =
    input && input.taskIntent && typeof input.taskIntent === "object"
      ? { ...input.taskIntent, goal: input.taskIntent.goal || goalFromRequest, taskId }
      : { goal: goalFromRequest, taskId };
  const taskIntent = normalizeTaskIntent(intentInput, taskId);
  taskIntent.taskId = taskId;

  let subjectContextCandidates =
    input && input.subjectContextCandidates && typeof input.subjectContextCandidates === "object"
      ? input.subjectContextCandidates
      : null;
  let subjectContext =
    input && input.subjectContext && typeof input.subjectContext === "object"
      ? input.subjectContext
      : null;

  const legacy = input && input.selectedSelfContext;
  if (!subjectContextCandidates && legacy) {
    subjectContextCandidates = migrateLegacySelectedSelfContext(legacy);
  }
  if (!subjectContext && legacy && legacy.userEdited && subjectContextCandidates) {
    // Old edited contexts are treated as candidate-level, not auto-confirmed contract.
    subjectContext = null;
  }

  const selectedSelfContext = legacy || {
    items: ((subjectContext && subjectContext.claims) || (subjectContextCandidates && subjectContextCandidates.claims) || []).map(
      (c) => ({
        source: (c.sourceRefs && c.sourceRefs[0] && c.sourceRefs[0].source) || "unknown",
        label: c.label || "",
        text: c.text || "",
      })
    ),
    combinedText: ((subjectContext && subjectContext.claims) || (subjectContextCandidates && subjectContextCandidates.claims) || [])
      .map((c) => "### " + (c.label || "") + "\n" + (c.text || ""))
      .join("\n\n"),
    userEdited: !!(subjectContext && subjectContext.confirmationState === "confirmed"),
  };

  return {
    schemaVersion: TASK_SCHEMA_VERSION,
    taskId,
    title,
    // legacy mirror of goal
    request: taskIntent.goal || String((input && input.request) || ""),
    goal: taskIntent.goal,
    status: String((input && input.status) || "draft"),
    taskIntent,
    subjectContextCandidates,
    subjectContext,
    // Prior confirmed snapshot retained for audit when goal change invalidates confirmation
    priorSubjectContext:
      input && input.priorSubjectContext && typeof input.priorSubjectContext === "object"
        ? input.priorSubjectContext
        : null,
    contextAudit: (input && input.contextAudit) || null,
    doingContext:
      input && input.doingContext && typeof input.doingContext === "object"
        ? input.doingContext
        : null,
    selectedSelfContext,
    existingUserPositions: String((input && input.existingUserPositions) || ""),
    digitalMeInferences: String((input && input.digitalMeInferences) || ""),
    result: String((input && input.result) || ""),
    // DVL2 reference materials — persisted for plan/generation (not VL1-only UI state)
    referenceMaterials: normalizeReferenceMaterials(input && input.referenceMaterials),
    // Email drafting (taskIntent.taskType === "email"): structured draft, main-process only
    emailDraft:
      input && input.emailDraft && typeof input.emailDraft === "object"
        ? {
            to: String(input.emailDraft.to || ""),
            subject: String(input.emailDraft.subject || ""),
            body: String(input.emailDraft.body || ""),
            attachments: Array.isArray(input.emailDraft.attachments)
              ? input.emailDraft.attachments.map((a) => String(a || "").trim()).filter(Boolean)
              : [],
            needsConfirmation: Array.isArray(input.emailDraft.needsConfirmation)
              ? input.emailDraft.needsConfirmation.map((n) => String(n || "").trim()).filter(Boolean)
              : [],
          }
        : null,
    // Video/audio scripting (taskIntent.taskType === "video_audio"): structured script, main-process only
    videoAudioScript:
      input && input.videoAudioScript && typeof input.videoAudioScript === "object"
        ? {
            title: String(input.videoAudioScript.title || ""),
            duration: String(input.videoAudioScript.duration || ""),
            scenes: Array.isArray(input.videoAudioScript.scenes)
              ? input.videoAudioScript.scenes
                  .map((s) => ({
                    scene: String((s && s.scene) || ""),
                    visuals: String((s && s.visuals) || ""),
                    narration: String((s && s.narration) || ""),
                    duration: String((s && s.duration) || ""),
                  }))
                  .filter((s) => s.visuals || s.narration)
              : [],
            creativeDirection: String(input.videoAudioScript.creativeDirection || ""),
            productionTips: Array.isArray(input.videoAudioScript.productionTips)
              ? input.videoAudioScript.productionTips.map((t) => String(t || "").trim()).filter(Boolean)
              : [],
            needsConfirmation: Array.isArray(input.videoAudioScript.needsConfirmation)
              ? input.videoAudioScript.needsConfirmation.map((n) => String(n || "").trim()).filter(Boolean)
              : [],
          }
        : null,
    // Block 2+: Capability Invocation records (append-only from main process)
    invocations: Array.isArray(input && input.invocations) ? input.invocations : [],
    selectedSkillId: input && input.selectedSkillId ? String(input.selectedSkillId) : null,
    // Block 3+: research expression results (append-only from main process)
    results: Array.isArray(input && input.results) ? input.results : [],
    // Block 4+: Experience Proposals (append-only from main process)
    proposals: Array.isArray(input && input.proposals) ? input.proposals : [],
    capabilityRefs: Array.isArray(input && input.capabilityRefs) ? input.capabilityRefs : [],
    identityRefs: Array.isArray(input && input.identityRefs) ? input.identityRefs : [],
    // IDCOLLAB-MIN-01: cache-only fields (not historical authority)
    identityContextRef:
      input && input.identityContextRef ? String(input.identityContextRef) : null,
    initiatorSubjectId:
      input && input.initiatorSubjectId ? String(input.initiatorSubjectId) : null,
    ownerSubjectId: input && input.ownerSubjectId ? String(input.ownerSubjectId) : null,
    representedSubjectId:
      input && input.representedSubjectId ? String(input.representedSubjectId) : null,
    authorization: (input && input.authorization) || null,
    audit: (input && input.audit) || null,
    modelMeta: (input && input.modelMeta) || null,
    deliverablePlanning: normalizeDeliverablePlanning(input && input.deliverablePlanning),
    deliverableExecution: normalizeDeliverableExecution(input && input.deliverableExecution),
    lifecycleStatus: normalizeLifecycleStatus(input && input.lifecycleStatus),
    archivedAt: input && input.archivedAt ? String(input.archivedAt) : null,
    deletedAt: input && input.deletedAt ? String(input.deletedAt) : null,
    createdAt: String((input && input.createdAt) || now),
    updatedAt: String((input && input.updatedAt) || now),
  };
}

function taskSearchHaystack(task) {
  const norm = normalizeTask(task);
  const parts = [
    norm.title,
    norm.goal,
    norm.request,
    norm.taskIntent && norm.taskIntent.goal,
    norm.result && norm.result.slice(0, 200),
  ];
  return parts
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function taskListSummary(norm) {
  const preview =
    String(norm.taskIntent && norm.taskIntent.goal ? norm.taskIntent.goal : norm.request || "").slice(0, 120);
  return {
    taskId: norm.taskId,
    title: norm.title,
    goal: norm.goal || (norm.taskIntent && norm.taskIntent.goal) || "",
    status: norm.status,
    lifecycleStatus: norm.lifecycleStatus,
    createdAt: norm.createdAt,
    updatedAt: norm.updatedAt,
    archivedAt: norm.archivedAt,
    requestPreview: preview,
    contextConfirmed: !!(norm.subjectContext && norm.subjectContext.confirmationState === "confirmed"),
  };
}

function matchesTaskScope(norm, scope) {
  const life = normalizeLifecycleStatus(norm.lifecycleStatus);
  if (scope === "archived") return life === "archived";
  // active: exclude archived and soft_deleted
  return life !== "archived" && life !== "soft_deleted";
}

function normalizeDeliverablePlanning(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      planId: null,
      currentDraftVersionId: null,
      activeConfirmedVersionId: null,
      plannedMaterialsDigest: null,
      materialsStale: false,
      materialsStaleReason: null,
      materialsStaleAt: null,
    };
  }
  return {
    planId: raw.planId ? String(raw.planId) : null,
    currentDraftVersionId: raw.currentDraftVersionId ? String(raw.currentDraftVersionId) : null,
    activeConfirmedVersionId: raw.activeConfirmedVersionId ? String(raw.activeConfirmedVersionId) : null,
    plannedMaterialsDigest: raw.plannedMaterialsDigest ? String(raw.plannedMaterialsDigest) : null,
    materialsStale: !!raw.materialsStale,
    materialsStaleReason: raw.materialsStaleReason ? String(raw.materialsStaleReason) : null,
    materialsStaleAt: raw.materialsStaleAt ? String(raw.materialsStaleAt) : null,
  };
}

function normalizeDeliverableExecution(raw) {
  if (!raw || typeof raw !== "object") {
    return { activePackageId: null };
  }
  return {
    activePackageId: raw.activePackageId ? String(raw.activePackageId) : null,
  };
}

function normalizeLifecycleStatus(raw) {
  const v = String(raw || "active");
  if (v === "archived" || v === "soft_deleted" || v === "active") return v;
  return "active";
}

function listTasks(userData, opts = {}) {
  const store = loadStore(userData);
  const scope = String(opts.scope || "active");
  const query = String(opts.query || "")
    .trim()
    .toLowerCase();
  const offset = Math.max(0, Number(opts.offset) || 0);
  const limitRaw = opts.limit == null ? null : Number(opts.limit);
  const limit = limitRaw == null || !Number.isFinite(limitRaw) ? null : Math.max(1, limitRaw);

  let filtered = (store.tasks || [])
    .map((t) => normalizeTask(t))
    .filter((norm) => matchesTaskScope(norm, scope));

  if (query) {
    filtered = filtered.filter((norm) => taskSearchHaystack(norm).includes(query));
  }

  filtered.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  const total = filtered.length;
  const page = limit == null ? filtered : filtered.slice(offset, offset + limit);
  const hasMore = limit != null && offset + page.length < total;

  return {
    ok: true,
    scope,
    query: query || null,
    offset,
    limit,
    total,
    hasMore,
    tasks: page.map(taskListSummary),
  };
}

function getTask(userData, taskId, opts = {}) {
  const store = loadStore(userData);
  const task = (store.tasks || []).find((t) => t.taskId === String(taskId || ""));
  if (!task) {
    return { ok: false, code: "not_found", message: "找不到该任务。" };
  }
  const norm = normalizeTask(task);
  if (opts && opts.heal === false) {
    return {
      ok: true,
      task: norm,
      invocationsHealed: false,
      resultsHealed: false,
      proposalsHealed: false,
    };
  }
  const healed = healRunningInvocations(norm.invocations);
  const healedResults = healRunningResults(norm.results);
  const healedProposals = healAndReconcileProposals(norm.proposals, opts.packageDir || null);
  if (healed.changed) {
    norm.invocations = healed.invocations;
  }
  if (healedResults.changed) {
    norm.results = healedResults.results;
  }
  if (healedProposals.changed) {
    norm.proposals = healedProposals.proposals;
  }
  return {
    ok: true,
    task: norm,
    invocationsHealed: healed.changed,
    resultsHealed: healedResults.changed,
    proposalsHealed: healedProposals.changed,
  };
}

async function saveTask(userData, taskInput) {
  const task = normalizeTask(taskInput);
  task.updatedAt = new Date().toISOString();
  await enqueueWrite(async () => {
    const store = loadStore(userData);
    store.version = STORE_VERSION;
    const idx = store.tasks.findIndex((t) => t.taskId === task.taskId);
    if (idx >= 0) {
      // Preserve createdAt from existing record when present
      const prev = store.tasks[idx];
      if (prev && prev.createdAt) task.createdAt = String(prev.createdAt);
      // Draft saves from renderer omit plan pointers — never wipe them silently.
      if (!Object.prototype.hasOwnProperty.call(taskInput || {}, "deliverablePlanning")) {
        task.deliverablePlanning = normalizeDeliverablePlanning(prev.deliverablePlanning);
      }
      if (!Object.prototype.hasOwnProperty.call(taskInput || {}, "deliverableExecution")) {
        task.deliverableExecution = normalizeDeliverableExecution(prev.deliverableExecution);
      }
      if (!Object.prototype.hasOwnProperty.call(taskInput || {}, "lifecycleStatus")) {
        task.lifecycleStatus = normalizeLifecycleStatus(prev.lifecycleStatus);
      }
      if (!Object.prototype.hasOwnProperty.call(taskInput || {}, "archivedAt")) {
        task.archivedAt = prev.archivedAt ? String(prev.archivedAt) : null;
      }
      if (!Object.prototype.hasOwnProperty.call(taskInput || {}, "deletedAt")) {
        task.deletedAt = prev.deletedAt ? String(prev.deletedAt) : null;
      }
      // Draft / plan saves often omit materials — never wipe persisted attachments.
      if (!Object.prototype.hasOwnProperty.call(taskInput || {}, "referenceMaterials")) {
        task.referenceMaterials = normalizeReferenceMaterials(prev.referenceMaterials);
      }
      store.tasks[idx] = task;
    } else {
      store.tasks.unshift(task);
    }
    await persistStoreAtomic(userData, store);
  });
  return { ok: true, task };
}

/**
 * Physical purge is not the product delete path for DVL2-01.
 * Confirmed / planned tasks must soft-delete; never leave executable orphans.
 */
async function deleteTask(userData, taskId) {
  const id = String(taskId || "");
  const got = getTask(userData, id, { heal: false });
  if (got.ok) {
    const dp = got.task.deliverablePlanning || {};
    if (dp.planId || dp.activeConfirmedVersionId || dp.currentDraftVersionId) {
      return {
        ok: false,
        code: "use_soft_delete",
        message: "该任务已关联成果计划，不能直接物理删除；请使用归档或软删除。",
      };
    }
  }
  await enqueueWrite(async () => {
    const store = loadStore(userData);
    store.tasks = (store.tasks || []).filter((t) => t.taskId !== id);
    await persistStoreAtomic(userData, store);
  });
  return { ok: true };
}

async function softDeleteTask(userData, taskId) {
  const got = getTask(userData, taskId, { heal: false });
  if (!got.ok) return got;
  const now = new Date().toISOString();
  const task = {
    ...got.task,
    lifecycleStatus: "soft_deleted",
    status: "soft_deleted",
    deletedAt: now,
    updatedAt: now,
  };
  return saveTask(userData, task);
}

async function archiveTask(userData, taskId) {
  const got = getTask(userData, taskId, { heal: false });
  if (!got.ok) return got;
  const now = new Date().toISOString();
  const task = {
    ...got.task,
    lifecycleStatus: "archived",
    status: "archived",
    archivedAt: now,
    deletedAt: null,
    updatedAt: now,
  };
  return saveTask(userData, task);
}

async function restoreTask(userData, taskId) {
  const got = getTask(userData, taskId, { heal: false });
  if (!got.ok) return got;
  if (normalizeLifecycleStatus(got.task.lifecycleStatus) !== "archived") {
    return { ok: false, code: "not_archived", message: "该任务不在已归档列表中。" };
  }
  const now = new Date().toISOString();
  const prevStatus = got.task.status === "archived" ? "draft" : got.task.status || "draft";
  const task = {
    ...got.task,
    lifecycleStatus: "active",
    status: prevStatus,
    archivedAt: null,
    updatedAt: now,
  };
  return saveTask(userData, task);
}

module.exports = {
  STORE_VERSION,
  TASK_SCHEMA_VERSION,
  storePath,
  newTaskId,
  loadStore,
  invalidateStoreCache,
  listTasks,
  getTask,
  saveTask,
  deleteTask,
  softDeleteTask,
  archiveTask,
  restoreTask,
  taskSearchHaystack,
  taskListSummary,
  matchesTaskScope,
  normalizeTask,
  normalizeDeliverablePlanning,
  normalizeDeliverableExecution,
  normalizeLifecycleStatus,
  migrateLegacySelectedSelfContext,
};

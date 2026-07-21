"use strict";

/**
 * IPC save boundary for act-behalf / research-express tasks.
 * Renderer may edit Task Intent and a narrow set of draft fields.
 * Capability Invocation history is always taken from the authoritative stored task.
 */

const { normalizeTaskIntent } = require("./task-intent");
const { applyGoalChangeToStoredTask } = require("./subject-context-assembly");

/** Fields the renderer must never author for research audit. */
const RENDERER_FORBIDDEN_RESEARCH_KEYS = Object.freeze([
  "invocations",
  "selectedSkillId",
  "discoveredSources",
  "resultRefs",
  "sourceRefs",
  "toolInvocation",
  "skillInvocation",
  "capabilityRefs",
  "authorization",
  "audit",
  "modelMeta",
  "results",
  "result",
  "sections",
  "modelInvocation",
  "ownerDecision",
  "revisions",
]);

/**
 * @param {object|null|undefined} existing
 */
function takeAuthoritativeResearchFields(existing) {
  if (!existing) {
    return {
      invocations: [],
      selectedSkillId: null,
      results: [],
      capabilityRefs: [],
      identityRefs: [],
      authorization: null,
      audit: null,
      modelMeta: null,
      result: "",
      existingUserPositions: "",
      digitalMeInferences: "",
    };
  }
  return {
    invocations: Array.isArray(existing.invocations) ? existing.invocations.slice() : [],
    selectedSkillId:
      existing.selectedSkillId != null && existing.selectedSkillId !== ""
        ? String(existing.selectedSkillId)
        : null,
    results: Array.isArray(existing.results) ? existing.results.slice() : [],
    capabilityRefs: Array.isArray(existing.capabilityRefs) ? existing.capabilityRefs.slice() : [],
    identityRefs: Array.isArray(existing.identityRefs) ? existing.identityRefs.slice() : [],
    authorization: existing.authorization || null,
    audit: existing.audit || null,
    modelMeta: existing.modelMeta || null,
    result: String(existing.result || ""),
    existingUserPositions: String(existing.existingUserPositions || ""),
    digitalMeInferences: String(existing.digitalMeInferences || ""),
  };
}

function rendererAttemptedResearchForge(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  for (const key of RENDERER_FORBIDDEN_RESEARCH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(p, key) && p[key] != null) {
      if ((key === "invocations" || key === "results") && Array.isArray(p[key])) return true;
      if (key !== "invocations" && key !== "results") return true;
    }
  }
  // Nested forge under a bogus full task dump
  if (p.task && typeof p.task === "object") {
    for (const key of ["invocations", "selectedSkillId", "discoveredSources", "results"]) {
      if (Object.prototype.hasOwnProperty.call(p.task, key) && p.task[key] != null) return true;
    }
  }
  return false;
}

/**
 * Merge renderer draft edits onto an authoritative task without accepting research fields.
 * Used by actBehalf:save (and tests of that exact production helper).
 *
 * @param {{ existing?: object|null, rendererPayload?: object }} args
 */
function buildDraftSaveRecord({ existing, rendererPayload } = {}) {
  const payload = rendererPayload && typeof rendererPayload === "object" ? rendererPayload : {};
  const goal = String(payload.goal || payload.request || "").trim();
  const title =
    String(payload.title || "").trim() ||
    (goal ? goal.slice(0, 40) + (goal.length > 40 ? "…" : "") : "未命名任务");

  const goalFields = applyGoalChangeToStoredTask(existing || null, goal);
  const research = takeAuthoritativeResearchFields(existing || null);

  const intentSrc =
    payload.taskIntent && typeof payload.taskIntent === "object" ? payload.taskIntent : {};

  const taskIntent = normalizeTaskIntent(
    {
      ...(existing && existing.taskIntent),
      goal,
      role: payload.role != null ? payload.role : intentSrc.role,
      expectedOutcome:
        payload.expectedOutcome != null ? payload.expectedOutcome : intentSrc.expectedOutcome,
      constraints:
        payload.constraints != null ? payload.constraints : intentSrc.constraints,
    },
    (payload.taskId && String(payload.taskId)) || (existing && existing.taskId) || undefined
  );

  let status = "draft";
  if (goalFields.invalidatedConfirmed) {
    status = goalFields.status || "draft";
  } else if (payload.status != null && String(payload.status).trim()) {
    // Allow only non-research status labels from renderer; never promote to research_succeeded
    const requested = String(payload.status).trim();
    if (
      requested === "research_succeeded" ||
      requested === "research_failed" ||
      requested === "research_running" ||
      requested === "context_confirmed"
    ) {
      status = existing && existing.status ? String(existing.status) : "draft";
    } else {
      status = requested;
    }
  } else if (existing && existing.status) {
    status = String(existing.status);
  }

  const record = {
    taskId: (existing && existing.taskId) || (payload.taskId ? String(payload.taskId) : undefined),
    createdAt: existing && existing.createdAt,
    title,
    request: goal,
    goal,
    taskIntent,
    status,
    subjectContextCandidates: goalFields.subjectContextCandidates,
    subjectContext: goalFields.subjectContext,
    priorSubjectContext: goalFields.priorSubjectContext,
    contextAudit: (existing && existing.contextAudit) || null,
    selectedSelfContext: (existing && existing.selectedSelfContext) || undefined,
    existingUserPositions: research.existingUserPositions,
    digitalMeInferences: research.digitalMeInferences,
    result: research.result,
    // Authoritative research / audit / results — never from renderer
    invocations: research.invocations,
    selectedSkillId: research.selectedSkillId,
    results: research.results,
    capabilityRefs: research.capabilityRefs,
    identityRefs: research.identityRefs,
    authorization: research.authorization,
    audit: research.audit,
    modelMeta: research.modelMeta,
  };

  return {
    record,
    goalFields,
    rejectedRendererResearch: rendererAttemptedResearchForge(payload),
  };
}

/**
 * Production path used by actBehalf:save.
 * Loads authoritative task by taskId, merges only allowed renderer fields, saves.
 */
async function saveDraftFromRenderer(store, userData, rendererPayload) {
  if (!store || typeof store.getTask !== "function" || typeof store.saveTask !== "function") {
    return { ok: false, code: "store_unavailable", message: "任务存储不可用。" };
  }
  let existing = null;
  const taskId = rendererPayload && rendererPayload.taskId;
  if (taskId) {
    const got = store.getTask(userData, taskId);
    if (got.ok) existing = got.task;
  }

  const built = buildDraftSaveRecord({ existing, rendererPayload });
  const saved = await store.saveTask(userData, built.record);
  return {
    ...saved,
    invalidatedConfirmed: built.goalFields.invalidatedConfirmed,
    clearedCandidates: built.goalFields.clearedCandidates,
    rejectedRendererResearch: built.rejectedRendererResearch,
  };
}

/**
 * Attach authoritative research fields onto a main-authored patch
 * (confirmContext / previewContext). Ignores any research keys on `patch`.
 */
function withAuthoritativeResearchFields(existing, patch) {
  const research = takeAuthoritativeResearchFields(existing || null);
  const base = patch && typeof patch === "object" ? { ...patch } : {};
  for (const key of RENDERER_FORBIDDEN_RESEARCH_KEYS) {
    delete base[key];
  }
  return {
    ...base,
    invocations: research.invocations,
    selectedSkillId: research.selectedSkillId,
    results: research.results,
    result: research.result,
    existingUserPositions: research.existingUserPositions,
    digitalMeInferences: research.digitalMeInferences,
    capabilityRefs: research.capabilityRefs,
    identityRefs: research.identityRefs,
    authorization: research.authorization,
    audit: research.audit,
    modelMeta: research.modelMeta,
  };
}

module.exports = {
  RENDERER_FORBIDDEN_RESEARCH_KEYS,
  takeAuthoritativeResearchFields,
  rendererAttemptedResearchForge,
  buildDraftSaveRecord,
  saveDraftFromRenderer,
  withAuthoritativeResearchFields,
};

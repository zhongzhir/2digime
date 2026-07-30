"use strict";

/**
 * MVP-RELEASE-GATE-01D — startup heal for interrupted generation & learning.
 * Derives recovery from existing Package / Learn stores + filesystem.
 * No new permanent Stores or fields.
 */

const fs = require("node:fs");
const path = require("node:path");

const packageStore = require("./deliverable-package-store");
const learnStore = require("./deliverable-learn-store");
const { JOB_STATUS } = learnStore;
const artifactFs = require("./deliverable-artifact-fs");
const { reconcileArtifactFilesystem } = require("./artifact-reconciliation");

const USER_INTERRUPT_SUMMARY = "上次工作被中断，任务和材料已经保留。";
const ACTIVE_GEN = new Set(["generating", "repairing"]);

function nowIso() {
  return new Date().toISOString();
}

function versionFilesPresent(userData, version) {
  if (!version) return false;
  const refs = [];
  if (version.artifactRef) refs.push(version.artifactRef);
  if (version.previewRef) refs.push(version.previewRef);
  if (Array.isArray(version.artifactRefs)) refs.push(...version.artifactRefs);
  if (!refs.length) return false;
  let anyOk = false;
  for (const ref of refs) {
    if (!ref || !ref.relativePath) continue;
    try {
      const abs = artifactFs.resolveAbsolute(userData, ref.relativePath);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) anyOk = true;
      else return false;
    } catch {
      return false;
    }
  }
  return anyOk;
}

function findCompleteVersionForAttempt(store, attempt) {
  const attemptId = String(attempt.id);
  if (attempt.producedVersionId && store.versions[attempt.producedVersionId]) {
    return store.versions[attempt.producedVersionId];
  }
  const d = store.deliverables[String(attempt.deliverableId)];
  if (d && d.currentVersionId && store.versions[d.currentVersionId]) {
    const v = store.versions[d.currentVersionId];
    if (String(v.generationAttemptId || "") === attemptId) return v;
  }
  for (const v of Object.values(store.versions || {})) {
    if (v && String(v.generationAttemptId || "") === attemptId) return v;
  }
  return null;
}

function markAttemptSucceeded(store, attempt, version) {
  const a = store.generationAttempts[attempt.id];
  if (!a) return false;
  if (a.status === "succeeded" && a.producedVersionId === version.id) return false;
  a.status = "succeeded";
  a.finishedAt = a.finishedAt || nowIso();
  a.producedVersionId = version.id;
  a.outcome = a.outcome || "created_new_version";
  a.errorCode = null;
  a.errorSummary = null;
  a.userIssueSummary = null;
  const d = store.deliverables[String(attempt.deliverableId)];
  if (d) {
    d.generationStatus = "ready";
    d.currentVersionId = d.currentVersionId || version.id;
    if (!Array.isArray(d.versionIds) || !d.versionIds.includes(version.id)) {
      d.versionIds = (Array.isArray(d.versionIds) ? d.versionIds : []).concat([version.id]);
    }
    d.latestGenerationAttemptId = attempt.id;
    d.lastGenerationIssueSummary = null;
    d.updatedAt = nowIso();
  }
  return true;
}

function markAttemptInterrupted(store, attempt) {
  const a = store.generationAttempts[attempt.id];
  if (!a) return false;
  if (a.status === "failed" && a.errorCode === "generation_interrupted") return false;
  a.status = "failed";
  a.finishedAt = a.finishedAt || nowIso();
  a.errorCode = "generation_interrupted";
  a.errorSummary = USER_INTERRUPT_SUMMARY;
  a.userIssueSummary = USER_INTERRUPT_SUMMARY;
  a.outcome = a.outcome || "interrupted";
  const d = store.deliverables[String(attempt.deliverableId)];
  if (d) {
    // Keep ready if a prior successful version still exists.
    if (d.currentVersionId && store.versions[d.currentVersionId]) {
      d.generationStatus = "ready";
      d.lastGenerationIssueSummary = null;
    } else {
      d.generationStatus = "failed";
      d.lastGenerationIssueSummary = USER_INTERRUPT_SUMMARY;
    }
    d.updatedAt = nowIso();
  }
  return true;
}

/**
 * Heal residual generating/repairing attempts.
 * Idempotent across repeated startups.
 */
async function healInterruptedGeneration(userData) {
  const actions = [];
  let store;
  try {
    store = packageStore.loadStore(userData);
  } catch (err) {
    return { ok: false, code: err && err.code, message: err && err.message, actions, mutated: false };
  }

  const pending = Object.values(store.generationAttempts || {}).filter(
    (a) => a && ACTIVE_GEN.has(String(a.status))
  );
  if (!pending.length) {
    return { ok: true, mutated: false, actions };
  }

  let mutated = false;
  await packageStore.mutateStore(userData, (s) => {
    s.generationAttempts = s.generationAttempts || {};
    for (const attempt of Object.values(s.generationAttempts)) {
      if (!attempt || !ACTIVE_GEN.has(String(attempt.status))) continue;

      const version = findCompleteVersionForAttempt(s, attempt);
      if (version && versionFilesPresent(userData, version)) {
        if (markAttemptSucceeded(s, attempt, version)) {
          mutated = true;
          actions.push({
            kind: "generation_heal_succeeded",
            attemptId: attempt.id,
            versionId: version.id,
          });
        }
        continue;
      }

      if (markAttemptInterrupted(s, attempt)) {
        mutated = true;
        actions.push({
          kind: "generation_heal_interrupted",
          attemptId: attempt.id,
          deliverableId: attempt.deliverableId,
        });
      }
    }
    return { healed: mutated, actions: actions.slice() };
  });

  return { ok: true, mutated, actions };
}

function learningAssetsComplete(job) {
  if (!job) return false;
  if (job.commit && (job.commit.changeSetId || job.commit.packageRevision != null)) return true;
  const audit = Array.isArray(job.audit) ? job.audit : [];
  if (audit.some((e) => e && (e.action === "committed" || e.action === "skipped_empty"))) return true;
  if (job.status === JOB_STATUS.committed || job.status === JOB_STATUS.skipped) return true;
  return false;
}

/**
 * Heal residual running learn jobs.
 */
function healInterruptedLearning(userData) {
  const actions = [];
  let mutated = false;
  let store;
  try {
    store = learnStore.loadStore(userData);
  } catch (err) {
    return { ok: false, code: err && err.code, message: err && err.message, actions };
  }

  for (const job of Object.values(store.jobs || {})) {
    if (!job || job.status !== JOB_STATUS.running) continue;

    if (learningAssetsComplete(job)) {
      const nextStatus =
        job.commit && job.commit.changeSetId ? JOB_STATUS.committed : JOB_STATUS.skipped;
      if (job.status !== nextStatus) {
        learnStore.upsertJob(userData, {
          ...job,
          status: nextStatus,
          lastError: null,
          audit: (job.audit || []).concat([
            { at: nowIso(), action: "heal_completed_from_assets", previousStatus: "running" },
          ]),
        });
        mutated = true;
        actions.push({ kind: "learning_heal_completed", jobId: job.id, status: nextStatus });
      }
      continue;
    }

    learnStore.upsertJob(userData, {
      ...job,
      status: JOB_STATUS.failed,
      lastError: "learning_interrupted",
      audit: (job.audit || []).concat([
        { at: nowIso(), action: "heal_interrupted", code: "learning_interrupted" },
      ]),
    });
    mutated = true;
    actions.push({ kind: "learning_heal_interrupted", jobId: job.id });
  }

  return { ok: true, mutated, actions };
}

/**
 * Full startup recovery: generation heal → learning heal → artifact reconcile.
 */
async function runStartupInterruptRecovery(userData, opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const generation = await healInterruptedGeneration(userData);
  const learning = healInterruptedLearning(userData);
  const artifacts = reconcileArtifactFilesystem(userData, {
    isolateOrphans: options.isolateOrphans !== false,
    stagingMaxAgeMs: options.stagingMaxAgeMs,
  });

  return {
    ok: true,
    generation,
    learning,
    artifacts,
    recoveredFromBackup: !!(options.storeRecoveryEvents && options.storeRecoveryEvents.length),
    storeRecoveryEvents: options.storeRecoveryEvents || [],
  };
}

module.exports = {
  USER_INTERRUPT_SUMMARY,
  healInterruptedGeneration,
  healInterruptedLearning,
  runStartupInterruptRecovery,
  versionFilesPresent,
  findCompleteVersionForAttempt,
  learningAssetsComplete,
};

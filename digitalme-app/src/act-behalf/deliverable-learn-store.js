"use strict";

/**
 * Local store for DVL2 deliverable auto-learn jobs (audit + idempotency).
 * File: <userData>/deliverable-learn-jobs.json
 */

const path = require("node:path");
const crypto = require("node:crypto");
const {
  writeJsonStoreAtomicSync,
  readJsonStoreWithBackup,
} = require("../json-store-persistence");

const STORE_NAME = "deliverable-learn-jobs.json";

const JOB_STATUS = Object.freeze({
  queued: "queued",
  running: "running",
  committed: "committed",
  pending_conflict: "pending_conflict",
  failed: "failed",
  skipped: "skipped",
  resolved_keep: "resolved_keep",
  resolved_session_only: "resolved_session_only",
});

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return (
    String(prefix || "learn_") +
    Date.now().toString(36) +
    "_" +
    crypto.randomBytes(3).toString("hex")
  );
}

function storePath(userData) {
  return path.join(String(userData || ""), STORE_NAME);
}

function emptyStore() {
  return { schemaVersion: 1, jobs: {}, byVersionId: {}, updatedAt: nowIso() };
}

function validateLearnStore(raw) {
  return !!(raw && typeof raw === "object");
}

function loadStore(userData) {
  const p = storePath(userData);
  let loaded;
  try {
    loaded = readJsonStoreWithBackup({
      targetPath: p,
      validate: validateLearnStore,
      emptyWhenMissing: emptyStore,
      corruptCode: "learn_store_corrupt",
    });
  } catch (err) {
    const e = new Error("学习作业存储损坏。");
    e.code = "learn_store_corrupt";
    e.cause = err;
    throw e;
  }
  const raw = loaded.parsed;
  return {
    schemaVersion: 1,
    jobs: raw.jobs && typeof raw.jobs === "object" ? raw.jobs : {},
    byVersionId: raw.byVersionId && typeof raw.byVersionId === "object" ? raw.byVersionId : {},
    updatedAt: raw.updatedAt || nowIso(),
  };
}

function saveStore(userData, store) {
  const p = storePath(userData);
  const next = {
    ...store,
    schemaVersion: 1,
    updatedAt: nowIso(),
  };
  writeJsonStoreAtomicSync({ targetPath: p, data: next, pretty: true });
  return next;
}

function getJob(userData, jobId) {
  const store = loadStore(userData);
  const job = store.jobs[String(jobId || "")];
  if (!job) return { ok: false, code: "job_not_found", message: "未找到学习作业。" };
  return { ok: true, job: JSON.parse(JSON.stringify(job)) };
}

function getJobByVersionId(userData, deliverableVersionId) {
  const store = loadStore(userData);
  const id = store.byVersionId[String(deliverableVersionId || "")];
  if (!id) return { ok: false, code: "job_not_found", message: "尚未有学习作业。" };
  return getJob(userData, id);
}

function listJobsForTask(userData, taskId) {
  const store = loadStore(userData);
  const tid = String(taskId || "");
  return Object.values(store.jobs || {})
    .filter((j) => j && String(j.source && j.source.taskId) === tid)
    .map((j) => JSON.parse(JSON.stringify(j)))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function upsertJob(userData, job) {
  const store = loadStore(userData);
  const id = String(job.id);
  const versionId = job.source && job.source.deliverableVersionId;
  store.jobs[id] = { ...job, updatedAt: nowIso() };
  if (versionId) store.byVersionId[String(versionId)] = id;
  saveStore(userData, store);
  return JSON.parse(JSON.stringify(store.jobs[id]));
}

function createQueuedJob(userData, source) {
  const versionId = String(source.deliverableVersionId || "");
  if (!versionId) {
    return { ok: false, code: "version_required", message: "缺少成果版本。" };
  }
  const existing = getJobByVersionId(userData, versionId);
  if (existing.ok) {
    const st = existing.job.status;
    if (
      st === JOB_STATUS.committed ||
      st === JOB_STATUS.pending_conflict ||
      st === JOB_STATUS.resolved_keep ||
      st === JOB_STATUS.resolved_session_only ||
      st === JOB_STATUS.skipped
    ) {
      return { ok: true, job: existing.job, reused: true };
    }
    if (st === JOB_STATUS.queued) {
      return { ok: true, job: existing.job, reused: true };
    }
    // failed or zombie running → allow safe retry by resetting to queued
  }

  const job = {
    id: existing.ok ? existing.job.id : newId("learn_"),
    status: JOB_STATUS.queued,
    idempotencyKey: versionId,
    source: {
      taskId: source.taskId || null,
      planVersionId: source.planVersionId || null,
      packageId: source.packageId || null,
      deliverableId: source.deliverableId || null,
      deliverableVersionId: versionId,
      artifactRefs: Array.isArray(source.artifactRefs) ? source.artifactRefs : [],
      contentHashes: Array.isArray(source.contentHashes) ? source.contentHashes : [],
      acceptedAt: source.acceptedAt || nowIso(),
      provenance: source.provenance || null,
    },
    extracted: [],
    classified: [],
    consolidateDiff: null,
    conflict: null,
    commit: null,
    attempts: existing.ok && Array.isArray(existing.job.attempts) ? existing.job.attempts.slice() : [],
    audit: existing.ok && Array.isArray(existing.job.audit) ? existing.job.audit.slice() : [],
    createdAt: (existing.ok && existing.job.createdAt) || nowIso(),
    updatedAt: nowIso(),
    lastError: null,
  };
  const saved = upsertJob(userData, job);
  return { ok: true, job: saved, reused: false };
}

function appendAudit(job, event) {
  const list = Array.isArray(job.audit) ? job.audit.slice() : [];
  list.push({ at: nowIso(), ...(event || {}) });
  return { ...job, audit: list, updatedAt: nowIso() };
}

module.exports = {
  JOB_STATUS,
  loadStore,
  saveStore,
  getJob,
  getJobByVersionId,
  listJobsForTask,
  upsertJob,
  createQueuedJob,
  appendAudit,
  newId,
  nowIso,
};

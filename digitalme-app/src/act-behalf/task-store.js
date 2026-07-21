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
const { healRunningProposals, markProposalsStale } = require("./experience-proposal");

const STORE_VERSION = 2;
const TASK_SCHEMA_VERSION = 2;
const RENAME_RETRY_WAITS_MS = Object.freeze([50, 150, 350]);
const RENAME_RETRY_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

/** @type {Promise<void>} */
let writeQueueTail = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storePath(userData) {
  return path.join(userData, "act-behalf-tasks.json");
}

function emptyStore() {
  return { version: STORE_VERSION, tasks: [] };
}

function newTaskId() {
  return "abt_" + Date.now().toString(36) + "_" + crypto.randomBytes(3).toString("hex");
}

function loadStore(userData) {
  const p = storePath(userData);
  if (!fs.existsSync(p)) return emptyStore();
  const raw = fs.readFileSync(p, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const e = new Error("任务存档无法解析，请勿覆盖。");
    e.code = "act_behalf_parse_failed";
    e.cause = err;
    throw e;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tasks)) {
    const e = new Error("任务存档格式无效。");
    e.code = "act_behalf_invalid_store";
    throw e;
  }
  return parsed;
}

async function persistStoreAtomic(userData, store) {
  const target = storePath(userData);
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = target + ".tmp." + process.pid + "." + Date.now();
  const payload = JSON.stringify(store, null, 2);
  fs.writeFileSync(tmp, payload, "utf8");
  let lastErr = null;
  for (let attempt = 0; attempt < RENAME_RETRY_WAITS_MS.length + 1; attempt += 1) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (err) {
      lastErr = err;
      if (!err || !RENAME_RETRY_CODES.has(err.code)) break;
      if (attempt < RENAME_RETRY_WAITS_MS.length) {
        await sleep(RENAME_RETRY_WAITS_MS[attempt]);
      }
    }
  }
  try {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  throw lastErr || new Error("任务存档写入失败");
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
    selectedSelfContext,
    existingUserPositions: String((input && input.existingUserPositions) || ""),
    digitalMeInferences: String((input && input.digitalMeInferences) || ""),
    result: String((input && input.result) || ""),
    // Block 2+: Capability Invocation records (append-only from main process)
    invocations: Array.isArray(input && input.invocations) ? input.invocations : [],
    selectedSkillId: input && input.selectedSkillId ? String(input.selectedSkillId) : null,
    // Block 3+: research expression results (append-only from main process)
    results: Array.isArray(input && input.results) ? input.results : [],
    // Block 4+: Experience Proposals (append-only from main process)
    proposals: Array.isArray(input && input.proposals) ? input.proposals : [],
    capabilityRefs: Array.isArray(input && input.capabilityRefs) ? input.capabilityRefs : [],
    identityRefs: Array.isArray(input && input.identityRefs) ? input.identityRefs : [],
    authorization: (input && input.authorization) || null,
    audit: (input && input.audit) || null,
    modelMeta: (input && input.modelMeta) || null,
    createdAt: String((input && input.createdAt) || now),
    updatedAt: String((input && input.updatedAt) || now),
  };
}

function listTasks(userData) {
  const store = loadStore(userData);
  return {
    ok: true,
    tasks: (store.tasks || [])
      .slice()
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .map((t) => {
        const norm = normalizeTask(t);
        return {
          taskId: norm.taskId,
          title: norm.title,
          status: norm.status,
          createdAt: norm.createdAt,
          updatedAt: norm.updatedAt,
          requestPreview: String(norm.taskIntent.goal || norm.request || "").slice(0, 120),
          contextConfirmed: !!(norm.subjectContext && norm.subjectContext.confirmationState === "confirmed"),
        };
      }),
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
  const healedProposals = healRunningProposals(norm.proposals);
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
      store.tasks[idx] = task;
    } else {
      store.tasks.unshift(task);
    }
    await persistStoreAtomic(userData, store);
  });
  return { ok: true, task };
}

async function deleteTask(userData, taskId) {
  const id = String(taskId || "");
  await enqueueWrite(async () => {
    const store = loadStore(userData);
    store.tasks = (store.tasks || []).filter((t) => t.taskId !== id);
    await persistStoreAtomic(userData, store);
  });
  return { ok: true };
}

module.exports = {
  STORE_VERSION,
  TASK_SCHEMA_VERSION,
  storePath,
  newTaskId,
  loadStore,
  listTasks,
  getTask,
  saveTask,
  deleteTask,
  normalizeTask,
  migrateLegacySelectedSelfContext,
};

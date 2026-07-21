"use strict";

/**
 * Minimal act-behalf task store — hermetic userData JSON with atomic rename.
 * File: <userData>/act-behalf-tasks.json
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const STORE_VERSION = 1;
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

function normalizeTask(input) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    taskId: String(input.taskId || newTaskId()),
    title: String(input.title || "").trim() || "未命名任务",
    request: String(input.request || ""),
    status: String(input.status || "draft"),
    selectedSelfContext: input.selectedSelfContext || {
      items: [],
      combinedText: "",
      userEdited: false,
    },
    existingUserPositions: String(input.existingUserPositions || ""),
    digitalMeInferences: String(input.digitalMeInferences || ""),
    result: String(input.result || ""),
    // Reserved for later capability / identity / authorization / audit expansion
    capabilityRefs: Array.isArray(input.capabilityRefs) ? input.capabilityRefs : [],
    identityRefs: Array.isArray(input.identityRefs) ? input.identityRefs : [],
    authorization: input.authorization || null,
    audit: input.audit || null,
    modelMeta: input.modelMeta || null,
    createdAt: String(input.createdAt || now),
    updatedAt: String(input.updatedAt || now),
  };
}

function listTasks(userData) {
  const store = loadStore(userData);
  return {
    ok: true,
    tasks: (store.tasks || [])
      .slice()
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .map((t) => ({
        taskId: t.taskId,
        title: t.title,
        status: t.status,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        requestPreview: String(t.request || "").slice(0, 120),
      })),
  };
}

function getTask(userData, taskId) {
  const store = loadStore(userData);
  const task = (store.tasks || []).find((t) => t.taskId === String(taskId || ""));
  if (!task) {
    return { ok: false, code: "not_found", message: "找不到该任务。" };
  }
  return { ok: true, task };
}

async function saveTask(userData, taskInput) {
  const task = normalizeTask(taskInput);
  task.updatedAt = new Date().toISOString();
  await enqueueWrite(async () => {
    const store = loadStore(userData);
    const idx = store.tasks.findIndex((t) => t.taskId === task.taskId);
    if (idx >= 0) store.tasks[idx] = task;
    else store.tasks.unshift(task);
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
  storePath,
  newTaskId,
  loadStore,
  listTasks,
  getTask,
  saveTask,
  deleteTask,
  normalizeTask,
};

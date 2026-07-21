"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  safePreviewText,
  toPersistableMessage,
} = require("./chat-message-model");

const RENAME_RETRY_WAITS_MS = Object.freeze([50, 150, 350]);
const RENAME_MAX_ATTEMPTS = 4;
const RENAME_RETRY_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);

/** Process-level recovery latch — blocks ALL formal sessions writes. */
let sessionsRecoveryLatch = false;
let latchReason = null;
let latchPath = null;

/** Injectable fs for hermetic rename tests. */
let fsImpl = fs;

/** @type {Promise<void>} */
let writeQueueTail = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sessionsPath(userData) {
  return path.join(userData, "workbench-sessions.json");
}

function isRecoveryLatched() {
  return sessionsRecoveryLatch === true;
}

function getRecoveryState() {
  return {
    latched: sessionsRecoveryLatch,
    reason: latchReason,
    path: latchPath,
  };
}

function setRecoveryLatch(reason, filePath) {
  sessionsRecoveryLatch = true;
  latchReason = String(reason || "sessions_parse_failed");
  latchPath = filePath || null;
}

/** Test-only: reset latch between hermetic cases. */
function _resetRecoveryLatchForTests() {
  sessionsRecoveryLatch = false;
  latchReason = null;
  latchPath = null;
}

function _setFsForTests(nextFs) {
  fsImpl = nextFs || fs;
}

function assertWritable() {
  if (sessionsRecoveryLatch) {
    const err = new Error("会话存档当前无法安全写入，请返回经典界面或新建对话前先处理存档问题。");
    err.code = "sessions_recovery_latched";
    throw err;
  }
}

function emptyStore() {
  return { version: 1, activeId: null, sessions: [] };
}

function validateStoreShape(store) {
  if (!store || typeof store !== "object" || Array.isArray(store)) return false;
  if (!Array.isArray(store.sessions)) return false;
  return true;
}

/**
 * Read formal store. Missing file → empty (OK for new install).
 * Parse / shape failure → set latch and throw (NEVER return empty that could overwrite).
 */
function loadStore(userData) {
  const p = sessionsPath(userData);
  if (!fsImpl.existsSync(p)) {
    return emptyStore();
  }
  let raw;
  try {
    raw = fsImpl.readFileSync(p, "utf8");
  } catch (err) {
    setRecoveryLatch("sessions_read_failed", p);
    const e = new Error("会话存档无法读取。");
    e.code = "sessions_read_failed";
    e.cause = err;
    throw e;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    setRecoveryLatch("sessions_parse_failed", p);
    const e = new Error("会话存档已损坏，已阻止覆盖写入。");
    e.code = "sessions_parse_failed";
    e.cause = err;
    throw e;
  }
  if (!validateStoreShape(parsed)) {
    setRecoveryLatch("sessions_shape_invalid", p);
    const e = new Error("会话存档结构无效，已阻止覆盖写入。");
    e.code = "sessions_shape_invalid";
    throw e;
  }
  return parsed;
}

function tryLoadStore(userData) {
  try {
    return { ok: true, store: loadStore(userData) };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "sessions_load_failed",
      message: err && err.message ? err.message : "会话存档无法读取。",
      recovery: getRecoveryState(),
    };
  }
}

async function atomicRenameWithRetry(tmpPath, finalPath) {
  let lastErr = null;
  for (let attempt = 0; attempt < RENAME_MAX_ATTEMPTS; attempt++) {
    try {
      fsImpl.renameSync(tmpPath, finalPath);
      return { ok: true, attempts: attempt + 1 };
    } catch (err) {
      lastErr = err;
      const code = err && err.code ? String(err.code) : "";
      const canRetry = RENAME_RETRY_CODES.has(code) && attempt < RENAME_MAX_ATTEMPTS - 1;
      if (!canRetry) {
        const e = new Error("会话未能保存到磁盘。");
        e.code = "sessions_rename_failed";
        e.attempts = attempt + 1;
        e.cause = err;
        throw e;
      }
      await sleep(RENAME_RETRY_WAITS_MS[attempt]);
    }
  }
  const e = new Error("会话未能保存到磁盘。");
  e.code = "sessions_rename_failed";
  e.attempts = RENAME_MAX_ATTEMPTS;
  e.cause = lastErr;
  throw e;
}

async function persistStoreAtomic(userData, store) {
  assertWritable();
  if (!validateStoreShape(store)) {
    const e = new Error("会话数据无效，未写入磁盘。");
    e.code = "sessions_store_invalid";
    throw e;
  }
  const finalPath = sessionsPath(userData);
  const dir = path.dirname(finalPath);
  if (!fsImpl.existsSync(dir)) {
    fsImpl.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = path.join(
    dir,
    "workbench-sessions." + process.pid + "." + Date.now().toString(36) + ".tmp"
  );
  const payload = JSON.stringify(store, null, 2);
  let fd = null;
  try {
    fd = fsImpl.openSync(tmpPath, "w");
    fsImpl.writeSync(fd, payload, 0, "utf8");
    try {
      fsImpl.fsyncSync(fd);
    } catch {
      /* some test fs mocks omit fsync */
    }
    fsImpl.closeSync(fd);
    fd = null;
    return await atomicRenameWithRetry(tmpPath, finalPath);
  } catch (err) {
    if (fd != null) {
      try {
        fsImpl.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    try {
      if (fsImpl.existsSync(tmpPath)) fsImpl.unlinkSync(tmpPath);
    } catch {
      /* ignore — must not destroy formal file */
    }
    throw err;
  }
}

function enqueueWrite(task) {
  const run = writeQueueTail.then(() => task(), () => task());
  writeQueueTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function saveStore(userData, store) {
  return enqueueWrite(() => persistStoreAtomic(userData, store));
}

function newId() {
  return "s_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e4);
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => {
    try {
      return toPersistableMessage(m);
    } catch {
      return {
        schemaVersion: 2,
        id: "m_bad_" + Date.now().toString(36),
        role: m && m.role === "assistant" ? "assistant" : "user",
        displayText: "这条历史消息无法显示。",
        modelText: "",
        attachmentRefs: [],
        createdAt: new Date().toISOString(),
      };
    }
  });
}

async function createSession(userData, opts = {}) {
  return enqueueWrite(async () => {
    assertWritable();
    const store = loadStore(userData);
    const s = {
      id: newId(),
      title: opts.title || "新对话",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      attachments: [],
      artifacts: [],
      packagePath: opts.packagePath || null,
    };
    store.sessions.unshift(s);
    store.activeId = s.id;
    await persistStoreAtomic(userData, store);
    return s;
  });
}

function listSessions(userData) {
  const loaded = tryLoadStore(userData);
  if (!loaded.ok) {
    return {
      activeId: null,
      sessions: [],
      recovery: loaded.recovery,
      error: { code: loaded.code, message: loaded.message },
    };
  }
  const store = loaded.store;
  return {
    activeId: store.activeId,
    sessions: store.sessions.map((s) => {
      if (!s || typeof s !== "object") {
        return {
          id: "s_broken_" + Date.now().toString(36),
          title: "无法显示的对话",
          updatedAt: null,
          createdAt: null,
          preview: "",
          broken: true,
        };
      }
      try {
        const firstUser = (s.messages || []).find((m) => m && m.role === "user");
        return {
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          createdAt: s.createdAt,
          preview: firstUser ? safePreviewText(firstUser, 40) : "",
          broken: false,
        };
      } catch {
        return {
          id: s.id || "s_broken",
          title: String(s.title || "无法显示的对话"),
          updatedAt: s.updatedAt || null,
          createdAt: s.createdAt || null,
          preview: "",
          broken: true,
        };
      }
    }),
  };
}

function getSession(userData, id) {
  const store = loadStore(userData);
  return store.sessions.find((s) => s.id === id) || null;
}

async function saveSession(userData, session) {
  return enqueueWrite(async () => {
    assertWritable();
    const store = loadStore(userData);
    const i = store.sessions.findIndex((s) => s.id === session.id);
    const next = { ...session };
    if (Array.isArray(next.messages)) {
      next.messages = sanitizeMessages(next.messages);
    }
    next.updatedAt = new Date().toISOString();
    if (i >= 0) store.sessions[i] = next;
    else store.sessions.unshift(next);
    store.activeId = next.id;
    store.sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    await persistStoreAtomic(userData, store);
    return next;
  });
}

async function renameSession(userData, id, title) {
  return enqueueWrite(async () => {
    assertWritable();
    const store = loadStore(userData);
    const s = store.sessions.find((x) => x.id === id);
    if (!s) throw new Error("找不到该对话");
    s.title = String(title || "未命名").slice(0, 60);
    s.updatedAt = new Date().toISOString();
    await persistStoreAtomic(userData, store);
    return s;
  });
}

async function deleteSession(userData, id) {
  return enqueueWrite(async () => {
    assertWritable();
    const store = loadStore(userData);
    store.sessions = store.sessions.filter((s) => s.id !== id);
    if (store.activeId === id) store.activeId = store.sessions[0]?.id || null;
    await persistStoreAtomic(userData, store);
    return { activeId: store.activeId };
  });
}

async function setActive(userData, id) {
  return enqueueWrite(async () => {
    assertWritable();
    const store = loadStore(userData);
    if (!store.sessions.some((s) => s.id === id)) throw new Error("找不到该对话");
    store.activeId = id;
    await persistStoreAtomic(userData, store);
    return store.sessions.find((s) => s.id === id) || null;
  });
}

/**
 * Mutate store under write queue (for main-authoritative chat paths).
 */
async function updateStore(userData, mutator) {
  return enqueueWrite(async () => {
    assertWritable();
    const store = loadStore(userData);
    const result = await mutator(store);
    await persistStoreAtomic(userData, store);
    return result;
  });
}

module.exports = {
  loadStore,
  tryLoadStore,
  listSessions,
  getSession,
  createSession,
  saveSession,
  renameSession,
  deleteSession,
  setActive,
  sessionsPath,
  saveStore,
  updateStore,
  isRecoveryLatched,
  assertWritable,
  getRecoveryState,
  setRecoveryLatch,
  RENAME_RETRY_WAITS_MS,
  RENAME_MAX_ATTEMPTS,
  RENAME_RETRY_CODES,
  _resetRecoveryLatchForTests,
  _setFsForTests,
};

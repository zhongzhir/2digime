"use strict";

/**
 * MVP-RELEASE-GATE-01D — shared JSON store persistence with .bak recovery.
 *
 * Write order (Windows-aware):
 *   serialize → write tmp → copy current → .bak → rename tmp → current → cleanup
 *
 * Read order:
 *   main → validate → else .bak → restore main if bak valid → else throw (never empty-overwrite)
 */

const fs = require("node:fs");
const path = require("node:path");

const RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY", "EEXIST"]);
const RENAME_RETRY_WAITS_MS = [15, 40, 90, 180];

/** @type {Array<object>} */
const recoveryEvents = [];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sleepSync(ms) {
  const end = Date.now() + Math.max(0, Number(ms) || 0);
  while (Date.now() < end) {
    /* bounded spin for sync rename retries on Windows */
  }
}

function bakPath(targetPath) {
  return String(targetPath) + ".bak";
}

function recordRecoveryEvent(evt) {
  recoveryEvents.push({ at: new Date().toISOString(), ...(evt || {}) });
  if (recoveryEvents.length > 40) recoveryEvents.splice(0, recoveryEvents.length - 40);
}

function drainRecoveryEvents() {
  const out = recoveryEvents.slice();
  recoveryEvents.length = 0;
  return out;
}

function peekRecoveryEvents() {
  return recoveryEvents.slice();
}

function serializePayload(data, pretty) {
  if (typeof data === "string") return data;
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

function prepareTmpWrite(target, payload) {
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = target + ".tmp." + process.pid + "." + Date.now();
  fs.writeFileSync(tmp, payload, "utf8");
  if (fs.existsSync(target)) {
    try {
      fs.copyFileSync(target, bakPath(target));
    } catch {
      /* best-effort bak */
    }
  }
  return tmp;
}

function finalizeRename(tmp, target) {
  let lastErr = null;
  for (let attempt = 0; attempt < RENAME_RETRY_WAITS_MS.length + 1; attempt += 1) {
    try {
      fs.renameSync(tmp, target);
      return { ok: true };
    } catch (err) {
      lastErr = err;
      if (!err || !RENAME_RETRY_CODES.has(err.code)) break;
      if (attempt < RENAME_RETRY_WAITS_MS.length) sleepSync(RENAME_RETRY_WAITS_MS[attempt]);
    }
  }
  try {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  throw lastErr || new Error("store write failed");
}

/**
 * Atomically persist JSON with a previous-good .bak (async wrapper).
 * @param {{ targetPath: string, data: object|string, pretty?: boolean }} opts
 */
async function writeJsonStoreAtomic(opts) {
  const target = path.resolve(String(opts.targetPath || ""));
  if (!target) throw new Error("store path required");
  const payload = serializePayload(opts.data, opts.pretty);
  const tmp = prepareTmpWrite(target, payload);
  // One async yield so callers sharing write queues do not starve the event loop.
  await sleep(0);
  finalizeRename(tmp, target);
  return { ok: true, bytes: Buffer.byteLength(payload) };
}

/**
 * Sync variant for stores that cannot become async (learn jobs).
 */
function writeJsonStoreAtomicSync(opts) {
  const target = path.resolve(String(opts.targetPath || ""));
  if (!target) throw new Error("store path required");
  const payload = serializePayload(opts.data, opts.pretty);
  const tmp = prepareTmpWrite(target, payload);
  finalizeRename(tmp, target);
  return { ok: true, bytes: Buffer.byteLength(payload) };
}

/**
 * Read JSON store; on parse/shape failure try .bak and restore.
 * Never returns empty store when corrupt files exist.
 *
 * @param {{
 *   targetPath: string,
 *   validate?: (parsed: object) => boolean,
 *   emptyWhenMissing?: () => object,
 *   corruptCode?: string,
 * }} opts
 */
function readJsonStoreWithBackup(opts) {
  const target = path.resolve(String(opts.targetPath || ""));
  const bak = bakPath(target);
  const corruptCode = opts.corruptCode || "store_corrupt";
  const validate =
    typeof opts.validate === "function"
      ? opts.validate
      : (parsed) => !!(parsed && typeof parsed === "object");

  function tryRead(filePath) {
    if (!fs.existsSync(filePath)) return { ok: false, code: "missing" };
    let st;
    try {
      st = fs.statSync(filePath);
      if (!st.isFile()) return { ok: false, code: "not_file" };
    } catch (err) {
      return { ok: false, code: "stat_failed", cause: err };
    }
    let raw;
    let parsed;
    try {
      raw = fs.readFileSync(filePath);
      parsed = JSON.parse(raw.toString("utf8"));
    } catch (err) {
      return { ok: false, code: "parse_failed", cause: err };
    }
    if (!validate(parsed)) {
      return { ok: false, code: "invalid_shape" };
    }
    return { ok: true, parsed, raw, mtimeMs: st.mtimeMs, size: st.size, from: filePath };
  }

  if (!fs.existsSync(target) && !fs.existsSync(bak)) {
    if (typeof opts.emptyWhenMissing === "function") {
      return { ok: true, parsed: opts.emptyWhenMissing(), recoveredFromBackup: false, missing: true };
    }
    const e = new Error("store missing");
    e.code = "store_missing";
    throw e;
  }

  const main = tryRead(target);
  if (main.ok) {
    return {
      ok: true,
      parsed: main.parsed,
      raw: main.raw,
      mtimeMs: main.mtimeMs,
      size: main.size,
      recoveredFromBackup: false,
    };
  }

  const backup = tryRead(bak);
  if (backup.ok) {
    // Restore main from backup (best-effort) so next boot uses primary.
    try {
      fs.copyFileSync(bak, target);
    } catch {
      /* use bak content in-memory even if restore copy fails */
    }
    recordRecoveryEvent({
      kind: "store_recovered_from_bak",
      targetPath: target,
      primaryError: main.code,
    });
    return {
      ok: true,
      parsed: backup.parsed,
      raw: backup.raw,
      mtimeMs: backup.mtimeMs,
      size: backup.size,
      recoveredFromBackup: true,
      primaryError: main.code,
    };
  }

  const e = new Error("存档损坏且没有可用备份。");
  e.code = corruptCode;
  e.primaryError = main.code;
  e.backupError = backup.code;
  e.cause = main.cause || backup.cause;
  throw e;
}

module.exports = {
  bakPath,
  writeJsonStoreAtomic,
  writeJsonStoreAtomicSync,
  readJsonStoreWithBackup,
  drainRecoveryEvents,
  peekRecoveryEvents,
  recordRecoveryEvent,
  RENAME_RETRY_CODES,
  RENAME_RETRY_WAITS_MS,
};

"use strict";

/**
 * Crash-safe journal: immutable per-generation records within the current
 * unfinished transaction sequence. Never replaces/deletes the previous complete
 * record before the next is fully published.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { ensureDir, rmrf } = require("./fs-util");

const JOURNAL_DIR = "journals";
const RECORD_RE = /^journal-(\d{10})\.json$/;
const PUBLISHING_RE = /^journal-(\d+)\.publishing-([a-f0-9]+)\.json$/;
const LEGACY_JOURNAL = "journal.json";

function err(code, message, extra) {
  const e = new Error(message || code);
  e.code = code;
  if (extra && typeof extra === "object") Object.assign(e, extra);
  return e;
}

function journalsDir(storeRoot) {
  return path.join(storeRoot, JOURNAL_DIR);
}

function recordPath(storeRoot, generation) {
  return path.join(journalsDir(storeRoot), `journal-${String(generation).padStart(10, "0")}.json`);
}

function isCompleteRecord(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.generation === "number" &&
    Number.isInteger(obj.generation) &&
    obj.generation >= 1 &&
    typeof obj.phase === "string" &&
    obj.phase.length > 0 &&
    obj.complete === true
  );
}

function parseRecordFile(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isCompleteRecord(obj)) return null;
  return obj;
}

function listGenerationFiles(storeRoot) {
  const dir = journalsDir(storeRoot);
  if (!fs.existsSync(dir)) return [];
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    throw err("readdir_failed", "readdir_failed", { path: dir, cause: e && e.message });
  }
  const out = [];
  for (const name of names) {
    const m = RECORD_RE.exec(name);
    if (!m) continue;
    const generation = parseInt(m[1], 10);
    const full = path.join(dir, name);
    const rec = parseRecordFile(full);
    if (rec && rec.generation === generation) {
      out.push({ generation, path: full, record: rec });
    }
  }
  out.sort((a, b) => a.generation - b.generation);
  return out;
}

function nextGeneration(storeRoot) {
  const listed = listGenerationFiles(storeRoot);
  if (!listed.length) return 1;
  return listed[listed.length - 1].generation + 1;
}

/**
 * Read highest complete journal generation (plus legacy journal.json if present and newer-absent).
 */
function readLatestJournal(storeRoot) {
  const listed = listGenerationFiles(storeRoot);
  if (listed.length) {
    return listed[listed.length - 1].record;
  }
  // Legacy single-file journal (pre-generation) — treat as generation 0 if valid phase.
  const legacy = path.join(storeRoot, LEGACY_JOURNAL);
  if (fs.existsSync(legacy)) {
    try {
      const obj = JSON.parse(fs.readFileSync(legacy, "utf8"));
      if (obj && typeof obj.phase === "string" && obj.phase) {
        return { ...obj, generation: 0, complete: true, legacy: true };
      }
    } catch {
      /* ignore corrupt legacy */
    }
  }
  return null;
}

/**
 * Append a new immutable journal record. Previous complete records remain until cleared.
 * Crash between publishing write and rename: previous generation still readable.
 */
function writeJournalRecord(storeRoot, body, hooks = {}) {
  if (typeof hooks.beforeWriteJournal === "function") hooks.beforeWriteJournal(body);
  ensureDir(journalsDir(storeRoot));
  const generation = nextGeneration(storeRoot);
  const record = {
    ...body,
    generation,
    complete: true,
    updatedAt: new Date().toISOString(),
  };
  const finalPath = recordPath(storeRoot, generation);
  const token = crypto.randomBytes(8).toString("hex");
  const publishing = path.join(
    journalsDir(storeRoot),
    `journal-${generation}.publishing-${token}.json`
  );

  if (typeof hooks.beforeJournalPublish === "function") {
    hooks.beforeJournalPublish({ generation, publishing, finalPath, record });
  }

  const payload = JSON.stringify(record, null, 2);
  let fd;
  try {
    fd = fs.openSync(publishing, "wx");
    fs.writeFileSync(fd, payload, "utf8");
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }

  // Verify publishing file is complete before publish rename.
  const verify = parseRecordFile(publishing);
  if (!verify || verify.generation !== generation) {
    try {
      fs.unlinkSync(publishing);
    } catch {
      /* ignore */
    }
    throw err("journal_publish_invalid", "journal_publish_invalid");
  }

  if (typeof hooks.beforeJournalRename === "function") {
    hooks.beforeJournalRename({ generation, publishing, finalPath, record });
  }

  try {
    fs.renameSync(publishing, finalPath);
  } catch (e) {
    // Leave publishing file for recover to inspect; previous generations intact.
    throw err("journal_publish_failed", "journal_publish_failed", { cause: e && e.message });
  }

  if (typeof hooks.afterWriteJournal === "function") {
    hooks.afterWriteJournal(record, finalPath);
  }
  return record;
}

/**
 * Remove journal records and stray publishing/tmp/bak artifacts after successful finalize.
 */
function clearJournal(storeRoot) {
  const dir = journalsDir(storeRoot);
  if (fs.existsSync(dir)) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      names = [];
    }
    for (const name of names) {
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
  const legacy = path.join(storeRoot, LEGACY_JOURNAL);
  if (fs.existsSync(legacy)) {
    try {
      fs.unlinkSync(legacy);
    } catch {
      /* ignore */
    }
  }
  // Clean accidental root-level journal bak/tmp leftovers from older writers.
  cleanupJournalArtifacts(storeRoot);
}

function cleanupJournalArtifacts(storeRoot) {
  let names;
  try {
    names = fs.readdirSync(storeRoot);
  } catch {
    return { removed: [] };
  }
  const removed = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    const isJunk =
      /^journal\.json\.(bak|tmp)\./i.test(name) ||
      /^journal\.json\.tmp\./i.test(name) ||
      /^lock\.json\.(bak|hb|dead)\./i.test(name) ||
      (lower.startsWith("journal") && (lower.includes(".bak.") || lower.includes(".tmp.")));
    if (!isJunk) continue;
    try {
      fs.unlinkSync(path.join(storeRoot, name));
      removed.push(name);
    } catch {
      /* ignore */
    }
  }
  const jdir = journalsDir(storeRoot);
  if (fs.existsSync(jdir)) {
    let jnames;
    try {
      jnames = fs.readdirSync(jdir);
    } catch {
      jnames = [];
    }
    for (const name of jnames) {
      if (PUBLISHING_RE.test(name) || name.includes(".tmp.") || name.includes(".bak.")) {
        // Incomplete publishing: if parseable+complete keep for readLatest? No — only final names count.
        // Orphan publishing after crash: safe to delete once a higher complete generation exists,
        // or keep if it is the only evidence. Prefer: if parseable complete and gen >= max final,
        // try to promote; else delete incomplete.
        const full = path.join(jdir, name);
        const rec = parseRecordFile(full);
        if (rec && RECORD_RE.test(`journal-${String(rec.generation).padStart(10, "0")}.json`)) {
          const dest = recordPath(storeRoot, rec.generation);
          if (!fs.existsSync(dest)) {
            try {
              fs.renameSync(full, dest);
              continue;
            } catch {
              /* fall through delete if rename fails and incomplete */
            }
          }
        }
        try {
          fs.unlinkSync(full);
          removed.push(name);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return { removed };
}

/**
 * Enumerate + select latest; also attempt to promote complete publishing files
 * when final name missing (crash after write before rename).
 */
function recoverJournalState(storeRoot) {
  const dir = journalsDir(storeRoot);
  ensureDir(dir);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    names = [];
  }

  for (const name of names) {
    const m = PUBLISHING_RE.exec(name);
    if (!m) continue;
    const generation = parseInt(m[1], 10);
    const full = path.join(dir, name);
    const rec = parseRecordFile(full);
    if (!rec || rec.generation !== generation) {
      // Incomplete publishing — leave for cleanupJournalArtifacts after decision.
      continue;
    }
    const dest = recordPath(storeRoot, generation);
    if (!fs.existsSync(dest)) {
      try {
        fs.renameSync(full, dest);
      } catch {
        /* concurrent */
      }
    }
  }

  const latest = readLatestJournal(storeRoot);
  return latest;
}

module.exports = {
  JOURNAL_DIR,
  journalsDir,
  readLatestJournal,
  writeJournalRecord,
  clearJournal,
  cleanupJournalArtifacts,
  recoverJournalState,
  listGenerationFiles,
  nextGeneration,
  isCompleteRecord,
};

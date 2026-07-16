"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { isExcludedName } = require("./paths");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function rmrf(p) {
  if (!p || !fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function fail(code, message, extra) {
  const e = new Error(message || code);
  e.code = code;
  if (extra && typeof extra === "object") Object.assign(e, extra);
  return e;
}

/**
 * Copy tree. Symlinks / junctions rejected (fail closed). readdir failures throw.
 */
function copyTree(src, dest, { excludeNames = [] } = {}) {
  ensureDir(dest);
  let entries;
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch (e) {
    throw fail("readdir_failed", "readdir_failed", { path: src, cause: e && e.message });
  }

  let srcReal;
  try {
    srcReal = fs.realpathSync(src);
  } catch (e) {
    throw fail("stat_failed", "stat_failed", { path: src, cause: e && e.message });
  }

  for (const ent of entries) {
    if (isExcludedName(ent.name) || excludeNames.includes(ent.name)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);

    if (ent.isSymbolicLink()) {
      throw fail("symlink_rejected", "symlink_rejected", { path: s });
    }

    let st;
    try {
      st = fs.lstatSync(s);
    } catch (e) {
      throw fail("stat_failed", "stat_failed", { path: s, cause: e && e.message });
    }
    if (st.isSymbolicLink()) {
      throw fail("symlink_rejected", "symlink_rejected", { path: s });
    }

    if (ent.isDirectory() || st.isDirectory()) {
      let real;
      try {
        real = fs.realpathSync(s);
      } catch (e) {
        throw fail("stat_failed", "stat_failed", { path: s, cause: e && e.message });
      }
      if (!String(real).startsWith(srcReal + path.sep) && real !== srcReal) {
        throw fail("reparse_rejected", "reparse_rejected", { path: s, real });
      }
      copyTree(s, d, { excludeNames });
    } else if (ent.isFile() || st.isFile()) {
      ensureDir(path.dirname(d));
      fs.copyFileSync(s, d);
    }
  }
}

/**
 * Atomic JSON write without delete-then-copy degradation.
 * 1. Write complete payload to unique tmp (exclusive create when possible)
 * 2. Optional read-back verify
 * 3. Target missing → rename tmp→target
 * 4. Target exists → rename target→bak, rename tmp→target, unlink bak;
 *    if second rename fails, restore bak→target (old metadata remains readable)
 *
 * @param {string} filePath
 * @param {object} obj
 * @param {{ beforeWriteJsonAtomic?: Function, verifyReadBack?: boolean }} [hooks]
 */
function writeJsonAtomic(filePath, obj, hooks = {}) {
  if (typeof hooks.beforeWriteJsonAtomic === "function") {
    hooks.beforeWriteJsonAtomic(filePath, obj);
  }

  ensureDir(path.dirname(filePath));
  const token = crypto.randomBytes(8).toString("hex");
  const tmp = filePath + ".tmp." + process.pid + "." + token;
  const payload = JSON.stringify(obj, null, 2);

  let fd;
  try {
    fd = fs.openSync(tmp, "wx");
  } catch (e) {
    if (e && e.code === "EEXIST") {
      // Extremely unlikely collision; fall back to truncate write on a new name.
      const tmp2 = filePath + ".tmp." + process.pid + "." + crypto.randomBytes(12).toString("hex");
      fs.writeFileSync(tmp2, payload, "utf8");
      return _replaceWithTmp(filePath, tmp2, hooks);
    }
    throw e;
  }
  try {
    fs.writeFileSync(fd, payload, "utf8");
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
  }

  if (hooks.verifyReadBack !== false) {
    const readBack = fs.readFileSync(tmp, "utf8");
    if (readBack !== payload) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw fail("write_verify_failed", "write_verify_failed", { path: tmp });
    }
  }

  return _replaceWithTmp(filePath, tmp, hooks);
}

function _replaceWithTmp(filePath, tmp, hooks = {}) {
  if (typeof hooks.beforeReplaceTarget === "function") {
    hooks.beforeReplaceTarget(filePath, tmp);
  }

  if (!fs.existsSync(filePath)) {
    try {
      fs.renameSync(tmp, filePath);
      return;
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw e;
    }
  }

  const bak = filePath + ".bak." + crypto.randomBytes(8).toString("hex");
  try {
    fs.renameSync(filePath, bak);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }

  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    // Restore previous readable metadata.
    try {
      fs.renameSync(bak, filePath);
    } catch (restoreErr) {
      const err = fail("atomic_replace_failed", "atomic_replace_failed", {
        path: filePath,
        cause: e && e.message,
        restoreError: restoreErr && restoreErr.message,
      });
      throw err;
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw fail("atomic_replace_failed", "atomic_replace_failed", {
      path: filePath,
      cause: e && e.message,
    });
  }

  try {
    fs.unlinkSync(bak);
  } catch {
    /* bak leftover is harmless; target is new content */
  }
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function dirByteFingerprint(dir) {
  if (!fs.existsSync(dir)) return null;
  const h = crypto.createHash("sha256");
  function walk(d, base) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      throw fail("readdir_failed", "readdir_failed", { path: d, cause: e && e.message });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (isExcludedName(ent.name)) continue;
      const rel = base ? base + "/" + ent.name : ent.name;
      const full = path.join(d, ent.name);
      if (ent.isSymbolicLink()) {
        throw fail("symlink_rejected", "symlink_rejected", { path: full });
      }
      if (ent.isDirectory()) walk(full, rel);
      else if (ent.isFile()) {
        h.update(rel);
        h.update(fs.readFileSync(full));
      }
    }
  }
  walk(dir, "");
  return h.digest("hex");
}

module.exports = { ensureDir, rmrf, copyTree, writeJsonAtomic, readJson, dirByteFingerprint };

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

function copyTree(src, dest, { excludeNames = [] } = {}) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const ent of entries) {
    if (isExcludedName(ent.name) || excludeNames.includes(ent.name)) continue;
    if (ent.isSymbolicLink()) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyTree(s, d, { excludeNames });
    else if (ent.isFile()) {
      ensureDir(path.dirname(d));
      fs.copyFileSync(s, d);
    }
  }
}

function writeJsonAtomic(filePath, obj) {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + ".tmp." + process.pid + "." + crypto.randomBytes(4).toString("hex");
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    // Windows: target may briefly be locked (AV / indexer); replace in place.
    if (e && (e.code === "EPERM" || e.code === "EACCES" || e.code === "EEXIST")) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
      try {
        fs.renameSync(tmp, filePath);
      } catch (e2) {
        fs.copyFileSync(tmp, filePath);
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
        if (!fs.existsSync(filePath)) throw e2;
      }
    } else {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw e;
    }
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
    for (const ent of fs
      .readdirSync(d, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (isExcludedName(ent.name)) continue;
      const rel = base ? base + "/" + ent.name : ent.name;
      const full = path.join(d, ent.name);
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

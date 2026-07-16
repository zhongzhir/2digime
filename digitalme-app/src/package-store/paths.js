"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  ALLOWED_PACKAGE_REL_PREFIXES,
  DIGEST_EXCLUSIONS,
  MAX_PATH_LEN,
} = require("./schema");

function normalizeRel(rel) {
  if (typeof rel !== "string") {
    const err = new Error("path_not_string");
    err.code = "path_rejected";
    throw err;
  }
  let s = rel.replace(/\\/g, "/").trim();
  if (!s || s.length > MAX_PATH_LEN) {
    const err = new Error("path_length");
    err.code = "path_rejected";
    throw err;
  }
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(s) || s.startsWith("//")) {
    const err = new Error("absolute_path_rejected");
    err.code = "path_rejected";
    throw err;
  }
  if (s.includes("\0")) {
    const err = new Error("path_nul");
    err.code = "path_rejected";
    throw err;
  }
  const parts = s.split("/").filter((p) => p && p !== ".");
  if (parts.some((p) => p === "..")) {
    const err = new Error("path_traversal");
    err.code = "path_rejected";
    throw err;
  }
  s = parts.join("/");
  const allowed = ALLOWED_PACKAGE_REL_PREFIXES.some((prefix) => {
    if (prefix.endsWith("/")) return s === prefix.slice(0, -1) || s.startsWith(prefix);
    return s === prefix;
  });
  if (!allowed) {
    const err = new Error("path_not_whitelisted");
    err.code = "path_rejected";
    throw err;
  }
  return s;
}

function isExcludedName(name) {
  const n = String(name || "").toLowerCase();
  return DIGEST_EXCLUSIONS.some((x) => x.toLowerCase() === n);
}

function resolveInsidePackage(packageRoot, rel) {
  const safeRel = normalizeRel(rel);
  const rootReal = fs.realpathSync(packageRoot);
  const abs = path.resolve(rootReal, ...safeRel.split("/"));
  let cur = rootReal;
  const segs = safeRel.split("/");
  for (let i = 0; i < segs.length; i++) {
    cur = path.join(cur, segs[i]);
    if (!fs.existsSync(cur)) {
      const parent = path.dirname(cur);
      const parentReal = fs.realpathSync(parent);
      if (!parentReal.startsWith(rootReal + path.sep) && parentReal !== rootReal) {
        const err = new Error("path_escape");
        err.code = "path_rejected";
        throw err;
      }
      return abs;
    }
    const st = fs.lstatSync(cur);
    if (st.isSymbolicLink()) {
      const err = new Error("symlink_rejected");
      err.code = "path_rejected";
      throw err;
    }
    if (process.platform === "win32" && st.isDirectory()) {
      try {
        const real = fs.realpathSync(cur);
        if (!real.startsWith(rootReal + path.sep) && real !== rootReal) {
          const err = new Error("reparse_escape");
          err.code = "path_rejected";
          throw err;
        }
      } catch (e) {
        if (e.code === "path_rejected") throw e;
      }
    }
  }
  const finalReal = fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
  if (!String(finalReal).startsWith(rootReal + path.sep) && finalReal !== rootReal) {
    const err = new Error("path_escape");
    err.code = "path_rejected";
    throw err;
  }
  return abs;
}

function storeRootFor(packageDir) {
  const parent = path.dirname(path.resolve(packageDir));
  const name = path.basename(path.resolve(packageDir));
  return path.join(parent, ".digitalme-pkgstore", name);
}

module.exports = {
  normalizeRel,
  isExcludedName,
  resolveInsidePackage,
  storeRootFor,
};

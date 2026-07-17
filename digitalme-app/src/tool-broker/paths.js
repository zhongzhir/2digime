"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function isUncPath(target) {
  const s = String(target || "");
  return s.startsWith("\\\\") || /^\/\/[^/]/u.test(s.replace(/\\/g, "/"));
}

function looksLikeNetworkOrCloudSync(target) {
  const s = String(target || "").toLowerCase();
  if (isUncPath(target)) return true;
  if (s.includes("wpsdrive") || s.includes("wps云盘") || s.includes("onedrive") || s.includes("dropbox")) {
    return true;
  }
  return false;
}

function assertNoNul(target) {
  if (String(target || "").includes("\0")) {
    const err = new Error("path_nul");
    err.code = "path_rejected";
    throw err;
  }
}

/**
 * Resolve and validate an authorized working directory under a saved root.
 * Rejects missing paths, escapes, symlinks, reparse/junction escapes, UNC/network/cloud paths.
 */
function resolveAuthorizedCwd(authorizedRoot, requestedCwd) {
  assertNoNul(authorizedRoot);
  assertNoNul(requestedCwd || "");
  const rootRaw = String(authorizedRoot || "").trim();
  if (!rootRaw) {
    const err = new Error("authorized_cwd_missing");
    err.code = "path_rejected";
    throw err;
  }
  if (looksLikeNetworkOrCloudSync(rootRaw)) {
    const err = new Error("network_or_cloud_path_rejected");
    err.code = "path_rejected";
    throw err;
  }
  if (!fs.existsSync(rootRaw)) {
    const err = new Error("authorized_cwd_missing");
    err.code = "path_rejected";
    throw err;
  }
  const rootStat = fs.lstatSync(rootRaw);
  if (rootStat.isSymbolicLink()) {
    const err = new Error("symlink_rejected");
    err.code = "path_rejected";
    throw err;
  }
  const rootReal = fs.realpathSync(rootRaw);
  if (looksLikeNetworkOrCloudSync(rootReal)) {
    const err = new Error("network_or_cloud_path_rejected");
    err.code = "path_rejected";
    throw err;
  }

  const cwdRaw = String(requestedCwd || "").trim() || rootRaw;
  if (looksLikeNetworkOrCloudSync(cwdRaw)) {
    const err = new Error("network_or_cloud_path_rejected");
    err.code = "path_rejected";
    throw err;
  }
  const normalizedProbe = path.normalize(cwdRaw);
  if (normalizedProbe.split(path.sep).includes("..")) {
    const err = new Error("path_traversal");
    err.code = "path_rejected";
    throw err;
  }
  if (!fs.existsSync(cwdRaw)) {
    const err = new Error("cwd_missing");
    err.code = "path_rejected";
    throw err;
  }
  const cwdStat = fs.lstatSync(cwdRaw);
  if (cwdStat.isSymbolicLink()) {
    const err = new Error("symlink_rejected");
    err.code = "path_rejected";
    throw err;
  }
  if (!cwdStat.isDirectory()) {
    const err = new Error("cwd_not_directory");
    err.code = "path_rejected";
    throw err;
  }

  const abs = path.resolve(cwdRaw);
  const rel = path.relative(rootReal, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    const err = new Error("path_escape");
    err.code = "path_rejected";
    throw err;
  }
  let cur = rootReal;
  const segs = rel ? rel.split(path.sep).filter(Boolean) : [];
  for (const seg of segs) {
    cur = path.join(cur, seg);
    if (!fs.existsSync(cur)) {
      const err = new Error("cwd_missing");
      err.code = "path_rejected";
      throw err;
    }
    const st = fs.lstatSync(cur);
    if (st.isSymbolicLink()) {
      const err = new Error("symlink_rejected");
      err.code = "path_rejected";
      throw err;
    }
    if (process.platform === "win32") {
      try {
        const real = fs.realpathSync(cur);
        if (!String(real).startsWith(rootReal + path.sep) && real !== rootReal) {
          const err = new Error("reparse_escape");
          err.code = "path_rejected";
          throw err;
        }
      } catch (e) {
        if (e.code === "path_rejected") throw e;
      }
    }
  }

  const finalReal = fs.realpathSync(abs);
  if (!String(finalReal).startsWith(rootReal + path.sep) && finalReal !== rootReal) {
    const err = new Error("path_escape");
    err.code = "path_rejected";
    throw err;
  }
  if (looksLikeNetworkOrCloudSync(finalReal)) {
    const err = new Error("network_or_cloud_path_rejected");
    err.code = "path_rejected";
    throw err;
  }
  return { cwdReal: finalReal, rootReal };
}

function isSafeTempRoot(candidate) {
  const tmp = path.resolve(os.tmpdir());
  const real = path.resolve(candidate);
  return real === tmp || real.startsWith(tmp + path.sep);
}

module.exports = {
  isUncPath,
  looksLikeNetworkOrCloudSync,
  resolveAuthorizedCwd,
  isSafeTempRoot,
};

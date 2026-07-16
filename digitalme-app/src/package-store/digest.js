"use strict";

/**
 * Package content digest (integrity only — not a signature).
 * Fail closed: readdir/stat/read failures and symlink/reparse escapes abort the digest.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { isExcludedName } = require("./paths");

const DIGEST_ALG = "sha256";

function fail(code, message, extra) {
  const e = new Error(message || code);
  e.code = code;
  if (extra && typeof extra === "object") Object.assign(e, extra);
  return e;
}

function hashBuffer(buf) {
  return crypto.createHash(DIGEST_ALG).update(buf).digest("hex");
}

function rootRealPath(packageDir) {
  const rootDir = path.resolve(packageDir);
  try {
    return { rootDir, rootReal: fs.realpathSync(rootDir) };
  } catch (e) {
    throw fail("stat_failed", "stat_failed", { path: rootDir, cause: e && e.message });
  }
}

function lstatOrThrow(full) {
  try {
    return fs.lstatSync(full);
  } catch (e) {
    throw fail("stat_failed", "stat_failed", { path: full, cause: e && e.message });
  }
}

function assertEntrySafe(full, rootReal, ent) {
  if (ent.isSymbolicLink()) {
    throw fail("symlink_rejected", "symlink_rejected", { path: full });
  }
  const st = lstatOrThrow(full);
  if (st.isSymbolicLink()) {
    throw fail("symlink_rejected", "symlink_rejected", { path: full });
  }
  // Junctions / reparse points: reject escape outside package root.
  if (st.isDirectory() || ent.isDirectory()) {
    let real;
    try {
      real = fs.realpathSync(full);
    } catch (e) {
      throw fail("stat_failed", "stat_failed", { path: full, cause: e && e.message });
    }
    if (!String(real).startsWith(rootReal + path.sep) && real !== rootReal) {
      throw fail("reparse_rejected", "reparse_rejected", { path: full, real });
    }
  } else if (st.isFile()) {
    // On Windows, some reparse file points may not report as symlinks via Dirent.
    if (process.platform === "win32") {
      try {
        const real = fs.realpathSync(full);
        const parentReal = fs.realpathSync(path.dirname(full));
        if (
          !String(parentReal).startsWith(rootReal + path.sep) &&
          parentReal !== rootReal
        ) {
          throw fail("reparse_rejected", "reparse_rejected", { path: full, real });
        }
        if (!String(real).startsWith(rootReal + path.sep) && real !== rootReal) {
          // File itself should still resolve under root.
          const relOk =
            String(path.dirname(real)).startsWith(rootReal + path.sep) ||
            path.dirname(real) === rootReal;
          if (!relOk) {
            throw fail("reparse_rejected", "reparse_rejected", { path: full, real });
          }
        }
      } catch (e) {
        if (e && (e.code === "reparse_rejected" || e.code === "symlink_rejected")) throw e;
        throw fail("stat_failed", "stat_failed", { path: full, cause: e && e.message });
      }
    }
  }
}

/**
 * Walk package tree and reject any symlink / reparse escape. Fail closed on I/O errors.
 */
function assertNoSymlinksOrEscapes(packageDir) {
  const { rootDir, rootReal } = rootRealPath(packageDir);

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      throw fail("readdir_failed", "readdir_failed", { path: dir, cause: e && e.message });
    }
    for (const ent of entries) {
      if (isExcludedName(ent.name)) continue;
      const full = path.join(dir, ent.name);
      assertEntrySafe(full, rootReal, ent);
      if (ent.isDirectory()) {
        walk(full);
      }
    }
  }

  walk(rootDir);
  return true;
}

function listContentFiles(packageDir) {
  const { rootDir, rootReal } = rootRealPath(packageDir);
  const files = [];

  function walk(dir, relBase) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      throw fail("readdir_failed", "readdir_failed", { path: dir, cause: e && e.message });
    }
    for (const ent of entries) {
      if (isExcludedName(ent.name)) continue;
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      assertEntrySafe(full, rootReal, ent);
      if (ent.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!ent.isFile()) continue;
      files.push(String(rel).replace(/\\/g, "/"));
    }
  }

  walk(rootDir, "");
  files.sort();
  return files;
}

function computeContentDigest(packageDir) {
  const files = listContentFiles(packageDir);
  const entries = [];
  const rootDir = path.resolve(packageDir);
  for (const rel of files) {
    const full = path.join(rootDir, ...rel.split("/"));
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch (e) {
      throw fail("read_failed", "read_failed", { path: full, cause: e && e.message });
    }
    entries.push({ path: rel, sha256: hashBuffer(buf), bytes: buf.length });
  }
  const lines = entries.map((e) => `${e.sha256}  ${e.path}`).join("\n");
  const rootSha256 = hashBuffer(Buffer.from(lines, "utf8"));
  return {
    algorithm: DIGEST_ALG,
    rootSha256,
    fileCount: entries.length,
    files: entries,
  };
}

module.exports = {
  DIGEST_ALG,
  hashBuffer,
  listContentFiles,
  computeContentDigest,
  assertNoSymlinksOrEscapes,
};

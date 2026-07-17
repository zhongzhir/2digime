"use strict";

/**
 * Build a minimal environment for local CLI subprocesses.
 * Starts from an empty object, then copies only allowlisted keys from the host process.
 *
 * On Windows, Node/libuv may still inject a small fixed set of profile variables when keys
 * are omitted; we therefore always pin PATH to empty when includePath is false so that an
 * absolute executable cannot be redirected via host PATH, and arbitrary host secrets are
 * never copied (only allowlisted keys).
 *
 * @param {string[]} allowlist
 * @param {NodeJS.ProcessEnv} [sourceEnv]
 * @param {{ includePath?: boolean }} [opts]
 */
function buildMinimalEnv(allowlist, sourceEnv = process.env, opts = {}) {
  const keys = Array.isArray(allowlist) ? allowlist : [];
  const includePath = opts.includePath === true;
  const out = Object.create(null);
  const source = sourceEnv && typeof sourceEnv === "object" ? sourceEnv : {};
  const sourceKeys = Object.keys(source);
  const wanted = new Set(
    keys
      .map((k) => String(k || "").trim())
      .filter(Boolean)
      .map((k) => k.toLowerCase())
  );
  if (includePath) wanted.add("path");

  for (const key of sourceKeys) {
    if (!wanted.has(String(key).toLowerCase())) continue;
    const value = source[key];
    if (value == null) continue;
    out[key] = String(value);
  }

  // Pin PATH: either allowlisted copy, or empty to block host PATH inheritance/injection.
  if (includePath) {
    if (!Object.keys(out).some((k) => k.toLowerCase() === "path")) {
      const hostPath = source.PATH || source.Path || source.path;
      if (hostPath != null) out.PATH = String(hostPath);
    }
  } else {
    // Remove any allowlisted PATH copy and force empty.
    for (const key of Object.keys(out)) {
      if (key.toLowerCase() === "path") delete out[key];
    }
    out.PATH = "";
  }
  return out;
}

function listEnvKeyNames(env) {
  return Object.keys(env || {})
    .filter((k) => {
      // Empty PATH is still listed so confirmation UI can show it was pinned.
      return true;
    })
    .sort((a, b) => a.localeCompare(b));
}

module.exports = {
  buildMinimalEnv,
  listEnvKeyNames,
};

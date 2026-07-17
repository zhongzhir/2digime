"use strict";

/**
 * Windows Authenticode status probe (code-owned verifier).
 * Uses fixed System32 PowerShell path + -File script; path is a separate argument (no string concat into -Command).
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SCRIPT_PATH = path.join(__dirname, "verify-authenticode.ps1");
const cache = new Map();

function resolvePowerShellPath() {
  const root = process.env.SystemRoot || "C:\\Windows";
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/**
 * @returns {{ ok: true, status: string, subject: string } | { ok: false, reasonCodes: string[], status?: string, subject?: string }}
 */
function verifyAuthenticode(filePath, cacheKey = "") {
  if (process.platform !== "win32") {
    return { ok: true, status: "Skipped", subject: "" };
  }
  const key = cacheKey || String(filePath);
  if (cache.has(key)) return cache.get(key);

  const ps = resolvePowerShellPath();
  if (!fs.existsSync(ps) || !fs.existsSync(SCRIPT_PATH)) {
    const fail = { ok: false, reasonCodes: ["authenticode_verifier_unavailable"] };
    cache.set(key, fail);
    return fail;
  }

  let raw;
  try {
    raw = execFileSync(
      ps,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        SCRIPT_PATH,
        "-LiteralPath",
        path.resolve(filePath),
      ],
      {
        encoding: "utf8",
        timeout: 20000,
        windowsHide: true,
        maxBuffer: 64 * 1024,
      }
    );
  } catch {
    const fail = { ok: false, reasonCodes: ["authenticode_probe_failed"] };
    cache.set(key, fail);
    return fail;
  }

  let parsed;
  try {
    const line = String(raw || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .pop();
    parsed = JSON.parse(line);
  } catch {
    const fail = { ok: false, reasonCodes: ["authenticode_probe_unreadable"] };
    cache.set(key, fail);
    return fail;
  }

  const status = String(parsed.status || "");
  const subject = String(parsed.subject || "");
  const result = { ok: true, status, subject };
  cache.set(key, result);
  return result;
}

function clearAuthenticodeCacheForTests() {
  cache.clear();
}

module.exports = {
  verifyAuthenticode,
  clearAuthenticodeCacheForTests,
  resolvePowerShellPath,
};

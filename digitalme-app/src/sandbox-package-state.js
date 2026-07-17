"use strict";

/**
 * Temp test-package sandbox helpers (settings advanced tools).
 * Does not touch PackageStore write paths or SecretStore crypto.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TEMP_PREFIX = "dm-p102-demo-";

function resolveDir(dir) {
  return path.resolve(String(dir || ""));
}

/**
 * True when dir is under the OS temp root and uses our demo prefix.
 */
function isTempDemoPackageDir(dir, tmpRoot) {
  const resolved = resolveDir(dir);
  if (!resolved) return false;
  const root = resolveDir(tmpRoot != null ? tmpRoot : os.tmpdir());
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const first = rel.split(/[/\\]/)[0] || "";
  return first.startsWith(TEMP_PREFIX);
}

/**
 * When switching to a temp package, remember the regular dir if current is not temp.
 */
function nextRegularPackageDir(currentPackageDir, existingRegular, defaultPackageDir, tmpRoot) {
  const current = resolveDir(currentPackageDir || defaultPackageDir);
  if (!isTempDemoPackageDir(current, tmpRoot)) {
    return current;
  }
  const existing = existingRegular ? resolveDir(existingRegular) : "";
  if (existing && !isTempDemoPackageDir(existing, tmpRoot)) {
    return existing;
  }
  return resolveDir(defaultPackageDir);
}

function loadSandboxState(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { regularPackageDir: "", activeTempPackageDir: "" };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      regularPackageDir: typeof raw.regularPackageDir === "string" ? raw.regularPackageDir : "",
      activeTempPackageDir:
        typeof raw.activeTempPackageDir === "string" ? raw.activeTempPackageDir : "",
    };
  } catch {
    return { regularPackageDir: "", activeTempPackageDir: "" };
  }
}

function saveSandboxState(filePath, state) {
  const payload = {
    regularPackageDir: String((state && state.regularPackageDir) || ""),
    activeTempPackageDir: String((state && state.activeTempPackageDir) || ""),
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
  return payload;
}

function buildSandboxStatus({
  currentPackageDir,
  regularPackageDir,
  defaultPackageDir,
  tmpRoot,
}) {
  const current = resolveDir(currentPackageDir || defaultPackageDir);
  const usingTemp = isTempDemoPackageDir(current, tmpRoot);
  const regular = nextRegularPackageDir(
    usingTemp ? regularPackageDir || defaultPackageDir : current,
    regularPackageDir,
    defaultPackageDir,
    tmpRoot
  );
  return {
    isUsingTemp: usingTemp,
    currentPackageDir: current,
    regularPackageDir: usingTemp ? resolveDir(regularPackageDir || regular) : current,
    canRestoreRegular: usingTemp,
  };
}

module.exports = {
  TEMP_PREFIX,
  isTempDemoPackageDir,
  nextRegularPackageDir,
  loadSandboxState,
  saveSandboxState,
  buildSandboxStatus,
};

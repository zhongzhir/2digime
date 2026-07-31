"use strict";

/**
 * Prove which main/preload/renderer sources the running process loaded.
 * Used by Owner runtime checks and Electron window tests — not a product feature claim.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const SRC_ROOT = __dirname;

const TRACKED = [
  { id: "main", rel: "main.js" },
  { id: "preload", rel: "preload.js" },
  { id: "rendererApp", rel: path.join("renderer", "app.js") },
  { id: "rendererHelp", rel: path.join("renderer", "help.js") },
  { id: "rendererHtml", rel: path.join("renderer", "index.html") },
];

function sha256File(absPath) {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function readGitHead(repoRoot) {
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    return String(out || "").trim() || null;
  } catch {
    return null;
  }
}

function readEmbeddedBuildInfo(opts = {}) {
  const candidates = [];
  if (opts.resourcesPath) {
    candidates.push(path.join(opts.resourcesPath, "build-info.json"));
  }
  candidates.push(path.join(SRC_ROOT, "closed-alpha-build-info.json"));
  candidates.push(path.join(SRC_ROOT, "..", "closed-alpha-build-info.json"));
  candidates.push(path.join(SRC_ROOT, "..", "build", "build-info.json"));
  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const raw = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (raw && typeof raw === "object") {
        return { ...raw, _sourcePath: candidate };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function buildRuntimeStamp(opts = {}) {
  const files = {};
  const markers = {};
  for (const item of TRACKED) {
    const abs = path.join(SRC_ROOT, item.rel);
    const stat = fs.statSync(abs);
    const sha256 = sha256File(abs);
    files[item.id] = {
      path: abs,
      sha256,
      sha256Short: sha256.slice(0, 16),
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }

  const appJs = fs.readFileSync(files.rendererApp.path, "utf8");
  const preloadJs = fs.readFileSync(files.preload.path, "utf8");
  const mainJs = fs.readFileSync(files.main.path, "utf8");

  markers.dmBootstrapDelegate = appJs.includes("dmBootstrapDelegate");
  markers.dmTipDelegate = appJs.includes("dmTipDelegate");
  markers.tipFallback = appJs.includes("暂无说明");
  markers.earlyUiDelegates = appJs.includes("registerEarlyUiDelegates");
  markers.onExternalAgentStartedPreload = preloadJs.includes("onExternalAgentStarted");
  markers.externalAgentStartedMain = mainJs.includes("l0:external-agent-started");
  markers.reportBootLog = appJs.includes("appendBootLog");

  const repoRoot = path.join(SRC_ROOT, "..", "..");
  const buildInfo = readEmbeddedBuildInfo(opts);
  const gitHead =
    opts.gitHead != null && String(opts.gitHead).trim()
      ? opts.gitHead
      : (buildInfo && buildInfo.gitHead) || readGitHead(repoRoot);

  return {
    ok: true,
    srcRoot: SRC_ROOT,
    gitHead,
    appVersion: (buildInfo && buildInfo.appVersion) || null,
    releaseChannel: (buildInfo && buildInfo.releaseChannel) || null,
    productSurface: (buildInfo && buildInfo.productSurface) || null,
    buildId: (buildInfo && buildInfo.buildId) || null,
    buildInfo: buildInfo || null,
    isPackaged: !!opts.isPackaged,
    // Commits that Owner re-check depends on (must be ancestors of running tree).
    requiredAncestorHints: ["596c9df", "b99d472"],
    files,
    markers,
    builtAt: new Date().toISOString(),
  };
}

function stampIsPostOwnerFixes(stamp) {
  if (!stamp || !stamp.markers) return false;
  const m = stamp.markers;
  return !!(
    m.dmBootstrapDelegate &&
    m.dmTipDelegate &&
    m.tipFallback &&
    m.earlyUiDelegates &&
    m.reportBootLog &&
    m.onExternalAgentStartedPreload &&
    m.externalAgentStartedMain
  );
}

module.exports = {
  TRACKED,
  buildRuntimeStamp,
  stampIsPostOwnerFixes,
  sha256File,
  readEmbeddedBuildInfo,
};

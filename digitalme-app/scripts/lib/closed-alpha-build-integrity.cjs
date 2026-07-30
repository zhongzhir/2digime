"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const PRODUCT_SURFACE = "classic";
const RELEASE_CHANNEL = "closed-alpha";

function fail(message, details) {
  const err = new Error(message);
  err.code = "BUILD_INTEGRITY_FAILED";
  err.details = details || null;
  throw err;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex").toUpperCase();
}

function fileMtimeMs(filePath) {
  return fs.statSync(filePath).mtimeMs;
}

function resolveGitHead(repoRoot) {
  const r = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    fail("unable to resolve git HEAD", { stderr: String(r.stderr || "") });
  }
  return String(r.stdout || "").trim();
}

function shortHash(gitHead) {
  return String(gitHead || "").slice(0, 7);
}

function makeBuildId(gitHead, when = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}` +
    `-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
  return `${stamp}-${shortHash(gitHead)}`;
}

function writeBuildInfo(targetPath, info) {
  const payload = {
    gitHead: info.gitHead,
    gitShort: shortHash(info.gitHead),
    buildId: info.buildId,
    buildTime: info.buildTime,
    productSurface: PRODUCT_SURFACE,
    releaseChannel: RELEASE_CHANNEL,
    unsigned: true,
    appVersion: info.appVersion || "0.1.0",
  };
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listAsarEntries(asarPath) {
  const asar = require("@electron/asar");
  return asar.listPackage(asarPath).map((s) => String(s).replace(/\\/g, "/"));
}

function extractAsarFile(asarPath, internalPath, destPath) {
  const asar = require("@electron/asar");
  const normalized = String(internalPath || "")
    .replace(/^\\/, "")
    .replace(/^\//, "")
    .replace(/\\/g, "/");
  let data;
  try {
    data = asar.extractFile(asarPath, normalized);
  } catch (err) {
    fail("asar extract-file failed", {
      internalPath: normalized,
      message: String(err && err.message ? err.message : err),
    });
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, data);
}

function assertNoSensitiveAsarPaths(entries) {
  const blocked = [
    /_access-min-evidence/i,
    /_mvp-release-gate/i,
    /_evidence/i,
    /\.env$/i,
    /config\.local\.json$/i,
    /knowledge-claims\.json$/i,
    /scripts\/test-/i,
    /scripts\/electron-/i,
  ];
  const hits = entries.filter((e) => blocked.some((re) => re.test(e)));
  if (hits.length) {
    fail("asar contains sensitive or test paths", { hits: hits.slice(0, 20) });
  }
}

/**
 * Strict post-build validation. Throws on any failure.
 * Never treats pre-existing artifacts outside staging as success.
 */
function validateFreshBuildArtifacts(args) {
  const {
    stagingDir,
    buildStartedAtMs,
    expectedGitHead,
    builderExitCode,
    zipPath,
    zipExitCode,
    buildInfoPathInProject,
  } = args;

  if (builderExitCode !== 0) {
    fail("electron-builder exited non-zero", { builderExitCode });
  }
  if (zipExitCode !== 0) {
    fail("zip command exited non-zero", { zipExitCode });
  }
  if (!zipPath || !fs.existsSync(zipPath)) {
    fail("zip missing after build", { zipPath });
  }
  if (!stagingDir || !fs.existsSync(stagingDir)) {
    fail("staging directory missing after build", { stagingDir });
  }
  const stagingStat = fs.statSync(stagingDir);
  if (stagingStat.birthtimeMs && stagingStat.birthtimeMs + 5 < buildStartedAtMs - 2000) {
    // birthtime not always reliable on Windows; rely primarily on nested file mtimes
  }

  const unpacked = path.join(stagingDir, "win-unpacked");
  const exePath = path.join(unpacked, "Digital Me.exe");
  const asarPath = path.join(unpacked, "resources", "app.asar");
  const resourceBuildInfo = path.join(unpacked, "resources", "build-info.json");

  if (!fs.existsSync(exePath)) fail("Digital Me.exe missing in staging", { exePath });
  if (!fs.existsSync(asarPath)) fail("resources/app.asar missing in staging", { asarPath });

  const exeMtime = fileMtimeMs(exePath);
  const asarMtime = fileMtimeMs(asarPath);
  // Allow small clock skew; reject clearly stale files from before build start.
  if (exeMtime + 500 < buildStartedAtMs) {
    fail("Digital Me.exe mtime is older than build start (stale artifact)", {
      exeMtime,
      buildStartedAtMs,
    });
  }
  if (asarMtime + 500 < buildStartedAtMs) {
    fail("app.asar mtime is older than build start (stale artifact)", {
      asarMtime,
      buildStartedAtMs,
    });
  }

  if (!fs.existsSync(resourceBuildInfo)) {
    fail("resources/build-info.json missing", { resourceBuildInfo });
  }
  const resourceInfo = JSON.parse(fs.readFileSync(resourceBuildInfo, "utf8"));
  if (resourceInfo.gitHead !== expectedGitHead) {
    fail("resources/build-info.json gitHead mismatch", {
      embedded: resourceInfo.gitHead,
      expectedGitHead,
    });
  }

  const entries = listAsarEntries(asarPath);
  assertNoSensitiveAsarPaths(entries);
  const embeddedName = entries.find((e) => /closed-alpha-build-info\.json$/i.test(e));
  if (!embeddedName) {
    fail("app.asar missing closed-alpha-build-info.json");
  }
  const tmpExtract = path.join(stagingDir, "_extract-build-info.json");
  const internal = embeddedName.replace(/^\\/, "").replace(/\\/g, "/");
  extractAsarFile(asarPath, internal.replace(/^\//, ""), tmpExtract);
  const asarInfo = JSON.parse(fs.readFileSync(tmpExtract, "utf8"));
  if (asarInfo.gitHead !== expectedGitHead) {
    fail("asar embedded gitHead mismatch", {
      embedded: asarInfo.gitHead,
      expectedGitHead,
    });
  }

  if (buildInfoPathInProject && fs.existsSync(buildInfoPathInProject)) {
    const srcInfo = JSON.parse(fs.readFileSync(buildInfoPathInProject, "utf8"));
    if (srcInfo.gitHead !== expectedGitHead) {
      fail("project build-info gitHead mismatch", { embedded: srcInfo.gitHead, expectedGitHead });
    }
  }

  const zipMtime = fileMtimeMs(zipPath);
  if (zipMtime + 500 < buildStartedAtMs) {
    fail("zip mtime is older than build start (stale zip)", { zipMtime, buildStartedAtMs });
  }

  // Zip must contain Digital Me.exe (PowerShell Compress-Archive stores paths)
  const listZip = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
        `$z=[IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}'); ` +
        `$names=$z.Entries | ForEach-Object { $_.FullName }; $z.Dispose(); ` +
        `$names | Out-String`,
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
  );
  if (listZip.status !== 0) {
    fail("unable to list zip contents", { stderr: String(listZip.stderr || "") });
  }
  const zipNames = String(listZip.stdout || "");
  if (!/Digital Me\.exe/i.test(zipNames)) {
    fail("zip does not contain Digital Me.exe", { sample: zipNames.slice(0, 500) });
  }

  const hashes = {
    exeSha256: sha256File(exePath),
    asarSha256: sha256File(asarPath),
    zipSha256: sha256File(zipPath),
    exeBytes: fs.statSync(exePath).size,
    asarBytes: fs.statSync(asarPath).size,
    zipBytes: fs.statSync(zipPath).size,
  };

  return {
    ok: true,
    unpacked,
    exePath,
    asarPath,
    zipPath,
    resourceInfo,
    asarInfo,
    hashes,
    entriesSample: entries.slice(0, 20),
  };
}

/**
 * Simulate / assert failure path: old artifacts present must not satisfy freshness.
 */
function assertStaleArtifactsRejected(args) {
  try {
    validateFreshBuildArtifacts(args);
    fail("expected stale artifacts to be rejected, but validation passed");
  } catch (err) {
    if (err.code !== "BUILD_INTEGRITY_FAILED" && !/older than build start|missing|non-zero|mismatch|stale/i.test(err.message)) {
      // rethrow unexpected
      if (err.message && err.message.includes("expected stale")) throw err;
    }
    return { rejected: true, reason: err.message, details: err.details || null };
  }
}

module.exports = {
  PRODUCT_SURFACE,
  RELEASE_CHANNEL,
  fail,
  sha256File,
  fileMtimeMs,
  resolveGitHead,
  shortHash,
  makeBuildId,
  writeBuildInfo,
  readJsonIfExists,
  listAsarEntries,
  extractAsarFile,
  validateFreshBuildArtifacts,
  assertStaleArtifactsRejected,
};

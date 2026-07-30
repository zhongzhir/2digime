"use strict";

/**
 * Closed-alpha portable build wrapper.
 * Never reports BUILD_OK based on pre-existing dist-alpha-build artifacts.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  resolveGitHead,
  shortHash,
  makeBuildId,
  writeBuildInfo,
  validateFreshBuildArtifacts,
  sha256File,
} = require("./lib/closed-alpha-build-integrity.cjs");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const buildInfoProjectPath = path.join(appRoot, "closed-alpha-build-info.json");
const buildInfoSourcePath = path.join(appRoot, "build", "build-info.json");
const stagingRoot = path.join(appRoot, "dist-alpha-build-staging");
const legacyDir = path.join(appRoot, "dist-alpha-build");
const currentPointerPath = path.join(appRoot, "dist-alpha-build-staging", "current-closed-alpha-build.json");
const evidenceDir = path.join(appRoot, "scripts", "_mvp-release-gate-01e-evidence");

function printFailed(err) {
  console.error("BUILD_FAILED");
  console.error(err && err.message ? err.message : err);
  if (err && err.details) {
    console.error(JSON.stringify(err.details, null, 2));
  }
}

function markLegacySuperseded(expectedGitHead) {
  if (!fs.existsSync(legacyDir)) return null;
  const supersededDir = path.join(legacyDir, "_superseded");
  fs.mkdirSync(supersededDir, { recursive: true });
  const marker = {
    superseded: true,
    not_current_release_candidate: true,
    markedAt: new Date().toISOString(),
    note: "Pre-FIX-01 artifacts; may predate current HEAD. Do not treat as release candidate.",
    knownStaleZipSha256Prefix: "B105D6935B5702AD20719ACF73F92F2E6FB88D51AD73BF40399278B43856E4DC",
    replacedByGitHead: expectedGitHead,
  };
  const markerPath = path.join(legacyDir, "SUPERSEDED.json");
  fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");

  // Move known legacy zip into _superseded if present (keep win-unpacked in place if locked).
  const legacyZip = path.join(legacyDir, "DigitalMe-ClosedAlpha-0.1.0-win-x64-dir.zip");
  if (fs.existsSync(legacyZip)) {
    const dest = path.join(supersededDir, path.basename(legacyZip));
    try {
      fs.renameSync(legacyZip, dest);
      marker.movedZip = dest;
    } catch (e) {
      marker.zipMoveError = String(e && e.message ? e.message : e);
      fs.copyFileSync(legacyZip, dest);
      marker.copiedZip = dest;
    }
    fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  }
  return markerPath;
}

function zipUnpacked(unpackedDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = '${unpackedDir.replace(/'/g, "''")}'
$dst = '${zipPath.replace(/'/g, "''")}'
if (Test-Path $dst) { Remove-Item -Force $dst }
[IO.Compression.ZipFile]::CreateFromDirectory($src, $dst, [IO.Compression.CompressionLevel]::Optimal, $false)
`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return r;
}

function main() {
  const buildStartedAtMs = Date.now();
  const buildStartedAtIso = new Date(buildStartedAtMs).toISOString();
  let gitHead;
  try {
    gitHead = resolveGitHead(repoRoot);
  } catch (err) {
    printFailed(err);
    process.exit(1);
  }

  const buildId = makeBuildId(gitHead, new Date(buildStartedAtMs));
  const stagingDir = path.join(stagingRoot, buildId);
  fs.mkdirSync(stagingDir, { recursive: true });

  const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
  const buildInfo = writeBuildInfo(buildInfoProjectPath, {
    gitHead,
    buildId,
    buildTime: buildStartedAtIso,
    appVersion: pkg.version,
  });
  writeBuildInfo(buildInfoSourcePath, {
    gitHead,
    buildId,
    buildTime: buildStartedAtIso,
    appVersion: pkg.version,
  });

  const env = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  };

  const electronBuilderBin = path.join(
    appRoot,
    "node_modules",
    "electron-builder",
    "cli.js"
  );
  if (!fs.existsSync(electronBuilderBin)) {
    printFailed(new Error("electron-builder CLI missing under node_modules"));
    process.exit(1);
  }

  // Full per-build JSON config (electron-builder last --config wins; avoid dual-config).
  const overrideConfigPath = path.join(stagingDir, "electron-builder.build.json");
  const buildConfig = {
    appId: "local.digitalme.app",
    productName: "Digital Me",
    copyright: "Digital Me",
    directories: {
      output: stagingDir,
      buildResources: "build",
    },
    files: [
      "src/**/*",
      "package.json",
      "closed-alpha-build-info.json",
      "!**/_*-evidence/**",
      "!**/project/**",
      "!**/*.md",
      "!scripts/**",
      "scripts/.keep",
    ],
    extraResources: [
      {
        from: "build/build-info.json",
        to: "build-info.json",
      },
    ],
    extraMetadata: {
      main: "src/main.js",
    },
    asar: true,
    forceCodeSigning: false,
    win: {
      target: [{ target: "dir", arch: ["x64"] }],
      signAndEditExecutable: false,
      signingHashAlgorithms: [],
      verifyUpdateCodeSignature: false,
    },
    electronLanguages: ["zh-CN", "en-US"],
  };
  fs.writeFileSync(overrideConfigPath, `${JSON.stringify(buildConfig, null, 2)}\n`, "utf8");

  console.log("[closed-alpha] staging:", stagingDir);
  console.log("[closed-alpha] gitHead:", gitHead);
  console.log("[closed-alpha] buildId:", buildId);

  const builder = spawnSync(
    process.execPath,
    [electronBuilderBin, "--win", "dir", "--x64", "--config", overrideConfigPath],
    {
      cwd: appRoot,
      env,
      encoding: "utf8",
      stdio: "inherit",
    }
  );
  const builderExitCode = builder.status == null ? 1 : builder.status;

  const zipName = `Digital-Me-Closed-Alpha-${shortHash(gitHead)}.zip`;
  const zipPath = path.join(stagingDir, zipName);
  let zipExitCode = 1;
  if (builderExitCode === 0) {
    const unpacked = path.join(stagingDir, "win-unpacked");
    const zipResult = zipUnpacked(unpacked, zipPath);
    zipExitCode = zipResult.status == null ? 1 : zipResult.status;
    if (zipExitCode !== 0) {
      console.error(zipResult.stderr || zipResult.stdout || "zip failed");
    }
  }

  let validated;
  try {
    validated = validateFreshBuildArtifacts({
      stagingDir,
      buildStartedAtMs,
      expectedGitHead: gitHead,
      builderExitCode,
      zipPath,
      zipExitCode,
      buildInfoPathInProject: buildInfoProjectPath,
    });
  } catch (err) {
    printFailed(err);
    process.exit(1);
  }

  const supersededMarker = markLegacySuperseded(gitHead);

  const manifest = {
    buildStatus: "portable_closed_alpha_build",
    buildOk: true,
    unsigned: true,
    smartScreenRisk: "expected",
    productSurface: buildInfo.productSurface,
    releaseChannel: buildInfo.releaseChannel,
    gitHead,
    gitShort: shortHash(gitHead),
    buildId,
    buildStartedAt: buildStartedAtIso,
    buildFinishedAt: new Date().toISOString(),
    stagingDir: path.relative(appRoot, stagingDir).replace(/\\/g, "/"),
    artifactExe: path.relative(appRoot, validated.exePath).replace(/\\/g, "/"),
    artifactAsar: path.relative(appRoot, validated.asarPath).replace(/\\/g, "/"),
    artifactZip: path.relative(appRoot, validated.zipPath).replace(/\\/g, "/"),
    hashes: validated.hashes,
    legacySupersededMarker: supersededMarker
      ? path.relative(appRoot, supersededMarker).replace(/\\/g, "/")
      : null,
    note: "Fresh staging build; stale dist-alpha-build is not a release candidate.",
  };

  fs.mkdirSync(evidenceDir, { recursive: true });
  const manifestPath = path.join(stagingDir, "build-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(evidenceDir, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(evidenceDir, "build-integrity-fix-01.json"),
    `${JSON.stringify(
      {
        task: "MVP-RELEASE-GATE-01E-FIX-01",
        ok: true,
        gitHead,
        buildId,
        hashes: validated.hashes,
        stagingDir: manifest.stagingDir,
        superseded: true,
        pushed: false,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const pointer = {
    current: true,
    gitHead,
    buildId,
    stagingDir: manifest.stagingDir,
    zip: manifest.artifactZip,
    exe: manifest.artifactExe,
    hashes: validated.hashes,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(currentPointerPath, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");

  // Verify manifest hashes still match files (integrity of written manifest).
  if (sha256File(validated.exePath) !== validated.hashes.exeSha256) {
    printFailed(new Error("manifest exe hash drifted before write finalize"));
    process.exit(1);
  }

  console.log("BUILD_OK");
  console.log(JSON.stringify({ buildId, gitHead, zip: zipName, hashes: validated.hashes }, null, 2));
  process.exit(0);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    printFailed(err);
    process.exit(1);
  }
}

module.exports = { main, markLegacySuperseded };

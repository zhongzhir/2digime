"use strict";

/**
 * TASK-QUALITY-STABILIZE-01-FIX-01A — formal Electron artifact-open acceptance harness.
 *
 * - Never depends on process.cwd() for module resolution (__dirname → app root).
 * - Isolated Electron process + temporary userData (never mutates Owner store).
 * - Optional Owner PRD acceptance: copies the named artifact into the temp userData.
 * - Headless: does not create a window; errors go to stderr + non-zero exit (no dialog).
 *
 * Usage:
 *   npm run test:artifact-open-acceptance
 *   npm run test:artifact-open-acceptance:owner   # DIGITALME_OPEN_OWNER_ACCEPTANCE=1
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

function fromAppRoot(...parts) {
  return path.resolve(__dirname, "..", ...parts);
}

function loadElectron() {
  // Keep electron require after path helpers so a failed require still reports cleanly.
  return require("electron");
}

const OWNER_PRD = Object.freeze({
  packageId: "delivery_ms5k9963_57dea4cf",
  deliverableId: "deliverable_ms5k9964_7b9fb09e",
  versionId: "dver_ms5kbhjc_79d46814",
  artifactId: "aref_ms5kbhjs_767bad99",
  taskId: "abt_ms5k8vpk_fd0a2b",
});

function writeResult(outPath, result) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
}

async function copyOwnerArtifactInto(isolatedUserData, ownerUserData, ids) {
  const artifactFs = require(fromAppRoot("src", "act-behalf", "deliverable-artifact-fs"));
  const packageStore = require(fromAppRoot("src", "act-behalf", "deliverable-package-store"));

  const ownerStore = packageStore.loadStore(ownerUserData);
  const artifact = ownerStore.artifacts && ownerStore.artifacts[ids.artifactId];
  const version = ownerStore.versions && ownerStore.versions[ids.versionId];
  const deliverable = ownerStore.deliverables && ownerStore.deliverables[ids.deliverableId];
  const pkg = ownerStore.packages && ownerStore.packages[ids.packageId];
  if (!artifact || !version || !deliverable || !pkg) {
    const e = new Error("owner artifact graph incomplete");
    e.code = "owner_artifact_missing";
    throw e;
  }

  const srcAbs = artifactFs.resolveAbsolute(ownerUserData, artifact.relativePath);
  if (!fs.existsSync(srcAbs)) {
    const e = new Error("owner artifact file missing: " + srcAbs);
    e.code = "file_missing";
    throw e;
  }

  const relDir = artifactFs.versionRelDir(ids.packageId, ids.deliverableId, ids.versionId);
  const destDir = artifactFs.resolveAbsolute(isolatedUserData, relDir);
  fs.mkdirSync(destDir, { recursive: true });
  const destFile = path.join(destDir, path.basename(srcAbs));
  fs.copyFileSync(srcAbs, destFile);

  // Also copy sibling formats if present (html/docx) so version refs stay consistent.
  const siblingDir = path.dirname(srcAbs);
  for (const name of fs.readdirSync(siblingDir)) {
    const from = path.join(siblingDir, name);
    const to = path.join(destDir, name);
    if (fs.statSync(from).isFile() && !fs.existsSync(to)) {
      fs.copyFileSync(from, to);
    }
  }

  const clonedArtifact = JSON.parse(JSON.stringify(artifact));
  const clonedVersion = JSON.parse(JSON.stringify(version));
  const clonedDeliverable = JSON.parse(JSON.stringify(deliverable));
  const clonedPkg = JSON.parse(JSON.stringify(pkg));

  await packageStore.mutateStore(isolatedUserData, (s) => {
    s.packages[ids.packageId] = clonedPkg;
    s.deliverables[ids.deliverableId] = clonedDeliverable;
    s.versions[ids.versionId] = clonedVersion;
    s.artifacts[ids.artifactId] = clonedArtifact;
    // Re-index any sibling artifact refs that exist on the version.
    const refs = []
      .concat(clonedVersion.artifactRefs || [])
      .concat(clonedVersion.artifactRef ? [clonedVersion.artifactRef] : [])
      .concat(clonedVersion.previewRef ? [clonedVersion.previewRef] : []);
    for (const ref of refs) {
      if (!ref || !ref.id) continue;
      const src = ownerStore.artifacts[ref.id] || ref;
      s.artifacts[ref.id] = JSON.parse(JSON.stringify(src));
    }
    return true;
  });

  return {
    artifactResolved: true,
    fileExists: fs.existsSync(destFile),
    absPath: destFile,
  };
}

async function seedSynthetic(isolatedUserData) {
  const artifactFs = require(fromAppRoot("src", "act-behalf", "deliverable-artifact-fs"));
  const packageStore = require(fromAppRoot("src", "act-behalf", "deliverable-package-store"));
  const packageId = "delivery_open_probe";
  const deliverableId = "deliverable_open_probe";
  const versionId = "dver_open_probe";
  const artifactId = "aref_open_probe";
  const committed = await artifactFs.commitVersionFiles(isolatedUserData, {
    packageId,
    deliverableId,
    versionId,
    files: { "artifact.md": "# Probe\n\n可打开。\n" },
    manifest: { attemptId: "dgatt_probe" },
  });
  const file = committed.files[0];
  const artifact = {
    id: artifactId,
    versionId,
    relativePath: file.relativePath,
    contentHash: file.contentHash,
    mimeType: "text/markdown",
    byteSize: file.byteSize,
    format: "md",
  };
  await packageStore.mutateStore(isolatedUserData, (s) => {
    s.packages[packageId] = {
      id: packageId,
      taskId: "abt_open_probe",
      deliverableIds: [deliverableId],
      softDeletedAt: null,
    };
    s.deliverables[deliverableId] = {
      id: deliverableId,
      packageId,
      kind: "document",
      generationStatus: "ready",
      currentVersionId: versionId,
      versionIds: [versionId],
      planDisposition: "included",
    };
    s.versions[versionId] = {
      id: versionId,
      deliverableId,
      packageId,
      artifactRef: artifact,
      artifactRefs: [artifact],
    };
    s.artifacts[artifactId] = artifact;
    return true;
  });
  return {
    artifactId,
    taskId: "abt_open_probe",
    versionId,
    deliverableId,
    absPath: artifactFs.resolveAbsolute(isolatedUserData, file.relativePath),
  };
}

async function main() {
  const { app, shell } = loadElectron();

  // Fail closed without dialogs: no windows; uncaught → stderr + exit.
  app.disableHardwareAcceleration?.();

  const resultPath =
    process.env.DIGITALME_OPEN_ACCEPTANCE_OUT ||
    path.join(os.tmpdir(), "dm-artifact-open-acceptance-result.json");

  const result = {
    artifactResolved: false,
    fileExists: false,
    openPathResult: null,
    firstOpen: "failed",
    reopenAfterRestart: "failed",
    moduleBase: fromAppRoot(),
    cwd: process.cwd(),
  };

  await app.whenReady();

  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "dm-open-accept-"));
  app.setPath("userData", isolated);

  try {
    const openMod = require(fromAppRoot("src", "act-behalf", "deliverable-artifact-open"));
    const ownerMode = process.env.DIGITALME_OPEN_OWNER_ACCEPTANCE === "1";

    let artifactId;
    let taskId;
    let prep;

    if (ownerMode) {
      const ownerUserData =
        process.env.DIGITALME_OWNER_USERDATA ||
        path.join(process.env.APPDATA || "", "digitalme-app");
      prep = await copyOwnerArtifactInto(isolated, ownerUserData, OWNER_PRD);
      artifactId = OWNER_PRD.artifactId;
      taskId = OWNER_PRD.taskId;
      result.artifactResolved = !!prep.artifactResolved;
      result.fileExists = !!prep.fileExists;
      result.absPath = prep.absPath;
      result.mode = "owner_prd_copy";
    } else {
      prep = await seedSynthetic(isolated);
      artifactId = prep.artifactId;
      taskId = prep.taskId;
      result.artifactResolved = true;
      result.fileExists = fs.existsSync(prep.absPath);
      result.absPath = prep.absPath;
      result.mode = "synthetic";
    }

    if (!result.fileExists) {
      writeResult(resultPath, result);
      console.error("ACCEPTANCE_RESULT", JSON.stringify(result));
      app.exit(1);
      return;
    }

    // Capture raw shell.openPath return for the acceptance contract.
    let lastOpenPathRaw = null;
    const recordingShell = {
      openPath: async (p) => {
        lastOpenPathRaw = await shell.openPath(p);
        return lastOpenPathRaw;
      },
    };

    const first = await openMod.openArtifactSecure({
      userData: isolated,
      payload: {
        artifactId,
        versionId: ownerMode ? OWNER_PRD.versionId : prep.versionId,
        deliverableId: ownerMode ? OWNER_PRD.deliverableId : prep.deliverableId,
        taskId,
      },
      shell: recordingShell,
    });
    result.openPathResult = lastOpenPathRaw === undefined || lastOpenPathRaw === null ? null : lastOpenPathRaw;
    result.firstOpen = first.ok && lastOpenPathRaw === "" ? "passed" : "failed";
    result.firstOpenDetail = first;

    // Simulate restart: reload modules against the same isolated userData.
    delete require.cache[require.resolve(fromAppRoot("src", "act-behalf", "deliverable-package-store"))];
    delete require.cache[require.resolve(fromAppRoot("src", "act-behalf", "deliverable-artifact-open"))];
    const openMod2 = require(fromAppRoot("src", "act-behalf", "deliverable-artifact-open"));
    lastOpenPathRaw = null;
    const second = await openMod2.openArtifactSecure({
      userData: isolated,
      payload: { artifactId, taskId },
      shell: recordingShell,
    });
    result.reopenOpenPathResult =
      lastOpenPathRaw === undefined || lastOpenPathRaw === null ? null : lastOpenPathRaw;
    result.reopenAfterRestart = second.ok && lastOpenPathRaw === "" ? "passed" : "failed";
    result.reopenDetail = second;

    writeResult(resultPath, result);
    console.log("ACCEPTANCE_RESULT", JSON.stringify(result));
    console.log("ACCEPTANCE_RESULT_PATH", resultPath);

    const ok =
      result.artifactResolved &&
      result.fileExists &&
      result.openPathResult === "" &&
      result.firstOpen === "passed" &&
      result.reopenAfterRestart === "passed";
    app.exit(ok ? 0 : 1);
  } catch (err) {
    result.error = {
      message: err && err.message ? String(err.message) : String(err),
      code: err && err.code ? err.code : undefined,
      stack: err && err.stack ? String(err.stack).slice(0, 800) : undefined,
    };
    try {
      writeResult(resultPath, result);
    } catch {
      /* ignore */
    }
    console.error("ACCEPTANCE_RESULT", JSON.stringify(result));
    console.error(err);
    app.exit(1);
  } finally {
    try {
      fs.rmSync(isolated, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  try {
    const { app } = require("electron");
    if (app && typeof app.exit === "function") app.exit(1);
  } catch {
    process.exit(1);
  }
});

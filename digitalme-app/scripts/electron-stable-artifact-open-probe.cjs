"use strict";

/**
 * Isolated Electron probe: generate is not required — opens an existing fixture file
 * via the authoritative open helper and verifies shell.openPath is invoked with an
 * absolute existing path. Does not read Owner production packages unless
 * DIGITALME_OPEN_OWNER_PROBE=1.
 */

const { app, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const artifactFs = require("../src/act-behalf/deliverable-artifact-fs");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const { openArtifactSecure } = require("../src/act-behalf/deliverable-artifact-open");

async function seed(userData) {
  const packageId = "delivery_open_probe";
  const deliverableId = "deliverable_open_probe";
  const versionId = "dver_open_probe";
  const artifactId = "aref_open_probe";
  const committed = await artifactFs.commitVersionFiles(userData, {
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
  await packageStore.mutateStore(userData, (s) => {
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
  return artifactId;
}

app.whenReady().then(async () => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), "dm-open-electron-"));
  try {
    const artifactId = await seed(isolated);
    const res = await openArtifactSecure({
      userData: isolated,
      payload: { artifactId, taskId: "abt_open_probe" },
      shell,
    });
    console.log("ELECTRON_OPEN", JSON.stringify(res));
    if (!res.ok) {
      app.exit(1);
      return;
    }
    // Second open after "restart" simulation: reload store from same dir.
    const res2 = await openArtifactSecure({
      userData: isolated,
      payload: { artifactId },
      shell,
    });
    console.log("ELECTRON_REOPEN", JSON.stringify(res2));
    app.exit(res2.ok ? 0 : 1);
  } catch (err) {
    console.error(err);
    app.exit(1);
  } finally {
    try {
      fs.rmSync(isolated, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

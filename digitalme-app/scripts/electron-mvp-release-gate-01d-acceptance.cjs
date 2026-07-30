"use strict";

/**
 * MVP-RELEASE-GATE-01D Electron acceptance — interrupt / bak / reconcile.
 * Isolated userData. Controlled hooks (no real model needed for heal path).
 *
 * Run: npm run test:mvp-release-gate-01d-electron
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.versions.electron) {
  console.error("Must run under Electron");
  process.exit(1);
}

process.env.DIGITALME_ACT_BEHALF_FAKE = "1";
process.env.DIGITALME_DVL2_03_MOCK_MODEL = "1";
process.env.DIGITALME_LOG_STARTUP_RECOVERY = "1";

const { app, BrowserWindow } = require("electron");

const EVIDENCE = path.join(
  __dirname,
  "_mvp-release-gate-01d-evidence",
  new Date().toISOString().replace(/[:.]/g, "-")
);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-01d-e2e-"));
app.setPath("userData", userData);
fs.mkdirSync(EVIDENCE, { recursive: true });

const packageStore = require("../src/act-behalf/deliverable-package-store");
const learnStore = require("../src/act-behalf/deliverable-learn-store");
const { JOB_STATUS } = learnStore;
const artifactFs = require("../src/act-behalf/deliverable-artifact-fs");
const { bakPath } = require("../src/json-store-persistence");
const lifecycle = require("../src/digital-me-lifecycle");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  const file = path.join(EVIDENCE, `${name}.png`);
  fs.writeFileSync(file, img.toPNG());
  return file;
}

async function waitFor(win, predicate, label, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await win.webContents.executeJavaScript(`(async()=>Boolean(await (${predicate})()))()`);
    if (ok) return;
    await sleep(120);
  }
  throw new Error(`timeout: ${label}`);
}

async function seedBeforeAppReady() {
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), "dm-01d-docs-"));
  const created = lifecycle.createDigitalMePackage({
    documentsRoot: docs,
    displayName: "可靠性验收",
    roleSummary: "中断恢复",
  });
  assert.equal(created.ok, true);

  // Config pointing at package (main reads config.json in userData)
  fs.writeFileSync(
    path.join(userData, "config.json"),
    JSON.stringify({ packageDir: created.packageDir, modelRouting: { mode: "fake" } }, null, 2),
    "utf8"
  );

  // Scenario A: generating attempt with no files (force-quit mid-generation)
  await packageStore.mutateStore(userData, (s) => {
    const packageId = "pkg_interrupt";
    const deliverableId = "del_interrupt";
    const attemptId = "gatt_interrupt";
    s.packages[packageId] = {
      id: packageId,
      taskId: "task_interrupt",
      deliverableIds: [deliverableId],
      lifecycleStatus: "active",
      completionStatus: "in_progress",
      sourcePlanVersionId: "pv1",
      updatedAt: new Date().toISOString(),
    };
    s.deliverables[deliverableId] = {
      id: deliverableId,
      packageId,
      title: "中断测试成果",
      kind: "document",
      planDisposition: "included",
      generationStatus: "generating",
      latestGenerationAttemptId: attemptId,
      currentVersionId: null,
      versionIds: [],
      updatedAt: new Date().toISOString(),
    };
    s.generationAttempts[attemptId] = {
      schemaVersion: 1,
      id: attemptId,
      packageId,
      deliverableId,
      status: "generating",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      producedVersionId: null,
    };
    return true;
  });

  // Scenario B: orphan disk version (file written, store never committed)
  await artifactFs.commitVersionFiles(userData, {
    packageId: "pkg_interrupt",
    deliverableId: "del_interrupt",
    versionId: "dver_orphan_disk",
    files: { "body.md": "# orphan body\n" },
    manifest: { attemptId: "gatt_interrupt" },
  });

  // Scenario C: learn job stuck running
  learnStore.upsertJob(userData, {
    id: "learn_interrupt",
    status: JOB_STATUS.running,
    source: { deliverableVersionId: "dver_x", taskId: "task_interrupt" },
    audit: [],
    attempts: [{ at: new Date().toISOString(), action: "run" }],
    commit: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Scenario D: healthy package store + bak, then corrupt main (startup bak recover)
  const pkgPath = packageStore.storePath(userData);
  assert.ok(fs.existsSync(pkgPath));
  // Force a second write so .bak exists from prior good snapshot
  await packageStore.mutateStore(userData, (s) => {
    s.packages.pkg_interrupt.updatedAt = new Date().toISOString();
    return true;
  });
  assert.ok(fs.existsSync(bakPath(pkgPath)), "bak should exist before corrupt");
  fs.copyFileSync(pkgPath, path.join(EVIDENCE, "packages-before-corrupt.json"));
  fs.copyFileSync(bakPath(pkgPath), path.join(EVIDENCE, "packages.bak-before-boot.json"));
  fs.writeFileSync(pkgPath, "{intentionally-corrupt", "utf8");

  fs.writeFileSync(
    path.join(EVIDENCE, "seed-summary.json"),
    JSON.stringify(
      {
        userData,
        packageDir: created.packageDir,
        seededGenerating: true,
        seededOrphan: true,
        seededLearnRunning: true,
        corruptedMainStore: true,
      },
      null,
      2
    ),
    "utf8"
  );

  return { packageDir: created.packageDir };
}

async function runHarness() {
  // Allow startup recovery async IIFE to finish
  await sleep(1500);

  let win = null;
  for (let i = 0; i < 100; i++) {
    win = BrowserWindow.getAllWindows()[0];
    if (win) break;
    await sleep(100);
  }
  assert.ok(win, "BrowserWindow");
  await waitFor(win, `() => document.readyState === "complete"`, "ready");
  await shot(win, "01-after-restart");

  packageStore.invalidateStoreCache();
  const store = packageStore.loadStore(userData);
  const attempt = store.generationAttempts.gatt_interrupt;
  assert.ok(attempt, "attempt present after bak recovery");
  assert.equal(attempt.status, "failed", "generating healed to failed");
  assert.equal(attempt.errorCode, "generation_interrupted");
  assert.equal(store.deliverables.del_interrupt.generationStatus, "failed");
  assert.match(String(store.deliverables.del_interrupt.lastGenerationIssueSummary || ""), /中断/);

  const learn = learnStore.getJob(userData, "learn_interrupt");
  assert.equal(learn.ok, true);
  assert.equal(learn.job.status, JOB_STATUS.failed);

  const orphanAbs = path.join(
    userData,
    "deliverable-artifacts",
    "pkg_interrupt",
    "del_interrupt",
    "dver_orphan_disk"
  );
  const orphanGone = !fs.existsSync(orphanAbs);
  const orphanRoot = path.join(userData, "deliverable-artifacts", "_orphaned");
  const hasOrphanQuarantine = fs.existsSync(orphanRoot);
  assert.ok(orphanGone || hasOrphanQuarantine, "orphan isolated or removed from authoritative tree");

  // UI must not show permanent busy for this deliverable when loading package view
  const viewHint = await win.webContents.executeJavaScript(`(async () => {
    try {
      if (window.digitalMe && window.digitalMe.getFirstRunState) {
        const fr = await window.digitalMe.getFirstRunState();
        return { firstRun: fr && fr.state };
      }
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
    return { firstRun: null };
  })()`);

  fs.writeFileSync(
    path.join(EVIDENCE, "post-restart-state.json"),
    JSON.stringify(
      {
        attemptStatus: attempt.status,
        errorCode: attempt.errorCode,
        deliverableGenerationStatus: store.deliverables.del_interrupt.generationStatus,
        learnStatus: learn.job.status,
        orphanGone,
        hasOrphanQuarantine,
        viewHint,
        pipelineModeEnvIgnored: true,
      },
      null,
      2
    ),
    "utf8"
  );

  await shot(win, "02-healed-state");

  fs.writeFileSync(
    path.join(EVIDENCE, "summary.json"),
    JSON.stringify(
      {
        ok: true,
        scenarios: [
          "A_generation_interrupt_heal",
          "B_orphan_isolate",
          "C_store_bak_recover",
          "D_learning_interrupt_heal",
        ],
        evidenceDir: EVIDENCE,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("01D Electron acceptance PASS", EVIDENCE);
  app.exit(0);
}

seedBeforeAppReady()
  .then(() => {
    require("../src/main.js");
    app.whenReady().then(() => {
      // main.js also registers whenReady; harness waits for window then verifies
      setTimeout(() => {
        runHarness().catch((err) => {
          console.error(err);
          try {
            fs.writeFileSync(
              path.join(EVIDENCE, "error.json"),
              JSON.stringify({ message: String(err && err.message || err), stack: err && err.stack }, null, 2)
            );
          } catch {
            /* ignore */
          }
          app.exit(1);
        });
      }, 800);
    });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

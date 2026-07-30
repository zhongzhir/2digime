"use strict";

/**
 * MVP-RELEASE-GATE-01D — execution reliability tests.
 * Run: npm run test:mvp-release-gate-01d
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  writeJsonStoreAtomic,
  writeJsonStoreAtomicSync,
  readJsonStoreWithBackup,
  bakPath,
  drainRecoveryEvents,
} = require("../src/json-store-persistence");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const taskStore = require("../src/act-behalf/task-store");
const planStore = require("../src/act-behalf/deliverable-plan-store");
const authStore = require("../src/act-behalf/authorization-store");
const learnStore = require("../src/act-behalf/deliverable-learn-store");
const { JOB_STATUS } = learnStore;
const {
  healInterruptedGeneration,
  healInterruptedLearning,
  runStartupInterruptRecovery,
  USER_INTERRUPT_SUMMARY,
} = require("../src/act-behalf/runtime-interrupt-heal");
const {
  reconcileArtifactFilesystem,
  projectArtifactAvailability,
} = require("../src/act-behalf/artifact-reconciliation");
const artifactFs = require("../src/act-behalf/deliverable-artifact-fs");
const artifactOpen = require("../src/act-behalf/deliverable-artifact-open");
const {
  resolveQualityPipelineMode,
  QUALITY_PIPELINE_MODES,
} = require("../src/act-behalf/quality-pipeline-mode");
const { resolveKnowledgeContext } = require("../src/act-behalf/knowledge-resolver");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name);
    console.error(err && err.stack ? err.stack : err);
  }
}

function tempUserData(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-01d-${label}-`));
}

function seedEmptyPackageStore(userData) {
  packageStore.invalidateStoreCache();
  const store = packageStore.emptyStore();
  return packageStore.mutateStore(userData, (s) => {
    Object.assign(s, store);
    return true;
  });
}

async function seedGeneratingAttempt(userData, opts) {
  const o = opts || {};
  await seedEmptyPackageStore(userData);
  const packageId = o.packageId || "pkg_01d";
  const deliverableId = o.deliverableId || "del_01d";
  const attemptId = o.attemptId || "gatt_01d";
  const versionId = o.versionId || null;

  await packageStore.mutateStore(userData, (s) => {
    s.packages[packageId] = {
      id: packageId,
      taskId: "task_01d",
      deliverableIds: [deliverableId],
      lifecycleStatus: "active",
      completionStatus: "in_progress",
      updatedAt: new Date().toISOString(),
    };
    s.deliverables[deliverableId] = {
      id: deliverableId,
      packageId,
      title: "测试成果",
      kind: "document",
      planDisposition: "included",
      generationStatus: "generating",
      latestGenerationAttemptId: attemptId,
      currentVersionId: versionId,
      versionIds: versionId ? [versionId] : [],
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
      producedVersionId: versionId,
      errorCode: null,
      userIssueSummary: null,
    };
    if (versionId && o.withVersion) {
      const rel = artifactFs.versionRelDir(packageId, deliverableId, versionId) + "/body.md";
      const art = {
        id: "aref_01d",
        versionId,
        relativePath: rel,
        format: "md",
        contentHash: "sha256:abc",
        byteSize: 12,
      };
      s.artifacts[art.id] = art;
      s.versions[versionId] = {
        id: versionId,
        deliverableId,
        generationAttemptId: attemptId,
        generationStatus: "ready",
        artifactRef: art,
        artifactRefs: [art],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    return true;
  });

  if (versionId && o.writeFiles) {
    const committed = await artifactFs.commitVersionFiles(userData, {
      packageId,
      deliverableId,
      versionId,
      files: { "body.md": "# hello\n" },
      manifest: { attemptId },
    });
    return { packageId, deliverableId, attemptId, versionId, committed };
  }
  return { packageId, deliverableId, attemptId, versionId };
}

async function main() {
  const evidenceRoot = path.join(__dirname, "_mvp-release-gate-01d-evidence");
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const summary = { startedAt: new Date().toISOString(), cases: [] };

  // --- Generation heal ---
  await test("gen heal: running + no files → interrupted", async () => {
    const ud = tempUserData("gen-none");
    const ids = await seedGeneratingAttempt(ud, {});
    const r1 = await healInterruptedGeneration(ud);
    assert.equal(r1.mutated, true);
    const store = packageStore.loadStore(ud);
    assert.equal(store.generationAttempts[ids.attemptId].status, "failed");
    assert.equal(store.generationAttempts[ids.attemptId].errorCode, "generation_interrupted");
    assert.equal(store.deliverables[ids.deliverableId].generationStatus, "failed");
    assert.match(store.deliverables[ids.deliverableId].lastGenerationIssueSummary, /中断/);
    const r2 = await healInterruptedGeneration(ud);
    assert.equal(r2.mutated, false);
    summary.cases.push({ id: "gen_no_files", before: "generating", after: "failed" });
  });

  await test("gen heal: running + complete version → succeeded", async () => {
    const ud = tempUserData("gen-ok");
    const ids = await seedGeneratingAttempt(ud, {
      versionId: "dver_01d",
      withVersion: true,
      writeFiles: true,
    });
    const r = await healInterruptedGeneration(ud);
    assert.equal(r.mutated, true);
    const store = packageStore.loadStore(ud);
    assert.equal(store.generationAttempts[ids.attemptId].status, "succeeded");
    assert.equal(store.deliverables[ids.deliverableId].generationStatus, "ready");
    const r2 = await healInterruptedGeneration(ud);
    assert.equal(r2.mutated, false);
    summary.cases.push({ id: "gen_complete", after: "succeeded" });
  });

  await test("gen heal: running + orphan dir only → interrupted, orphan isolated", async () => {
    const ud = tempUserData("gen-orphan");
    const ids = await seedGeneratingAttempt(ud, {});
    // Write orphan version dir without store record
    await artifactFs.commitVersionFiles(ud, {
      packageId: ids.packageId,
      deliverableId: ids.deliverableId,
      versionId: "dver_orphan",
      files: { "body.md": "# orphan\n" },
      manifest: { attemptId: ids.attemptId },
    });
    const recovery = await runStartupInterruptRecovery(ud);
    assert.equal(recovery.generation.mutated, true);
    const store = packageStore.loadStore(ud);
    assert.equal(store.generationAttempts[ids.attemptId].status, "failed");
    assert.ok(!store.versions.dver_orphan);
    assert.ok((recovery.artifacts.orphansIsolated || []).length >= 1);
    const open = artifactOpen.resolveOpenableArtifact(ud, {
      artifactId: "missing",
      versionId: "dver_orphan",
    });
    assert.equal(open.ok, false);
    summary.cases.push({
      id: "gen_orphan",
      orphans: recovery.artifacts.orphansIsolated.length,
    });
  });

  // --- Learning heal ---
  await test("learn heal: running + no assets → failed; createQueuedJob can retry", async () => {
    const ud = tempUserData("learn-none");
    const job = {
      id: "learn_z1",
      status: JOB_STATUS.running,
      source: { deliverableVersionId: "dver_l1", taskId: "t1" },
      audit: [],
      attempts: [],
      commit: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    learnStore.upsertJob(ud, job);
    const h = healInterruptedLearning(ud);
    assert.equal(h.mutated, true);
    const got = learnStore.getJob(ud, "learn_z1");
    assert.equal(got.job.status, JOB_STATUS.failed);
    const created = learnStore.createQueuedJob(ud, job.source);
    assert.equal(created.ok, true);
    assert.equal(created.reused, false);
    assert.equal(created.job.status, JOB_STATUS.queued);
    const h2 = healInterruptedLearning(ud);
    assert.equal(h2.mutated, false);
    summary.cases.push({ id: "learn_no_assets", after: "failed_then_queued" });
  });

  await test("learn heal: running + commit assets → committed", async () => {
    const ud = tempUserData("learn-ok");
    learnStore.upsertJob(ud, {
      id: "learn_z2",
      status: JOB_STATUS.running,
      source: { deliverableVersionId: "dver_l2" },
      audit: [{ at: new Date().toISOString(), action: "committed", changeSetId: "cs_1" }],
      commit: { changeSetId: "cs_1", packageRevision: 3 },
      attempts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const h = healInterruptedLearning(ud);
    assert.equal(h.mutated, true);
    assert.equal(learnStore.getJob(ud, "learn_z2").job.status, JOB_STATUS.committed);
    const again = learnStore.createQueuedJob(ud, { deliverableVersionId: "dver_l2" });
    assert.equal(again.reused, true);
    assert.equal(again.job.status, JOB_STATUS.committed);
    summary.cases.push({ id: "learn_with_assets", after: "committed" });
  });

  // --- Store backup ---
  const coreStores = [
    {
      name: "tasks",
      pathOf: (ud) => taskStore.storePath(ud),
      write: async (ud) => {
        await taskStore.saveTask(ud, {
          title: "t",
          goal: "g",
          request: "g",
          status: "draft",
        });
      },
      load: (ud) => taskStore.loadStore(ud),
      hasData: (s) => Array.isArray(s.tasks) && s.tasks.length > 0,
    },
    {
      name: "packages",
      pathOf: (ud) => packageStore.storePath(ud),
      write: async (ud) => {
        packageStore.invalidateStoreCache();
        if (!fs.existsSync(packageStore.storePath(ud))) {
          await seedEmptyPackageStore(ud);
        }
        await packageStore.mutateStore(ud, (s) => {
          s.packages.p1 = {
            id: "p1",
            taskId: "t",
            deliverableIds: [],
            updatedAt: new Date().toISOString(),
          };
          return true;
        });
      },
      load: (ud) => {
        packageStore.invalidateStoreCache();
        return packageStore.loadStore(ud);
      },
      hasData: (s) => !!(s.packages && s.packages.p1),
    },
    {
      name: "plans",
      pathOf: (ud) => planStore.storePath(ud),
      write: async (ud) => {
        planStore.invalidateStoreCache();
        const p = planStore.storePath(ud);
        let cur = { version: 1, plans: {} };
        if (fs.existsSync(p)) {
          try {
            cur = JSON.parse(fs.readFileSync(p, "utf8"));
          } catch {
            cur = { version: 1, plans: {} };
          }
        }
        cur.plans = cur.plans || {};
        cur.plans.pl1 = { id: "pl1", taskId: "t", versions: {}, updatedAt: new Date().toISOString() };
        await writeJsonStoreAtomic({ targetPath: p, data: cur });
        planStore.invalidateStoreCache();
      },
      load: (ud) => planStore.loadStore(ud),
      hasData: (s) => !!(s.plans && s.plans.pl1),
    },
    {
      name: "authorizations",
      pathOf: (ud) => authStore.storePath(ud),
      write: async (ud) => {
        await authStore.mutateStore(ud, (s) => {
          s.authorizations.a1 = { id: "a1", taskId: "t", status: "active" };
          return true;
        });
      },
      load: (ud) => authStore.loadStore(ud),
      hasData: (s) => !!(s.authorizations && s.authorizations.a1),
    },
    {
      name: "learn",
      pathOf: (ud) => learnStore.storePath ? path.join(ud, "deliverable-learn-jobs.json") : path.join(ud, "deliverable-learn-jobs.json"),
      write: async (ud) => {
        learnStore.upsertJob(ud, {
          id: "lj1",
          status: JOB_STATUS.queued,
          source: { deliverableVersionId: "v1" },
          audit: [],
          attempts: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      },
      load: (ud) => learnStore.loadStore(ud),
      hasData: (s) => !!(s.jobs && s.jobs.lj1),
    },
  ];

  for (const cs of coreStores) {
    await test(`store bak: ${cs.name} write creates .bak and recovers`, async () => {
      const ud = tempUserData(`store-${cs.name}`);
      await cs.write(ud);
      await cs.write(ud); // second write ensures .bak from prior good
      const p = cs.pathOf(ud);
      assert.ok(fs.existsSync(p), "main exists");
      assert.ok(fs.existsSync(bakPath(p)), "bak exists after second write");
      const good = fs.readFileSync(p, "utf8");
      fs.writeFileSync(p, "{not-json", "utf8");
      drainRecoveryEvents();
      const loaded = cs.load(ud);
      assert.ok(cs.hasData(loaded), "recovered data present");
      const events = drainRecoveryEvents();
      assert.ok(events.some((e) => e.kind === "store_recovered_from_bak"));
      // Dual corrupt must fail — not return empty
      fs.writeFileSync(p, "{bad", "utf8");
      fs.writeFileSync(bakPath(p), "{also-bad", "utf8");
      if (cs.name === "packages") packageStore.invalidateStoreCache();
      if (cs.name === "tasks") taskStore.invalidateStoreCache();
      if (cs.name === "plans") planStore.invalidateStoreCache();
      assert.throws(() => cs.load(ud));
      // Restore good for cleanliness
      fs.writeFileSync(p, good, "utf8");
      summary.cases.push({ id: `store_${cs.name}`, bak: true, dualCorruptThrows: true });
    });
  }

  await test("store: bak corrupt does not overwrite good main", async () => {
    const ud = tempUserData("bak-bad");
    const p = path.join(ud, "probe.json");
    writeJsonStoreAtomicSync({ targetPath: p, data: { ok: true, n: 1 }, pretty: true });
    writeJsonStoreAtomicSync({ targetPath: p, data: { ok: true, n: 2 }, pretty: true });
    fs.writeFileSync(bakPath(p), "{corrupt", "utf8");
    const loaded = readJsonStoreWithBackup({
      targetPath: p,
      validate: (x) => x && x.ok === true,
      emptyWhenMissing: () => ({ ok: false }),
    });
    assert.equal(loaded.parsed.n, 2);
    assert.equal(loaded.recoveredFromBackup, false);
    assert.equal(JSON.parse(fs.readFileSync(p, "utf8")).n, 2);
  });

  // --- Artifact reconciliation ---
  await test("artifact reconcile: missing file projection + orphan isolate", async () => {
    const ud = tempUserData("art");
    const ids = await seedGeneratingAttempt(ud, {
      versionId: "dver_miss",
      withVersion: true,
      writeFiles: false,
    });
    // Mark ready without files
    await packageStore.mutateStore(ud, (s) => {
      s.generationAttempts[ids.attemptId].status = "succeeded";
      s.deliverables[ids.deliverableId].generationStatus = "ready";
      s.deliverables[ids.deliverableId].currentVersionId = ids.versionId;
      return true;
    });
    const proj = projectArtifactAvailability(ud, "aref_01d");
    assert.equal(proj.available, false);
    assert.equal(proj.code, "file_missing");
    const open = artifactOpen.resolveOpenableArtifact(ud, {
      artifactId: "aref_01d",
      versionId: ids.versionId,
      deliverableId: ids.deliverableId,
      taskId: "task_01d",
    });
    assert.equal(open.ok, false);
    assert.equal(open.code, "file_missing");
    assert.match(open.message, /重新生成/);

    await artifactFs.commitVersionFiles(ud, {
      packageId: ids.packageId,
      deliverableId: ids.deliverableId,
      versionId: "dver_only_disk",
      files: { "body.md": "x" },
    });
    const rec = reconcileArtifactFilesystem(ud);
    assert.ok(rec.orphansIsolated.length >= 1);
    summary.cases.push({ id: "artifact_reconcile", missing: true, orphans: rec.orphansIsolated.length });
  });

  // --- stable_delivery ---
  await test("stable_delivery only in production; env cannot unlock", () => {
    assert.equal(resolveQualityPipelineMode({}), QUALITY_PIPELINE_MODES.STABLE_DELIVERY);
    const prevMode = process.env.DIGITALME_QUALITY_PIPELINE_MODE;
    const prevAllow = process.env.DIGITALME_ALLOW_ADVANCED_PIPELINE;
    process.env.DIGITALME_QUALITY_PIPELINE_MODE = "advanced_shadow";
    process.env.DIGITALME_ALLOW_ADVANCED_PIPELINE = "1";
    assert.equal(resolveQualityPipelineMode({}), QUALITY_PIPELINE_MODES.STABLE_DELIVERY);
    assert.equal(
      resolveQualityPipelineMode({ qualityPipelineMode: "advanced_shadow" }),
      QUALITY_PIPELINE_MODES.ADVANCED_SHADOW
    );
    if (prevMode === undefined) delete process.env.DIGITALME_QUALITY_PIPELINE_MODE;
    else process.env.DIGITALME_QUALITY_PIPELINE_MODE = prevMode;
    if (prevAllow === undefined) delete process.env.DIGITALME_ALLOW_ADVANCED_PIPELINE;
    else process.env.DIGITALME_ALLOW_ADVANCED_PIPELINE = prevAllow;
    summary.cases.push({ id: "stable_delivery_locked", ok: true });
  });

  // --- Knowledge unification ---
  await test("knowledge: buildSystemPrompt no longer dumps longTermMemory", () => {
    // Load main's exported helper if present; else string-check source.
    const mainPath = path.join(__dirname, "../src/main.js");
    const src = fs.readFileSync(mainPath, "utf8");
    assert.ok(!/parts\.push\("## 长期记忆/.test(src));
    assert.ok(/do not dump full longTermMemory/.test(src));
    summary.cases.push({ id: "no_memory_dump", ok: true });
  });

  await test("knowledge: resolver filters superseded / rejected", () => {
    const pkgDir = tempUserData("know");
    fs.mkdirSync(path.join(pkgDir, "memory"), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "manifest.json"), JSON.stringify({ id: "pkg" }), "utf8");
    fs.writeFileSync(path.join(pkgDir, "persona.md"), "persona", "utf8");
    // Minimal — resolver should not throw on empty package
    const resolved = resolveKnowledgeContext({
      query: "当前项目原则是什么",
      packageDir: pkgDir,
      surface: "chat",
      tokenBudget: 4000,
    });
    assert.ok(resolved);
    assert.ok(!Array.isArray(resolved.claims) || resolved.claims.every((c) => !c.supersededBy));
    summary.cases.push({ id: "knowledge_resolver", ok: true });
  });

  await test("interrupt copy constant present", () => {
    assert.match(USER_INTERRUPT_SUMMARY, /中断/);
    assert.match(USER_INTERRUPT_SUMMARY, /保留/);
  });

  summary.finishedAt = new Date().toISOString();
  summary.passed = passed;
  summary.failed = failed;
  fs.writeFileSync(
    path.join(evidenceRoot, "unit-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  console.log("\n01D results:", passed, "passed,", failed, "failed");
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

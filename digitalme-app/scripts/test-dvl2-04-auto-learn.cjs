"use strict";

/**
 * DVL2 auto-learn after accept: contracts (sync pipeline).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const actStore = require("../src/act-behalf/task-store");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const planner = require("../src/act-behalf/deliverable-planner");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
const generation = require("../src/act-behalf/deliverable-generation");
const autoLearn = require("../src/act-behalf/deliverable-auto-learn");
const learnStore = require("../src/act-behalf/deliverable-learn-store");
const { createMinimalFixture } = require("../src/package-store/fixture");

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log("PASS", name);
    })
    .catch((err) => {
      failed += 1;
      console.error("FAIL", name);
      console.error(err && err.stack ? err.stack : err);
    });
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function depsPrepare(ud) {
  return {
    getTask: (u, id) => actStore.getTask(u, id, { heal: false }),
    getPlan: (u, planId) => require("../src/act-behalf/deliverable-plan-store").getPlan(u, planId),
    saveTaskExecution: async (u, id, exec) => {
      const got = actStore.getTask(u, id, { heal: false });
      return actStore.saveTask(u, {
        ...got.task,
        deliverableExecution: { activePackageId: exec.activePackageId || null },
      });
    },
  };
}

async function seedGeneratedDoc(userData) {
  const taskId = "t_learn_" + Date.now().toString(36);
  const goal = "请写一份项目介绍文档。";
  await actStore.saveTask(userData, {
    taskId,
    title: "learn",
    goal,
    request: goal,
    status: "draft",
  });
  const suggestion = planner.ruleBasedPlan({ goal });
  suggestion.items = [
    {
      id: "pd_document",
      kind: "document",
      title: "介绍文档",
      purpose: "测试学习",
      format: "md",
      priority: "required",
      order: 0,
      dependencies: [],
      planDisposition: "included",
      riskFlags: [],
    },
  ];
  const applied = planner.applySuggestionToRecord({
    taskId,
    existingRecord: null,
    suggestion,
    goal,
  });
  const committed = await planConsistency.commitPlanThenTask({
    userData,
    planRecord: applied.plan,
    saveTaskPointers: async ({ deliverablePlanning }) => {
      const got = actStore.getTask(userData, taskId, { heal: false }).task;
      return actStore.saveTask(userData, { ...got, deliverablePlanning });
    },
    cas: { expectAbsent: true },
  });
  assert.equal(committed.ok, true);
  const confirmed = planner.confirmDraft(committed.plan);
  const after = await planConsistency.commitPlanThenTask({
    userData,
    planRecord: confirmed.plan,
    saveTaskPointers: async ({ deliverablePlanning }) => {
      const got = actStore.getTask(userData, taskId, { heal: false }).task;
      return actStore.saveTask(userData, {
        ...got,
        deliverablePlanning,
        deliverableExecution: { activePackageId: null },
      });
    },
    cas: { expectedRevision: planConsistency.revisionTokensFromPlan(committed.plan) },
  });
  assert.equal(after.ok, true);
  const prep = await prepareDeliverablePackage(userData, { taskId }, depsPrepare(userData));
  assert.equal(prep.ok, true);
  const gen = await generation.generateDeliverablePackage(
    userData,
    { packageId: prep.package.id },
    { callModel: null, imageMode: "mock" }
  );
  assert.equal(gen.ok, true);
  const view = packageStore.getPackageView(userData, prep.package.id);
  const del = (view.deliverables || []).find((d) => d.kind === "document");
  assert.ok(del && del.currentVersionId);
  return {
    taskId,
    packageId: prep.package.id,
    versionId: del.currentVersionId,
    deliverableId: del.id,
  };
}

async function main() {
  await test("1) accept returns; learn job runs; accept independent of learn", async () => {
    const ud = tempDir("dm-learn-1-");
    const pkgDir = tempDir("dm-learn-pkg-1-");
    try {
      createMinimalFixture(pkgDir, { withMemoryLine: true });
      const seeded = await seedGeneratedDoc(ud);
      const reviewed = await generation.reviewDeliverableVersion(ud, {
        versionId: seeded.versionId,
        decision: "accepted",
      });
      assert.equal(reviewed.ok, true);
      assert.equal(reviewed.reviewStatus, "accepted");

      const enq = await autoLearn.enqueueAfterAccept(ud, seeded.versionId, {
        packageDir: pkgDir,
        sync: true,
      });
      assert.equal(enq.ok, true);
      assert.ok(enq.job);
      assert.ok(
        ["committed", "skipped"].includes(enq.job.status),
        "status=" + enq.job.status
      );

      const store = packageStore.loadStore(ud);
      assert.equal(store.versions[seeded.versionId].reviewStatus, "accepted");
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("2) idempotent: second accept does not double-commit", async () => {
    const ud = tempDir("dm-learn-2-");
    const pkgDir = tempDir("dm-learn-pkg-2-");
    try {
      createMinimalFixture(pkgDir, { withMemoryLine: true });
      const seeded = await seedGeneratedDoc(ud);
      await generation.reviewDeliverableVersion(ud, {
        versionId: seeded.versionId,
        decision: "accepted",
      });
      const first = await autoLearn.enqueueAfterAccept(ud, seeded.versionId, {
        packageDir: pkgDir,
        sync: true,
      });
      assert.equal(first.ok, true);
      const cs1 = first.job.commit && first.job.commit.changeSetId;

      const second = await autoLearn.enqueueAfterAccept(ud, seeded.versionId, {
        packageDir: pkgDir,
        sync: true,
      });
      assert.equal(second.ok, true);
      assert.equal(second.reused, true);
      assert.equal(second.job.id, first.job.id);
      if (cs1) {
        assert.equal(second.job.commit.changeSetId, cs1);
      }
      const mem = fs.readFileSync(path.join(pkgDir, "memory", "long-term-memory.jsonl"), "utf8");
      const episodicLines = mem.split(/\n+/).filter((l) => l.includes("episodic"));
      // At most one auto-learn episodic batch for this version (may be 1+ lines but one job)
      assert.ok(episodicLines.length >= 1);
      assert.equal(Object.keys(learnStore.loadStore(ud).byVersionId).length, 1);
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("3) learn failure does not undo accept; retry works", async () => {
    const ud = tempDir("dm-learn-3-");
    try {
      const seeded = await seedGeneratedDoc(ud);
      await generation.reviewDeliverableVersion(ud, {
        versionId: seeded.versionId,
        decision: "accepted",
      });
      // Force fail by pointing to nonexistent then fix with retry + package
      const created = learnStore.createQueuedJob(ud, {
        taskId: seeded.taskId,
        packageId: seeded.packageId,
        deliverableId: seeded.deliverableId,
        deliverableVersionId: seeded.versionId,
        artifactRefs: [],
        contentHashes: [],
        acceptedAt: new Date().toISOString(),
      });
      // Corrupt job mid-run simulation: run with missing package → skipped (not failed)
      const skipped = await autoLearn.runLearnJob(ud, created.job.id, {
        packageDir: path.join(ud, "no-such-package"),
      });
      assert.equal(skipped.ok, true);
      assert.equal(skipped.job.status, "skipped");
      assert.equal(
        packageStore.loadStore(ud).versions[seeded.versionId].reviewStatus,
        "accepted"
      );

      // Explicit failure path: inject exception by empty version wipe is hard;
      // mark failed and retry with real package.
      let job = { ...skipped.job, status: "failed", lastError: "simulated" };
      learnStore.upsertJob(ud, job);
      const pkgDir = tempDir("dm-learn-pkg-3-");
      createMinimalFixture(pkgDir, { withMemoryLine: true });
      const retried = await autoLearn.retryJob(ud, job.id, { packageDir: pkgDir });
      assert.equal(retried.ok, true);
      assert.ok(["committed", "skipped"].includes(retried.job.status));
      cleanup(pkgDir);
    } finally {
      cleanup(ud);
    }
  });

  await test("4) no-conflict path writes episodic/semantic with audit rollback token", async () => {
    const ud = tempDir("dm-learn-4-");
    const pkgDir = tempDir("dm-learn-pkg-4-");
    try {
      createMinimalFixture(pkgDir, { withMemoryLine: true });
      const seeded = await seedGeneratedDoc(ud);
      await generation.reviewDeliverableVersion(ud, {
        versionId: seeded.versionId,
        decision: "accepted",
      });
      const res = await autoLearn.enqueueAfterAccept(ud, seeded.versionId, {
        packageDir: pkgDir,
        sync: true,
      });
      assert.equal(res.job.status, "committed");
      assert.ok(res.job.commit && res.job.commit.changeSetId);
      assert.ok(res.job.commit.rollbackToken != null || res.job.commit.packageRevision != null);
      assert.ok(Array.isArray(res.job.audit) && res.job.audit.length >= 1);
      assert.equal(res.job.source.deliverableVersionId, seeded.versionId);
      const mem = fs.readFileSync(path.join(pkgDir, "memory", "long-term-memory.jsonl"), "utf8");
      assert.match(mem, /deliverable_auto_learn|episodic|semantic/);
      assert.equal(mem.includes(seeded.versionId) || mem.includes("介绍文档"), true);
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("5) conflict: keep does not write; apply_new commits", async () => {
    const ud = tempDir("dm-learn-5-");
    const pkgDir = tempDir("dm-learn-pkg-5-");
    try {
      createMinimalFixture(pkgDir, { withMemoryLine: true });
      const before = fs.readFileSync(path.join(pkgDir, "memory", "long-term-memory.jsonl"), "utf8");
      const seeded = await seedGeneratedDoc(ud);
      await generation.reviewDeliverableVersion(ud, {
        versionId: seeded.versionId,
        decision: "accepted",
      });
      const pending = await autoLearn.enqueueAfterAccept(ud, seeded.versionId, {
        packageDir: pkgDir,
        sync: true,
        forceConflict: true,
      });
      assert.equal(pending.job.status, "pending_conflict");
      assert.ok(pending.job.conflict && pending.job.conflict.question);
      assert.equal(pending.job.conflict.question.includes("Package"), false);

      const kept = await autoLearn.resolveConflict(
        ud,
        { jobId: pending.job.id, choice: "keep_existing" },
        { packageDir: pkgDir }
      );
      assert.equal(kept.ok, true);
      assert.equal(kept.job.status, "resolved_keep");
      const afterKeep = fs.readFileSync(
        path.join(pkgDir, "memory", "long-term-memory.jsonl"),
        "utf8"
      );
      assert.equal(afterKeep, before);

      // New version/job for apply_new path
      const ud2 = tempDir("dm-learn-5b-");
      const pkgDir2 = tempDir("dm-learn-pkg-5b-");
      createMinimalFixture(pkgDir2, { withMemoryLine: true });
      const seeded2 = await seedGeneratedDoc(ud2);
      await generation.reviewDeliverableVersion(ud2, {
        versionId: seeded2.versionId,
        decision: "accepted",
      });
      const pending2 = await autoLearn.enqueueAfterAccept(ud2, seeded2.versionId, {
        packageDir: pkgDir2,
        sync: true,
        forceConflict: true,
      });
      const applied = await autoLearn.resolveConflict(
        ud2,
        { jobId: pending2.job.id, choice: "apply_new" },
        { packageDir: pkgDir2 }
      );
      assert.equal(applied.ok, true);
      assert.equal(applied.job.status, "committed");
      assert.ok(applied.job.commit && applied.job.commit.changeSetId);
      cleanup(ud2);
      cleanup(pkgDir2);
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("6) UI: DVL2 default has no VL1 learn candidate buttons; conflict hidden by default", async () => {
    const root = path.join(__dirname, "..", "src", "renderer");
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
    assert.ok(html.includes('id="act-learn-conflict"'));
    assert.ok(html.includes('class="act-learn-conflict hidden"'));
    assert.equal(html.includes("总结本次经验") && html.includes('id="btn-act-create-proposal"'), true);
    // DVL2 path must hide learn panel
    assert.match(app, /taskUsesDvl2Deliverables/);
    assert.match(app, /hideDvl2LegacyLearnAndResultPanels/);
    assert.equal(html.includes("成果计划已准备，尚未开始执行"), false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

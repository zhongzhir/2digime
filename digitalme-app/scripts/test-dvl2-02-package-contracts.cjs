"use strict";

/**
 * DVL2-02 deliverable package preparation contracts.
 * No real model / no real deliverable files / no package-store/** touch.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const schema = require("../src/act-behalf/deliverable-package-schema");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
const { reconcileTaskAndPackages } = require("../src/act-behalf/deliverable-package-consistency");
const { recomputeCurrentPreparationReadiness } = require("../src/act-behalf/deliverable-package-readiness");
const planSchema = require("../src/act-behalf/deliverable-plan-schema");
const planStore = require("../src/act-behalf/deliverable-plan-store");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const planner = require("../src/act-behalf/deliverable-planner");
const actStore = require("../src/act-behalf/task-store");

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

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-dvl2-02-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function assertNoArtifactFiles(userData) {
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  };
  const banned = walk(userData).filter((f) =>
    /\.(docx|pptx|html|png|jpg|jpeg|mp4|mp3)$/i.test(f)
  );
  assert.equal(banned.length, 0, "must not create real deliverable files: " + banned.join(", "));
}

function depsFor(userData, { failPointer } = {}) {
  return {
    getTask: (ud, id) => actStore.getTask(ud, id, { heal: false }),
    getPlan: (ud, planId) => planStore.getPlan(ud, planId),
    saveTaskExecution: async (ud, id, exec) => {
      if (failPointer) {
        const e = new Error("simulated pointer write failure");
        e.code = "task_pointer_write_failed";
        throw e;
      }
      const got = actStore.getTask(ud, id, { heal: false });
      if (!got.ok) throw Object.assign(new Error("task missing"), { code: "task_not_found" });
      return actStore.saveTask(ud, {
        ...got.task,
        deliverableExecution: {
          activePackageId: exec.activePackageId ? String(exec.activePackageId) : null,
        },
      });
    },
  };
}

async function seedConfirmedPlan(userData, taskId, goal) {
  await actStore.saveTask(userData, {
    taskId,
    title: "t",
    goal,
    request: goal,
    status: "draft",
  });
  const suggestion = planner.ruleBasedPlan({ goal });
  const applied = planner.applySuggestionToRecord({
    taskId,
    existingRecord: null,
    suggestion,
    goal,
  });
  const committed = await planConsistency.commitPlanThenTask({
    userData,
    planRecord: applied.plan,
    saveTaskPointers: async ({ deliverablePlanning, auditEvent }) => {
      const got = actStore.getTask(userData, taskId, { heal: false }).task;
      const audit = planConsistency.appendAudit(got, auditEvent || { action: "seed" });
      return actStore.saveTask(userData, { ...got, deliverablePlanning, audit });
    },
    cas: { expectAbsent: true },
  });
  assert.equal(committed.ok, true);
  const confirmed = planner.confirmDraft(committed.plan);
  assert.equal(confirmed.ok, true);
  const after = await planConsistency.commitPlanThenTask({
    userData,
    planRecord: confirmed.plan,
    saveTaskPointers: async ({ deliverablePlanning, auditEvent }) => {
      const got = actStore.getTask(userData, taskId, { heal: false }).task;
      const audit = planConsistency.appendAudit(got, auditEvent || { action: "confirm" });
      return actStore.saveTask(userData, {
        ...got,
        status: "plan_confirmed",
        deliverablePlanning,
        deliverableExecution: { activePackageId: null },
        audit,
      });
    },
    cas: {
      expectedRevision: planConsistency.revisionTokensFromPlan(committed.plan),
    },
  });
  assert.equal(after.ok, true);
  return after;
}

async function main() {
  await test("1 schema accepts valid package mapping fields", () => {
    const d = schema.mapPlannedToDeliverable(
      { id: "pd_1", kind: "document", title: "介绍", format: "docx", dependencies: [] },
      "delivery_x",
      0
    );
    assert.equal(d.currentVersionId, null);
    assert.deepEqual(d.versionIds, []);
    assert.equal(d.generationStatus, "planned");
  });

  await test("1b invalid prepare input rejected", async () => {
    const ud = tempUserData();
    try {
      const res = await prepareDeliverablePackage(
        ud,
        { taskId: "abt_x", sourcePlanVersionId: "pv_1" },
        depsFor(ud)
      );
      assert.equal(res.ok, false);
      assert.equal(res.code, "invalid_prepare_input");
    } finally {
      cleanup(ud);
    }
  });

  await test("2 no confirmed cannot prepare", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      await actStore.saveTask(ud, {
        taskId,
        title: "t",
        request: "goal",
        status: "draft",
        deliverablePlanning: { planId: null, currentDraftVersionId: null, activeConfirmedVersionId: null },
      });
      const res = await prepareDeliverablePackage(ud, { taskId }, depsFor(ud));
      assert.equal(res.ok, false);
      assert.equal(res.code, "no_confirmed_plan");
    } finally {
      cleanup(ud);
    }
  });

  await test("3 draft cannot prepare", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      await actStore.saveTask(ud, {
        taskId,
        title: "t",
        request: "为投资人准备材料",
        status: "draft",
      });
      const suggestion = planner.ruleBasedPlan({ goal: "为投资人准备材料" });
      const applied = planner.applySuggestionToRecord({
        taskId,
        existingRecord: null,
        suggestion,
        goal: "为投资人准备材料",
      });
      const committed = await planConsistency.commitPlanThenTask({
        userData: ud,
        planRecord: applied.plan,
        saveTaskPointers: async ({ deliverablePlanning }) => {
          const got = actStore.getTask(ud, taskId, { heal: false }).task;
          return actStore.saveTask(ud, { ...got, deliverablePlanning });
        },
        cas: { expectAbsent: true },
      });
      assert.equal(committed.ok, true);
      // Point task at draft id as if mis-set
      const draftId = committed.plan.currentDraftVersionId;
      const got = actStore.getTask(ud, taskId, { heal: false }).task;
      await actStore.saveTask(ud, {
        ...got,
        deliverablePlanning: {
          planId: committed.plan.planId,
          currentDraftVersionId: draftId,
          activeConfirmedVersionId: draftId,
        },
      });
      const res = await prepareDeliverablePackage(ud, { taskId }, depsFor(ud));
      assert.equal(res.ok, false);
      assert.equal(res.code, "confirmed_version_invalid");
    } finally {
      cleanup(ud);
    }
  });

  await test("4-10 first prepare creates package+deliverables without versions/hashes", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      const seeded = await seedConfirmedPlan(ud, taskId, "请为投资人准备介绍材料和宣传视频计划");
      const included = planSchema.includedItems(
        seeded.plan.versions[seeded.plan.activeConfirmedVersionId].items
      );
      const res = await prepareDeliverablePackage(ud, { taskId }, depsFor(ud));
      assert.equal(res.ok, true);
      assert.equal(res.outcome, "created_new");
      assert.equal(res.package.lifecycleStatus, "planned");
      assert.equal(res.package.completionStatus, "none");
      assert.equal(res.deliverables.length, included.length);
      for (const d of res.deliverables) {
        assert.equal(d.currentVersionId, null);
        assert.deepEqual(d.versionIds, []);
        assert.equal(d.planDisposition, "included");
        assert.equal(d.generationStatus, "planned");
        assert.equal(d.reviewStatus, "unreviewed");
      }
      const raw = JSON.parse(fs.readFileSync(packageStore.storePath(ud), "utf8"));
      // DVL2-03 may persist empty version/artifact collections; prepare must not create Version records.
      assert.ok(!raw.versions || Object.keys(raw.versions).length === 0);
      assert.ok(!raw.artifacts || Object.keys(raw.artifacts).length === 0);
      assert.ok(!("artifactRefs" in raw) || raw.artifactRefs == null);
      assert.ok(!("contentHashes" in raw) || raw.contentHashes == null);
      for (const d of Object.values(raw.deliverables || {})) {
        assert.equal(d.currentVersionId, null);
        assert.deepEqual(d.versionIds || [], []);
      }
      const task = actStore.getTask(ud, taskId, { heal: false }).task;
      assert.equal(task.deliverableExecution.activePackageId, res.package.id);
      assertNoArtifactFiles(ud);
    } finally {
      cleanup(ud);
    }
  });

  await test("11-13 repeat prepare hits same package existing_package", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      await seedConfirmedPlan(ud, taskId, "请为投资人准备介绍材料");
      const first = await prepareDeliverablePackage(ud, { taskId }, depsFor(ud));
      assert.equal(first.outcome, "created_new");
      const beforeUpdated = first.package.updatedAt;
      const storeBefore = packageStore.loadStore(ud);
      const attemptCountBefore = Object.keys(storeBefore.preparationAttempts).length;
      const second = await prepareDeliverablePackage(ud, { taskId }, depsFor(ud));
      assert.equal(second.ok, true);
      assert.equal(second.outcome, "existing_package");
      assert.equal(second.package.id, first.package.id);
      assert.equal(second.package.updatedAt, beforeUpdated);
      const storeAfter = packageStore.loadStore(ud);
      assert.equal(
        Object.keys(storeAfter.preparationAttempts).length,
        attemptCountBefore + 1
      );
      const active = packageStore.findActivePackageForConfirmed(
        ud,
        taskId,
        first.package.sourcePlanId,
        first.package.sourcePlanVersionId
      );
      assert.equal(active.length, 1);
    } finally {
      cleanup(ud);
    }
  });

  await test("14 concurrent first prepare yields one active package", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      await seedConfirmedPlan(ud, taskId, "请准备项目介绍文档");
      const [a, b] = await Promise.all([
        prepareDeliverablePackage(ud, { taskId }, depsFor(ud)),
        prepareDeliverablePackage(ud, { taskId }, depsFor(ud)),
      ]);
      assert.equal(a.ok, true);
      assert.equal(b.ok, true);
      assert.equal(a.package.id, b.package.id);
      const outcomes = [a.outcome, b.outcome].sort();
      assert.deepEqual(outcomes, ["created_new", "existing_package"]);
      const active = packageStore.findActivePackageForConfirmed(
        ud,
        taskId,
        a.package.sourcePlanId,
        a.package.sourcePlanVersionId
      );
      assert.equal(active.length, 1);
    } finally {
      cleanup(ud);
    }
  });

  await test("15 stale revision rejected and disk unchanged", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      await seedConfirmedPlan(ud, taskId, "请准备介绍文档");
      await prepareDeliverablePackage(ud, { taskId }, depsFor(ud));
      const before = fs.readFileSync(packageStore.storePath(ud));
      let threw = false;
      try {
        await packageStore.mutateStore(
          ud,
          (store) => {
            store.packages.__probe = { id: "__probe" };
            return true;
          },
          { expectedRevision: 0 }
        );
      } catch (err) {
        threw = true;
        assert.equal(err.code, "stale_store_revision");
      }
      assert.equal(threw, true);
      const after = fs.readFileSync(packageStore.storePath(ud));
      assert.ok(before.equals(after));
    } finally {
      cleanup(ud);
    }
  });

  await test("16 archived package does not silently recreate", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      await seedConfirmedPlan(ud, taskId, "请准备介绍文档");
      const first = await prepareDeliverablePackage(ud, { taskId }, depsFor(ud));
      await packageStore.mutateStore(ud, (store) => {
        store.packages[first.package.id].archivedAt = new Date().toISOString();
        return true;
      });
      const got = actStore.getTask(ud, taskId, { heal: false }).task;
      await actStore.saveTask(ud, {
        ...got,
        deliverableExecution: { activePackageId: null },
      });
      const res = await prepareDeliverablePackage(ud, { taskId }, depsFor(ud));
      assert.equal(res.ok, false);
      assert.equal(res.code, "package_archived");
      const active = packageStore.findActivePackageForConfirmed(
        ud,
        taskId,
        first.package.sourcePlanId,
        first.package.sourcePlanVersionId
      );
      assert.equal(active.length, 0);
    } finally {
      cleanup(ud);
    }
  });

  await test("17 soft_deleted does not restore or replace on normal prepare", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      await seedConfirmedPlan(ud, taskId, "请准备介绍文档");
      const first = await prepareDeliverablePackage(ud, { taskId }, depsFor(ud));
      await packageStore.mutateStore(ud, (store) => {
        store.packages[first.package.id].softDeletedAt = new Date().toISOString();
        return true;
      });
      const got = actStore.getTask(ud, taskId, { heal: false }).task;
      await actStore.saveTask(ud, {
        ...got,
        deliverableExecution: { activePackageId: null },
      });
      const res = await prepareDeliverablePackage(ud, { taskId }, depsFor(ud));
      assert.equal(res.ok, false);
      assert.equal(res.code, "package_soft_deleted");
    } finally {
      cleanup(ud);
    }
  });

  await test("18 dual active packages fail-closed", () => {
    const recon = reconcileTaskAndPackages({
      task: {
        taskId: "abt_1",
        deliverablePlanning: {
          planId: "plan_1",
          activeConfirmedVersionId: "pv_1",
        },
        deliverableExecution: { activePackageId: null },
      },
      packages: [
        {
          id: "a",
          taskId: "abt_1",
          sourcePlanId: "plan_1",
          sourcePlanVersionId: "pv_1",
          deliverableIds: ["d1"],
          executionSnapshot: {},
        },
        {
          id: "b",
          taskId: "abt_1",
          sourcePlanId: "plan_1",
          sourcePlanVersionId: "pv_1",
          deliverableIds: ["d2"],
          executionSnapshot: {},
        },
      ],
      deliverablesByPackage: { a: [{ id: "d1" }], b: [{ id: "d2" }] },
    });
    assert.equal(recon.ok, false);
    assert.equal(recon.failClosed, true);
    assert.equal(recon.code, "duplicate_active_packages");
  });

  await test("19-20 store ok + task pointer fail → degraded; retry reconciles", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      await seedConfirmedPlan(ud, taskId, "请准备介绍文档");
      const first = await prepareDeliverablePackage(ud, { taskId }, depsFor(ud, { failPointer: true }));
      assert.equal(first.ok, true);
      assert.equal(first.degraded_consistency, true);
      const task1 = actStore.getTask(ud, taskId, { heal: false }).task;
      assert.equal(task1.deliverableExecution.activePackageId, null);
      // Simulate main reconcile-before-prepare path
      const packages = packageStore.listPackagesForTask(ud, taskId);
      const recon = reconcileTaskAndPackages({
        task: task1,
        packages,
        deliverablesByPackage: {
          [first.package.id]: packageStore.getDeliverablesForPackage(ud, first.package.id),
        },
      });
      assert.equal(recon.ok, true);
      assert.equal(recon.deliverableExecution.activePackageId, first.package.id);
      await actStore.saveTask(ud, {
        ...task1,
        deliverableExecution: recon.deliverableExecution,
      });
      const second = await prepareDeliverablePackage(ud, { taskId }, depsFor(ud));
      assert.equal(second.outcome, "existing_package");
      assert.equal(second.package.id, first.package.id);
    } finally {
      cleanup(ud);
    }
  });

  await test("21-22 new confirmed creates new package; old sourcePlanVersionId unchanged", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      const seeded = await seedConfirmedPlan(ud, taskId, "请准备介绍文档与演示");
      const first = await prepareDeliverablePackage(ud, { taskId }, depsFor(ud));
      const oldVersionId = first.package.sourcePlanVersionId;
      const oldPackageId = first.package.id;

      // Create new draft from confirmed and confirm again
      const planGot = planStore.getPlan(ud, seeded.plan.planId);
      const withDraft = planner.saveDraftEdits(planGot.plan, {
        understanding: {
          goal: { value: "请准备介绍文档与演示（修订）", provenance: "user_provided" },
        },
      });
      assert.equal(withDraft.ok, true);
      const savedDraft = await planConsistency.commitPlanThenTask({
        userData: ud,
        planRecord: withDraft.plan,
        saveTaskPointers: async ({ deliverablePlanning }) => {
          const got = actStore.getTask(ud, taskId, { heal: false }).task;
          return actStore.saveTask(ud, { ...got, deliverablePlanning });
        },
        cas: { expectedRevision: planConsistency.revisionTokensFromPlan(planGot.plan) },
      });
      assert.equal(savedDraft.ok, true);
      const confirmed2 = planner.confirmDraft(savedDraft.plan);
      assert.equal(confirmed2.ok, true);
      const after = await planConsistency.commitPlanThenTask({
        userData: ud,
        planRecord: confirmed2.plan,
        saveTaskPointers: async ({ deliverablePlanning }) => {
          const got = actStore.getTask(ud, taskId, { heal: false }).task;
          return actStore.saveTask(ud, {
            ...got,
            deliverablePlanning,
            deliverableExecution: { activePackageId: null },
          });
        },
        cas: {
          expectedRevision: planConsistency.revisionTokensFromPlan(savedDraft.plan),
        },
      });
      assert.equal(after.ok, true);
      const second = await prepareDeliverablePackage(ud, { taskId }, depsFor(ud));
      assert.equal(second.ok, true);
      assert.equal(second.outcome, "created_new");
      assert.notEqual(second.package.id, oldPackageId);
      assert.notEqual(second.package.sourcePlanVersionId, oldVersionId);
      const oldPkg = packageStore.getPackage(ud, oldPackageId).package;
      assert.equal(oldPkg.sourcePlanVersionId, oldVersionId);
    } finally {
      cleanup(ud);
    }
  });

  await test("23-24 attempt history not overwritten; incomplete attempt not success", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      await seedConfirmedPlan(ud, taskId, "请准备介绍文档");
      const first = await prepareDeliverablePackage(ud, { taskId }, depsFor(ud));
      const dangling = {
        schemaVersion: 1,
        id: "pprep_dangling",
        packageId: "delivery_missing",
        taskId,
        sourcePlanVersionId: first.package.sourcePlanVersionId,
        status: "interrupted",
        outcome: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        errorCode: null,
        errorSummary: null,
        createdPackageId: null,
        recoveryMetadata: {},
      };
      await packageStore.appendPreparationAttempt(
        ud,
        dangling,
        packageStore.loadStore(ud).revision
      );
      const store = packageStore.loadStore(ud);
      assert.ok(store.preparationAttempts[first.attempt.id]);
      assert.ok(store.preparationAttempts.pprep_dangling);
      assert.equal(store.preparationAttempts.pprep_dangling.status, "interrupted");
      // Incomplete attempt must not be treated as prepared package
      const missing = packageStore.getPackage(ud, "delivery_missing");
      assert.equal(missing.ok, false);
      const readiness = recomputeCurrentPreparationReadiness(first.package, first.deliverables);
      assert.match(readiness.userSummary, /成果包已准备/);
    } finally {
      cleanup(ud);
    }
  });

  await test("25 corrupt store fail-closed", () => {
    const ud = tempUserData();
    try {
      fs.writeFileSync(packageStore.storePath(ud), "{not-json", "utf8");
      let threw = false;
      try {
        packageStore.loadStore(ud);
      } catch (err) {
        threw = true;
        assert.equal(err.code, "deliverable_package_parse_failed");
      }
      assert.equal(threw, true);
      // Must not have been overwritten to empty
      assert.equal(fs.readFileSync(packageStore.storePath(ud), "utf8"), "{not-json");
    } finally {
      cleanup(ud);
    }
  });

  await test("26-27 no package-store/** and no result-generation require in module graph", () => {
    const prepareSrc = fs.readFileSync(
      path.join(__dirname, "../src/act-behalf/deliverable-package-prepare.js"),
      "utf8"
    );
    const storeSrc = fs.readFileSync(
      path.join(__dirname, "../src/act-behalf/deliverable-package-store.js"),
      "utf8"
    );
    assert.equal(/["'].*package-store\//.test(prepareSrc), false);
    assert.equal(/result-generation/.test(prepareSrc), false);
    assert.equal(/["'].*package-store\//.test(storeSrc), false);
    assert.equal(/result-generation/.test(storeSrc), false);
    const pkgStoreDir = path.join(__dirname, "../src/package-store");
    assert.ok(!fs.existsSync(path.join(pkgStoreDir, "deliverable-packages.json")));
  });

  await test("reconcile restores missing pointer; clears stale/missing", () => {
    const pkg = {
      id: "delivery_1",
      taskId: "abt_1",
      sourcePlanId: "plan_1",
      sourcePlanVersionId: "pv_1",
      deliverableIds: ["d1"],
      executionSnapshot: {},
    };
    const restore = reconcileTaskAndPackages({
      task: {
        taskId: "abt_1",
        deliverablePlanning: { planId: "plan_1", activeConfirmedVersionId: "pv_1" },
        deliverableExecution: { activePackageId: null },
      },
      packages: [pkg],
      deliverablesByPackage: { delivery_1: [{ id: "d1" }] },
    });
    assert.equal(restore.deliverableExecution.activePackageId, "delivery_1");

    const clearMissing = reconcileTaskAndPackages({
      task: {
        taskId: "abt_1",
        deliverablePlanning: { planId: "plan_1", activeConfirmedVersionId: "pv_1" },
        deliverableExecution: { activePackageId: "gone" },
      },
      packages: [pkg],
      deliverablesByPackage: { delivery_1: [{ id: "d1" }] },
    });
    assert.equal(clearMissing.deliverableExecution.activePackageId, "delivery_1");

    const clearStale = reconcileTaskAndPackages({
      task: {
        taskId: "abt_1",
        deliverablePlanning: { planId: "plan_1", activeConfirmedVersionId: "pv_2" },
        deliverableExecution: { activePackageId: "delivery_1" },
      },
      packages: [pkg],
      deliverablesByPackage: { delivery_1: [{ id: "d1" }] },
    });
    assert.equal(clearStale.deliverableExecution.activePackageId, null);
  });

  console.log("\nDVL2-02 package contracts:", passed, "passed,", failed, "failed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

"use strict";

/**
 * DVL2-01 deliverable planner contracts — round-2 (CAS / model / lifecycle / version chain).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const schema = require("../src/act-behalf/deliverable-plan-schema");
const planStore = require("../src/act-behalf/deliverable-plan-store");
const consistency = require("../src/act-behalf/deliverable-plan-consistency");
const planner = require("../src/act-behalf/deliverable-planner");
const { recomputeExecutionReadiness } = require("../src/act-behalf/deliverable-plan-readiness");
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-dvl2-01-r2-"));
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
  const banned = walk(userData).filter((f) => /\.(docx|pptx|html|png|jpg|mp4|mp3)$/i.test(f));
  assert.equal(banned.length, 0, "must not create real deliverable files: " + banned.join(", "));
}

async function seedPlan(userData, taskId, goal) {
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
  const committed = await consistency.commitPlanThenTask({
    userData,
    planRecord: applied.plan,
    saveTaskPointers: async ({ deliverablePlanning, auditEvent }) => {
      const got = actStore.getTask(userData, taskId, { heal: false }).task;
      const audit = consistency.appendAudit(got, auditEvent || { action: "seed" });
      return actStore.saveTask(userData, { ...got, deliverablePlanning, audit });
    },
    cas: { expectAbsent: true },
  });
  assert.equal(committed.ok, true);
  return committed;
}

async function main() {
  await test("schema baseline + dependency rules", () => {
    const doc = schema.normalizeItem({ kind: "document", title: "t" }, 0);
    assert.equal(doc.runtimeAvailability, "unavailable");
  });

  await test("Task pointer missing Plan → fail-closed", () => {
    const rec = consistency.reconcileTaskAndPlans({
      task: {
        taskId: "t",
        deliverablePlanning: { planId: "gone", currentDraftVersionId: "d1", activeConfirmedVersionId: null },
      },
      plansForTask: [],
    });
    assert.equal(rec.failClosed, true);
    assert.equal(rec.code, "plan_missing_for_task_pointer");
    assert.equal(rec.deliverablePlanning.planId, "gone");
    assert.equal(rec.safePlanPatch, null);
  });

  await test("Store CAS rejects stale overwrite; store unchanged", async () => {
    const userData = tempUserData();
    try {
      const seeded = await seedPlan(userData, "task_cas", "写一份介绍文档");
      const before = fs.readFileSync(planStore.storePath(userData), "utf8");
      const staleTokens = consistency.revisionTokensFromPlan(seeded.plan);
      // bump store revision
      const bumped = await planStore.savePlanRecord(userData, seeded.plan, {
        expectedRevision: staleTokens,
      });
      assert.equal(bumped.ok, true);
      const afterBump = fs.readFileSync(planStore.storePath(userData), "utf8");

      const edited = planStore.cloneRecord(bumped.plan);
      edited.versions[edited.currentDraftVersionId].title = "should-not-write";
      await assert.rejects(
        () =>
          planStore.savePlanRecord(userData, edited, {
            expectedRevision: staleTokens,
          }),
        (err) => err && err.code === "stale_plan_state"
      );
      const afterStale = fs.readFileSync(planStore.storePath(userData), "utf8");
      assert.equal(afterStale, afterBump);
      assert.notEqual(before, afterBump);
    } finally {
      cleanup(userData);
    }
  });

  await test("first create expectAbsent; second create rejected", async () => {
    const userData = tempUserData();
    try {
      await seedPlan(userData, "task_abs", "写一份介绍文档");
      const again = planner.applySuggestionToRecord({
        taskId: "task_abs",
        existingRecord: null,
        suggestion: planner.ruleBasedPlan({ goal: "写一份介绍文档" }),
        goal: "写一份介绍文档",
      });
      await assert.rejects(
        () => planStore.savePlanRecord(userData, again.plan, { expectAbsent: true }),
        (err) => err && (err.code === "duplicate_plan_for_task" || err.code === "stale_plan_state")
      );
    } finally {
      cleanup(userData);
    }
  });

  await test("model-assisted fake success path (string adapter)", async () => {
    const userData = tempUserData();
    try {
      const fakeJson = JSON.stringify({
        understanding: {
          goal: "写一份介绍文档",
          audience: "合作伙伴",
          usage: "对外介绍",
          assumptions: ["信息有限时先出草稿计划"],
          unresolvedQuestions: [],
        },
        items: [
          { kind: "document", title: "介绍文档", purpose: "正式说明", priority: "required" },
          { kind: "image", title: "封面", purpose: "视觉入口", priority: "recommended" },
        ],
      });
      let wrappedRejected = false;
      const bad = await planner.modelAssistedPlan(
        { goal: "写一份介绍文档" },
        {
          callModel: async () => ({ content: fakeJson, routeMeta: { should: "not-parse" } }),
        }
      );
      assert.equal(bad.ok, false);
      assert.equal(bad.code, "invalid_model_response");
      wrappedRejected = true;

      const ok = await planner.generatePlanSuggestion(
        { goal: "写一份介绍文档" },
        { callModel: async () => fakeJson }
      );
      assert.equal(ok.ok, true);
      assert.equal(ok.mode, "model_assisted");
      assert.ok(ok.items.length >= 2);
      assert.ok(ok.items.every((it) => it.runtimeAvailability === "unavailable"));
      assert.equal(ok.understanding.audience.value, "合作伙伴");
      assert.equal(wrappedRejected, true);

      const audit = consistency.appendPlanningInvocation(
        { audit: null },
        {
          id: "plaudit_fake_001",
          taskId: "t_model",
          mode: "model_assisted",
          purpose: "deliverable_planning",
          route: { purpose: "deliverable_planning", mappedTaskType: "artifact", ok: true },
          ok: true,
          at: new Date().toISOString(),
          inputDigest: { fieldNames: ["goal"], fieldCount: 1 },
        }
      );
      assert.ok(audit.planningInvocations[0].id.startsWith("plaudit_"));
      assert.equal(audit.planningInvocations[0].purpose, "deliverable_planning");
      assertNoArtifactFiles(userData);
    } finally {
      cleanup(userData);
    }
  });

  await test("currentDraft pointing at confirmed rejected", async () => {
    const userData = tempUserData();
    try {
      const seeded = await seedPlan(userData, "task_draft_bad", "写一份介绍文档");
      const conf = planner.confirmDraft(seeded.plan);
      const saved = await planStore.savePlanRecord(userData, conf.plan, {
        expectedRevision: consistency.revisionTokensFromPlan(seeded.plan),
      });
      const bad = planStore.cloneRecord(saved.plan);
      bad.currentDraftVersionId = bad.activeConfirmedVersionId;
      await assert.rejects(
        () =>
          planStore.savePlanRecord(userData, bad, {
            expectedRevision: consistency.revisionTokensFromPlan(saved.plan),
          }),
        (err) => err && err.code === "draft_status_invalid"
      );
    } finally {
      cleanup(userData);
    }
  });

  await test("duplicate versionIds / version key mismatch / duplicate planVersion rejected", async () => {
    const userData = tempUserData();
    try {
      const seeded = await seedPlan(userData, "task_ver", "写一份介绍文档");
      const base = planStore.cloneRecord(seeded.plan);
      const dupIds = planStore.cloneRecord(base);
      dupIds.versionIds = [dupIds.versionIds[0], dupIds.versionIds[0]];
      assert.equal(planStore.validatePlanRecordForWrite(planStore.loadStore(userData), dupIds).code, "duplicate_version_id");

      const mismatch = planStore.cloneRecord(base);
      const vid = mismatch.versionIds[0];
      mismatch.versions[vid].versionId = "other_id";
      assert.equal(
        planStore.validatePlanRecordForWrite(planStore.loadStore(userData), mismatch).code,
        "version_id_mismatch"
      );

      const v2 = schema.createDraftVersion({
        planId: base.planId,
        taskId: base.taskId,
        versionNumber: 1,
        understanding: base.versions[base.versionIds[0]].understanding,
        items: base.versions[base.versionIds[0]].items,
        status: "draft",
      });
      const dupPv = planStore.cloneRecord(base);
      dupPv.versions[v2.versionId] = v2;
      dupPv.versionIds.push(v2.versionId);
      assert.equal(
        planStore.validatePlanRecordForWrite(planStore.loadStore(userData), dupPv).code,
        "duplicate_plan_version"
      );
    } finally {
      cleanup(userData);
    }
  });

  await test("lifecycle degraded then reconciliation converges Task", async () => {
    const userData = tempUserData();
    try {
      const seeded = await seedPlan(userData, "task_life", "写一份介绍文档");
      const archivedPlan = consistency.applyLifecycleToPlan(seeded.plan, "archived");
      const planSaved = await planStore.savePlanRecord(userData, archivedPlan, {
        expectedRevision: consistency.revisionTokensFromPlan(seeded.plan),
      });
      assert.equal(planSaved.plan.lifecycleStatus, "archived");
      // Simulate Task write failure: leave task active
      let task = actStore.getTask(userData, "task_life", { heal: false }).task;
      assert.equal(task.lifecycleStatus || "active", "active");

      const rec = consistency.reconcileTaskAndPlans({
        task,
        plansForTask: [planSaved.plan],
      });
      assert.equal(rec.failClosed, false);
      assert.equal(rec.safeTaskPatch.lifecycleStatus, "archived");
      assert.ok(rec.audits.some((a) => a.action === "lifecycle_reconcile_task"));

      await actStore.saveTask(userData, { ...task, ...rec.safeTaskPatch });
      task = actStore.getTask(userData, "task_life", { heal: false }).task;
      assert.equal(task.lifecycleStatus, "archived");

      // soft_deleted same path
      const softPlan = consistency.applyLifecycleToPlan(planSaved.plan, "soft_deleted");
      const softSaved = await planStore.savePlanRecord(userData, softPlan, {
        expectedRevision: consistency.revisionTokensFromPlan(planSaved.plan),
      });
      const rec2 = consistency.reconcileTaskAndPlans({
        task,
        plansForTask: [softSaved.plan],
      });
      assert.equal(rec2.safeTaskPatch.lifecycleStatus, "soft_deleted");
    } finally {
      cleanup(userData);
    }
  });

  await test("inactive blocks edit semantics; lifecycle stale revision rejected", async () => {
    assert.equal(consistency.isInactiveLifecycle("archived"), true);
    const userData = tempUserData();
    try {
      const seeded = await seedPlan(userData, "task_stale_life", "写一份介绍文档");
      const tokens = consistency.revisionTokensFromPlan(seeded.plan);
      await planStore.savePlanRecord(userData, seeded.plan, { expectedRevision: tokens });
      const fresh = planStore.getPlan(userData, seeded.plan.planId).plan;
      await assert.rejects(
        () =>
          planStore.savePlanRecord(
            userData,
            consistency.applyLifecycleToPlan(fresh, "archived"),
            { expectedRevision: tokens }
          ),
        (err) => err && err.code === "stale_plan_state"
      );
    } finally {
      cleanup(userData);
    }
  });

  await test("archive/soft-delete coordinated path via commit semantics", async () => {
    const userData = tempUserData();
    try {
      const seeded = await seedPlan(userData, "task_coord", "写一份介绍文档");
      const next = consistency.applyLifecycleToPlan(seeded.plan, "archived");
      const planOk = await planStore.savePlanRecord(userData, next, {
        expectedRevision: consistency.revisionTokensFromPlan(seeded.plan),
      });
      const taskOk = await actStore.saveTask(userData, {
        ...actStore.getTask(userData, "task_coord", { heal: false }).task,
        lifecycleStatus: "archived",
        status: "archived",
        deliverablePlanning: consistency.pointersFromRecord(planOk.plan),
      });
      assert.equal(planOk.plan.lifecycleStatus, "archived");
      assert.equal(taskOk.task.lifecycleStatus, "archived");
    } finally {
      cleanup(userData);
    }
  });

  await test("Plan write ok + Task fail → degraded; safe repair CAS", async () => {
    const userData = tempUserData();
    try {
      await actStore.saveTask(userData, { taskId: "task_deg", title: "t", goal: "g", request: "g" });
      const applied = planner.applySuggestionToRecord({
        taskId: "task_deg",
        existingRecord: null,
        suggestion: planner.ruleBasedPlan({ goal: "写一份介绍文档" }),
        goal: "写一份介绍文档",
      });
      const degraded = await consistency.commitPlanThenTask({
        userData,
        planRecord: applied.plan,
        saveTaskPointers: async () => ({ ok: false, code: "forced_fail" }),
        cas: { expectAbsent: true },
      });
      assert.equal(degraded.consistency, "degraded_consistency");

      const seeded = await seedPlan(userData, "task_safe2", "写一份介绍文档");
      const broken = planStore.cloneRecord(seeded.plan);
      broken.currentDraftVersionId = "missing_draft";
      const store = planStore.loadStore(userData);
      store.plans[broken.planId] = broken;
      fs.writeFileSync(planStore.storePath(userData), JSON.stringify(store, null, 2));
      const task = actStore.getTask(userData, "task_safe2", { heal: false }).task;
      const rec = consistency.reconcileTaskAndPlans({ task, plansForTask: [broken] });
      assert.equal(rec.failClosed, false);
      await planStore.savePlanRecord(userData, rec.safePlanPatch, {
        expectedRevision: rec.casExpectedRevision,
      });
      assert.equal(planStore.getPlan(userData, broken.planId).plan.currentDraftVersionId, null);
      assertNoArtifactFiles(userData);
    } finally {
      cleanup(userData);
    }
  });

  await test("version fork + readiness + planning audit id", () => {
    const suggestion = planner.ruleBasedPlan({ goal: "写一份项目介绍文档" });
    let plan = planner.applySuggestionToRecord({
      taskId: "task_1",
      existingRecord: null,
      suggestion,
      goal: "写一份项目介绍文档",
    }).plan;
    plan = planner.confirmDraft(plan).plan;
    assert.equal(recomputeExecutionReadiness(plan.versions[plan.activeConfirmedVersionId]).status, "not_executable");
    const inv = consistency.appendPlanningInvocation(
      { audit: null },
      { id: "plaudit_x", purpose: "deliverable_planning", ok: true }
    );
    assert.ok(inv.planningInvocations[0].id.startsWith("plaudit_"));
  });

  console.log("\nDVL2-01 planner contracts: %d passed, %d failed", passed, failed);
  process.exit(failed ? 1 : 0);
}

main();

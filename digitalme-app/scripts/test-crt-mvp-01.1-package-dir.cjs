"use strict";

/**
 * CRT-MVP-01.1: confirmPlanAndGenerate must forward packageDir to Assembler.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const actStore = require("../src/act-behalf/task-store");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const planner = require("../src/act-behalf/deliverable-planner");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const { confirmPlanAndGenerate } = require("../src/act-behalf/deliverable-confirm-and-generate");
const deliverablePlanStore = require("../src/act-behalf/deliverable-plan-store");
const { createMinimalFixture } = require("../src/package-store/fixture");
const distillMe = require("../src/distill-me");

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

function tempDir(p) {
  return fs.mkdtempSync(path.join(os.tmpdir(), p));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function deps(ud) {
  return {
    getTask: (u, id) => actStore.getTask(u, id, { heal: false }),
    getPlan: (u, planId) => deliverablePlanStore.getPlan(u, planId),
    saveTaskExecution: async (u, id, exec) => {
      const got = actStore.getTask(u, id, { heal: false });
      return actStore.saveTask(u, {
        ...got.task,
        deliverableExecution: { activePackageId: exec.activePackageId || null },
      });
    },
  };
}

async function seedDraft(userData, taskId, goal) {
  await actStore.saveTask(userData, {
    taskId,
    title: "crt-pkgdir",
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
      purpose: "packageDir 回归",
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
  return committed.plan;
}

function seedSubjectPackage(packageDir, token) {
  createMinimalFixture(packageDir);
  const data = distillMe.read(packageDir);
  data.items = [
    {
      id: "distill_pkgdir_1",
      category: "identity",
      statement: `本人项目标识：${token}。Digital Me 主体上下文回归。`,
      status: "confirmed",
      confidence: "high",
      sourceRefs: ["crt_mvp_011"],
      evidenceRefs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      version: 1,
    },
  ];
  fs.mkdirSync(path.join(packageDir, "life"), { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "life", "distill-me-identity-facts.json"),
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function orchestrationCtx(userData, taskId, plan, { packageDir } = {}) {
  return {
    userData,
    taskId,
    packageDir: packageDir === undefined ? null : packageDir,
    revisionExpected: planConsistency.revisionTokensFromPlan(plan),
    loadPlanForTaskOrFail: async (ud, id) => {
      const task = actStore.getTask(ud, id, { heal: false });
      if (!task.ok || !task.task) return { ok: false, code: "task_not_found" };
      const planId =
        (task.task.deliverablePlanning && task.task.deliverablePlanning.planId) || null;
      if (!planId) return { ok: true, plan: null };
      const got = deliverablePlanStore.getPlan(ud, planId);
      return { ok: true, plan: got.plan || null };
    },
    assertFreshPlan: async (ud, planId, expected) => {
      const got = deliverablePlanStore.getPlan(ud, planId);
      if (!got.ok || !got.plan) return { ok: false, code: "plan_not_found" };
      const match = planConsistency.assertRevisionMatch(got.plan, expected);
      if (!match.ok) return match;
      return { ok: true, plan: got.plan };
    },
    extractRevisionExpected: (payload) => {
      if (!payload || typeof payload !== "object") return null;
      if (
        payload.expectedPlanUpdatedAt != null ||
        payload.expectedCurrentDraftVersionId != null ||
        payload.expectedActiveConfirmedVersionId != null
      ) {
        return {
          expectedPlanUpdatedAt: payload.expectedPlanUpdatedAt ?? null,
          expectedCurrentDraftVersionId: payload.expectedCurrentDraftVersionId ?? null,
          expectedActiveConfirmedVersionId: payload.expectedActiveConfirmedVersionId ?? null,
        };
      }
      return null;
    },
    saveTaskPlanPointers: async (ud, id, { deliverablePlanning, extraPatch }) => {
      const got = actStore.getTask(ud, id, { heal: false }).task;
      return actStore.saveTask(ud, {
        ...got,
        deliverablePlanning,
        ...(extraPatch || {}),
      });
    },
    buildDeliverablePlanView: (planRecord, task) => ({
      ok: true,
      version:
        planRecord &&
        planRecord.versions[
          planRecord.currentDraftVersionId || planRecord.activeConfirmedVersionId
        ],
      deliverablePlanning: task && task.deliverablePlanning,
      revision: planConsistency.revisionTokensFromPlan(planRecord),
      taskId,
    }),
    getTask: (ud, id) => actStore.getTask(ud, id, { heal: false }),
    getPlan: (ud, planId) => deliverablePlanStore.getPlan(ud, planId),
    saveTaskExecution: deps(userData).saveTaskExecution,
    reconcilePackagesForTask: async () => ({ ok: true }),
    callModel: null,
    imageMode: "mock",
  };
}

function latestProvenance(userData, packageId) {
  const view = packageStore.getPackageView(userData, packageId);
  const del = (view.deliverables || []).find((d) => d.kind === "document");
  assert.ok(del && del.currentVersionId, "missing generated version");
  return view.versions[del.currentVersionId].provenance;
}

async function main() {
  const TOKEN = "UNIQUE_PKGDIR_SUBJECT_C7";

  await test("a) confirmPlanAndGenerate with packageDir → not no_package", async () => {
    const ud = tempDir("crt-011-yes-");
    const pkgDir = tempDir("crt-011-pkg-");
    try {
      seedSubjectPackage(pkgDir, TOKEN);
      const taskId = "t_with_pkg";
      const goal = "为 Digital Me 写介绍文档 " + TOKEN;
      const plan = await seedDraft(ud, taskId, goal);
      const res = await confirmPlanAndGenerate(
        orchestrationCtx(ud, taskId, plan, { packageDir: pkgDir })
      );
      assert.equal(res.ok, true, res.message || res.code);
      assert.ok(res.packageId);
      const prov = latestProvenance(ud, res.packageId);
      assert.ok(prov.subjectContextSnapshotId, "expected assembly snapshot id");
      assert.ok(prov.assembly && prov.assembly.assemblyId);
      assert.notEqual(prov.assembly.emptyReason, "no_package");
      assert.equal(prov.assembly.emptyReason, null);
      assert.ok(Array.isArray(prov.subjectRefs) && prov.subjectRefs.length >= 1);
      assert.ok(prov.subjectRefs.some((r) => r.layer === "identity" && r.included));
      console.log(
        "PROVENANCE_EXAMPLE",
        JSON.stringify(
          {
            subjectContextSnapshotId: prov.subjectContextSnapshotId,
            subjectRefs: prov.subjectRefs,
            memoryRefs: prov.memoryRefs,
            assembly: prov.assembly,
          },
          null,
          2
        )
      );
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("b) confirmPlanAndGenerate without packageDir → emptyReason no_package", async () => {
    const ud = tempDir("crt-011-no-");
    try {
      const taskId = "t_no_pkg";
      const plan = await seedDraft(ud, taskId, "写一篇介绍");
      const res = await confirmPlanAndGenerate(
        orchestrationCtx(ud, taskId, plan, { packageDir: null })
      );
      assert.equal(res.ok, true, res.message || res.code);
      const prov = latestProvenance(ud, res.packageId);
      assert.ok(prov.subjectContextSnapshotId);
      assert.equal(prov.assembly.emptyReason, "no_package");
      assert.deepEqual(prov.subjectRefs || [], []);
      assert.deepEqual(prov.memoryRefs || [], []);
    } finally {
      cleanup(ud);
    }
  });

  // Source-level guard: one-click path must forward packageDir literal.
  await test("c) confirm-and-generate source forwards packageDir", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "act-behalf", "deliverable-confirm-and-generate.js"),
      "utf8"
    );
    assert.match(src, /packageDir:\s*packageDir\s*\|\|\s*null/);
    assert.match(src, /const\s*\{[^}]*packageDir/s);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

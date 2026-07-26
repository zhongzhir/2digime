"use strict";

/**
 * One-click confirmPlanAndGenerate + UI banned-string checks.
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
const { confirmPlanAndGenerate } = require("../src/act-behalf/deliverable-confirm-and-generate");
const deliverablePlanStore = require("../src/act-behalf/deliverable-plan-store");
const artifactFs = require("../src/act-behalf/deliverable-artifact-fs");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-dvl2-oneclick-"));
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

async function seedDraftOnly(userData, taskId) {
  const goal = "请为项目准备介绍文档。";
  await actStore.saveTask(userData, {
    taskId,
    title: "t",
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
      purpose: "测试",
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

async function seedConfirmed(userData, taskId) {
  const plan = await seedDraftOnly(userData, taskId);
  const confirmed = planner.confirmDraft(plan);
  assert.equal(confirmed.ok, true);
  const after = await planConsistency.commitPlanThenTask({
    userData,
    planRecord: confirmed.plan,
    saveTaskPointers: async ({ deliverablePlanning }) => {
      const got = actStore.getTask(userData, taskId, { heal: false }).task;
      return actStore.saveTask(userData, {
        ...got,
        deliverablePlanning,
        status: "plan_confirmed",
        deliverableExecution: { activePackageId: null },
      });
    },
    cas: { expectedRevision: planConsistency.revisionTokensFromPlan(plan) },
  });
  assert.equal(after.ok, true);
  return after.plan;
}

function orchestrationCtx(userData, taskId, plan) {
  return {
    userData,
    taskId,
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

async function main() {
  await test("1) draft-only: one click confirms + creates package + generates", async () => {
    const ud = tempUserData();
    try {
      const taskId = "t_draft";
      const plan = await seedDraftOnly(ud, taskId);
      assert.ok(plan.currentDraftVersionId);
      assert.ok(!plan.activeConfirmedVersionId);

      const res = await confirmPlanAndGenerate(orchestrationCtx(ud, taskId, plan));
      assert.equal(res.ok, true, res.message || res.code);
      assert.ok(res.packageId);
      assert.equal(res.prepareOutcome, "created_new");
      const included = (res.deliverables || []).filter((d) => d.planDisposition === "included");
      assert.ok(included.length >= 1);
      assert.ok(included.some((d) => d.generationStatus === "ready" || d.currentVersionId));

      const reloaded = deliverablePlanStore.getPlan(
        ud,
        actStore.getTask(ud, taskId, { heal: false }).task.deliverablePlanning.planId
      );
      assert.ok(reloaded.plan.activeConfirmedVersionId);
      assert.equal(reloaded.plan.currentDraftVersionId, null);
    } finally {
      cleanup(ud);
    }
  });

  await test("2) confirmed without package: one click creates package + generates", async () => {
    const ud = tempUserData();
    try {
      const taskId = "t_confirmed";
      const plan = await seedConfirmed(ud, taskId);
      const listBefore = packageStore.listPackagesForTask(ud, taskId);
      assert.equal(listBefore.length, 0);

      const res = await confirmPlanAndGenerate(orchestrationCtx(ud, taskId, plan));
      assert.equal(res.ok, true, res.message || res.code);
      assert.equal(res.prepareOutcome, "created_new");
      assert.ok(res.packageId);
      const included = (res.deliverables || []).filter((d) => d.planDisposition === "included");
      assert.ok(included.some((d) => d.generationStatus === "ready" || d.currentVersionId));
    } finally {
      cleanup(ud);
    }
  });

  await test("3) existing package: one click generates without duplicate package", async () => {
    const ud = tempUserData();
    try {
      const taskId = "t_pkg";
      const plan = await seedConfirmed(ud, taskId);
      const prep = await prepareDeliverablePackage(ud, { taskId }, deps(ud));
      assert.equal(prep.ok, true);
      const packageId = prep.package.id;

      const res = await confirmPlanAndGenerate(orchestrationCtx(ud, taskId, plan));
      assert.equal(res.ok, true, res.message || res.code);
      assert.equal(res.prepareOutcome, "existing_package");
      assert.equal(res.packageId, packageId);
      const list = packageStore.listPackagesForTask(ud, taskId);
      assert.equal(list.length, 1);
    } finally {
      cleanup(ud);
    }
  });

  await test("4+5) UI ordinary mode has no banned prep/confirm strings", async () => {
    const root = path.join(__dirname, "..", "src", "renderer");
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const plannerUi = fs.readFileSync(path.join(root, "deliverable-planner.js"), "utf8");
    const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
    const joined = html + "\n" + plannerUi + "\n" + app;

    // Strip legacy/compat comments and advanced blocks for ordinary-path check:
    // only assert against default primary UI markup and planner labels.
    const banned = [
      "确认成果计划",
      "准备成果包",
      "查看成果包准备",
      "成果包已准备",
      "生成此项",
    ];
    for (const phrase of banned) {
      assert.equal(
        html.includes(`>${phrase}<`) || html.includes(`">${phrase}<`),
        false,
        "index.html must not expose button/label: " + phrase
      );
      assert.equal(
        plannerUi.includes(`"${phrase}"`) ||
          plannerUi.includes(`'${phrase}'`) ||
          plannerUi.includes(`>${phrase}<`),
        false,
        "deliverable-planner.js must not render: " + phrase
      );
    }
    assert.ok(html.includes('id="btn-act-generate-from-plan"'));
    assert.ok(html.includes(">生成成果<"));
    assert.equal(html.includes('id="btn-act-prepare-package"'), false);
    assert.equal(html.includes('id="btn-act-plan-confirm"'), false);
    assert.equal(joined.includes("当前尚无法生成真实文件"), false);
  });

  await test("6) one click still produces real files", async () => {
    const ud = tempUserData();
    try {
      const taskId = "t_files";
      const plan = await seedDraftOnly(ud, taskId);
      const res = await confirmPlanAndGenerate(orchestrationCtx(ud, taskId, plan));
      assert.equal(res.ok, true, res.message || res.code);
      const versions = Object.values(res.versions || {});
      assert.ok(versions.length >= 1, "expected versions");
      let foundFile = false;
      for (const ver of versions) {
        const ref = ver && (ver.artifactRef || (ver.artifactRefs && ver.artifactRefs[0]));
        if (!ref || !ref.relativePath) continue;
        const abs = artifactFs.resolveAbsolute(ud, ref.relativePath);
        assert.equal(fs.existsSync(abs), true, abs);
        foundFile = true;
      }
      assert.equal(foundFile, true);
    } finally {
      cleanup(ud);
    }
  });

  await test("7) restart restores results without prep flow", async () => {
    const ud = tempUserData();
    try {
      const taskId = "t_restart";
      const plan = await seedDraftOnly(ud, taskId);
      const res = await confirmPlanAndGenerate(orchestrationCtx(ud, taskId, plan));
      assert.equal(res.ok, true);
      const packageId = res.packageId;

      // Simulate restart: reload stores
      const view = packageStore.getPackageView(ud, packageId);
      assert.equal(view.ok, true);
      assert.ok(view.package);
      const ready = (view.deliverables || []).filter(
        (d) => d.generationStatus === "ready" || d.currentVersionId
      );
      assert.ok(ready.length >= 1);

      // Prep buttons are gone from HTML; generate button remains the only primary.
      const html = fs.readFileSync(
        path.join(__dirname, "..", "src", "renderer", "index.html"),
        "utf8"
      );
      assert.equal(html.includes("准备成果包"), false);
      assert.ok(html.includes("生成成果"));
    } finally {
      cleanup(ud);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

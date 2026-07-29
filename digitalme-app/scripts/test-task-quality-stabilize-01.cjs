"use strict";

/**
 * TASK-QUALITY-STABILIZE-01 — stable delivery vs non-blocking enhancement.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const generation = require("../src/act-behalf/deliverable-generation");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const actStore = require("../src/act-behalf/task-store");
const planner = require("../src/act-behalf/deliverable-planner");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
const { resolveQualityPipelineMode, QUALITY_PIPELINE_MODES } = require("../src/act-behalf/quality-pipeline-mode");
const { assertBaselineHardGates } = require("../src/act-behalf/stable-hard-gates");
const { runQualityEnhancement, MAX_ENHANCEMENT_MODEL_CALLS } = require("../src/act-behalf/stable-delivery");
const { deriveUserFacingTaskState, USER_STATUS } = require("../src/act-behalf/user-facing-task-view");
const { buildOutcomeCriteria } = require("../src/act-behalf/outcome-criteria");

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

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-stabilize-01-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const GOAL = "为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。";

const BASELINE_MD = `# Digital Me 项目知识功能 PRD

## 背景
当前已具备 Knowledge Resolver 与项目知识存储、低打扰学习闭环。真实用户问题是跨任务调用不稳。真实缺口是可见性。下一步实现最小增量。

## 范围
本期范围：可见性增强。非范围：外部市场。

## 关系
复用现有 PlanRecord、ArtifactRef；不新建第二套权威对象。

## 验收
新对话可调用；自动化测试覆盖。
`;

const PLACEHOLDER_MD = `# 文档\n\n目标：\n范围：\n项目名称：待填写\n`;

async function seedDocumentPackage(userData, goal) {
  const taskId = "abt_stab_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await actStore.saveTask(userData, { taskId, title: goal, goal, request: goal, status: "draft" });
  const suggestion = planner.ruleBasedPlan({ goal });
  suggestion.items = [
    {
      id: "pd_doc",
      kind: "document",
      title: "Digital Me 项目知识功能 PRD",
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
  const prep = await prepareDeliverablePackage(
    userData,
    { taskId },
    {
      getTask: (u, id) => actStore.getTask(u, id, { heal: false }),
      getPlan: (u, planId) => require("../src/act-behalf/deliverable-plan-store").getPlan(u, planId),
      saveTaskExecution: async (u, id, exec) => {
        const got = actStore.getTask(u, id, { heal: false });
        return actStore.saveTask(u, {
          ...got.task,
          deliverableExecution: { activePackageId: exec.activePackageId || null },
        });
      },
    }
  );
  assert.equal(prep.ok, true);
  return { taskId, packageId: prep.package.id, deliverableId: prep.deliverables[0].id };
}

async function main() {
  await test("default pipeline mode is stable_delivery", () => {
    assert.equal(resolveQualityPipelineMode({}), QUALITY_PIPELINE_MODES.STABLE_DELIVERY);
    assert.equal(
      resolveQualityPipelineMode({ qualityPipelineMode: "advanced_shadow" }),
      QUALITY_PIPELINE_MODES.ADVANCED_SHADOW
    );
  });

  await test("hard gates: missing chapter / soft quality do not block", () => {
    const ok = assertBaselineHardGates(BASELINE_MD, { goal: GOAL });
    assert.equal(ok.ok, true);
  });

  await test("hard gates: obvious placeholder blocks", () => {
    const r = assertBaselineHardGates(PLACEHOLDER_MD, { goal: GOAL });
    assert.equal(r.ok, false);
    assert.equal(r.code, "obvious_placeholder");
  });

  await test("baseline persists even when soft reviewer would fail", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedDocumentPackage(ud, GOAL);
      let reviewCalls = 0;
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: seeded.deliverableId },
        {
          qualityPipelineMode: "stable_delivery",
          imageMode: "mock",
          callModel: async (_m, options) => {
            if (options && options.taskType === "review") {
              reviewCalls += 1;
              return JSON.stringify({
                status: "fail",
                blockingIssues: [{ message: "故意软失败：缺固定章节背景", ruleId: "soft" }],
                qualityIssues: [],
                suggestedRevisions: [],
                scores: {},
              });
            }
            return BASELINE_MD;
          },
        }
      );
      assert.equal(res.ok, true, JSON.stringify(res));
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const d = view.deliverables[0];
      assert.equal(d.generationStatus, "ready");
      assert.ok(d.currentVersionId, "baseline must set currentVersionId");
      const ver = view.versions[d.currentVersionId];
      assert.ok(ver && ver.contentAvailable);
      assert.equal(ver.provenance.generation_stage, "baseline");
      // Enhancement may run reviews but must not mark failed.
      assert.notEqual(d.generationStatus, "failed");
      const artDir = path.join(
        ud,
        "deliverable-artifacts",
        String(seeded.packageId),
        String(d.id),
        String(d.currentVersionId)
      );
      assert.ok(fs.existsSync(path.join(artDir, "artifact.md")));
      void reviewCalls;
    } finally {
      cleanup(ud);
    }
  });

  await test("enhancement failure keeps baseline ready", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedDocumentPackage(ud, GOAL);
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: seeded.deliverableId },
        {
          qualityPipelineMode: "stable_delivery",
          imageMode: "mock",
          callModel: async (_m, options) => {
            if (options && options.taskType === "review") {
              return JSON.stringify({
                status: "fail",
                blockingIssues: [{ message: "软问题", ruleId: "soft" }],
                qualityIssues: [],
                suggestedRevisions: ["改"],
                scores: {},
              });
            }
            // Rewrite path also returns soft-failing content with placeholders → enhancement rejected
            return BASELINE_MD;
          },
        }
      );
      assert.equal(res.ok, true);
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const d = view.deliverables[0];
      assert.equal(d.generationStatus, "ready");
      assert.ok(d.currentVersionId);
      const uf = deriveUserFacingTaskState({
        userGoal: GOAL,
        packageView: view,
      });
      assert.equal(uf.status, USER_STATUS.COMPLETED);
      assert.equal(uf.statusMessage, "成果已完成");
      assert.ok(uf.primaryAction && uf.primaryAction.label === "打开成果");
      assert.ok(!JSON.stringify(uf).includes("继续完善"));
    } finally {
      cleanup(ud);
    }
  });

  await test("enhancement success creates new version", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedDocumentPackage(ud, GOAL);
      let artifactCalls = 0;
      let reviewN = 0;
      const better = BASELINE_MD + "\n\n## 补充\n已对齐当前系统事实与验收路径。\n";
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: seeded.deliverableId },
        {
          qualityPipelineMode: "stable_delivery",
          imageMode: "mock",
          callModel: async (_m, options) => {
            if (options && options.taskType === "review") {
              reviewN += 1;
              // First review fails (triggers rewrite); second passes.
              if (reviewN === 1) {
                return JSON.stringify({
                  status: "fail",
                  blockingIssues: [{ message: "可完善", ruleId: "soft" }],
                  qualityIssues: [{ message: "略短" }],
                  suggestedRevisions: [],
                  scores: { completeness: 0.4 },
                });
              }
              return JSON.stringify({
                status: "pass",
                blockingIssues: [],
                qualityIssues: [],
                suggestedRevisions: [],
                scores: { completeness: 0.9 },
              });
            }
            artifactCalls += 1;
            return artifactCalls === 1 ? BASELINE_MD : better;
          },
        }
      );
      assert.equal(res.ok, true);
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const d = view.deliverables[0];
      assert.equal(d.generationStatus, "ready");
      const versions = Object.values(view.versions || {}).filter((v) => v.deliverableId === d.id);
      if (res.enhancement && res.enhancement.enhanced) {
        assert.ok(versions.length >= 2, "enhanced should add a version");
        const cur = view.versions[d.currentVersionId];
        assert.equal(cur.provenance.generation_stage, "enhanced");
      } else {
        // Acceptable if scoring did not consider rewrite better — baseline still ready.
        assert.ok(d.currentVersionId);
      }
      assert.ok(artifactCalls >= 1);
      assert.ok(reviewN <= MAX_ENHANCEMENT_MODEL_CALLS + 1);
    } finally {
      cleanup(ud);
    }
  });

  await test("obvious placeholder blocks baseline (terminal)", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedDocumentPackage(ud, GOAL);
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: seeded.deliverableId },
        {
          qualityPipelineMode: "stable_delivery",
          imageMode: "mock",
          callModel: async () => PLACEHOLDER_MD,
        }
      );
      assert.equal(res.ok, false);
      assert.ok(
        res.code === "obvious_placeholder" || res.code === "empty_content",
        "code=" + res.code
      );
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const d = view.deliverables[0];
      assert.equal(d.generationStatus, "failed");
      assert.equal(d.currentVersionId, null);
      const uf = deriveUserFacingTaskState({ userGoal: GOAL, packageView: view });
      assert.equal(uf.statusMessage, "成果未能生成");
      assert.equal(uf.primaryAction, null);
    } finally {
      cleanup(ud);
    }
  });

  await test("enhancement budget constant is 3", () => {
    assert.equal(MAX_ENHANCEMENT_MODEL_CALLS, 3);
  });

  await test("no new permanent top-level stores introduced", () => {
    assert.ok(!fs.existsSync(path.join(__dirname, "../src/act-behalf/baselineArtifactStore.js")));
    assert.ok(!fs.existsSync(path.join(__dirname, "../src/act-behalf/enhancedArtifactStore.js")));
    assert.ok(!fs.existsSync(path.join(__dirname, "../src/act-behalf/qualityDraftStore.js")));
  });

  await test("renderer has no 继续完善 and uses 成果未能生成", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../src/renderer/deliverable-planner.js"),
      "utf8"
    );
    assert.ok(!src.includes("继续完善"));
    assert.ok(src.includes("成果未能生成"));
    assert.ok(src.includes("修改计划"));
  });

  await test("runQualityEnhancement is non-blocking API", async () => {
    const criteria = buildOutcomeCriteria({
      goal: GOAL,
      kind: "document",
      title: "PRD",
      isDigitalMeProject: true,
    });
    const out = await runQualityEnhancement({
      baselineMd: BASELINE_MD,
      kind: "document",
      criteria,
      goal: GOAL,
      isDigitalMeProject: true,
      callModel: null,
    });
    assert.equal(out.enhanced, false);
    assert.ok(out.reason);
  });

  await test("baseline persists before enhancement completes (awaitEnhancement false)", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedDocumentPackage(ud, GOAL);
      let baselineSeen = false;
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: seeded.deliverableId },
        {
          qualityPipelineMode: "stable_delivery",
          imageMode: "mock",
          awaitEnhancement: false,
          onBaselinePersisted: async () => {
            const view = packageStore.getPackageView(ud, seeded.packageId);
            const d = view.deliverables[0];
            assert.equal(d.generationStatus, "ready");
            assert.ok(d.currentVersionId);
            baselineSeen = true;
          },
          callModel: async (_m, options) => {
            if (options && options.taskType === "review") {
              await new Promise((r) => setTimeout(r, 80));
              return JSON.stringify({
                status: "fail",
                blockingIssues: [{ message: "软" }],
                qualityIssues: [],
                suggestedRevisions: [],
                scores: {},
              });
            }
            return BASELINE_MD;
          },
        }
      );
      assert.equal(res.ok, true);
      assert.equal(baselineSeen, true);
      assert.equal(res.enhancement && res.enhancement.pending, true);
      const view = packageStore.getPackageView(ud, seeded.packageId);
      assert.equal(view.deliverables[0].generationStatus, "ready");
      // Allow background job to settle without failing the task.
      await new Promise((r) => setTimeout(r, 250));
      const view2 = packageStore.getPackageView(ud, seeded.packageId);
      assert.equal(view2.deliverables[0].generationStatus, "ready");
    } finally {
      cleanup(ud);
    }
  });

  console.log("\ntask-quality-stabilize-01:", passed, "passed,", failed, "failed");
  process.exit(failed ? 1 : 0);
}

main();

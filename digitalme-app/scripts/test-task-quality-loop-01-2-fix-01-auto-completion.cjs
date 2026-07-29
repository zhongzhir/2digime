"use strict";

/**
 * TASK-QUALITY-LOOP-01.2-FIX-01 — auto-completion + single task view.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
void crypto;

const generation = require("../src/act-behalf/deliverable-generation");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const actStore = require("../src/act-behalf/task-store");
const planner = require("../src/act-behalf/deliverable-planner");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
const { buildOutcomeCriteria } = require("../src/act-behalf/outcome-criteria");
const {
  deriveUserFacingTaskState,
  USER_STATUS,
} = require("../src/act-behalf/user-facing-task-view");
const { RECOVERY_ACTIONS } = require("../src/act-behalf/attempt-recovery");
const { generateByKindWithRepair } = require("../src/act-behalf/deliverable-generators");

const FIXTURE = path.join(
  __dirname,
  "fixtures/task-quality-loop-01-2-fix-01/owner-runtime-attempt.json"
);

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
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-tql012-fix01-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const CONFLICT_DRAFT = `# Digital Me 项目知识功能 PRD

## 背景
当前已具备 Knowledge Resolver。真实用户问题是跨任务调用不稳。真实缺口是可见性。本期范围做最小增量。非范围：外部市场。

## 方案
以区块链为主底座重建项目知识，并配置 6-8 人团队与 300-500 万预算，第 15 个月完成。

## 验收
新对话可调用；自动化测试覆盖。
复用现有 PlanRecord、ArtifactRef；不新建第二套。
`;

const GOOD_DRAFT = `# Digital Me 项目知识功能 PRD

## 背景
Digital Me 已具备项目知识存储、统一知识解析（Knowledge Resolver）与低打扰学习闭环（低风险自动采纳 / 修正替代 supersede），项目知识可跨对话与做事任务调用。真实用户问题是跨任务调用不够稳。真实缺口是可见性增强与误学纠正入口。本 PRD 约束下一步实现，不新建第二套项目知识存储。

## 范围
本期范围：可见性与纠正入口。非范围：外部市场与结算、视频音频生成。

## 关系
复用现有 ProjectKnowledgeClaim、PlanRecord、ArtifactRef；按权威等级注入；沿用现有权威存储；不新建第二套。

## 验收标准
新对话与新任务可调用已记录知识；被 supersede 的旧知识停止生效；再次生成使用新说法；自动化测试覆盖记录、调用与修正路径。
`;

async function seedDocumentPackage(userData, goal) {
  const taskId = "abt_fix01_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await actStore.saveTask(userData, {
    taskId,
    title: goal,
    goal,
    request: goal,
    status: "draft",
  });
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
  assert.equal(confirmed.ok, true);
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
  return { taskId, packageId: prep.package.id, deliverableId: prep.deliverables[0].id, goal };
}

async function main() {
  await test("owner runtime fixture reproduces unrepaired authority conflict shape", () => {
    const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
    assert.equal(fx.attempt.errorCode, "project_authority_conflict");
    assert.equal(fx.attempt.modelCallCount, 1);
    assert.deepEqual(fx.attempt.recoveryActions || [], []);
    assert.equal(fx.diagnosis.semanticBlocksWired, false);
    assert.ok(fx.diagnosis.terminalReason.includes("isRepairable"));
  });

  await test("ordinary terminal failure projection has no 继续完善", () => {
    const view = deriveUserFacingTaskState({
      userGoal: "为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。",
      deliverable: {
        id: "d1",
        title: "Digital Me 项目知识功能 PRD",
        planDisposition: "included",
        generationStatus: "failed",
        latestGenerationAttemptId: "a1",
      },
      packageView: {
        deliverables: [
          {
            id: "d1",
            title: "Digital Me 项目知识功能 PRD",
            planDisposition: "included",
            generationStatus: "failed",
            latestGenerationAttemptId: "a1",
          },
        ],
        generationAttempts: {
          a1: {
            status: "failed",
            errorCode: "project_authority_conflict",
            errorSummary: "项目权威一致性检查未通过",
            recoveryActions: [
              { action: RECOVERY_ACTIONS.LOCAL_REPAIR },
              { action: RECOVERY_ACTIONS.CLEAN_REGENERATION },
            ],
          },
        },
        versions: {},
      },
    });
    assert.equal(view.status, USER_STATUS.FAILED);
    assert.equal(view.statusMessage, "成果未能生成");
    assert.equal(view.primaryAction, null);
    assert.equal(view.secondaryAction && view.secondaryAction.label, "查看原因");
    assert.equal(view.title, "Digital Me 项目知识功能 PRD");
    assert.ok(!JSON.stringify(view).includes("继续完善"));
  });

  await test("renderer source has no default 继续完善 / 成果还未完成", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../src/renderer/deliverable-planner.js"),
      "utf8"
    );
    assert.ok(!src.includes("继续完善"), "继续完善 must be removed from ordinary path");
    assert.ok(!src.includes("成果还未完成"), "old failed copy must be replaced");
    assert.ok(src.includes("成果未能生成"));
    assert.ok(src.includes("查看原因"));
    assert.ok(src.includes("renderItemRowSummary"));
    assert.ok(src.includes("修改计划"));
    assert.ok(src.includes("act-gen-status-block"));
  });

  await test("project_authority_conflict auto-repairs within one user initiation", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedDocumentPackage(
        ud,
        "为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。"
      );
      let draftCalls = 0;
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: seeded.deliverableId },
        {
          useSemanticBlocks: false,
          packageDir: path.join(__dirname, ".."),
          callModel: async (_messages, options) => {
            if (options && options.taskType === "review") {
              return JSON.stringify({
                status: "pass",
                blockingIssues: [],
                qualityIssues: [],
                suggestedRevisions: [],
                scores: { goalAlignment: 0.9 },
              });
            }
            draftCalls += 1;
            return draftCalls === 1 ? CONFLICT_DRAFT : GOOD_DRAFT;
          },
          imageMode: "mock",
          qualityPipelineMode: "advanced_shadow",
        }
      );
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.ok(draftCalls >= 2, "must auto-repair inside one initiation, draftCalls=" + draftCalls);
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const d = view.deliverables[0];
      assert.equal(d.generationStatus, "ready");
      assert.ok(d.currentVersionId);
      const attempts = Object.values(view.generationAttempts || {});
      const actions = [];
      for (const a of attempts) {
        for (const x of a.recoveryActions || []) actions.push(x.action || x);
      }
      assert.ok(
        actions.includes(RECOVERY_ACTIONS.LOCAL_REPAIR) || actions.includes("local_repair"),
        "expected local_repair in recoveryActions: " + JSON.stringify(actions)
      );
    } finally {
      cleanup(ud);
    }
  });

  await test("semantic block failure does not silently invent unbounded free generation", async () => {
    let wholeDocCalls = 0;
    let outlineCalls = 0;
    const produced = await generateByKindWithRepair(
      "document",
      {
        useSemanticBlocks: true,
        outcomeCriteria: buildOutcomeCriteria({
          goal: "为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。",
          kind: "document",
          title: "PRD",
          isDigitalMeProject: true,
        }),
        isDigitalMeProject: true,
        projectResolved: { projectContextId: "pctx_test", projectId: "project_digital_me", ok: true },
        pkg: { id: "p" },
        deliverable: { id: "d", title: "PRD", kind: "document", purpose: "x" },
        task: {
          goal: "为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。",
        },
        referenceMaterials: [],
        callModel: async (messages) => {
          const sys = JSON.stringify(messages || []);
          if (/内容结构|coversSemanticItems|Outline/i.test(sys) || /provisionalTitle/.test(sys)) {
            outlineCalls += 1;
            throw new Error("outline protocol broken");
          }
          if (/一个内容块|本块必须覆盖/.test(sys)) {
            throw new Error("block protocol broken");
          }
          wholeDocCalls += 1;
          return GOOD_DRAFT;
        },
      },
      { maxRepairAttempts: 0, allowCleanRegeneration: false }
    );
    assert.ok(produced && produced.files, "should still produce via bounded fallback or blocks");
    assert.ok(wholeDocCalls <= 2, "must not loop free whole-doc generation");
    assert.ok(outlineCalls >= 0);
  });

  await test("understanding hidden when only repeating goal; plan summary mode exists", () => {
    const view = deriveUserFacingTaskState({
      userGoal: "为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。",
      understanding: {
        goal: "为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。",
        summary: "为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。",
      },
      planConfirmed: true,
      packageView: { deliverables: [], generationAttempts: {}, versions: {} },
    });
    assert.equal(view.summary, null);
    assert.equal(view.planUiMode, "confirmed");
  });

  console.log("\ntask-quality-loop-01-2-fix-01:", passed, "passed,", failed, "failed");
  process.exit(failed ? 1 : 0);
}

main();

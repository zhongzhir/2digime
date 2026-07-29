"use strict";

/**
 * TASK-QUALITY-LOOP-01 — quality-reviewed deliverable loop tests.
 *
 * Covers: task mode detection, OutcomeCriteria formation, deterministic
 * Reviewer checks, model reviewer integration, automatic revision budget,
 * failure persistence, artifact persistence, restart recovery, and the
 * minimal PRD benchmark fixture.
 *
 * NOTE: passing these tests does NOT prove market-95th-percentile quality.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const {
  TASK_MODES,
  detectTaskMode,
  buildOutcomeCriteria,
  modeGuidanceFor,
} = require("../src/act-behalf/outcome-criteria");
const {
  deterministicReview,
  reviewDeliverableContent,
  toRepairIssues,
  userFacingReviewSummary,
  userFacingReviewFailure,
  farFutureRatio,
} = require("../src/act-behalf/deliverable-reviewer");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const generation = require("../src/act-behalf/deliverable-generation");
const actStore = require("../src/act-behalf/task-store");
const planner = require("../src/act-behalf/deliverable-planner");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");

const BENCHMARK_PATH = path.join(__dirname, "fixtures", "task-quality-loop-01", "benchmark-samples.json");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-tql01-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function loadBenchmark() {
  return JSON.parse(fs.readFileSync(BENCHMARK_PATH, "utf8"));
}

async function seedDocumentPackage(userData, goal) {
  const taskId = "abt_tql01_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
      title: "测试 PRD",
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
  const prep = await prepareDeliverablePackage(userData, { taskId }, {
    getTask: (u, id) => actStore.getTask(u, id, { heal: false }),
    getPlan: (u, planId) => require("../src/act-behalf/deliverable-plan-store").getPlan(u, planId),
    saveTaskExecution: async (u, id, exec) => {
      const got = actStore.getTask(u, id, { heal: false });
      return actStore.saveTask(u, {
        ...got.task,
        deliverableExecution: { activePackageId: exec.activePackageId || null },
      });
    },
  });
  assert.equal(prep.ok, true);
  return { taskId, packageId: prep.package.id, goal };
}

const PASS_REVIEW_JSON = JSON.stringify({
  status: "pass",
  blockingIssues: [],
  qualityIssues: [],
  suggestedRevisions: [],
  scores: { goalAlignment: 0.9 },
});

const E2E_GOAL = "为团队知识库功能生成一份可直接用于当前开发的 PRD。";

const E2E_DEFECTIVE_MD = [
  "# 团队知识库功能 PRD",
  "",
  "## 背景",
  "团队需要知识库功能来沉淀与复用项目知识。",
  "",
  "## 目标",
  "让知识在日常任务中被稳定使用。",
  "",
  "## 范围",
  "本期包含知识记录与任务内使用。",
  "",
  "## 功能需求",
  "1. 支持记录项目知识。",
  "2. 任务中自动使用相关知识。",
  "",
].join("\n");

const E2E_GOOD_MD = [
  "# 团队知识库功能 PRD",
  "",
  "## 背景",
  "当前已具备分散文档沉淀能力；真实缺口是跨任务统一检索与修正入口。本 PRD 约束下一步实现。",
  "",
  "## 目标",
  "真实用户问题是成员找不到最新说法；让知识在日常任务中被稳定使用，用户可修正。",
  "",
  "## 范围",
  "本期范围：知识记录与任务内使用。非范围：外部协作与公开分享。",
  "",
  "## 与现有对象的关系",
  "复用现有任务与成果引用，按权威等级注入相关知识；不新建第二套知识存储。",
  "",
  "## 功能需求",
  "1. 支持记录项目知识，低风险知识自动采纳。",
  "2. 任务中自动使用相关知识，来源可见。",
  "3. 成员修正后旧知识被替代，冲突请求选择。",
  "",
  "## 验收标准",
  "1. 新对话与新任务可调用已记录知识。",
  "2. 修正后再次生成使用新说法。",
  "3. 自动化测试覆盖记录、调用与修正路径。",
  "",
].join("\n");

async function main() {
  // ---- 1. Task mode detection: current implementation ----
  await test("mode detection: current implementation recognized", () => {
    const mode = detectTaskMode({
      goal: "为 Digital Me 的项目知识功能生成一份可直接用于开发的 PRD。",
    });
    assert.equal(mode, TASK_MODES.CURRENT_IMPLEMENTATION);
    const mode2 = detectTaskMode({ goal: "生成当前实现可行的功能清单" });
    assert.equal(mode2, TASK_MODES.CURRENT_IMPLEMENTATION);
  });

  // ---- 2. Task mode detection: strategic/exploration not downgraded ----
  await test("mode detection: strategic and exploration are not downgraded", () => {
    assert.equal(
      detectTaskMode({ goal: "为 Digital Me 制定三年战略规划，明确分阶段路线。" }),
      TASK_MODES.STRATEGIC_PLANNING
    );
    assert.equal(
      detectTaskMode({
        goal: "探索 Digital Me 将来如何支持多个数字主体协作，形成方案比较，不要求近期实现。",
      }),
      TASK_MODES.SOLUTION_EXPLORATION
    );
  });

  // ---- 3. OutcomeCriteria formation ----
  await test("outcome criteria formed with mode, sections and constraints", () => {
    const c = buildOutcomeCriteria({
      goal: "为 Digital Me 的项目知识功能生成一份可直接用于开发的 PRD。",
      audience: "开发团队",
      usage: "直接开发",
      expectedQuality: "可直接用于开发",
      kind: "document",
      title: "项目知识功能 PRD",
      isDigitalMeProject: true,
    });
    assert.equal(c.taskMode, TASK_MODES.CURRENT_IMPLEMENTATION);
    assert.ok(Array.isArray(c.requiredSemanticCoverage) && c.requiredSemanticCoverage.includes("acceptanceEvidence"));
    assert.ok(c.requiredSemanticCoverage.includes("currentFoundation"));
    assert.equal(c.requiredSections.length, 0, "01.2: fixed chapter titles removed");
    assert.ok(c.projectConstraints.some((x) => x.includes("当前仓库")));
    assert.equal(c.implementationAlignment.requireCurrentImplementationBasis, true);
    assert.ok(c.criteriaDigest.startsWith("sha256:"));
    assert.ok(modeGuidanceFor(c.taskMode).includes("当前实施模式"));
  });

  // ---- 4. Reviewer finds placeholder ----
  await test("reviewer finds leftover placeholder content", () => {
    const r = deterministicReview("# 文档\n\n项目名称：____\n\n- 功能一\n", {
      criteria: buildOutcomeCriteria({ goal: "写说明", kind: "document" }),
      kind: "document",
      goal: "写说明",
    });
    assert.ok(r.blockingIssues.length > 0);
  });

  // ---- 5. Reviewer finds missing semantic coverage (not fixed chapter titles) ----
  await test("reviewer finds missing required section", () => {
    const sample = loadBenchmark().samples[0];
    const criteria = buildOutcomeCriteria({
      goal: sample.userGoal,
      kind: "document",
      title: "项目知识功能 PRD",
      isDigitalMeProject: true,
    });
    const acceptable = deterministicReview(sample.drafts.acceptable, {
      criteria,
      kind: "document",
      goal: sample.userGoal,
      isDigitalMeProject: true,
    });
    assert.equal(
      acceptable.blockingIssues.filter((i) => i.ruleId === "missing_semantic_coverage").length,
      0,
      "acceptable draft must cover required semantics: " + JSON.stringify(acceptable.blockingIssues)
    );
    // Remove acceptance evidence substance (not merely a heading rename).
    const noAcceptance = sample.drafts.acceptable
      .replace(/## 验收[\s\S]*?(?=## 边界与约束)/, "")
      .replace(/新对话|supersede|不串用|跨任务|跨对话/g, "（略）");
    const r = deterministicReview(noAcceptance, {
      criteria,
      kind: "document",
      goal: sample.userGoal,
      isDigitalMeProject: true,
    });
    assert.ok(
      r.blockingIssues.some((i) => i.ruleId === "missing_semantic_coverage"),
      "expected missing_semantic_coverage, got " + JSON.stringify(r.blockingIssues.map((i) => i.ruleId))
    );
  });

  // ---- 6. Reviewer finds project fact conflict ----
  await test("reviewer finds unsupported project fact conflict", () => {
    const sample = loadBenchmark().samples[0];
    const criteria = buildOutcomeCriteria({
      goal: sample.userGoal,
      kind: "document",
      title: "项目知识功能 PRD",
      isDigitalMeProject: true,
    });
    const r = deterministicReview(sample.drafts.defective, {
      criteria,
      kind: "document",
      goal: sample.userGoal,
      isDigitalMeProject: true,
    });
    assert.ok(r.blockingIssues.some((i) => i.ruleId === "project_fact_conflict"));
    const conflict = r.blockingIssues.find((i) => i.ruleId === "project_fact_conflict");
    assert.ok(conflict.message.includes("视频"));
  });

  // ---- 7. Reviewer finds far-future dominance in current implementation mode ----
  await test("reviewer flags far-future dominance only in current implementation mode", () => {
    const sample = loadBenchmark().samples[0];
    const criteria = buildOutcomeCriteria({
      goal: sample.userGoal,
      kind: "document",
      title: "项目知识功能 PRD",
      isDigitalMeProject: true,
    });
    const r = deterministicReview(sample.drafts.defective, {
      criteria,
      kind: "document",
      goal: sample.userGoal,
      isDigitalMeProject: true,
    });
    assert.ok(r.blockingIssues.some((i) => i.ruleId === "far_future_dominant"));

    // Same far-future-heavy content is allowed in exploration mode.
    const explorationContent =
      "# 远期协作探索\n\n## 当前基础\n当前系统仅支持单机单主体使用，协作能力停留在本地模拟阶段，尚未接入任何外部网络。\n\n## 方案一：区块链网络\n以区块链与智能合约构建协作网络，主体之间通过链上凭证互相确认授权，优势是公开可审计，代价是引入外部依赖。\n\n## 方案二：联邦学习\n以联邦学习在多个主体之间共享模型成果而不交换原始数据，适合隐私敏感场景，但工程复杂度明显更高。\n\n## 远期\n以上均为远期方向，需要另行立项评估，本文件只做路线比较，不构成实施承诺。\n";
    const expCriteria = buildOutcomeCriteria({
      goal: "协作方案",
      kind: "document",
      title: "协作探索",
    });
    assert.equal(expCriteria.taskMode, TASK_MODES.CURRENT_IMPLEMENTATION); // sanity for next line
    const expCriteria2 = { ...expCriteria, taskMode: TASK_MODES.SOLUTION_EXPLORATION, requiredSections: ["当前基础", "方案", "远期"] };
    const ok = deterministicReview(explorationContent, {
      criteria: expCriteria2,
      kind: "document",
      goal: "探索协作方案",
    });
    assert.equal(ok.blockingIssues.length, 0, JSON.stringify(ok.blockingIssues));
    assert.ok(farFutureRatio(explorationContent) > 0.15);
  });

  // ---- 8. Exploration collapse detected ----
  await test("reviewer detects exploration outcome collapsed into implementation plan", () => {
    const sample = loadBenchmark().samples[1];
    const criteria = {
      ...buildOutcomeCriteria({ goal: sample.userGoal, kind: "document", title: "协作方案" }),
    };
    assert.equal(criteria.taskMode, TASK_MODES.SOLUTION_EXPLORATION);
    const r = deterministicReview(sample.drafts.defective, {
      criteria,
      kind: "document",
      goal: sample.userGoal,
      isDigitalMeProject: true,
    });
    assert.ok(r.blockingIssues.some((i) => i.ruleId === "exploration_collapsed"));
  });

  // ---- 9. Model reviewer merge + graceful degradation ----
  await test("model reviewer issues merge; model failure degrades gracefully", async () => {
    const criteria = buildOutcomeCriteria({
      goal: E2E_GOAL,
      kind: "document",
      title: "测试 PRD",
    });
    // (a) deterministic-clean draft + model blocking issue → fail
    const r1 = await reviewDeliverableContent({
      content: E2E_GOOD_MD,
      kind: "document",
      criteria,
      goal: E2E_GOAL,
      callModel: async () =>
        JSON.stringify({
          status: "fail",
          blockingIssues: [{ message: "模型发现：缺少非功能需求章节。", lineNumber: 3 }],
          qualityIssues: [],
          suggestedRevisions: ["补充非功能需求。"],
          scores: { completeness: 0.4 },
        }),
    });
    assert.equal(r1.status, "fail");
    assert.ok(r1.blockingIssues.some((i) => i.source === "model_reviewer"));
    assert.ok(r1.suggestedRevisions.some((s) => s.includes("非功能需求")));

    // (b) deterministic-clean draft + model throws → pass, degraded flag
    const r2 = await reviewDeliverableContent({
      content: E2E_GOOD_MD,
      kind: "document",
      criteria,
      goal: E2E_GOAL,
      callModel: async () => {
        throw new Error("network down");
      },
    });
    assert.equal(r2.status, "pass");
    assert.equal(r2.reviewerDegraded, true);

    // (c) deterministic-fail draft + model throws → still fail (deterministic authoritative)
    const r3 = await reviewDeliverableContent({
      content: E2E_DEFECTIVE_MD,
      kind: "document",
      criteria,
      goal: E2E_GOAL,
      callModel: async () => {
        throw new Error("network down");
      },
    });
    assert.equal(r3.status, "fail");
    assert.equal(r3.reviewerDegraded, true);
  });

  // ---- 10. One revision then pass: full loop, quality persisted, files on disk ----
  await test("e2e: one automatic revision then pass, reviewer persisted, files on disk", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedDocumentPackage(ud, E2E_GOAL);
      const view0 = packageStore.getPackageView(ud, seeded.packageId);
      const del = view0.deliverables[0];
      let draftCalls = 0;
      let reviewCalls = 0;
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: del.id },
        {
          callModel: async (_messages, options) => {
            if (options && options.taskType === "review") {
              reviewCalls += 1;
              return PASS_REVIEW_JSON;
            }
            draftCalls += 1;
            return draftCalls === 1 ? E2E_DEFECTIVE_MD : E2E_GOOD_MD;
          },
          imageMode: "mock",
        }
      );
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(draftCalls, 2, "first draft + exactly one revision");
      assert.ok(reviewCalls >= 2, "reviewer ran on both drafts");
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const d = view.deliverables[0];
      assert.equal(d.generationStatus, "ready");
      assert.ok(d.currentVersionId);
      const version = view.versions[d.currentVersionId];
      assert.ok(version.quality && version.quality.reviewer, "reviewer result persisted on version");
      assert.equal(version.quality.reviewer.status, "pass");
      assert.equal(version.quality.reviewer.taskMode, "current_implementation");
      assert.equal(version.quality.reviewer.modelReviewUsed, true);
      assert.ok(version.quality.reviewer.scores);
      const attempts = Object.values(view.generationAttempts || {});
      assert.ok(attempts.some((a) => a.status === "superseded" && a.outcome === "repair_initiated"));
      assert.ok(attempts.some((a) => a.status === "succeeded"));
      // Artifact files really on disk.
      const artDir = path.join(
        ud,
        "deliverable-artifacts",
        String(seeded.packageId),
        String(del.id),
        String(d.currentVersionId)
      );
      assert.ok(fs.existsSync(path.join(artDir, "artifact.md")), "artifact.md on disk");
      const md = fs.readFileSync(path.join(artDir, "artifact.md"), "utf8");
      assert.ok(md.includes("验收标准"));

      // Restart recovery: fresh load from disk still exposes version + quality.
      const fresh = packageStore.getPackageView(ud, seeded.packageId);
      const fd = fresh.deliverables[0];
      assert.equal(fd.generationStatus, "ready");
      const fv = fresh.versions[fd.currentVersionId];
      assert.ok(fv && fv.quality && fv.quality.reviewer);
      assert.equal(fv.quality.reviewer.status, "pass");
    } finally {
      cleanup(ud);
    }
  });

  // ---- 11. Two revisions still failing: stops, persists evidence, plain language ----
  await test("e2e: two revisions still failing stops with persisted evidence and no artifacts", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedDocumentPackage(ud, E2E_GOAL);
      const view0 = packageStore.getPackageView(ud, seeded.packageId);
      const del = view0.deliverables[0];
      let draftCalls = 0;
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: del.id },
        {
          callModel: async (_messages, options) => {
            if (options && options.taskType === "review") return PASS_REVIEW_JSON;
            draftCalls += 1;
            return E2E_DEFECTIVE_MD;
          },
          imageMode: "mock",
        }
      );
      assert.equal(res.ok, false);
      assert.equal(res.code, "review_content_rejected");
      assert.equal(draftCalls, 3, "first draft + exactly two revisions");
      assert.ok(!/Reviewer|blocking|pipeline|attempt|状态机/i.test(res.message), "plain language failure message");
      assert.ok(
        /验收|必要问题|尚未充分|质量|可直接使用/.test(res.message),
        "failure message explains what is missing: " + res.message
      );
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const d = view.deliverables[0];
      assert.equal(d.generationStatus, "failed");
      assert.equal(d.currentVersionId, null);
      assert.ok(d.lastGenerationIssueSummary);
      const attempts = Object.values(view.generationAttempts || {});
      assert.equal(attempts.length, 3, "initial + two repair attempts");
      assert.equal(attempts.filter((a) => a.status === "superseded").length, 2);
      const failedAttempt = attempts.find((a) => a.status === "failed");
      assert.ok(failedAttempt);
      assert.equal(failedAttempt.errorCode, "review_content_rejected");
      assert.ok(failedAttempt.failureEvidence, "failure evidence persisted");
      assert.ok(failedAttempt.failureEvidence.reviewResult, "reviewer result persisted in evidence");
      assert.equal(failedAttempt.failureEvidence.reviewResult.status, "fail");
      assert.ok(failedAttempt.userIssueSummary);
      // No artifact files for the failed deliverable.
      const artRoot = path.join(ud, "deliverable-artifacts", String(seeded.packageId), String(del.id));
      assert.ok(!fs.existsSync(artRoot), "no artifact directory for failed deliverable");
    } finally {
      cleanup(ud);
    }
  });

  // ---- 12. Benchmark fixture: modes + reviewer verdicts ----
  await test("benchmark samples: mode detection and reviewer verdicts match expectations", () => {
    const bench = loadBenchmark();
    assert.equal(bench.samples.length, 3);
    for (const sample of bench.samples) {
      const mode = detectTaskMode({ goal: sample.userGoal });
      assert.equal(mode, sample.expectedMode, `${sample.id} mode`);
      const criteria = buildOutcomeCriteria({
        goal: sample.userGoal,
        kind: "document",
        title: sample.id,
        isDigitalMeProject: /Digital Me/.test(sample.userGoal),
      });
      const onDefective = deterministicReview(sample.drafts.defective, {
        criteria,
        kind: "document",
        goal: sample.userGoal,
        isDigitalMeProject: /Digital Me/.test(sample.userGoal),
      });
      assert.equal(
        onDefective.blockingIssues.length > 0 ? "fail" : "pass",
        sample.expectedReviewer.onDefective,
        `${sample.id} defective should fail: ${JSON.stringify(onDefective.blockingIssues.map((i) => i.ruleId))}`
      );
      const onAcceptable = deterministicReview(sample.drafts.acceptable, {
        criteria,
        kind: "document",
        goal: sample.userGoal,
        isDigitalMeProject: /Digital Me/.test(sample.userGoal),
      });
      assert.equal(
        onAcceptable.blockingIssues.length > 0 ? "fail" : "pass",
        sample.expectedReviewer.onAcceptable,
        `${sample.id} acceptable should pass: ${JSON.stringify(onAcceptable.blockingIssues.map((i) => i.ruleId))}`
      );
    }
  });

  // ---- 13. Repair issues + user-facing summaries are plain language ----
  await test("repair issues and user-facing summaries carry plain language", async () => {
    const sample = loadBenchmark().samples[0];
    const criteria = buildOutcomeCriteria({
      goal: sample.userGoal,
      kind: "document",
      title: "项目知识功能 PRD",
      isDigitalMeProject: true,
    });
    const result = await reviewDeliverableContent({
      content: sample.drafts.defective,
      kind: "document",
      criteria,
      goal: sample.userGoal,
      isDigitalMeProject: true,
    });
    assert.equal(result.status, "fail");
    const repairIssues = toRepairIssues(result);
    assert.ok(repairIssues.length > 0);
    assert.ok(repairIssues.every((i) => i.message));
    const summary = userFacingReviewSummary(result);
    const failure = userFacingReviewFailure(result);
    assert.ok(summary.startsWith("成果还没有达到可直接使用的质量"));
    assert.ok(failure.includes("你可以重试，或补充更明确的要求"));
    assert.ok(!/Reviewer|blocking|pipeline|状态机/i.test(summary + failure));
  });

  console.log("\ntask-quality-loop-01:", passed, "passed,", failed, "failed");
  process.exit(failed ? 1 : 0);
}

main();

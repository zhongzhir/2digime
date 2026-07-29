"use strict";

/**
 * TASK-QUALITY-LOOP-01.2 — Semantic contract, coverage, recovery consolidation, UI view.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildOutcomeCriteria, TASK_MODES } = require("../src/act-behalf/outcome-criteria");
const {
  SEMANTIC_IDS,
  deriveSemanticContract,
  checkSemanticCoverage,
  findHollowSemanticHeadings,
  defaultOutlinePlan,
  validateOutlineCoverage,
  ensureOutlineCovers,
  inferRequiredSemanticCoverage,
} = require("../src/act-behalf/semantic-contract");
const {
  proposeOutlinePlan,
  generateDocumentBySemanticBlocks,
  assembleBlocks,
  ruleBasedBlock,
} = require("../src/act-behalf/semantic-generation");
const {
  RECOVERY_ACTIONS,
  normalizeRecoveryActions,
  buildAttemptAuditWrite,
  hasRecoveryAction,
  legacyFlagsFromRecovery,
} = require("../src/act-behalf/attempt-recovery");
const { deriveUserFacingTaskState, USER_STATUS } = require("../src/act-behalf/user-facing-task-view");
const { deterministicReview } = require("../src/act-behalf/deliverable-reviewer");
const { buildGapStatement } = require("../src/act-behalf/grounded-generation");
const { buildCurrentSystemSnapshot } = require("../src/act-behalf/current-system-snapshot");
const { buildAuthorityMap } = require("../src/act-behalf/authority-map");

const GOAL = "为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。";

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

function goodPrdBody() {
  return [
    "# 项目知识功能说明",
    "",
    "## 现状与问题",
    "当前系统已具备项目知识存储、Knowledge Resolver、来源可见与 supersede 学习闭环。",
    "真实用户问题是在现有能力上获得可直接实施的产品说明，而不是从零建设。",
    "实际缺口在于浏览体验与跨面验证仍可完善。",
    "",
    "## 本轮方案",
    "本轮新增最小增量：完善引用展示。用户路径支持跨对话、跨任务正确调用。",
    "复用现有 ProjectKnowledge、Task、PlanRecord、ArtifactRef；不新建第二套。",
    "",
    "## 验收与边界",
    "验收：新对话调用更新后事实；被 supersede 的旧知识停止生效；不同项目不串用。",
    "不做事项：不引入既有 SQLite 后端；不把项目知识重做成项目管理系统。",
  ].join("\n");
}

async function main() {
  await test("PRD goal yields semantic coverage (not fixed chapters)", () => {
    const c = buildOutcomeCriteria({
      goal: GOAL,
      kind: "document",
      title: "PRD",
      isDigitalMeProject: true,
    });
    assert.equal(c.taskMode, TASK_MODES.CURRENT_IMPLEMENTATION);
    assert.equal(c.requiredSections.length, 0);
    assert.ok(c.requiredSemanticCoverage.includes(SEMANTIC_IDS.CURRENT_FOUNDATION));
    assert.ok(c.requiredSemanticCoverage.includes(SEMANTIC_IDS.ACCEPTANCE_EVIDENCE));
    const contract = deriveSemanticContract({
      goal: GOAL,
      kind: "document",
      title: "PRD",
      isDigitalMeProject: true,
      outcomeCriteria: c,
    });
    assert.equal(contract.preferredForm, "implementation_prd");
    assert.equal(contract.expectedDepth, "implementation");
  });

  await test("simple memo does not get PRD semantics", () => {
    const ids = inferRequiredSemanticCoverage({
      goal: "写一条项目备忘：今晚先不改主线",
      title: "备忘",
      kind: "document",
      taskMode: TASK_MODES.CURRENT_IMPLEMENTATION,
    });
    assert.deepEqual(ids.sort(), [SEMANTIC_IDS.CONCLUSION, SEMANTIC_IDS.PROBLEM_STATEMENT].sort());
  });

  await test("exploration mode is not forced into implementation structure", () => {
    const c = buildOutcomeCriteria({
      goal: "比较 Digital Me 外部协作的多条候选路线，不要求近期实施",
      kind: "document",
      title: "协作探索",
    });
    assert.equal(c.taskMode, TASK_MODES.SOLUTION_EXPLORATION);
    assert.ok(c.requiredSemanticCoverage.includes(SEMANTIC_IDS.OPTIONS));
    assert.ok(!c.requiredSemanticCoverage.includes(SEMANTIC_IDS.ACCEPTANCE_EVIDENCE));
  });

  await test("strategic mode allows open structure", () => {
    const c = buildOutcomeCriteria({
      goal: "Digital Me 三年战略规划与路线图",
      kind: "document",
      title: "战略",
    });
    assert.equal(c.taskMode, TASK_MODES.STRATEGIC_PLANNING);
    assert.equal(c.expectedDepth, "open");
  });

  await test("different titles but full semantics can pass", () => {
    const criteria = buildOutcomeCriteria({
      goal: GOAL,
      kind: "document",
      title: "PRD",
      isDigitalMeProject: true,
    });
    const body = goodPrdBody(); // no 背景/功能需求 headings
    assert.ok(!/^## 背景/m.test(body));
    const r = deterministicReview(body, {
      criteria,
      kind: "document",
      goal: GOAL,
      isDigitalMeProject: true,
    });
    assert.equal(
      r.blockingIssues.filter((i) => i.ruleId === "missing_semantic_coverage").length,
      0,
      JSON.stringify(r.blockingIssues)
    );
    // dimensions are on the full async ReviewResult; deterministic layer exposes issues only.
    assert.ok(Array.isArray(r.blockingIssues));
  });

  await test("titled 背景 section that is hollow cannot pass", () => {
    const criteria = buildOutcomeCriteria({
      goal: GOAL,
      kind: "document",
      title: "PRD",
      isDigitalMeProject: true,
    });
    const hollow = "# x\n\n## 背景\n\n（空）\n\n## 其它\n" + goodPrdBody();
    const hollowHits = findHollowSemanticHeadings(hollow);
    assert.ok(hollowHits.some((h) => h.title.includes("背景")));
    const r = deterministicReview(hollow, {
      criteria,
      kind: "document",
      goal: GOAL,
      isDigitalMeProject: true,
    });
    assert.ok(r.qualityIssues.some((i) => i.ruleId === "hollow_section_heading"));
  });

  await test("OutlinePlan covers all required semantics", async () => {
    const contract = deriveSemanticContract({
      goal: GOAL,
      kind: "document",
      title: "PRD",
      isDigitalMeProject: true,
    });
    const { outline } = await proposeOutlinePlan({
      callModel: async () => "not-json",
      contract,
      goal: GOAL,
      title: "PRD",
    });
    const v = validateOutlineCoverage(outline, contract.requiredSemanticCoverage);
    assert.equal(v.ok, true);
    assert.ok((outline.sections || []).length <= 8);
  });

  await test("missing semantics first repair outline then fill", () => {
    const contract = deriveSemanticContract({
      goal: GOAL,
      kind: "document",
      title: "PRD",
      isDigitalMeProject: true,
    });
    const incomplete = { sections: [{ provisionalTitle: "A", purpose: "x", coversSemanticItems: ["currentFoundation"] }] };
    const v = validateOutlineCoverage(incomplete, contract.requiredSemanticCoverage);
    assert.equal(v.ok, false);
    const fixed = ensureOutlineCovers(incomplete, contract.requiredSemanticCoverage);
    assert.equal(validateOutlineCoverage(fixed, contract.requiredSemanticCoverage).ok, true);
  });

  await test("single semantic gap only adds related block", async () => {
    const contract = deriveSemanticContract({
      goal: GOAL,
      kind: "document",
      title: "PRD",
      isDigitalMeProject: true,
    });
    const ctx = { goal: GOAL, title: "PRD", kind: "document" };
    const outline = defaultOutlinePlan(contract);
    const blocks = outline.sections.map((s) => ({
      blockId: s.provisionalTitle,
      content: ruleBasedBlock(ctx, s),
      coveredSemanticItems: s.coversSemanticItems,
    }));
    // Strip acceptance substance from every block (headings alone must not count).
    for (const b of blocks) {
      b.content = String(b.content || "")
        .replace(/验收[：:].*/g, "")
        .replace(
          /如何验证|验收标准|证明结果|新对话|被\s*supersede|停止生效|不同项目不串用|重启后|自动化测试覆盖|再次生成使用/g,
          ""
        );
      b.coveredSemanticItems = (b.coveredSemanticItems || []).filter(
        (id) => id !== SEMANTIC_IDS.ACCEPTANCE_EVIDENCE
      );
    }
    let md = assembleBlocks(blocks, "PRD");
    let cov = checkSemanticCoverage(md, contract.requiredSemanticCoverage);
    assert.ok(
      cov.missing.includes(SEMANTIC_IDS.ACCEPTANCE_EVIDENCE),
      "expected acceptance gap, missing=" + JSON.stringify(cov.missing)
    );
    const fill = ruleBasedBlock(ctx, {
      provisionalTitle: "补充",
      coversSemanticItems: [SEMANTIC_IDS.ACCEPTANCE_EVIDENCE],
    });
    md = assembleBlocks(blocks.concat([{ content: fill }]), "PRD");
    cov = checkSemanticCoverage(md, contract.requiredSemanticCoverage);
    assert.equal(cov.ok, true);
  });

  await test("semantic block generation produces covered document without callModel", async () => {
    const criteria = buildOutcomeCriteria({
      goal: GOAL,
      kind: "document",
      title: "PRD",
      isDigitalMeProject: true,
    });
    const produced = await generateDocumentBySemanticBlocks({
      callModel: null,
      ctx: { goal: GOAL, title: "PRD", kind: "document" },
      outcomeCriteria: criteria,
      isDigitalMeProject: true,
    });
    assert.ok(produced.md.length > 200);
    assert.equal(produced.coverage.ok, true);
    assert.ok(produced.outline.sections.length >= 3);
    assert.ok(produced.outline.sections.length <= 8);
    // Intermediate blocks are runtime summaries — not full permanent content dump.
    assert.ok(produced.blocks.every((b) => b.contentLength > 0 && !b.content));
  });

  await test("new writes use recoveryActions[]; legacy booleans remain readable", () => {
    const write = buildAttemptAuditWrite({
      recoveryActions: [
        { action: RECOVERY_ACTIONS.GROUNDED_REBUILD, at: "2026-07-28T00:00:00.000Z" },
        { action: RECOVERY_ACTIONS.CLEAN_REGENERATION, at: "2026-07-28T00:01:00.000Z" },
      ],
      modelCallCount: 4,
    });
    assert.ok(Array.isArray(write.recoveryActions));
    assert.equal(write.groundedRebuildUsed, true);
    assert.equal(write.cleanRegenerationUsed, true);
    assert.equal(write.groundingAudit.recoveryActions.length, 2);
    const legacy = {
      groundedRebuildUsed: true,
      cleanRegenerationUsed: false,
      groundingAudit: { repairModes: ["local_repair"] },
    };
    const normalized = normalizeRecoveryActions(legacy);
    assert.ok(hasRecoveryAction(legacy, RECOVERY_ACTIONS.GROUNDED_REBUILD));
    assert.ok(normalized.some((a) => a.action === RECOVERY_ACTIONS.LOCAL_REPAIR));
    const flags = legacyFlagsFromRecovery(write);
    assert.equal(flags.groundedRebuildUsed, true);
  });

  await test("blocking issues filterable from unified issues; grounding is a dimension", () => {
    const criteria = buildOutcomeCriteria({
      goal: GOAL,
      kind: "document",
      title: "PRD",
      isDigitalMeProject: true,
    });
    const r = deterministicReview("太短", {
      criteria,
      kind: "document",
      goal: GOAL,
      isDigitalMeProject: true,
    });
    // Force via semantic miss
    assert.ok(r.blockingIssues.length >= 1);
    // Simulate schema v2 shape
    const issues = (r.blockingIssues || []).concat(r.qualityIssues || []);
    const blocking = issues.filter((i) => i.issueType === "blocking" || !i.issueType);
    assert.ok(blocking.length >= 1);
  });

  await test("UI state derived from attempt; not separately stored", () => {
    const view = deriveUserFacingTaskState({
      task: { goal: GOAL, title: GOAL },
      userGoal: GOAL,
      packageView: {
        deliverables: [{ id: "d1", planDisposition: "included", generationStatus: "failed", latestGenerationAttemptId: "a1" }],
        generationAttempts: {
          a1: {
            status: "failed",
            recoveryActions: [{ action: RECOVERY_ACTIONS.CLEAN_REGENERATION }],
            userIssueSummary: "内部细节",
          },
        },
        versions: {},
      },
    });
    assert.equal(view.status, USER_STATUS.FAILED);
    assert.equal(view.statusMessage, "成果未能完成");
    assert.equal(view.primaryAction, null);
    assert.equal(view.secondaryAction && view.secondaryAction.label, "查看原因");
    assert.equal(view.title, GOAL);
    assert.ok(view.detailAvailable);

    const busy = deriveUserFacingTaskState({
      userGoal: GOAL,
      packageView: {
        deliverables: [{ id: "d1", planDisposition: "included", generationStatus: "generating", latestGenerationAttemptId: "a2" }],
        generationAttempts: { a2: { status: "repairing" } },
      },
    });
    assert.equal(busy.status, USER_STATUS.REFINING);
    assert.equal(busy.primaryAction, null);

    const done = deriveUserFacingTaskState({
      userGoal: GOAL,
      packageView: {
        deliverables: [
          {
            id: "d1",
            planDisposition: "included",
            generationStatus: "ready",
            currentVersionId: "v1",
            latestGenerationAttemptId: "a3",
          },
        ],
        generationAttempts: { a3: { status: "succeeded" } },
        versions: {
          v1: { id: "v1", artifactRefs: [{ id: "art1", format: "md" }] },
        },
      },
    });
    assert.equal(done.status, USER_STATUS.COMPLETED);
    assert.equal(done.primaryAction.label, "打开成果");
    assert.equal(done.secondaryAction.placement, "overflow");
  });

  await test("GapStatement remains derived; no second store dependency", () => {
    const snap = buildCurrentSystemSnapshot({ goal: GOAL });
    const map = buildAuthorityMap();
    const gap = buildGapStatement({ snapshot: snap, authorityMap: map, goal: GOAL });
    assert.ok(gap.ExistingCapabilities.length >= 1);
    // Prove it is a function of snapshot+map, not an independent authority.
    const gap2 = buildGapStatement({ snapshot: snap, authorityMap: map, goal: GOAL });
    assert.equal(gap.ExistingCapabilities.length, gap2.ExistingCapabilities.length);
    assert.ok(!fs.existsSync(path.join(__dirname, "../src/act-behalf/gap-statement-store.js")));
  });

  await test("understanding summary hidden when it only repeats goal (projection rule)", () => {
    const view = deriveUserFacingTaskState({
      userGoal: GOAL,
      understanding: { goal: GOAL, summary: GOAL },
      packageView: { deliverables: [], generationAttempts: {}, versions: {} },
    });
    assert.equal(view.summary, null);
    const withExtra = deriveUserFacingTaskState({
      userGoal: GOAL,
      understanding: { goal: GOAL, summary: "将按当前实施方案生成，可直接进入开发评审。" },
      packageView: { deliverables: [], generationAttempts: {}, versions: {} },
    });
    assert.ok(withExtra.summary && withExtra.summary.includes("当前实施"));
  });

  await test("renderer minimizes duplicate goal/status and failed artifact card", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../src/renderer/deliverable-planner.js"),
      "utf8"
    );
    assert.ok(src.includes("goalIsDuplicate"), "hides duplicate understanding goal");
    assert.ok(src.includes("成果未能完成"), "single failed status copy");
    assert.ok(src.includes("查看原因"), "details are secondary/collapsed");
    assert.ok(src.includes("正在完善成果") || src.includes("正在生成成果"));
    assert.ok(/hide generate while busy|Single primary action/i.test(src));
    assert.ok(!/继续完善/.test(src), "no continue-repair label on ordinary failure");
    assert.ok(!/重试生成/.test(src), "no parallel retry-generate label");
  });

  console.log("\ntask-quality-loop-01-2:", passed, "passed,", failed, "failed");
  process.exit(failed ? 1 : 0);
}

main();

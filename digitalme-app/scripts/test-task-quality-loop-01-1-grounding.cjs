"use strict";

/**
 * TASK-QUALITY-LOOP-01.1 — GroundingReview tests.
 *
 * Verifies that current-implementation outcomes about the Digital Me project
 * are checked against the real system state (CurrentSystemSnapshot +
 * AuthorityMap), not model common sense.
 *
 * NOTE: passing these tests does NOT prove market-95th-percentile quality.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const { buildOutcomeCriteria } = require("../src/act-behalf/outcome-criteria");
const {
  buildCurrentSystemSnapshot,
  renderSnapshotFacts,
} = require("../src/act-behalf/current-system-snapshot");
const { buildAuthorityMap } = require("../src/act-behalf/authority-map");
const { groundingReview } = require("../src/act-behalf/grounding-review");
const { reviewDeliverableContent } = require("../src/act-behalf/deliverable-reviewer");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const generation = require("../src/act-behalf/deliverable-generation");
const actStore = require("../src/act-behalf/task-store");
const planner = require("../src/act-behalf/deliverable-planner");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
const { createMinimalFixture } = require("../src/package-store/fixture");
const projectStore = require("../src/act-behalf/project-knowledge-store");

const FIXTURE_PATH = path.join(__dirname, "fixtures", "task-quality-loop-01", "grounding-samples.json");
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

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-tql011-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function loadFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

function criteriaFor(goal) {
  return buildOutcomeCriteria({ goal: goal || GOAL, kind: "document", title: "项目知识功能 PRD", isDigitalMeProject: true });
}

function realSnapshotAndMap(goal) {
  const snapshot = buildCurrentSystemSnapshot({ goal: goal || GOAL });
  const authorityMap = buildAuthorityMap();
  return { snapshot, authorityMap };
}

function ruleIds(result) {
  return result.blockingIssues.map((i) => i.ruleId);
}

async function seedDocumentPackage(userData, goal) {
  const taskId = "abt_tql011_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await actStore.saveTask(userData, { taskId, title: goal, goal, request: goal, status: "draft" });
  const suggestion = planner.ruleBasedPlan({ goal });
  suggestion.items = [
    {
      id: "pd_doc",
      kind: "document",
      title: "项目知识功能 PRD",
      purpose: "指导开发",
      format: "md",
      priority: "required",
      order: 0,
      dependencies: [],
      planDisposition: "included",
      riskFlags: [],
    },
  ];
  const applied = planner.applySuggestionToRecord({ taskId, existingRecord: null, suggestion, goal });
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
      return actStore.saveTask(userData, { ...got, deliverablePlanning, deliverableExecution: { activePackageId: null } });
    },
    cas: { expectedRevision: planConsistency.revisionTokensFromPlan(committed.plan) },
  });
  assert.equal(after.ok, true);
  const prep = await prepareDeliverablePackage(userData, { taskId }, {
    getTask: (u, id) => actStore.getTask(u, id, { heal: false }),
    getPlan: (u, planId) => require("../src/act-behalf/deliverable-plan-store").getPlan(u, planId),
    saveTaskExecution: async (u, id, exec) => {
      const got = actStore.getTask(u, id, { heal: false });
      return actStore.saveTask(u, { ...got.task, deliverableExecution: { activePackageId: exec.activePackageId || null } });
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
  scores: {},
});

async function main() {
  const fixture = loadFixture();
  const failureDraft = fixture.failure.content;
  const acceptableDraft = fixture.acceptable.content;

  // ---- 1. Snapshot only extracts task-relevant capabilities ----
  await test("snapshot extracts only task-relevant capabilities", () => {
    const snap = buildCurrentSystemSnapshot({ goal: GOAL });
    const ids = snap.relevantModules.map((m) => m.id);
    assert.ok(ids.includes("project_knowledge_store"));
    assert.ok(ids.includes("knowledge_resolver"));
    assert.ok(ids.includes("low_friction_learning"));
    const unrelated = buildCurrentSystemSnapshot({ goal: "为 Digital Me 设计封面图片风格" });
    const uids = unrelated.relevantModules.map((m) => m.id);
    assert.ok(!uids.includes("project_knowledge_store"));
    assert.ok(!uids.includes("knowledge_resolver"));
    assert.ok(snap.snapshotDigest.startsWith("sha256:"));
    assert.ok(renderSnapshotFacts(snap).includes("已具备"));
  });

  // ---- 2. Unknown facts are never asserted as confirmed ----
  await test("unknown capabilities are never asserted", () => {
    const fabricated = {
      relevantModules: [
        {
          id: "knowledge_resolver",
          label: "统一知识解析",
          status: "unknown",
          domainNouns: ["知识解析"],
          mentionTokens: ["Knowledge Resolver"],
          sourceRef: "x",
        },
      ],
      persistenceMechanisms: [{ kind: "sqlite", status: "absent", detail: "none", sourceRef: "x" }],
      knownBoundaries: [],
    };
    const r = groundingReview("系统尚未具备知识解析能力。", {
      goal: GOAL,
      snapshot: fabricated,
      authorityMap: buildAuthorityMap(),
    });
    assert.equal(
      r.blockingIssues.filter((i) => i.ruleId === "current_state_incorrect").length,
      0,
      "unknown capability must not back current_state_incorrect"
    );
    assert.equal(
      r.blockingIssues.filter((i) => i.ruleId === "existing_capability_ignored").length,
      0,
      "unknown capability must not back existing_capability_ignored"
    );
  });

  // ---- 3. Detects existing project knowledge (false "missing" claim blocked) ----
  await test("blocks documents that falsely claim project knowledge is missing", () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const r = groundingReview("当前系统缺乏统一的项目知识管理机制，需要从零开始建设。", {
      goal: GOAL,
      snapshot,
      authorityMap,
    });
    assert.ok(ruleIds(r).includes("current_state_incorrect"));
  });

  // ---- 4. Detects existing Knowledge Resolver (ignored capability blocked) ----
  await test("blocks documents that ignore the existing Knowledge Resolver", () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const r = groundingReview(acceptableDraft.replace(/Knowledge Resolver/g, "某机制").replace(/统一知识解析/g, "某解析"), {
      goal: GOAL,
      snapshot,
      authorityMap,
    });
    assert.ok(ruleIds(r).includes("existing_capability_ignored"));
    assert.ok(r.grounding.missingCurrentCapabilities.includes("knowledge_resolver"));
  });

  // ---- 5. PlanRecord duplication detected ----
  await test("detects PlanRecord duplication without reference markers", () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const bad = groundingReview("系统应维护 executionPlans 列表存储所有执行计划。", { goal: GOAL, snapshot, authorityMap });
    const hit = bad.blockingIssues.find((i) => i.ruleId === "duplicate_authority_source");
    assert.ok(hit);
    assert.ok(bad.grounding.duplicateAuthorityObjects.includes("PlanRecord"));
    const good = groundingReview("系统应引用现有 PlanRecord（planId）关联执行计划。", { goal: GOAL, snapshot, authorityMap });
    assert.ok(!good.grounding.duplicateAuthorityObjects.includes("PlanRecord"));
  });

  // ---- 6. Task duplication detected ----
  await test("detects Task duplication", () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const r = groundingReview("为此新建一套任务存储来管理任务状态。", { goal: GOAL, snapshot, authorityMap });
    assert.ok(r.grounding.duplicateAuthorityObjects.includes("Task"));
  });

  // ---- 7. ArtifactRef duplication detected ----
  await test("detects ArtifactRef duplication", () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const r = groundingReview("产出完成后记录为 keyOutcomes 关键成果列表。", { goal: GOAL, snapshot, authorityMap });
    assert.ok(r.grounding.duplicateAuthorityObjects.includes("ArtifactRef"));
  });

  // ---- 8. Unsupported SQLite assumption blocked; SecretStore mention allowed ----
  await test("blocks unsupported SQLite assumption but allows existing SecretStore mention", () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const r = groundingReview(
      "推荐使用 SQLite 作为持久化后端（延续当前架构方向）。本地存储应遵循既有加密策略（当前架构中已有 SecretStore 和 PolicyEngine）。",
      { goal: GOAL, snapshot, authorityMap }
    );
    const arch = r.blockingIssues.filter((i) => i.ruleId === "unsupported_architecture_assumption");
    assert.ok(arch.length >= 1);
    assert.ok(arch[0].message.includes("SQLite"));
    assert.ok(!arch.some((i) => i.message.includes("SecretStore")));
  });

  await test("does not treat negated/deferred capability statements as unsupported claims", () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const r = groundingReview(
      "当前存储基于 JSON 文件；SQLite 持久化、云同步、外部 Agent 适配层均未上线。不引入既有 SQLite 后端。",
      { goal: GOAL, snapshot, authorityMap }
    );
    const arch = r.blockingIssues.filter((i) => i.ruleId === "unsupported_architecture_assumption");
    assert.equal(arch.length, 0, JSON.stringify(arch));
    assert.ok(!ruleIds(r).includes("grounding_revision_guidance"));
  });

  await test("revision guidance is suggested only, never a blocking content defect", () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const r = groundingReview(
      "推荐使用 SQLite 作为持久化后端。总预估工时：9-15 人日。",
      { goal: GOAL, snapshot, authorityMap }
    );
    assert.ok(r.blockingIssues.length >= 1);
    assert.ok(!r.blockingIssues.some((i) => i.ruleId === "grounding_revision_guidance"));
    assert.ok(r.suggestedRevisions.some((s) => String(s).includes("修订方向") || String(s).includes("现有基础")));
  });

  // ---- 9. CRUD-only acceptance blocked ----
  await test("blocks acceptance criteria that only test CRUD", () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const body =
      "# 文档\n\n## 验收\n\n1. 创建项目成功并返回标识。\n2. 添加事实后可查询到。\n3. 导出 JSON 文件格式正确。\n";
    const r = groundingReview(body, { goal: GOAL, snapshot, authorityMap });
    assert.ok(ruleIds(r).includes("acceptance_only_tests_crud"));
  });

  // ---- 10. Cross-flow user-outcome acceptance passes ----
  await test("accepts acceptance criteria with cross-flow user outcomes", () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const body =
      "# 文档\n\n## 验收\n\n1. 用户修正事实后，新对话立即使用新事实。\n2. 新任务使用更新后的项目知识。\n3. 被 supersede 的旧事实停止生效。\n4. 重启后行为一致。\n";
    const r = groundingReview(body, { goal: GOAL, snapshot, authorityMap });
    assert.ok(!ruleIds(r).includes("acceptance_only_tests_crud"));
  });

  // ---- 11. Ordinary technical choices must not escalate to Owner ----
  await test("flags ordinary choices escalated to Owner; strategic topics exempt", () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const bad = groundingReview("场景 3 待 Owner 决策界面入口方式。", { goal: GOAL, snapshot, authorityMap });
    assert.ok(ruleIds(bad).includes("owner_decision_overreach"));
    const strategic = groundingReview("对外授权边界与数据主权方向待 Owner 决策。", { goal: GOAL, snapshot, authorityMap });
    assert.ok(!ruleIds(strategic).includes("owner_decision_overreach"));
  });

  // ---- 12. Unsubstantiated estimates blocked ----
  await test("blocks unsubstantiated estimates; labeled assumptions exempt", () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const bad = groundingReview("总预估工时：9-15 人日。", { goal: GOAL, snapshot, authorityMap });
    assert.ok(ruleIds(bad).includes("unsubstantiated_estimate"));
    const ok = groundingReview("工期约 5 人日（待验证假设，需在任务拆分后复核）。", { goal: GOAL, snapshot, authorityMap });
    assert.ok(!ruleIds(ok).includes("unsubstantiated_estimate"));
  });

  // ---- 13. Failure sample (artifact(3)) is blocked with all expected rule ids ----
  await test("failure sample artifact(3) is blocked with expected grounding issues", async () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const result = await reviewDeliverableContent({
      content: failureDraft,
      kind: "document",
      criteria: criteriaFor(fixture.goal),
      goal: fixture.goal,
      isDigitalMeProject: true,
      snapshot,
      authorityMap,
    });
    assert.equal(result.status, "fail");
    const ids = ruleIds(result);
    for (const expected of fixture.failure.expectedRuleIds) {
      assert.ok(ids.includes(expected), `expected ruleId ${expected} in ${JSON.stringify(ids)}`);
    }
    for (const entity of fixture.failure.expectedDuplicateEntities) {
      assert.ok(
        result.grounding.duplicateAuthorityObjects.includes(entity),
        `expected duplicate entity ${entity}`
      );
    }
    assert.ok(result.grounding.missingCurrentCapabilities.includes("knowledge_resolver"));
    assert.equal(result.grounding.currentStateAccuracy, "issues");
    assert.equal(result.grounding.acceptanceValueAlignment, "issues");
  });

  // ---- 14. Acceptable sample passes ----
  await test("acceptable sample passes grounding and full review", async () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const result = await reviewDeliverableContent({
      content: acceptableDraft,
      kind: "document",
      criteria: criteriaFor(fixture.goal),
      goal: fixture.goal,
      isDigitalMeProject: true,
      snapshot,
      authorityMap,
      callModel: async () => PASS_REVIEW_JSON,
    });
    assert.equal(
      result.status,
      "pass",
      JSON.stringify(result.blockingIssues.map((i) => [i.ruleId, i.message.slice(0, 60)]))
    );
    assert.equal(result.grounding.currentStateAccuracy, "pass");
    assert.equal(result.grounding.authorityConsistency, "pass");
    assert.equal(result.grounding.acceptanceValueAlignment, "pass");
  });

  // ---- 15. Automatic revision clears grounding issues; result persisted ----
  await test("e2e: revision clears grounding issues, quality persisted, files on disk", async () => {
    const ud = tempUserData();
    const pkgDir = path.join(ud, "pkg");
    try {
      createMinimalFixture(pkgDir);
      projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
      const seeded = await seedDocumentPackage(ud, GOAL);
      const view0 = packageStore.getPackageView(ud, seeded.packageId);
      const del = view0.deliverables[0];
      let draftCalls = 0;
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: del.id },
        {
          packageDir: pkgDir,
          callModel: async (_messages, options) => {
            if (options && options.taskType === "review") return PASS_REVIEW_JSON;
            draftCalls += 1;
            return draftCalls === 1 ? failureDraft : acceptableDraft;
          },
          imageMode: "mock",
          qualityPipelineMode: "advanced_shadow",
        }
      );
      assert.equal(res.ok, true, JSON.stringify({ code: res.code, message: res.message }));
      assert.equal(draftCalls, 2, "first draft + exactly one revision");
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const d = view.deliverables[0];
      assert.equal(d.generationStatus, "ready");
      const version = view.versions[d.currentVersionId];
      assert.ok(version.quality.reviewer.grounding, "grounding persisted on version");
      assert.equal(version.quality.reviewer.grounding.currentStateAccuracy, "pass");
      assert.equal(version.quality.reviewer.grounding.duplicateAuthorityObjects.length, 0);
      const attempts = Object.values(view.generationAttempts || {});
      assert.ok(attempts.some((a) => a.status === "superseded" && a.outcome === "repair_initiated"));
      const rejected = attempts.find((a) => a.outcome === "repair_initiated");
      assert.ok(rejected.failureEvidence && rejected.failureEvidence.reviewResult.grounding);
      const artDir = path.join(ud, "deliverable-artifacts", String(seeded.packageId), String(del.id), String(d.currentVersionId));
      assert.ok(fs.existsSync(path.join(artDir, "artifact.md")));

      // ---- 18. Restart recovery ----
      const fresh = packageStore.getPackageView(ud, seeded.packageId);
      const fv = fresh.versions[fresh.deliverables[0].currentVersionId];
      assert.ok(fv && fv.quality && fv.quality.reviewer && fv.quality.reviewer.grounding);
      assert.equal(fv.quality.reviewer.grounding.currentStateAccuracy, "pass");
    } finally {
      cleanup(ud);
    }
  });

  // ---- 16. Two revisions still grounding-blocked: no artifacts, evidence persisted ----
  await test("e2e: persistent grounding blocking stops without writing artifacts", async () => {
    const ud = tempUserData();
    const pkgDir = path.join(ud, "pkg");
    try {
      createMinimalFixture(pkgDir);
      projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
      const seeded = await seedDocumentPackage(ud, GOAL);
      const view0 = packageStore.getPackageView(ud, seeded.packageId);
      const del = view0.deliverables[0];
      let draftCalls = 0;
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: del.id },
        {
          packageDir: pkgDir,
          callModel: async (_messages, options) => {
            if (options && options.taskType === "review") return PASS_REVIEW_JSON;
            draftCalls += 1;
            return failureDraft;
          },
          imageMode: "mock",
          qualityPipelineMode: "advanced_shadow",
        }
      );
      assert.equal(res.ok, false);
      assert.equal(res.code, "review_content_rejected");
      assert.equal(draftCalls, 4, "first draft + 2 rebuilds + 1 clean regeneration");
      assert.ok(res.message.includes("成果与当前项目状态存在冲突"), "grounding failure message: " + res.message);
      assert.ok(!/AuthorityMap|CurrentSystemSnapshot|duplicate_authority_source|grounding/i.test(res.message));
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const d = view.deliverables[0];
      assert.equal(d.generationStatus, "failed");
      assert.equal(d.currentVersionId, null);
      const attempts = Object.values(view.generationAttempts || {});
      assert.equal(attempts.length, 4);
      const failedAttempt = attempts.find((a) => a.status === "failed");
      assert.ok(failedAttempt.failureEvidence.reviewResult.grounding, "grounding persisted in failure evidence");
      assert.ok(failedAttempt.failureEvidence.reviewResult.grounding.duplicateAuthorityObjects.length >= 2);
      assert.equal(failedAttempt.cleanRegenerationUsed, true, "clean regeneration audited on final failure");
      const artRoot = path.join(ud, "deliverable-artifacts", String(seeded.packageId), String(del.id));
      assert.ok(!fs.existsSync(artRoot), "no artifact directory for failed deliverable");
      assert.ok(res.groundingAudit && res.groundingAudit.cleanRegenerationUsed);
    } finally {
      cleanup(ud);
    }
  });

  // ---- 17. reviewerDegraded must not skip deterministic grounding ----
  await test("degraded model review never skips deterministic grounding", async () => {
    const { snapshot, authorityMap } = realSnapshotAndMap();
    const result = await reviewDeliverableContent({
      content: failureDraft,
      kind: "document",
      criteria: criteriaFor(fixture.goal),
      goal: fixture.goal,
      isDigitalMeProject: true,
      snapshot,
      authorityMap,
      callModel: async () => {
        throw new Error("review route down");
      },
    });
    assert.equal(result.reviewerDegraded, true);
    assert.equal(result.status, "fail");
    assert.ok(ruleIds(result).includes("unsupported_architecture_assumption"));
  });

  console.log("\ntask-quality-loop-01-1-grounding:", passed, "passed,", failed, "failed");
  process.exit(failed ? 1 : 0);
}

main();

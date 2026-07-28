"use strict";

/**
 * TASK-QUALITY-LOOP-01.1-FIX-01 — Grounded Generation tests.
 *
 * Covers authoritative system facts, historical demotion, Gap Statement,
 * grounded rebuild, and one-shot clean regeneration.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const { buildOutcomeCriteria } = require("../src/act-behalf/outcome-criteria");
const { buildCurrentSystemSnapshot } = require("../src/act-behalf/current-system-snapshot");
const { buildAuthorityMap } = require("../src/act-behalf/authority-map");
const {
  renderAuthoritativeSystemFactsBlock,
  demoteHistoricalMaterials,
  classifyMaterialAuthority,
  MATERIAL_AUTHORITY,
  buildGapStatement,
  validateGapStatement,
  ensureValidGapStatement,
  renderGapStatementBlock,
  needsGroundedRebuild,
  buildGroundedRebuildMessages,
  REPAIR_MODES,
} = require("../src/act-behalf/grounded-generation");
const { buildGenerationContext } = require("../src/act-behalf/deliverable-context");
const { generateByKindWithRepair, draftDocument } = require("../src/act-behalf/deliverable-generators");
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-tql011-fix01-"));
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

const PASS_REVIEW_JSON = JSON.stringify({
  status: "pass",
  blockingIssues: [],
  qualityIssues: [],
  suggestedRevisions: [],
  scores: {},
});

async function seedDocumentPackage(userData, goal) {
  const taskId = "abt_fix01_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
  return { taskId, packageId: prep.package.id, goal };
}

async function main() {
  const fixture = loadFixture();
  const failureDraft = fixture.failure.content;
  const acceptableDraft = fixture.acceptable.content;

  await test("authoritative system facts outrank historical stale status", () => {
    const snapshot = buildCurrentSystemSnapshot({ goal: GOAL });
    const authorityMap = buildAuthorityMap();
    const block = renderAuthoritativeSystemFactsBlock(snapshot, authorityMap);
    assert.ok(block.text.includes("CURRENT SYSTEM FACTS — AUTHORITATIVE"));
    assert.ok(block.text.includes("capabilityId=project_knowledge_store"));
    assert.ok(block.text.includes("capabilityId=knowledge_resolver"));
    assert.ok(block.text.includes("currentStatus=present"));
    assert.ok(block.text.includes("authoritativeModule="));
    assert.ok(block.text.includes("sourceRef="));
    assert.ok(block.facts.some((f) => f.capabilityId === "knowledge_resolver"));

    const ctx = buildGenerationContext({
      pkg: { executionSnapshot: { inputSummary: { goal: GOAL } }, id: "pkg", taskId: "t" },
      deliverable: { id: "d", title: "PRD", kind: "document", purpose: "dev" },
      task: { taskId: "t", goal: GOAL },
      referenceMaterials: [
        {
          id: "old",
          name: "旧规划",
          text: "项目知识功能尚未启动，待实现统一知识库。",
          note: "planning",
        },
      ],
      isDigitalMeProject: true,
      outcomeCriteria: buildOutcomeCriteria({
        goal: GOAL,
        kind: "document",
        title: "PRD",
        isDigitalMeProject: true,
      }),
      authoritativeFactsText: block.text,
      systemFactsText: "已具备：项目知识存储",
    });
    assert.ok(ctx.authoritativeFactsText.includes("AUTHORITATIVE"));
    assert.ok(ctx.attachmentText.includes("planning_only") || ctx.attachmentText.includes("旧规划"));
    // Stale phrasing may appear in materials, but authoritative block must remain present and first-class.
    assert.ok(ctx.authoritativeFactsText.indexOf("knowledge_resolver") >= 0);
  });

  await test("superseded historical entries do not enter current facts", () => {
    const materials = [
      {
        id: "cur",
        name: "current",
        text: "Knowledge Resolver 已实现并可跨任务调用。",
        authorityLevel: "accepted_runtime_state",
        claimType: "current_status",
        confirmationStatus: "owner_confirmed",
      },
      {
        id: "old",
        name: "old",
        text: "项目知识尚未建立。",
        claimType: "historical_exploration",
        authorityLevel: "historical_record",
        confirmationStatus: "superseded",
        supersededBy: "cur",
      },
    ];
    const out = demoteHistoricalMaterials(materials, { includeHistoricalAnnotated: false });
    assert.equal(out.materials.length, 1);
    assert.equal(out.materials[0].id, "cur");
    assert.equal(out.materials[0].materialAuthority, MATERIAL_AUTHORITY.CURRENT_AUTHORITATIVE);
    assert.equal(out.demoted.length, 1);
    assert.equal(out.demoted[0].reason, "historical_superseded");
    assert.equal(classifyMaterialAuthority(materials[1]), MATERIAL_AUTHORITY.HISTORICAL_SUPERSEDED);
  });

  await test("ExistingCapabilities and ActualGaps must not overlap", () => {
    const snapshot = buildCurrentSystemSnapshot({ goal: GOAL });
    const authorityMap = buildAuthorityMap();
    const gap = ensureValidGapStatement(
      buildGapStatement({ snapshot, authorityMap, goal: GOAL })
    );
    assert.ok(gap.ExistingCapabilities.some((c) => c.id === "knowledge_resolver"));
    assert.ok(gap.ExistingCapabilities.some((c) => c.id === "project_knowledge_store"));
    assert.equal(gap.validation.ok, true);
    for (const g of gap.ActualGaps) {
      assert.ok(!/建立\s*Knowledge Resolver|从零.*项目知识|缺乏.*Knowledge Resolver/.test(g.label));
      assert.ok(!gap.ExistingCapabilities.some((c) => c.id === g.id));
    }

    const conflicting = {
      ExistingCapabilities: [{ id: "knowledge_resolver", label: "统一知识解析 Knowledge Resolver" }],
      ActualGaps: [{ id: "bad", label: "建立 Knowledge Resolver" }],
    };
    const v = validateGapStatement(conflicting);
    assert.equal(v.ok, false);
    assert.ok(v.conflicts.length >= 1);
    const fixed = ensureValidGapStatement({ ...conflicting, validation: v });
    assert.equal(fixed.validation.ok, true);
    assert.equal(fixed.ActualGaps.length, 0);
  });

  await test("current_state_incorrect triggers grounded rebuild (not local patch)", async () => {
    const modes = [];
    const snapshot = buildCurrentSystemSnapshot({ goal: GOAL });
    const authorityMap = buildAuthorityMap();
    const facts = renderAuthoritativeSystemFactsBlock(snapshot, authorityMap).text;
    const gap = renderGapStatementBlock(
      ensureValidGapStatement(buildGapStatement({ snapshot, authorityMap, goal: GOAL }))
    );
    const goodDraft = [
      "# 项目知识功能 PRD",
      "",
      "## 现有基础",
      "当前系统已具备项目知识存储（project-knowledge-store）、Knowledge Resolver、学习闭环（含 supersede）与来源可见。",
      "",
      "## 真实用户问题",
      "需要在现有能力上补齐可直接实施的产品缺口说明。",
      "",
      "## 实际缺口",
      "项目知识浏览与管理体验仍可完善；不得从零重建 Knowledge Resolver。",
      "",
      "## 最小新增能力",
      "在现有 ProjectKnowledgeClaim 上增强浏览与引用展示。",
      "",
      "## 与现有权威对象的关系",
      "复用现有 ProjectKnowledge、Task、ArtifactRef；不新建第二套知识存储。",
      "",
      "## 用户路径",
      "用户在新任务中自动获得正确项目知识。",
      "",
      "## 验收标准",
      "新对话可调用更新后的事实；被 supersede 的旧知识停止生效；不同项目不串用。",
      "",
      "## 不做事项",
      "不引入既有 SQLite 后端；不重建项目知识 CRUD 作为主目标。",
    ].join("\n");
    let calls = 0;
    const produced = await generateByKindWithRepair(
      "document",
      {
        pkg: {
          id: "pkg",
          taskId: "t",
          executionSnapshot: { inputSummary: { goal: GOAL }, understanding: {} },
        },
        deliverable: { id: "d", title: "PRD", kind: "document", purpose: "dev" },
        task: { taskId: "t", goal: GOAL },
        referenceMaterials: [],
        isDigitalMeProject: true,
        projectResolved: {
          ok: true,
          projectId: "project_digital_me",
          projectContextId: "pctx_unit_fix01",
          displayLabel: "Digital Me",
        },
        outcomeCriteria: buildOutcomeCriteria({
          goal: GOAL,
          kind: "document",
          title: "PRD",
          isDigitalMeProject: true,
        }),
        authoritativeFactsText: facts,
        gapStatementText: gap,
        callModel: async () => {
          calls += 1;
          return calls === 1 ? failureDraft : goodDraft;
        },
      },
      {
        maxRepairAttempts: 2,
        allowCleanRegeneration: false,
        onDraftValidated: async ({ draft, repairContext }) => {
          // Bypass full grounding on the rebuilt draft; we only assert repair mode wiring.
          if (calls === 1) {
            const e = new Error("grounding");
            e.code = "review_content_rejected";
            e.reviewResult = {
              status: "fail",
              blockingIssues: [
                {
                  ruleId: "current_state_incorrect",
                  message: "宣称项目知识缺失",
                  source: "grounding",
                },
              ],
            };
            e.reviewIssues = e.reviewResult.blockingIssues;
            throw e;
          }
          assert.equal(repairContext && repairContext.mode, REPAIR_MODES.GROUNDED_REBUILD);
          void draft;
        },
        onDraftRejected: async ({ nextRepairContext }) => {
          modes.push(nextRepairContext && nextRepairContext.mode);
        },
      }
    );
    assert.equal(calls, 2);
    assert.deepEqual(modes, [REPAIR_MODES.GROUNDED_REBUILD]);
    assert.equal(produced.groundingAudit.groundedRebuildUsed, true);
    assert.ok(
      needsGroundedRebuild({
        blockingIssues: [{ ruleId: "existing_capability_ignored" }],
      })
    );
  });

  await test("grounded rebuild does not carry full failed draft", async () => {
    const snapshot = buildCurrentSystemSnapshot({ goal: GOAL });
    const authorityMap = buildAuthorityMap();
    const facts = renderAuthoritativeSystemFactsBlock(snapshot, authorityMap).text;
    const ctx = buildGenerationContext({
      pkg: { id: "pkg", taskId: "t", executionSnapshot: { inputSummary: { goal: GOAL } } },
      deliverable: { id: "d", title: "PRD", kind: "document", purpose: "dev" },
      task: { taskId: "t", goal: GOAL },
      isDigitalMeProject: true,
      outcomeCriteria: buildOutcomeCriteria({
        goal: GOAL,
        kind: "document",
        title: "PRD",
        isDigitalMeProject: true,
      }),
      authoritativeFactsText: facts,
      gapStatementText: "ExistingCapabilities:\n  - knowledge_resolver",
    });
    const uniqueMarker = "UNIQUE_FAILED_DRAFT_MARKER_" + Date.now();
    const failed = failureDraft + "\n\n" + uniqueMarker;
    const messages = buildGroundedRebuildMessages(ctx, [
      { ruleId: "current_state_incorrect", message: "现状错误" },
    ]);
    const joined = JSON.stringify(messages);
    assert.ok(!joined.includes(uniqueMarker));
    assert.ok(!joined.includes(failed.slice(0, 120)));
    assert.ok(joined.includes("禁止再次出现的问题"));
    assert.ok(joined.includes("现有基础"));

    let seen = "";
    await draftDocument(
      {
        pkg: { id: "pkg", taskId: "t", executionSnapshot: { inputSummary: { goal: GOAL } } },
        deliverable: { id: "d", title: "PRD", kind: "document", purpose: "dev" },
        task: { taskId: "t", goal: GOAL },
        isDigitalMeProject: true,
        outcomeCriteria: buildOutcomeCriteria({
          goal: GOAL,
          kind: "document",
          title: "PRD",
          isDigitalMeProject: true,
        }),
        authoritativeFactsText: facts,
        callModel: async (messages) => {
          seen = JSON.stringify(messages);
          return acceptableDraft;
        },
      },
      {
        mode: REPAIR_MODES.GROUNDED_REBUILD,
        priorDraft: null,
        issues: [{ ruleId: "current_state_incorrect", message: "现状错误" }],
      }
    );
    assert.ok(!seen.includes(uniqueMarker));
    assert.ok(seen.includes("AUTHORITATIVE") || seen.includes("capabilityId="));
  });

  await test("e2e: grounded rebuild clears project-knowledge state conflict and persists", async () => {
    const ud = tempUserData();
    const pkgDir = path.join(ud, "pkg");
    try {
      createMinimalFixture(pkgDir);
      projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
      const seeded = await seedDocumentPackage(ud, GOAL);
      const view0 = packageStore.getPackageView(ud, seeded.packageId);
      const del = view0.deliverables[0];
      let draftCalls = 0;
      const captured = [];
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: del.id },
        {
          packageDir: pkgDir,
          callModel: async (messages, options) => {
            if (options && options.taskType === "review") return PASS_REVIEW_JSON;
            draftCalls += 1;
            captured.push(JSON.stringify(messages));
            return draftCalls === 1 ? failureDraft : acceptableDraft;
          },
          imageMode: "mock",
        }
      );
      assert.equal(res.ok, true, JSON.stringify({ code: res.code, message: res.message }));
      assert.equal(draftCalls, 2);
      assert.equal(res.groundingAudit.groundedRebuildUsed, true);
      assert.equal(res.groundingAudit.cleanRegenerationUsed, false);
      // Rebuild messages must not contain the full failure draft body.
      assert.ok(!captured[1].includes(failureDraft.slice(0, 180)));
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const d = view.deliverables[0];
      assert.equal(d.generationStatus, "ready");
      const version = view.versions[d.currentVersionId];
      assert.ok(version.quality.groundingAudit);
      assert.equal(version.quality.groundingAudit.groundedRebuildUsed, true);
      const attempts = Object.values(view.generationAttempts || {});
      assert.ok(attempts.some((a) => a.repairMode === REPAIR_MODES.GROUNDED_REBUILD || a.groundedRebuildUsed));
    } finally {
      cleanup(ud);
    }
  });

  await test("e2e: two grounding failures then one clean regeneration succeeds and writes artifacts", async () => {
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
          callModel: async (messages, options) => {
            if (options && options.taskType === "review") return PASS_REVIEW_JSON;
            draftCalls += 1;
            if (draftCalls <= 3) return failureDraft;
            // Clean regeneration context should be clean (no subject/attachment dump required).
            const joined = JSON.stringify(messages);
            assert.ok(joined.includes("干净上下文") || joined.includes("AUTHORITATIVE") || joined.includes("capabilityId="));
            return acceptableDraft;
          },
          imageMode: "mock",
        }
      );
      assert.equal(res.ok, true, JSON.stringify({ code: res.code, message: res.message }));
      assert.equal(draftCalls, 4, "user must not manually re-trigger");
      assert.equal(res.groundingAudit.cleanRegenerationUsed, true);
      assert.equal(res.groundingAudit.groundedRebuildUsed, true);
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const d = view.deliverables[0];
      assert.equal(d.generationStatus, "ready");
      assert.ok(d.currentVersionId);
      const artDir = path.join(
        ud,
        "deliverable-artifacts",
        String(seeded.packageId),
        String(del.id),
        String(d.currentVersionId)
      );
      assert.ok(fs.existsSync(path.join(artDir, "artifact.md")));
      const attempts = Object.values(view.generationAttempts || {});
      assert.ok(attempts.some((a) => a.cleanRegenerationUsed === true));
      assert.ok(attempts.filter((a) => a.repairMode === REPAIR_MODES.CLEAN_REGENERATION).length <= 1);
    } finally {
      cleanup(ud);
    }
  });

  await test("e2e: clean regeneration runs only once; persistent failure does not write artifacts", async () => {
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
        }
      );
      assert.equal(res.ok, false);
      assert.equal(draftCalls, 4);
      assert.equal(res.groundingAudit.cleanRegenerationUsed, true);
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const attempts = Object.values(view.generationAttempts || {});
      const cleanAttempts = attempts.filter((a) => a.repairMode === REPAIR_MODES.CLEAN_REGENERATION);
      assert.ok(cleanAttempts.length <= 1);
      assert.equal(view.deliverables[0].currentVersionId, null);
      const artRoot = path.join(ud, "deliverable-artifacts", String(seeded.packageId), String(del.id));
      assert.ok(!fs.existsSync(artRoot));
    } finally {
      cleanup(ud);
    }
  });

  await test("audit records rebuild and clean regeneration without leaking to user message", async () => {
    const ud = tempUserData();
    const pkgDir = path.join(ud, "pkg");
    try {
      createMinimalFixture(pkgDir);
      projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
      const seeded = await seedDocumentPackage(ud, GOAL);
      const view0 = packageStore.getPackageView(ud, seeded.packageId);
      const del = view0.deliverables[0];
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: del.id },
        {
          packageDir: pkgDir,
          callModel: async (_messages, options) => {
            if (options && options.taskType === "review") return PASS_REVIEW_JSON;
            return failureDraft;
          },
          imageMode: "mock",
        }
      );
      assert.equal(res.ok, false);
      assert.ok(res.groundingAudit.groundedRebuildUsed);
      assert.ok(res.groundingAudit.cleanRegenerationUsed);
      assert.ok(!/grounded rebuild|clean regeneration|snapshot digest|调用次数/i.test(res.message));
    } finally {
      cleanup(ud);
    }
  });

  console.log("\ntask-quality-loop-01-1-fix-01:", passed, "passed,", failed, "failed");
  process.exit(failed ? 1 : 0);
}

main();

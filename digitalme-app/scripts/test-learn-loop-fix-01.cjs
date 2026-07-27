"use strict";

/**
 * LEARN-LOOP-FIX-01 acceptance tests.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const { createMinimalFixture } = require("../src/package-store/fixture");
const projectStore = require("../src/act-behalf/project-knowledge-store");
const { resolveProjectContext, detectProjectFromGoal } = require("../src/act-behalf/project-context-registry");
const {
  retrieveProjectClaims,
  classifyMemoryAsset,
} = require("../src/act-behalf/project-knowledge-retrieval");
const { classifyTaskContext, assertProjectAuthorityConsistency } = require("../src/act-behalf/subject-context-engine");
const { assertGeneratedContentUsable } = require("../src/act-behalf/deliverable-context");
const generation = require("../src/act-behalf/deliverable-generation");
const actStore = require("../src/act-behalf/task-store");
const planner = require("../src/act-behalf/deliverable-planner");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const artifactFs = require("../src/act-behalf/deliverable-artifact-fs");

function depsPrepare(ud) {
  return {
    getTask: (u, id) => actStore.getTask(u, id, { heal: false }),
    getPlan: (u, planId) => require("../src/act-behalf/deliverable-plan-store").getPlan(u, planId),
    saveTaskExecution: async (u, id, exec) => {
      const got = actStore.getTask(u, id, { heal: false });
      return actStore.saveTask(u, {
        ...got.task,
        deliverableExecution: { activePackageId: exec.activePackageId || null },
      });
    },
  };
}

async function seedDigitalMePlan(userData, taskId, pkgDir) {
  const goal = "开始起草 Digital Me 项目的开发计划";
  await actStore.saveTask(userData, {
    taskId,
    title: goal,
    goal,
    request: goal,
    status: "draft",
    referenceMaterials: [],
  });
  const suggestion = planner.ruleBasedPlan({ goal });
  suggestion.items = [
    {
      id: "pd_document",
      kind: "document",
      title: "DigitalMe开发计划书",
      purpose: "项目开发核心规划文档",
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
  projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
  const prep = await prepareDeliverablePackage(userData, { taskId }, depsPrepare(userData));
  assert.equal(prep.ok, true);
  return prep;
}

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

function cleanup(d) {
  try {
    fs.rmSync(d, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function main() {
  await test("detect Digital Me project from goal", () => {
    const d = detectProjectFromGoal("开始起草 Digital Me 项目的开发计划");
    assert.ok(d);
    assert.equal(d.projectId, "project_digital_me");
  });

  await test("authoritative files register into ProjectContextSet", () => {
    const pkgDir = tempDir("llf01-pkg-");
    createMinimalFixture(pkgDir);
    const ensured = projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
    assert.ok(ensured.ok);
    assert.ok(ensured.sourceCount >= 3, "expected multiple authoritative sources");
    const cs = projectStore.getContextSet(pkgDir, "pctx_digital_me_default");
    assert.ok(cs);
    assert.ok(cs.authoritativeSourceRefs.length >= 1);
    cleanup(pkgDir);
  });

  await test("unregistered file on disk alone is not learned", () => {
    const pkgDir = tempDir("llf01-pkg2-");
    createMinimalFixture(pkgDir);
    const orphan = path.join(pkgDir, "orphan-not-registered.md");
    fs.writeFileSync(orphan, "# orphan", "utf8");
    const resolved = resolveProjectContext(pkgDir, {
      goal: "开始起草 Digital Me 项目的开发计划",
    });
    assert.ok(resolved.ok);
    const names = resolved.materials.map((m) => m.name);
    assert.ok(!names.includes("orphan-not-registered.md"));
    cleanup(pkgDir);
  });

  await test("authority ranking prefers frozen spec over historical exploration", () => {
    const claims = projectStore.buildDigitalMeSeedClaims();
    const result = retrieveProjectClaims({
      claims,
      query: "Digital Me 稳定币 区块链 开发计划",
      projectId: "project_digital_me",
    });
    const texts = result.claims.map((c) => c.claimText).join("\n");
    assert.ok(/不是.*主技术底座|不是当前产品主线/.test(texts));
    assert.ok(!result.claims.some((c) => c.claimType === "historical_exploration"));
  });

  await test("conflict governance: current decision beats stablecoin exploration", () => {
    const claims = projectStore.buildDigitalMeSeedClaims();
    const current = claims.find((c) => c.claimId === "pkc_dm_no_stablecoin_mainline");
    const historical = claims.find((c) => c.memoryAssetId === "core_009");
    assert.ok(current);
    assert.ok(historical);
    const result = retrieveProjectClaims({
      claims,
      query: "稳定币 支付通道 项目主线",
      projectId: "project_digital_me",
    });
    assert.ok(result.claims.some((c) => c.claimId === "pkc_dm_no_stablecoin_mainline"));
    assert.ok(
      result.excludedClaims.some(
        (e) => e.reason === "historical_excluded_by_default" || e.reason === "superseded"
      )
    );
  });

  await test("memory governance excludes core_008 core_009 from assembly", () => {
    assert.equal(classifyMemoryAsset({ assetId: "core_008", statement: "UBC" }).excluded, true);
    assert.equal(classifyMemoryAsset({ assetId: "core_009", statement: "稳定币" }).excluded, true);
  });

  await test("project plan classifies as project_document_generation not decision_support", () => {
    const c = classifyTaskContext({
      goal: "开始起草 Digital Me 项目的开发计划",
      deliverableTitle: "DigitalMe开发计划书",
      deliverablePurpose: "概述项目背景、目标、范围、时间表、资源需求和风险管理。",
      deliverableKind: "document",
    });
    assert.equal(c.contextClass, "project_document_generation");
    assert.ok(!c.signals.includes("goal:decision"));
  });

  await test("reviewer rejects ungrounded team and budget numbers for Digital Me", () => {
    const bad =
      "# 计划\n\n技术团队至少 6-8 人。第一年预算 300-500 万元。开发周期 15 个月。\n";
    const corpus = "Digital Me 是人的数字主体层；区块链不是主技术底座。";
    assert.throws(
      () =>
        assertGeneratedContentUsable(bad, {
          goal: "开始起草 Digital Me 项目的开发计划",
          contextClass: "project_document_generation",
          evidenceCorpus: corpus,
          isDigitalMeProject: true,
        }),
      (e) => e.code === "ungrounded_project_numbers" || e.code === "project_authority_conflict"
    );
  });

  await test("reviewer blocks stablecoin as mainline", () => {
    const bad = "Digital Me 以稳定币支付通道和 UBC 分配为核心主线基础设施。";
    const corpus = projectStore
      .buildDigitalMeSeedClaims()
      .map((c) => c.claimText)
      .join("\n");
    assert.throws(
      () => assertProjectAuthorityConsistency(bad, corpus, { isDigitalMeProject: true }),
      (e) => e.code === "project_authority_conflict"
    );
  });

  await test("generation with fake model uses project context (no stablecoin mainline)", async () => {
    const userData = tempDir("llf01-ud-");
    const pkgDir = tempDir("llf01-pkg3-");
    createMinimalFixture(pkgDir, { withMemoryLine: true });

    const taskId = actStore.newTaskId();
    const prep = await seedDigitalMePlan(userData, taskId, pkgDir);
    const d0 = prep.deliverables[0];
    const gen = await generation.generateOneDeliverable(
      userData,
      { packageId: prep.package.id, deliverableId: d0.id },
      { packageDir: pkgDir, callModel: null, imageMode: "mock" }
    );
    assert.ok(gen.ok, gen.message || gen.code);
    const ver = gen.version;
    const md = fs.readFileSync(artifactFs.resolveAbsolute(userData, ver.artifactRef.relativePath), "utf8");
    assert.ok(/数字主体|Digital Me/i.test(md));
    assert.ok(!/稳定币支付通道.*核心|UBC.*主线|6.?8\s*人|300.?500\s*万/i.test(md));
    cleanup(userData);
    cleanup(pkgDir);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

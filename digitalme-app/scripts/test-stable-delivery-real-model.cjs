"use strict";

/**
 * TASK-QUALITY-STABILIZE-01 — real-model stable delivery harness (isolated userData).
 *
 * Usage:
 *   npm run test:stable-delivery-real-model
 *
 * Requires a configured model route in the app config (or DIGITALME_STABLE_REAL=1 with secrets).
 * Does NOT read Owner production deliverable packages; uses a temp userData directory.
 * Does NOT print API keys.
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

const GOAL = "为 Digital Me 的项目知识功能生成一份可直接用于当前产品开发的 PRD。";
const RUNS = 3;

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function seed(userData) {
  const taskId = "abt_real_" + Date.now().toString(36);
  await actStore.saveTask(userData, { taskId, title: GOAL, goal: GOAL, request: GOAL, status: "draft" });
  const suggestion = planner.ruleBasedPlan({ goal: GOAL });
  suggestion.items = [
    {
      id: "pd_doc",
      kind: "document",
      title: "Digital Me 项目知识功能 PRD",
      purpose: "可直接用于当前产品开发",
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
    goal: GOAL,
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
  await planConsistency.commitPlanThenTask({
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
  return { packageId: prep.package.id, deliverableId: prep.deliverables[0].id };
}

function tryBuildRealCallModel() {
  if (process.env.DIGITALME_DVL2_03_MOCK_MODEL === "1" || process.env.DIGITALME_ACT_BEHALF_FAKE === "1") {
    return null;
  }
  if (process.env.DIGITALME_STABLE_REAL !== "1" && process.env.DIGITALME_STABLE_FORCE_REAL !== "1") {
    return null;
  }
  try {
    // Prefer the same model route the Electron app uses when secrets are present.
    const { callModel } = require("../src/model-routing");
    const cfgPath = process.env.DIGITALME_CONFIG_PATH;
    let cfg = {};
    if (cfgPath && fs.existsSync(cfgPath)) {
      cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    }
    return async (messages, options = {}) =>
      callModel(cfg, messages, { ...(options || {}), taskType: options.taskType || "artifact" });
  } catch (err) {
    console.error("real model route unavailable:", err && err.message);
    return null;
  }
}

async function main() {
  const callModel = tryBuildRealCallModel();
  if (!callModel) {
    console.log(
      "SKIP test:stable-delivery-real-model — set DIGITALME_STABLE_REAL=1 with a configured model route,"
    );
    console.log("or complete Owner Electron acceptance (npm start) for the same goal.");
    console.log("Mock-only success must not be reported as real-model proof.");
    process.exit(0);
  }

  const results = [];
  for (let i = 0; i < RUNS; i++) {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), "dm-stable-real-"));
    try {
      const seeded = await seed(ud);
      const started = Date.now();
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: seeded.deliverableId },
        {
          qualityPipelineMode: "stable_delivery",
          imageMode: "mock",
          callModel,
        }
      );
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const d = view.deliverables[0];
      const ver = d.currentVersionId ? view.versions[d.currentVersionId] : null;
      const artPath =
        ver &&
        path.join(
          ud,
          "deliverable-artifacts",
          String(seeded.packageId),
          String(d.id),
          String(d.currentVersionId),
          "artifact.md"
        );
      const row = {
        run: i + 1,
        ok: !!res.ok,
        generationStatus: d.generationStatus,
        hasVersion: !!d.currentVersionId,
        fileExists: !!(artPath && fs.existsSync(artPath)),
        enhancement: res.enhancement || null,
        durationMs: Date.now() - started,
        modelCallCount:
          (res.groundingAudit && res.groundingAudit.modelCallCount) ||
          (res.enhancement && res.enhancement.modelCalls) ||
          null,
      };
      results.push(row);
      console.log("RUN", JSON.stringify(row));
      assert.equal(res.ok, true, "baseline must succeed");
      assert.equal(d.generationStatus, "ready");
      assert.ok(d.currentVersionId);
      assert.ok(artPath && fs.existsSync(artPath));
    } finally {
      cleanup(ud);
    }
  }

  assert.equal(results.filter((r) => r.ok && r.fileExists).length, RUNS);
  console.log("stable-delivery-real-model: %d/%d baseline persisted", RUNS, RUNS);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

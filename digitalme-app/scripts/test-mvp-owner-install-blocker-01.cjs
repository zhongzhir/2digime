"use strict";

/**
 * MVP-OWNER-INSTALL-BLOCKER-01 — digest stability + sticky stale heal.
 *   node scripts/test-mvp-owner-install-blocker-01.cjs
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { normalizeReferenceMaterials } = require("../src/act-behalf/deliverable-context");
const deliverablePlanner = require("../src/act-behalf/deliverable-planner");
const { confirmPlanAndGenerate } = require("../src/act-behalf/deliverable-confirm-and-generate");
const actBehalfStore = require("../src/act-behalf/task-store");
const deliverablePlanStore = require("../src/act-behalf/deliverable-plan-store");
const deliverablePlanConsistency = require("../src/act-behalf/deliverable-plan-consistency");

async function test(name, fn) {
  try {
    await fn();
    console.log("PASS", name);
  } catch (err) {
    console.error("FAIL", name, err && err.message ? err.message : err);
    throw err;
  }
}

async function main() {
  await test("1) long material re-normalize keeps planning digest stable", () => {
    const long = ("幻灯片内容\n".repeat(4000) + "A".repeat(5000)).slice(0, 35000);
    const first = normalizeReferenceMaterials([
      { id: "pptx1", name: "plan.pptx", text: long, ok: true },
      {
        id: "folder1",
        name: "商务资料",
        text: "文件夹「商务资料」共 23 个文件。\n" + Array.from({ length: 23 }, (_, i) => `file_${i}.docx`).join("\n"),
        ok: true,
        isFolder: true,
        fileCount: 23,
      },
    ]);
    const d1 = deliverablePlanner.planningMaterialsDigest(
      deliverablePlanner.summarizeReferenceMaterialsForPlanning(first)
    );
    const second = normalizeReferenceMaterials(
      first.map((m) => ({
        id: m.id,
        name: m.name,
        text: m.text,
        ok: true,
        contentHash: m.contentHash,
        charCount: m.charCount,
        isFolder: m.isFolder,
        fileCount: m.fileCount,
      }))
    );
    const d2 = deliverablePlanner.planningMaterialsDigest(
      deliverablePlanner.summarizeReferenceMaterialsForPlanning(second)
    );
    assert.equal(first[0].charCount, first[0].text.length);
    assert.equal(second[0].charCount, second[0].text.length);
    assert.equal(d1, d2, "digest must not flip across re-save");
  });

  await test("2) sticky materialsStale with matching digest is healed and generate proceeds past gate", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-blocker-01-"));
    const materials = normalizeReferenceMaterials([
      { id: "pptx1", name: "plan.pptx", text: "商业计划摘要\n".repeat(2000), ok: true },
      {
        id: "folder1",
        name: "中鉴智投",
        text: "文件夹列表\n" + Array.from({ length: 23 }, (_, i) => `doc_${i}.docx`).join("\n"),
        ok: true,
        isFolder: true,
        fileCount: 23,
      },
    ]);
    const created = await actBehalfStore.saveTask(userData, {
      title: "新闻通稿",
      goal: "写一份1000字以内创业大赛获奖报道",
      request: "写一份1000字以内创业大赛获奖报道",
      status: "draft",
      referenceMaterials: materials,
    });
    assert.equal(created.ok, true);
    const suggestion = deliverablePlanner.ruleBasedPlan({
      goal: created.task.goal,
      referenceMaterials: materials,
    });
    const applied = deliverablePlanner.applySuggestionToRecord({
      taskId: created.task.taskId,
      existingRecord: null,
      suggestion,
      goal: created.task.goal,
    });
    const digest = deliverablePlanner.planningMaterialsDigest(
      deliverablePlanner.summarizeReferenceMaterialsForPlanning(materials)
    );
    const committed = await deliverablePlanConsistency.commitPlanThenTask({
      userData,
      planRecord: applied.plan,
      saveTaskPointers: async ({ deliverablePlanning }) =>
        actBehalfStore.saveTask(userData, {
          ...created.task,
          deliverablePlanning: {
            ...deliverablePlanning,
            plannedMaterialsDigest: digest,
            materialsStale: true, // sticky false-positive
            materialsStaleReason: "reference_materials_changed",
            materialsStaleAt: new Date().toISOString(),
          },
        }),
      cas: { expectAbsent: true },
    });
    assert.equal(committed.ok, true);

    let generateEntered = false;
    let res;
    try {
      res = await confirmPlanAndGenerate({
        userData,
        taskId: created.task.taskId,
        loadPlanForTaskOrFail: async (ud, tid) => {
          const got = actBehalfStore.getTask(ud, tid, { heal: false });
          const planId = got.task && got.task.deliverablePlanning && got.task.deliverablePlanning.planId;
          const gotPlan = planId ? deliverablePlanStore.getPlan(ud, planId) : null;
          const plan = gotPlan && gotPlan.plan ? gotPlan.plan : gotPlan;
          return { ok: true, task: got.task, plan };
        },
        assertFreshPlan: async (ud, planId) => {
          const gotPlan = deliverablePlanStore.getPlan(ud, planId);
          return { ok: true, plan: gotPlan && gotPlan.plan ? gotPlan.plan : gotPlan };
        },
        extractRevisionExpected: () => null,
        saveTaskPlanPointers: async (ud, tid, args) => {
          const got = actBehalfStore.getTask(ud, tid, { heal: false });
          return actBehalfStore.saveTask(ud, {
            ...got.task,
            ...(args || {}),
          });
        },
        buildDeliverablePlanView: () => ({ ok: true }),
        getTask: (ud, id) => actBehalfStore.getTask(ud, id, { heal: false }),
        getPlan: (ud, planId) => {
          const gotPlan = deliverablePlanStore.getPlan(ud, planId);
          return gotPlan && gotPlan.plan ? gotPlan.plan : gotPlan;
        },
        saveTaskExecution: async () => ({ ok: true }),
        reconcilePackagesForTask: async () => ({ ok: true }),
        callModel: async () => {
          generateEntered = true;
          return "# 通稿\n\n正文".repeat(40);
        },
        imageMode: "mock",
        packageDir: path.join(userData, "pkg"),
      });
    } catch (err) {
      res = { ok: false, code: err && err.code, message: String(err && err.message) };
    }

    // Must NOT fail at plan_materials_stale gate (may fail later on package/auth in hermetic test).
    assert.notEqual(res && res.code, "plan_materials_stale");
    const after = actBehalfStore.getTask(userData, created.task.taskId, { heal: false }).task;
    assert.equal(after.deliverablePlanning.materialsStale, false, "sticky stale healed");
    fs.rmSync(userData, { recursive: true, force: true });
    void generateEntered;
  });

  console.log("mvp-owner-install-blocker-01: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

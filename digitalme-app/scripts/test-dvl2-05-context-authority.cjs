"use strict";

/**
 * Regression tests for Owner runtime blockers:
 * - no legacy 开始 on DVL2 page
 * - confirmed plan not flipped to video_audio by attachment keywords
 * - generation context unwraps PlanVersion + includes attachments
 * - placeholders / demo content rejected
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const actStore = require("../src/act-behalf/task-store");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const planner = require("../src/act-behalf/deliverable-planner");
const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
const generation = require("../src/act-behalf/deliverable-generation");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const {
  buildGenerationContext,
  unwrapField,
  assertGeneratedContentUsable,
  normalizeReferenceMaterials,
} = require("../src/act-behalf/deliverable-context");
const {
  generateWebpage,
  buildSlideMessages,
} = require("../src/act-behalf/deliverable-generators");
const { detectTaskType, TASK_TYPES } = require("../src/act-behalf/task-intent");
const { buildDraftSaveRecord } = require("../src/act-behalf/task-save-boundary");

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

async function seedPlanAndPackage(userData, { goal, kinds, materials }) {
  const taskId = "t_fix_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  await actStore.saveTask(userData, {
    taskId,
    title: "Digital Me 介绍",
    goal,
    request: goal,
    status: "draft",
    referenceMaterials: materials || [],
  });
  const suggestion = planner.ruleBasedPlan({ goal });
  suggestion.items = kinds.map((kind, i) => ({
    id: "pd_" + kind,
    kind,
    title: kind === "presentation" ? "投资人介绍演示" : kind === "webpage" ? "官网页面" : kind + " 成果",
    purpose: "面向投资人的 Digital Me 介绍",
    format: kind === "image" ? "png" : kind === "presentation" ? "pptx" : kind === "webpage" ? "html" : "md",
    priority: "required",
    order: i,
    dependencies: [],
    planDisposition: "included",
    riskFlags: [],
  }));
  suggestion.understanding = {
    goal: { value: goal, provenance: "user_provided" },
    audience: { value: "投资人", provenance: "user_provided" },
    usage: { value: "融资与官网介绍", provenance: "user_provided" },
    constraints: { value: ["必须基于提供的项目材料"], provenance: "user_provided" },
    assumptions: [],
    unresolvedQuestions: [],
  };
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
  const prep = await prepareDeliverablePackage(userData, { taskId }, depsPrepare(userData));
  assert.equal(prep.ok, true);
  return { taskId, packageId: prep.package.id, package: prep.package, plan: after.plan };
}

function dvl2BlocksAutoGenerate(task) {
  const planning = task && task.deliverablePlanning;
  return !!(planning && (planning.planId || planning.activeConfirmedVersionId || planning.currentDraftVersionId));
}

async function main() {
  await test("1) DVL2 page HTML has no 开始 button", () => {
    const html = fs.readFileSync(
      path.join(__dirname, "..", "src", "renderer", "index.html"),
      "utf8"
    );
    assert.equal(html.includes('id="btn-act-auto-generate"'), false);
    assert.equal(/btn-act-auto-generate[^>]*>开始</.test(html), false);
    assert.ok(html.includes('id="btn-act-generate-from-plan"'));
    assert.ok(html.includes('id="btn-act-form-plan"'));
    assert.match(html, /参考材料/);
  });

  await test("2) attachment keywords must not flip user-goal detectTaskType to video_audio", () => {
    const userGoal =
      "参考项目资料，为 Digital Me 项目准备面向投资人的项目介绍材料、官网页面和宣传图片。";
    const withAttachment =
      userGoal +
      "\n\n---\n\n以下是本次任务的相关文件内容，请参考：\n\n" +
      "【附件】系统构想里提到脚本引擎与视频演示能力。";
    assert.equal(detectTaskType(userGoal), TASK_TYPES.general);
    // Full blob (goal+attachment) historically flipped to video_audio — production must strip.
    assert.equal(detectTaskType(withAttachment), TASK_TYPES.videoAudio);
    const goalOnly = withAttachment.split("\n\n---\n")[0];
    assert.equal(detectTaskType(goalOnly), TASK_TYPES.general);
  });

  await test("2b) DVL2 planning tasks must block autoGenerate guard", async () => {
    const ud = tempDir("dm-ctx-block-");
    try {
      const seeded = await seedPlanAndPackage(ud, {
        goal: "为 Digital Me 准备 PPT 与网页",
        kinds: ["presentation", "webpage"],
        materials: [],
      });
      const task = actStore.getTask(ud, seeded.taskId, { heal: false }).task;
      assert.equal(dvl2BlocksAutoGenerate(task), true);
      assert.notEqual(task.taskIntent && task.taskIntent.taskType, "video_audio");
      // Confirmed plan kinds stay presentation/webpage — not video_audio
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const kinds = view.deliverables.map((d) => d.kind).sort();
      assert.deepEqual(kinds, ["presentation", "webpage"]);
    } finally {
      cleanup(ud);
    }
  });

  await test("3) execution snapshot unwraps provenance goal/audience (not [object Object])", async () => {
    const ud = tempDir("dm-ctx-snap-");
    try {
      const goal = "为 Digital Me 准备投资人介绍材料 UNIQUE_DM_TOKEN_A1";
      const seeded = await seedPlanAndPackage(ud, {
        goal,
        kinds: ["presentation"],
        materials: [],
      });
      const snap = seeded.package.executionSnapshot;
      assert.ok(snap.inputSummary);
      assert.equal(String(snap.inputSummary.goal).includes("[object Object]"), false);
      assert.match(String(snap.inputSummary.goal), /Digital Me/);
      assert.equal(unwrapField(snap.inputSummary.audience) || snap.inputSummary.audience, "投资人");
    } finally {
      cleanup(ud);
    }
  });

  await test("4-6) generation prompts include goal, audience, purpose, attachment unique token", async () => {
    const ud = tempDir("dm-ctx-prompt-");
    try {
      const token = "UNIQUE_ATTACHMENT_MARKER_Z9Q7";
      const goal = "为 Digital Me 项目准备面向投资人的介绍材料与官网 UNIQUE_GOAL_MARKER_G4";
      const seeded = await seedPlanAndPackage(ud, {
        goal,
        kinds: ["presentation", "webpage"],
        materials: normalizeReferenceMaterials([
          {
            id: "m1",
            name: "digital-me-project-positioning-draft.md",
            text: `定位草案。${token}。Digital Me 是个人数字主体系统。`,
            ok: true,
          },
        ]),
      });
      const task = actStore.getTask(ud, seeded.taskId, { heal: false }).task;
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const pres = view.deliverables.find((d) => d.kind === "presentation");
      const ctx = buildGenerationContext({
        pkg: view.package,
        deliverable: pres,
        task,
        referenceMaterials: task.referenceMaterials,
      });
      assert.match(ctx.goal, /UNIQUE_GOAL_MARKER_G4/);
      assert.match(ctx.audience, /投资人/);
      assert.match(ctx.purpose || "", /投资人|介绍/);
      assert.match(ctx.attachmentText, new RegExp(token));
      const msgs = buildSlideMessages(ctx);
      const blob = msgs.map((m) => m.content).join("\n");
      assert.match(blob, /UNIQUE_GOAL_MARKER_G4/);
      assert.match(blob, new RegExp(token));
      assert.match(blob, /投资人/);
      assert.equal(blob.includes("[object Object]"), false);
      assert.equal(blob.includes("智能出行平台"), false);
    } finally {
      cleanup(ud);
    }
  });

  await test("7) regenerate keeps same task/package/materials in context", async () => {
    const ud = tempDir("dm-ctx-regen-");
    try {
      const token = "UNIQUE_REGEN_MATERIAL_M2";
      const goal = "Digital Me 官网与演示 REGEN_GOAL_X";
      const seeded = await seedPlanAndPackage(ud, {
        goal,
        kinds: ["document"],
        materials: normalizeReferenceMaterials([
          { id: "m2", name: "a.md", text: `正文 ${token}`, ok: true },
        ]),
      });
      const gen1 = await generation.generateDeliverablePackage(
        ud,
        { packageId: seeded.packageId },
        { callModel: null, imageMode: "mock" }
      );
      assert.equal(gen1.ok, true);
      const view1 = packageStore.getPackageView(ud, seeded.packageId);
      const del = view1.deliverables.find((d) => d.kind === "document");
      const v1 = del.currentVersionId;
      const gen2 = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: del.id },
        { callModel: null, imageMode: "mock" }
      );
      assert.equal(gen2.ok, true);
      const view2 = packageStore.getPackageView(ud, seeded.packageId);
      const del2 = view2.deliverables.find((d) => d.id === del.id);
      assert.notEqual(del2.currentVersionId, v1);
      const ver = view2.versions[del2.currentVersionId];
      assert.ok(ver.provenance);
      assert.equal(ver.provenance.planVersion, seeded.package.sourcePlanVersionId);
      const att = (ver.provenance.attachmentRefs || []).find((r) => r.included);
      assert.ok(att);
      assert.match(att.name || "", /a\.md/);
    } finally {
      cleanup(ud);
    }
  });

  await test("8-10) placeholder/demo rejected; model failure does not succeed", async () => {
    assert.throws(
      () =>
        assertGeneratedContentUsable("项目名称：____\nCEO 姓名：待定\n增长 XX%", {
          kind: "webpage",
        }),
      (err) => err && err.code === "placeholder_content_rejected"
    );
    assert.throws(
      () =>
        assertGeneratedContentUsable("智能出行平台融资计划书与完整路演材料", {
          kind: "presentation",
          goal: "为 Digital Me 准备材料",
        }),
      (err) => err && err.code === "off_topic_content_rejected"
    );

    const ud = tempDir("dm-ctx-ph-");
    try {
      const seeded = await seedPlanAndPackage(ud, {
        goal: "为 Digital Me 写官网",
        kinds: ["webpage"],
        materials: [],
      });
      const task = actStore.getTask(ud, seeded.taskId, { heal: false }).task;
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const page = view.deliverables.find((d) => d.kind === "webpage");
      await assert.rejects(
        () =>
          generateWebpage({
            pkg: view.package,
            deliverable: page,
            task,
            referenceMaterials: [],
            callModel: async () =>
              "# 智能出行平台\n\n项目名称\n\n- 功能一\n- CEO 姓名\n- 增长 XX%",
          }),
        (err) =>
          err &&
          (err.code === "placeholder_content_rejected" ||
            err.code === "off_topic_content_rejected")
      );
    } finally {
      cleanup(ud);
    }

    const ud2 = tempDir("dm-ctx-fail-");
    try {
      const seeded = await seedPlanAndPackage(ud2, {
        goal: "Digital Me 介绍文档",
        kinds: ["document"],
        materials: [],
      });
      await generation.generateDeliverablePackage(
        ud2,
        { packageId: seeded.packageId },
        {
          callModel: async () => "",
          imageMode: "mock",
        }
      );
      const view = packageStore.getPackageView(ud2, seeded.packageId);
      const doc = view.deliverables.find((d) => d.kind === "document");
      assert.equal(doc.generationStatus, "failed");
      assert.equal(doc.currentVersionId, null);
    } finally {
      cleanup(ud2);
    }
  });

  await test("11) draft save persists referenceMaterials for DVL2", () => {
    const built = buildDraftSaveRecord({
      existing: {
        taskId: "t1",
        goal: "g",
        deliverablePlanning: { planId: "p1" },
      },
      rendererPayload: {
        taskId: "t1",
        goal: "g",
        referenceMaterials: [
          { id: "a", name: "x.md", text: "UNIQUE_SAVE_TOKEN", ok: true },
        ],
      },
    });
    assert.ok(built.record.referenceMaterials.length >= 1);
    assert.match(built.record.referenceMaterials[0].text, /UNIQUE_SAVE_TOKEN/);
    assert.equal(built.record.deliverablePlanning.planId, "p1");
  });

  await test("11b) saveTask preserves materials when omitted on later save", async () => {
    const ud = tempDir("dm-ctx-preserve-");
    try {
      await actStore.saveTask(ud, {
        taskId: "t_preserve",
        goal: "g",
        referenceMaterials: [
          { id: "m", name: "keep.md", text: "KEEP_TOKEN_99", ok: true },
        ],
      });
      await actStore.saveTask(ud, {
        taskId: "t_preserve",
        goal: "g2",
        title: "updated",
        // referenceMaterials intentionally omitted
      });
      const got = actStore.getTask(ud, "t_preserve", { heal: false }).task;
      assert.match(got.referenceMaterials[0].text, /KEEP_TOKEN_99/);
    } finally {
      cleanup(ud);
    }
  });

  await test("12) writing/research independent scenes keep their own start buttons", () => {
    const html = fs.readFileSync(
      path.join(__dirname, "..", "src", "renderer", "index.html"),
      "utf8"
    );
    assert.ok(html.includes("开始新研究") || html.includes("btn-research-new"));
    assert.equal(html.includes('id="btn-act-auto-generate"'), false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

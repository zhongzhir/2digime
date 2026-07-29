"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const { getBlockingPlaceholderIssues } = require("../src/act-behalf/placeholder-validation");
const { assertGeneratedContentUsable } = require("../src/act-behalf/deliverable-context");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const generation = require("../src/act-behalf/deliverable-generation");
const actStore = require("../src/act-behalf/task-store");
const planner = require("../src/act-behalf/deliverable-planner");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-ph-gate-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function seedDocumentPackage(userData, goal) {
  const taskId = "abt_test_" + Date.now().toString(36);
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
      title: "测试文档",
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

const ALLOW_SAMPLES = [
  ["项目名称：Digital Me", "filled project name"],
  ["本 PRD 不得使用占位符", "negated placeholder mention"],
  ["当前没有待补充事项，可直接进入评审。", "negated pending supplement"],
  ["占位规则说明：检测未填写字段", "rules explanation"],
  ["不得使用功能一作为模板项", "counterexample mention"],
  ["团队规模尚未确定，需 Owner 后续决策", "explicit owner decision"],
];

const REJECT_SAMPLES = [
  ["项目名称：____", "blank field"],
  ["功能一", "template slot line"],
  ["待填写：验收标准", "pending fill field"],
  ["负责人：[请填写负责人]", "bracket fill"],
  ["标题：{{project_name}}", "mustache placeholder"],
  ["# 模板\n\n## 一\n\n## 二\n\n## 三\n\n## 四\n\n", "template shell"],
];

async function main() {
  await test("allow samples pass blocking gate", () => {
    for (const [text, label] of ALLOW_SAMPLES) {
      const blocking = getBlockingPlaceholderIssues(text);
      assert.equal(blocking.length, 0, `${label} should allow: ${text}`);
    }
  });

  await test("reject samples hit blocking gate", () => {
    for (const [text, label] of REJECT_SAMPLES) {
      const blocking = getBlockingPlaceholderIssues(text);
      assert.ok(blocking.length > 0, `${label} should reject: ${text}`);
    }
  });

  await test("assertGeneratedContentUsable allows filled PRD field labels", () => {
    const md = [
      "# 测试 PRD",
      "",
      "项目名称：Digital Me",
      "",
      "本 PRD 不得使用占位符。",
      "",
      "团队规模尚未确定，需 Owner 后续决策。",
    ].join("\n");
    assert.doesNotThrow(() =>
      assertGeneratedContentUsable(md, {
        kind: "document",
        goal: "为 Digital Me 设计页面",
        isDigitalMeProject: true,
      })
    );
  });

  await test("auto repair succeeds after initial placeholder draft", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedDocumentPackage(ud, "写一份内部协作工具的使用说明");
      const view0 = packageStore.getPackageView(ud, seeded.packageId);
      const del = view0.deliverables[0];
      let calls = 0;
      const goodMd = [
        "# 内部协作工具使用说明",
        "",
        "## 概述",
        "本文说明团队如何在日常工作中使用该工具完成文档协作、任务跟踪与结果归档。",
        "",
        "## 适用范围",
        "适用于产品、设计与研发角色的日常协作，不涉及对外承诺或合同条款。",
        "",
        "项目名称：协作工具试点",
      ].join("\n");
      const badMd = "# 模板\n\n项目名称：____\n\n- 功能一\n- 功能二\n";
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: del.id },
        {
          qualityPipelineMode: "advanced_shadow",
          callModel: async () => {
            calls += 1;
            return calls === 1 ? badMd : goodMd;
          },
          imageMode: "mock",
        }
      );
      assert.equal(res.ok, true, JSON.stringify(res));
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const d = view.deliverables[0];
      assert.ok(d.currentVersionId);
      assert.equal(Object.keys(view.versions).length, 1);
      const attempts = Object.values(view.generationAttempts || {});
      assert.ok(attempts.length >= 2);
      assert.ok(attempts.some((a) => a.status === "superseded"));
      assert.ok(attempts.some((a) => a.status === "succeeded"));
    } finally {
      cleanup(ud);
    }
  });

  await test("continuous failure saves evidence and no artifact files", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedDocumentPackage(ud, "Digital Me 连续失败测试");
      const view0 = packageStore.getPackageView(ud, seeded.packageId);
      const del = view0.deliverables[0];
      const badMd = "# 模板\n\n项目名称：____\n\n功能一\n";
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: del.id },
        {
          qualityPipelineMode: "advanced_shadow",
          callModel: async () => badMd,
          imageMode: "mock",
        }
      );
      assert.equal(res.ok, false);
      assert.equal(res.code, "placeholder_content_rejected");
      assert.ok(res.userIssueSummary);
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const d = view.deliverables[0];
      assert.equal(d.generationStatus, "failed");
      assert.equal(d.currentVersionId, null);
      const failed = Object.values(view.generationAttempts || {}).find((a) => a.status === "failed");
      assert.ok(failed);
      assert.ok(failed.failureEvidence || failed.placeholderIssues);
      assert.ok(failed.userIssueSummary);
    } finally {
      cleanup(ud);
    }
  });

  await test("same inputDigest fail then success attempt chain", async () => {
    const ud = tempUserData();
    try {
      const seeded = await seedDocumentPackage(ud, "写一份通用操作流程说明");
      const view0 = packageStore.getPackageView(ud, seeded.packageId);
      const del = view0.deliverables[0];
      let n = 0;
      const goodMd = [
        "# 操作流程说明",
        "",
        "## 背景",
        "本文描述用户在系统中完成一项标准操作的步骤、前置条件与预期结果。",
        "",
        "## 步骤",
        "1. 打开任务列表并选择目标条目。",
        "2. 填写必要信息并提交。",
        "3. 在结果页确认状态与后续动作。",
      ].join("\n");
      await generation.generateOneDeliverable(
        ud,
        { packageId: seeded.packageId, deliverableId: del.id },
        {
          qualityPipelineMode: "advanced_shadow",
          callModel: async () => {
            n += 1;
            return n === 1 ? "项目名称：____\n功能一" : goodMd;
          },
          imageMode: "mock",
        }
      );
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const attempts = Object.values(view.generationAttempts || {}).sort((a, b) =>
        String(a.startedAt).localeCompare(String(b.startedAt))
      );
      assert.ok(attempts.length >= 2);
      const digests = new Set(attempts.map((a) => a.inputDigest));
      assert.equal(digests.size, 1);
      assert.equal(view.deliverables[0].generationStatus, "ready");
    } finally {
      cleanup(ud);
    }
  });

  console.log("\nplaceholder gate:", passed, "passed,", failed, "failed");
  process.exit(failed ? 1 : 0);
}

main();

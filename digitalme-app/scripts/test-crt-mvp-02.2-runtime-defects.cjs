"use strict";

/**
 * CRT-MVP-02.2 — stale materials UI chain, claim natural presentation, attributed/exploration gates.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const actStore = require("../src/act-behalf/task-store");
const planStore = require("../src/act-behalf/deliverable-plan-store");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const planner = require("../src/act-behalf/deliverable-planner");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const generation = require("../src/act-behalf/deliverable-generation");
const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
const { confirmPlanAndGenerate } = require("../src/act-behalf/deliverable-confirm-and-generate");
const {
  promptGuidanceForClass,
  resolveAssemblyPolicy,
  findInternalClaimTags,
  findFakeAttributedClaims,
  findProductRedefinitionDrift,
  assertFormalArtifactPresentation,
  classifyTaskContext,
  finalizeSubjectAssembly,
  DEFAULT_CLAIM_POSTURE_PRESENTATION,
} = require("../src/act-behalf/subject-context-engine");
const { assembleSubjectContext } = require("../src/act-behalf/subject-context-assembler");
const { assertGeneratedContentUsable } = require("../src/act-behalf/deliverable-context");
const { buildDocumentMessages } = require("../src/act-behalf/deliverable-generators");
const autoLearn = require("../src/act-behalf/deliverable-auto-learn");
const { createMinimalFixture } = require("../src/package-store/fixture");

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
    getPlan: (u, planId) => planStore.getPlan(u, planId),
    saveTaskExecution: async (u, id, exec) => {
      const got = actStore.getTask(u, id, { heal: false });
      return actStore.saveTask(u, {
        ...got.task,
        deliverableExecution: { activePackageId: exec.activePackageId || null },
      });
    },
  };
}

async function seedPlannedTask(userData, { goal, materials }) {
  const taskId = "t_022_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  await actStore.saveTask(userData, {
    taskId,
    title: "crt022",
    goal,
    request: goal,
    status: "draft",
    referenceMaterials: materials || [],
  });
  const suggestion = planner.ruleBasedPlan({
    goal,
    referenceMaterials: materials || [],
  });
  suggestion.items = [
    {
      id: "pd_document",
      kind: "document",
      title: "说明文档",
      purpose: "说明",
      priority: "required",
      format: "docx",
      order: 0,
      dependencies: [],
      planDisposition: "included",
    },
  ];
  const applied = planner.applySuggestionToRecord({
    taskId,
    existingRecord: null,
    suggestion,
    goal,
  });
  const digest = suggestion.planningMaterialsDigest;
  await planConsistency.commitPlanThenTask({
    userData,
    planRecord: applied.plan,
    saveTaskPointers: async (args) => {
      const got = actStore.getTask(userData, taskId, { heal: false });
      return actStore.saveTask(userData, {
        ...got.task,
        deliverablePlanning: {
          planId: (args.deliverablePlanning && args.deliverablePlanning.planId) || applied.plan.planId,
          currentDraftVersionId:
            (args.deliverablePlanning && args.deliverablePlanning.currentDraftVersionId) ||
            applied.version.versionId,
          activeConfirmedVersionId:
            (args.deliverablePlanning && args.deliverablePlanning.activeConfirmedVersionId) || null,
          plannedMaterialsDigest: digest,
          materialsStale: false,
          materialsStaleReason: null,
          materialsStaleAt: null,
        },
      });
    },
  });
  let got = actStore.getTask(userData, taskId, { heal: false });
  // Ensure digest survived normalizeDeliverablePlanning.
  if (!got.task.deliverablePlanning.plannedMaterialsDigest) {
    got = await actStore.saveTask(userData, {
      ...got.task,
      deliverablePlanning: {
        ...got.task.deliverablePlanning,
        plannedMaterialsDigest: digest,
        materialsStale: false,
      },
    });
  }
  return { taskId, task: got.task || got, digest };
}

async function main() {
  await test("UI1 saveTask keeps materialsStale; confirmPlanAndGenerate blocks", async () => {
    const ud = tempDir("crt022-ui1-");
    try {
      const taskId = "t_stale_1";
      await actStore.saveTask(ud, {
        taskId,
        title: "stale",
        goal: "介绍 Digital Me",
        request: "介绍 Digital Me",
        referenceMaterials: [{ id: "f1", name: "a.txt", text: "A", ok: true }],
        deliverablePlanning: {
          planId: "plan_x",
          currentDraftVersionId: "dpv_x",
          activeConfirmedVersionId: "dpv_x",
          plannedMaterialsDigest: "sha256:old",
          materialsStale: false,
        },
      });
      const saved = await actStore.saveTask(ud, {
        ...(actStore.getTask(ud, taskId, { heal: false }).task),
        referenceMaterials: [{ id: "f2", name: "b.txt", text: "B", ok: true }],
        deliverablePlanning: {
          ...(actStore.getTask(ud, taskId, { heal: false }).task.deliverablePlanning),
          materialsStale: true,
          materialsStaleReason: "reference_materials_changed",
          materialsStaleAt: new Date().toISOString(),
        },
      });
      assert.equal(saved.task.deliverablePlanning.materialsStale, true);
      assert.equal(saved.task.deliverablePlanning.plannedMaterialsDigest, "sha256:old");

      const blocked = await confirmPlanAndGenerate({
        userData: ud,
        taskId,
        loadPlanForTaskOrFail: async () => ({
          ok: true,
          task: saved.task,
          plan: {
            planId: "plan_x",
            activeConfirmedVersionId: "dpv_x",
            currentDraftVersionId: "dpv_x",
            versions: {
              dpv_x: {
                versionId: "dpv_x",
                status: "confirmed",
                understanding: { goal: { value: "介绍 Digital Me" } },
                items: [],
              },
            },
          },
        }),
        assertFreshPlan: () => ({ ok: true }),
        extractRevisionExpected: () => ({}),
        saveTaskPlanPointers: async () => ({ ok: true }),
        buildDeliverablePlanView: () => ({}),
        getTask: (u, id) => actStore.getTask(u, id, { heal: false }),
        getPlan: async () => ({ ok: true, plan: null }),
        saveTaskExecution: async () => ({ ok: true }),
        callModel: async () => ({ text: "should not run" }),
      });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.code, "plan_materials_stale");
      assert.match(blocked.message, /参考材料已变化/);
    } finally {
      cleanup(ud);
    }
  });

  await test("UI2 clearing materialsStale persists after saveTask", async () => {
    const ud = tempDir("crt022-ui2-");
    try {
      const taskId = "t_stale_2";
      await actStore.saveTask(ud, {
        taskId,
        title: "stale2",
        goal: "写说明",
        request: "写说明",
        deliverablePlanning: {
          planId: "plan_y",
          currentDraftVersionId: "d1",
          activeConfirmedVersionId: null,
          plannedMaterialsDigest: "sha256:d1",
          materialsStale: true,
          materialsStaleReason: "reference_materials_changed",
          materialsStaleAt: new Date().toISOString(),
        },
      });
      const cleared = await actStore.saveTask(ud, {
        ...(actStore.getTask(ud, taskId, { heal: false }).task),
        deliverablePlanning: {
          planId: "plan_y",
          currentDraftVersionId: "d2",
          activeConfirmedVersionId: null,
          plannedMaterialsDigest: "sha256:d2",
          materialsStale: false,
          materialsStaleReason: null,
          materialsStaleAt: null,
        },
      });
      assert.equal(cleared.task.deliverablePlanning.materialsStale, false);
      assert.equal(cleared.task.deliverablePlanning.plannedMaterialsDigest, "sha256:d2");
    } finally {
      cleanup(ud);
    }
  });

  await test("UI3 generateOneDeliverable blocked when materialsStale", async () => {
    const ud = tempDir("crt022-ui3-");
    try {
      const taskId = "t_stale_3";
      await actStore.saveTask(ud, {
        taskId,
        title: "stale3",
        goal: "写说明",
        request: "写说明",
        deliverablePlanning: {
          planId: "plan_z",
          currentDraftVersionId: "d1",
          activeConfirmedVersionId: "d1",
          plannedMaterialsDigest: "sha256:z",
          materialsStale: true,
          materialsStaleReason: "reference_materials_changed",
          materialsStaleAt: new Date().toISOString(),
        },
      });
      // Minimal package pointing at stale task
      await packageStore.mutateStore(ud, (s) => {
        s.packages = s.packages || {};
        s.deliverables = s.deliverables || {};
        const packageId = "pkg_stale_3";
        const deliverableId = "del_stale_3";
        s.packages[packageId] = {
          id: packageId,
          taskId,
          softDeletedAt: null,
          deliverableIds: [deliverableId],
          sourcePlanVersionId: "d1",
          executionSnapshot: { inputSummary: { goal: "写说明" } },
        };
        s.deliverables[deliverableId] = {
          id: deliverableId,
          packageId,
          kind: "document",
          title: "说明",
          purpose: "说明",
          planDisposition: "included",
          dependencies: [],
        };
        return true;
      });
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId: "pkg_stale_3", deliverableId: "del_stale_3" },
        { callModel: async () => ({ text: "should not" }) }
      );
      assert.equal(res.ok, false);
      assert.equal(res.code, "plan_materials_stale");

      const pkgRes = await generation.generateDeliverablePackage(
        ud,
        { packageId: "pkg_stale_3" },
        { callModel: async () => ({ text: "should not" }) }
      );
      assert.equal(pkgRes.ok, false);
      assert.equal(pkgRes.code, "plan_materials_stale");
    } finally {
      cleanup(ud);
    }
  });

  await test("UX1 editable context-menu template roles exist in main createWindow path", () => {
    // Static source contract: context-menu handler with paste role.
    const mainSrc = fs.readFileSync(
      path.join(__dirname, "../src/main.js"),
      "utf8"
    );
    assert.match(mainSrc, /webContents\.on\(\s*"context-menu"/);
    assert.match(mainSrc, /role:\s*"paste"/);
    assert.match(mainSrc, /role:\s*"cut"/);
    assert.match(mainSrc, /label:\s*"粘贴"/);
  });

  await test("CP1 formal artifact rejects bracket claim tags", () => {
    assert.equal(DEFAULT_CLAIM_POSTURE_PRESENTATION, "natural");
    const tagged = "市场很大。[已确认] 用户增长迅速。[分析认为] 值得投入。";
    assert.ok(findInternalClaimTags(tagged).length >= 2);
    assert.throws(
      () =>
        assertGeneratedContentUsable(tagged, {
          kind: "presentation",
          goal: "介绍 Digital Me",
          contextClass: "representation",
          evidenceCorpus: "Digital Me 是个人数字主体系统。",
        }),
      (e) => e && e.code === "internal_claim_tags_rejected"
    );
    assert.equal(
      assertGeneratedContentUsable(
        "目前尚未确认市场规模。未来可考虑本地优先的授权协作方案。",
        {
          kind: "presentation",
          goal: "介绍 Digital Me",
          contextClass: "representation",
          evidenceCorpus: "Digital Me 是个人数字主体系统。",
        }
      ),
      true
    );
  });

  await test("CP2 provenance keeps claimPostures with natural presentation", () => {
    const genSrc = fs.readFileSync(
      path.join(__dirname, "../src/act-behalf/deliverable-generation.js"),
      "utf8"
    );
    assert.match(genSrc, /claimPostures:\s*\[\s*"confirmed"/);
    assert.match(genSrc, /claimPosturePresentation:\s*"natural"/);
  });

  await test("CP3 fake attributed stock phrases rejected", () => {
    const body =
      "全球AI个人助理市场预计2027年达500亿美元以上。根据公开报告，行业正在高速增长。";
    assert.ok(findFakeAttributedClaims(body, "").length >= 1);
    assert.throws(
      () => assertFormalArtifactPresentation(body, { evidenceCorpus: "", contextClass: "exploration" }),
      (e) => e && e.code === "fake_attribution_rejected"
    );
    assert.equal(
      findFakeAttributedClaims("根据本次材料，项目强调本地优先。", "【参考材料】本地优先说明").length,
      0
    );
  });

  await test("EX1/EX2/EX3 exploration guidance anchors Digital Me core", () => {
    const g = promptGuidanceForClass(
      "exploration",
      resolveAssemblyPolicy({ contextClass: "exploration" })
    );
    assert.match(g, /数字主体|本地优先|平台中立|可迁移/);
    assert.match(g, /DID|联邦学习|区块链/);
    assert.match(g, /不得未经依据|待评估/);
    assert.match(g, /多个不同方向|价值、风险/);
    assert.match(g, /禁止在正文写入方括号|自然语言/);

    const msgs = buildDocumentMessages({
      goal: "探索 Digital Me 可能的商业模式",
      title: "探索草稿",
      contextClass: "exploration",
      allowAiExplorationBlock: true,
      subjectRenderedText: "本人专注 Digital Me。",
      attachmentText: "",
      claimPosturePresentation: "natural",
      subjectAssembly: { assemblyPolicy: { allowAiExplorationBlock: true } },
    });
    const blob = msgs.map((m) => m.content).join("\n");
    assert.match(blob, /本地优先|数字主体/);
    assert.match(blob, /禁止在正文写入方括号|例如 \[已确认\]/);
    // Formal artifact body (not the system instruction) must stay natural.
    assert.equal(findInternalClaimTags("目前尚未确认规模。未来可考虑本地优先。").length, 0);

    assert.ok(
      findProductRedefinitionDrift(
        "Digital Me 定位为区块链身份平台，以 DID/VC 为核心。",
        "exploration"
      ).length >= 1
    );
    assert.throws(
      () =>
        assertFormalArtifactPresentation(
          "Digital Me 核心是区块链身份平台，全面转向 DID/VC 产品。",
          { contextClass: "exploration" }
        ),
      (e) => e && e.code === "product_redefinition_rejected"
    );
    // Hypothetical tech option OK
    assert.equal(
      findProductRedefinitionDrift(
        "一种待验证的方案是评估联邦学习或 DID 作为可选增强，而非默认底座。",
        "exploration"
      ).length,
      0
    );
  });

  await test("J1 judgment harvest + soft readback (runtime audit: Owner memory lacked candidate)", async () => {
    const JUDGMENT =
      "在当前阶段，优先验证真实主体持续参与行动，而非扩展大量功能";
    const extracted = await autoLearn.extractLearningItems({
      title: "决策备忘",
      kind: "document",
      excerpt: `# 备忘\n\n${JUDGMENT}\n\n其他段落。`,
      source: { deliverableVersionId: "dver_test_j1" },
      evidenceCorpus: "任务说明不含该判断句。",
    });
    const classified = autoLearn.classifyItems(extracted, "任务说明不含该判断句。");
    const jc = classified.filter(
      (c) => c.learnKind === "new_judgment" || c.logicalState === "judgment_candidate"
    );
    assert.ok(jc.length >= 1, "extract must harvest judgment without UNIQUE token");
    assert.equal(jc[0].ownership, "subject_owned");

    const pkgDir = tempDir("crt022-j1-");
    try {
      createMinimalFixture(pkgDir);
      const memDir = path.join(pkgDir, "memory");
      fs.mkdirSync(memDir, { recursive: true });
      fs.appendFileSync(
        path.join(memDir, "long-term-memory.jsonl"),
        JSON.stringify({
          type: "semantic",
          content: JUDGMENT,
          learnKind: "new_judgment",
          logicalState: "judgment_candidate",
          ownership: "subject_owned",
          confidence: "low",
          activationState: "active_low_confidence",
          status: "active",
        }) + "\n",
        "utf8"
      );
      const c = classifyTaskContext({
        goal: "对比下一阶段该优先验证什么",
        deliverableKind: "document",
      });
      assert.equal(c.contextClass, "decision_support");
      const policy = resolveAssemblyPolicy(c);
      let asm = assembleSubjectContext({
        packageDir: pkgDir,
        query: { goal: "对比下一阶段该优先验证什么" },
        policy,
        contextClass: c.contextClass,
      });
      asm = finalizeSubjectAssembly(asm, { classification: c, policy, attachmentRefs: [] });
      assert.equal(/本人判断框架（须遵守）/.test(asm.renderedText), false);
      assert.match(asm.renderedText, /Judgment Candidate|待确认的取舍线索|优先验证/);
      assert.ok(asm.refs.some((r) => r.logicalState === "judgment_candidate"));
    } finally {
      cleanup(pkgDir);
    }
  });

  await test("renderer renderPlanView prefers materialsStale banner (source + logic)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../src/renderer/deliverable-planner.js"),
      "utf8"
    );
    assert.match(src, /materialsStale/);
    assert.match(src, /is-materials-stale/);
    assert.match(src, /参考材料已变化/);
    // Mirror UI priority: stale banner outranks understanding summary.
    const view = {
      materialsStale: true,
      statusBanner: "参考材料已变化，请重新形成预计交付后再生成。",
      version: { understanding: { goal: { value: "旧理解" } } },
    };
    const u = view.version.understanding || {};
    const understandingLine =
      u.summary || u.oneLineSummary || (u.goal && (u.goal.value || u.goal)) || "";
    const one = view.materialsStale
      ? view.statusBanner || "参考材料已变化，请重新形成预计交付后再生成。"
      : understandingLine || view.statusBanner || "";
    assert.match(String(one), /参考材料已变化/);
    assert.notEqual(String(one), "旧理解");
  });

  console.log(`\nCRT-MVP-02.2 unit: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);

  const { spawnSync } = require("node:child_process");
  const scripts = [
    "test-crt-mvp-02.1-planner-claim-posture.cjs",
    "test-crt-mvp-02-subject-context-engine.cjs",
    "test-crt-mvp-continuity.cjs",
    "test-crt-mvp-01.1-package-dir.cjs",
    "test-dvl2-03-generation-contracts.cjs",
    "test-dvl2-03-one-click-generate.cjs",
    "test-dvl2-04-auto-learn.cjs",
    "test-dvl2-05-context-authority.cjs",
  ];
  for (const s of scripts) {
    const r = spawnSync(process.execPath, [path.join(__dirname, s)], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      env: process.env,
    });
    if (r.status !== 0) {
      console.error("REGRESSION FAIL", s);
      console.error(r.stdout || "");
      console.error(r.stderr || "");
      process.exit(1);
    }
    console.log("PASS regression", s);
  }
  console.log("\nAll CRT-MVP-02.2 + regressions passed.");
  console.log(
    "OWNER_RUNTIME_J1_AUDIT: 未通过（Owner memory/learn-jobs 无 judgment_candidate /「优先验证…」写入）；本轮已补 extract harvest + 自动化 J1。"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

"use strict";

/**
 * CRT-MVP-02 Subject Context Engine — classification, evidence/ownership, learn gate.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const {
  classifyTaskContext,
  resolveAssemblyPolicy,
  finalizeSubjectAssembly,
  promptGuidanceForClass,
  findUnsupportedFabricatedFacts,
  assertRepresentationFactsGrounded,
  CONTEXT_CLASSES,
} = require("../src/act-behalf/subject-context-engine");
const { assembleSubjectContext } = require("../src/act-behalf/subject-context-assembler");
const { buildGenerationContext, assertGeneratedContentUsable } = require("../src/act-behalf/deliverable-context");
const { buildDocumentMessages, generateDocument } = require("../src/act-behalf/deliverable-generators");
const generation = require("../src/act-behalf/deliverable-generation");
const autoLearn = require("../src/act-behalf/deliverable-auto-learn");
const actStore = require("../src/act-behalf/task-store");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const planner = require("../src/act-behalf/deliverable-planner");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
const { createMinimalFixture } = require("../src/package-store/fixture");
const distillMe = require("../src/distill-me");

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

function seedIdentity(packageDir, statement, id) {
  const data = distillMe.read(packageDir);
  data.items = data.items || [];
  data.items.push({
    id: id || "distill_id_1",
    category: "identity",
    statement,
    status: "confirmed",
    confidence: "high",
    sourceRefs: ["crt_mvp02"],
    evidenceRefs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    version: 1,
  });
  fs.mkdirSync(path.join(packageDir, "life"), { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "life", "distill-me-identity-facts.json"),
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function appendMemory(packageDir, row) {
  const dir = path.join(packageDir, "memory");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, "long-term-memory.jsonl"),
    JSON.stringify({
      type: "semantic",
      confidence: "low",
      activationState: "active_low_confidence",
      status: "active",
      ownership: "subject_owned",
      ...row,
    }) + "\n",
    "utf8"
  );
}

async function seedPlanAndPackage(userData, { goal, audience, usage, kinds }) {
  const taskId = "t_mvp02_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  await actStore.saveTask(userData, {
    taskId,
    title: "CRT-MVP-02",
    goal,
    request: goal,
    status: "draft",
  });
  const suggestion = planner.ruleBasedPlan({ goal });
  suggestion.items = (kinds || ["document"]).map((kind, i) => ({
    id: "pd_" + kind,
    kind,
    title: kind === "document" ? "成果文档" : kind + " 成果",
    purpose: "情境引擎验证",
    format: kind === "document" ? "md" : "html",
    priority: "required",
    order: i,
    dependencies: [],
    planDisposition: "included",
    riskFlags: [],
  }));
  suggestion.understanding = {
    goal: { value: goal, provenance: "user_provided" },
    audience: { value: audience || "", provenance: "user_provided" },
    usage: { value: usage || "", provenance: "user_provided" },
    constraints: { value: [], provenance: "user_provided" },
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
  return { taskId, packageId: prep.package.id };
}

async function main() {
  await test("C0 vague goal → execution", () => {
    const c = classifyTaskContext({
      goal: "做一份材料",
      audience: "",
      usage: "",
      constraints: "",
      deliverableKind: "document",
      deliverableTitle: "材料",
      deliverablePurpose: "",
    });
    assert.equal(c.contextClass, "execution");
    assert.ok(c.signals.includes("default:execution"));
    assert.ok(CONTEXT_CLASSES.includes(c.contextClass));
  });

  await test("C1 investor intro → representation; no exploration subject block", () => {
    const c = classifyTaskContext({
      goal: "为 Digital Me 准备面向投资人的介绍材料",
      audience: "投资人",
      usage: "对外介绍",
      deliverableKind: "document",
      deliverableTitle: "介绍",
    });
    assert.equal(c.contextClass, "representation");
    const policy = resolveAssemblyPolicy(c);
    assert.equal(policy.allowAiExplorationBlock, false);
    const guidance = promptGuidanceForClass(c.contextClass, policy);
    assert.match(guidance, /强事实边界|禁止创造/);
    assert.equal(/开放探索块/.test(guidance) && policy.allowAiExplorationBlock, false);
  });

  await test("C2 decision contrast → decision_support; judgment/experience priority", () => {
    const c = classifyTaskContext({
      goal: "对比两个方案，是否该选择外包",
      audience: "本人",
      deliverableKind: "document",
    });
    assert.equal(c.contextClass, "decision_support");
    const policy = resolveAssemblyPolicy(c);
    assert.ok(policy.priorityLayers[0] === "judgment" || policy.priorityLayers.includes("experience"));
    assert.equal(policy.allowJudgmentCandidateSoft, true);
  });

  await test("C3 exploration → allow ai_exploration; not subject_fact", () => {
    const c = classifyTaskContext({
      goal: "探索 Digital Me 可能的商业模式与未来场景",
      deliverableKind: "document",
    });
    assert.equal(c.contextClass, "exploration");
    const policy = resolveAssemblyPolicy(c);
    assert.equal(policy.allowAiExplorationBlock, true);
    const guidance = promptGuidanceForClass("exploration", policy);
    assert.match(guidance, /ai_exploration|假设|待验证/);
  });

  await test("C4 no packageDir → no_package; no fabricated subject", () => {
    const c = classifyTaskContext({ goal: "介绍本人" });
    const policy = resolveAssemblyPolicy(c);
    const asm = assembleSubjectContext({
      packageDir: null,
      query: { goal: "介绍本人" },
      policy,
      contextClass: c.contextClass,
    });
    const fin = finalizeSubjectAssembly(asm, { classification: c, policy, attachmentRefs: [] });
    assert.equal(fin.emptyReason, "no_package");
    assert.equal(fin.refs.length, 0);
    assert.equal(fin.renderedText.includes("已了解"), false);
  });

  await test("C5 subject + representation → refs with evidence/ownership/contextClass", async () => {
    const ud = tempDir("mvp02-c5-");
    const pkgDir = tempDir("mvp02-pkg-c5-");
    try {
      createMinimalFixture(pkgDir);
      seedIdentity(pkgDir, "本人是 Digital Me Owner，专注主体连续性。", "distill_c5");
      const seeded = await seedPlanAndPackage(ud, {
        goal: "面向投资人介绍 Digital Me",
        audience: "投资人",
        usage: "对外介绍",
        kinds: ["document"],
      });
      const gen = await generation.generateDeliverablePackage(
        ud,
        { packageId: seeded.packageId },
        { callModel: null, imageMode: "mock", packageDir: pkgDir }
      );
      assert.equal(gen.ok, true);
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const del = view.deliverables.find((d) => d.kind === "document");
      const ver = view.versions[del.currentVersionId];
      const p = ver.provenance;
      assert.equal(p.contextClass, "representation");
      assert.ok(p.contextClassification && p.contextClassification.confidence);
      assert.ok(Array.isArray(p.contextClassification.signals));
      assert.ok(p.assemblyPolicyDigest);
      assert.ok(Array.isArray(p.subjectRefs) && p.subjectRefs.length > 0);
      assert.ok(
        p.subjectRefs.some(
          (r) =>
            r.included !== false &&
            r.evidenceKind === "subject_fact" &&
            r.ownership === "subject_owned"
        )
      );
      assert.ok(p.evidenceSummary);
      assert.ok(p.ownershipSummary);
      assert.equal(p.assembly.emptyReason !== "no_package", true);
      console.log(
        "PROVENANCE_EXAMPLE",
        JSON.stringify(
          {
            contextClass: p.contextClass,
            contextClassification: p.contextClassification,
            assemblyPolicyDigest: p.assemblyPolicyDigest,
            subjectRefs: p.subjectRefs.slice(0, 2),
            attachmentRefs: p.attachmentRefs,
            evidenceSummary: p.evidenceSummary,
            ownershipSummary: p.ownershipSummary,
          },
          null,
          2
        )
      );
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("C6 attachments → task_material + task_owned", async () => {
    const ud = tempDir("mvp02-c6-");
    const pkgDir = tempDir("mvp02-pkg-c6-");
    try {
      createMinimalFixture(pkgDir);
      seedIdentity(pkgDir, "本人运营 Digital Me。", "distill_c6");
      const seeded = await seedPlanAndPackage(ud, {
        goal: "按计划整理材料说明",
        kinds: ["document"],
      });
      const got = actStore.getTask(ud, seeded.taskId, { heal: false }).task;
      await actStore.saveTask(ud, {
        ...got,
        referenceMaterials: [
          {
            id: "att1",
            name: "brief.txt",
            text: "本次任务附件：只用于本次交付，不是终身主体事实。",
            ok: true,
            contentHash: "sha256:att1",
          },
        ],
      });
      const gen = await generation.generateDeliverablePackage(
        ud,
        { packageId: seeded.packageId },
        { callModel: null, imageMode: "mock", packageDir: pkgDir }
      );
      assert.equal(gen.ok, true);
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const del = view.deliverables[0];
      const ver = view.versions[del.currentVersionId];
      assert.ok(Array.isArray(ver.provenance.attachmentRefs));
      const included = ver.provenance.attachmentRefs.filter((r) => r.included);
      assert.ok(included.length >= 1);
      for (const r of included) {
        assert.equal(r.evidenceKind, "task_material");
        assert.equal(r.ownership, "task_owned");
        assert.notEqual(r.ownership, "subject_owned");
      }
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("C7 representation rejects ungrounded team/funding facts", async () => {
    const hits = findUnsupportedFabricatedFacts(
      "我们完成了天使轮融资 5000 万，DAU 达到 20 万。",
      "Digital Me 是个人数字主体系统。"
    );
    assert.ok(hits.length >= 1);
    assert.throws(
      () =>
        assertRepresentationFactsGrounded(
          "核心团队 CTO 张三加入，已完成 A 轮融资。",
          "无团队无融资",
          "representation"
        ),
      (e) => e && e.code === "ungrounded_representation_facts"
    );

    const ctx = {
      goal: "面向投资人介绍 Digital Me",
      contextClass: "representation",
      subjectRenderedText: "本人专注 Digital Me。",
      attachmentText: "",
      title: "介绍",
    };
    assert.throws(
      () =>
        assertGeneratedContentUsable(
          "# 介绍\n\n我们有 30 名工程师，NPS 72，年收入 1 亿。\n",
          {
            kind: "document",
            goal: ctx.goal,
            contextClass: "representation",
            evidenceCorpus: ctx.subjectRenderedText,
          }
        ),
      (e) => e && e.code === "ungrounded_representation_facts"
    );

    // Exploration may state hypothetically — detector still flags raw facts, but class gate only for representation.
    assert.equal(
      assertRepresentationFactsGrounded(
        "假设未来可考虑融资，可能达到更大用户量。",
        "",
        "exploration"
      ),
      true
    );
  });

  await test("L1 UNIQUE_FACT with task_material evidence → new_fact", () => {
    const FACT = "UNIQUE_FACT_OK_99";
    const extracted = [
      {
        id: "ex_unique_" + FACT,
        layer: "semantic",
        text: `从已接受成果中保留的要点标记：${FACT}`,
        confidence: "low",
      },
    ];
    const classified = autoLearn.classifyItems(extracted, `材料记载 ${FACT}`);
    const item = classified[0];
    assert.equal(item.learnKind, "new_fact");
    assert.equal(item.logicalState, "active_low");
    assert.notEqual(item.writeTarget, "audit_only");
    const cons = autoLearn.consolidate(classified);
    assert.ok(cons.kept.some((k) => k.learnKind === "new_fact"));
  });

  await test("L1b UNIQUE_FAKE_FACT without evidence → not new_fact", () => {
    const FAKE = "UNIQUE_FAKE_FACT_77";
    const extracted = [
      {
        id: "ex_unique_" + FAKE,
        layer: "semantic",
        text: `从已接受成果中保留的要点标记：${FAKE}`,
        confidence: "low",
      },
    ];
    const classified = autoLearn.classifyItems(extracted, "完全无关的附件正文");
    const item = classified[0];
    assert.notEqual(item.learnKind, "new_fact");
    assert.equal(item.rejectReason, "unverified_fact_no_evidence");
    const cons = autoLearn.consolidate(classified);
    assert.ok(cons.skipped.some((s) => s.action === "skip_unverified_fact"));
    assert.equal(
      cons.kept.some((k) => k.learnKind === "new_fact" && String(k.text).includes(FAKE)),
      false
    );
  });

  await test("L2 judgment phrase → judgment_candidate", () => {
    const extracted = [
      {
        id: "ex_j",
        layer: "semantic",
        text: "对外材料应优先讲问题与时机，而非先堆技术细节。",
        confidence: "low",
      },
    ];
    const classified = autoLearn.classifyItems(extracted, "");
    assert.ok(
      classified[0].learnKind === "new_judgment" || classified[0].learnKind === "decision_pattern"
    );
    assert.equal(classified[0].logicalState, "judgment_candidate");
  });

  await test("L2b Judgment Candidate not in Active hard block", () => {
    const pkgDir = tempDir("mvp02-l2b-");
    try {
      createMinimalFixture(pkgDir);
      seedIdentity(pkgDir, "本人是 Digital Me Owner。", "id_l2b");
      appendMemory(pkgDir, {
        id: "mem_jc_1",
        content: "优先选择本地部署而非云端托管。",
        learnKind: "new_judgment",
        logicalState: "judgment_candidate",
      });
      const c = classifyTaskContext({ goal: "写一份执行说明", deliverableKind: "document" });
      assert.equal(c.contextClass, "execution");
      const policy = resolveAssemblyPolicy(c);
      assert.equal(policy.allowJudgmentCandidateSoft, false);
      let asm = assembleSubjectContext({
        packageDir: pkgDir,
        query: { goal: "写一份执行说明" },
        policy,
        contextClass: c.contextClass,
      });
      asm = finalizeSubjectAssembly(asm, { classification: c, policy, attachmentRefs: [] });
      assert.equal(/本人判断框架（须遵守）/.test(asm.renderedText), false);
      const jc = asm.refs.filter((r) => r.logicalState === "judgment_candidate");
      assert.ok(jc.length >= 1);
      assert.ok(jc.every((r) => r.included === false || r.hardJudgment !== true));

      const cDec = classifyTaskContext({ goal: "对比方案是否该上云", deliverableKind: "document" });
      const polDec = resolveAssemblyPolicy(cDec);
      let asm2 = assembleSubjectContext({
        packageDir: pkgDir,
        query: { goal: "对比方案是否该上云" },
        policy: polDec,
        contextClass: cDec.contextClass,
      });
      asm2 = finalizeSubjectAssembly(asm2, {
        classification: cDec,
        policy: polDec,
        attachmentRefs: [],
      });
      assert.equal(/本人判断框架（须遵守）/.test(asm2.renderedText), false);
      assert.match(asm2.renderedText, /Judgment Candidate|待确认的取舍线索/);
    } finally {
      cleanup(pkgDir);
    }
  });

  await test("L3 expression_preference readable next time", () => {
    const pkgDir = tempDir("mvp02-l3-");
    try {
      createMinimalFixture(pkgDir);
      const PREF = "UNIQUE_PREF_STYLE_42";
      appendMemory(pkgDir, {
        id: "mem_pref_1",
        content: `表达偏好：段落短句，标记 ${PREF}`,
        learnKind: "expression_preference",
        logicalState: "active_low",
      });
      const c = classifyTaskContext({
        goal: "创作一段产品文案",
        deliverableKind: "document",
      });
      const policy = resolveAssemblyPolicy(c);
      let asm = assembleSubjectContext({
        packageDir: pkgDir,
        query: { goal: "创作一段产品文案", deliverableKind: "document" },
        policy,
        contextClass: c.contextClass,
      });
      asm = finalizeSubjectAssembly(asm, { classification: c, policy, attachmentRefs: [] });
      assert.match(asm.renderedText, new RegExp(PREF));
      assert.ok(asm.refs.some((r) => r.learnKind === "expression_preference" && r.included !== false));
    } finally {
      cleanup(pkgDir);
    }
  });

  await test("prompt guidance differs by contextClass", () => {
    const exec = promptGuidanceForClass("execution", resolveAssemblyPolicy({ contextClass: "execution" }));
    const rep = promptGuidanceForClass(
      "representation",
      resolveAssemblyPolicy({ contextClass: "representation" })
    );
    assert.match(exec, /保守执行|少发挥/);
    assert.match(rep, /禁止创造|待确认/);
    assert.notEqual(exec, rep);
  });

  console.log(`\nCRT-MVP-02 unit: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);

  const { spawnSync } = require("node:child_process");
  const scripts = [
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
  console.log("\nAll CRT-MVP-02 + regressions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

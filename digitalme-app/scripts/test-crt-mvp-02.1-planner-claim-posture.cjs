"use strict";

/**
 * CRT-MVP-02.1 — Planner attachment alignment + Claim Posture gates.
 * Uses isolated temp Package / userData only (never Owner runtime Package).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const planner = require("../src/act-behalf/deliverable-planner");
const {
  classifyTaskContext,
  resolveAssemblyPolicy,
  finalizeSubjectAssembly,
  promptGuidanceForClass,
  findUnsupportedFabricatedFacts,
  assertRepresentationFactsGrounded,
  CLAIM_POSTURES,
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

const JUDGMENT_PHRASE =
  "在当前阶段，优先验证真实主体持续参与行动，而非扩展大量功能";

async function main() {
  await test("P1 Planner reads attachment title + excerpt", () => {
    const materials = [
      {
        id: "file_p1",
        name: "主体材料-边界.txt",
        mime: "text/plain",
        text: "Digital Me 当前阶段重点是持续参与。资金用途可按若干方案测算。受众为投资人。",
        contentHash: "sha256:p1demo",
      },
    ];
    const summaries = planner.summarizeReferenceMaterialsForPlanning(materials);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].filename, "主体材料-边界.txt");
    assert.match(summaries[0].excerpt, /持续参与/);
    assert.ok(summaries[0].contentHash);
    assert.ok(summaries[0].charCount > 0);

    const msgs = planner.buildPlanningModelMessages({
      goal: "面向投资人做介绍材料",
      referenceMaterials: materials,
    });
    const user = JSON.parse(msgs.find((m) => m.role === "user").content);
    assert.ok(Array.isArray(user.referenceMaterials));
    assert.equal(user.referenceMaterials[0].filename, "主体材料-边界.txt");
    assert.match(user.referenceMaterials[0].excerpt, /投资人/);

    const plan = planner.ruleBasedPlan({
      goal: "面向投资人做介绍材料",
      referenceMaterials: materials,
    });
    assert.equal(plan.ok, true);
    assert.ok(plan.planningMaterialsDigest);
    assert.ok(
      plan.understanding.assumptions.some((a) => /已附参考材料/.test(String(a)))
    );
    assert.equal(
      plan.understanding.assumptions.some((a) =>
        /^(?=.*(?:未附|未在本次输入|暂无参考材料))(?!.*已附参考材料)/.test(String(a))
      ) ||
        plan.understanding.assumptions.some((a) =>
          /未附参考|未在本次输入中附|暂无参考材料附件/.test(String(a))
        ),
      false
    );
  });

  await test("P2 unresolvedQuestion dropped when answer already in materials", () => {
    const materials = [
      {
        id: "file_p2",
        name: "受众说明.md",
        text: "本次材料主要面向投资人与合作伙伴，说明产品边界与路线。",
      },
    ];
    const plan = planner.ruleBasedPlan({
      goal: "请准备一套对外介绍成果包",
      referenceMaterials: materials,
    });
    assert.equal(plan.ok, true);
    const qs = plan.understanding.unresolvedQuestions || [];
    assert.equal(
      qs.some((q) => /面向谁|受众/.test(String(q))),
      false,
      "should not re-ask audience when materials already name 投资人"
    );
    // Explicit filter regression
    const filtered = planner.filterUnresolvedAgainstMaterials(
      ["这次材料主要面向谁？", "是否已附参考材料？", "预算上限是多少？"],
      planner.summarizeReferenceMaterialsForPlanning(materials)
    );
    assert.equal(filtered.some((q) => /面向谁/.test(q)), false);
    assert.equal(filtered.some((q) => /是否已附/.test(q)), false);
    assert.ok(filtered.some((q) => /预算/.test(q)));
  });

  await test("P3 materials digest change marks stale alignment", () => {
    const a = planner.summarizeReferenceMaterialsForPlanning([
      { id: "f1", name: "a.txt", text: "版本一内容 ALPHA" },
    ]);
    const b = planner.summarizeReferenceMaterialsForPlanning([
      { id: "f1", name: "a.txt", text: "版本二内容 BETA 已变更" },
    ]);
    const da = planner.planningMaterialsDigest(a);
    const db = planner.planningMaterialsDigest(b);
    assert.notEqual(da, db);

    const empty = planner.planningMaterialsDigest(
      planner.summarizeReferenceMaterialsForPlanning([])
    );
    assert.notEqual(da, empty);

    // Simulate task pointer stale rule used by main.syncTaskPlanMaterialsAlignment
    const planned = da;
    const current = db;
    const materialsStale = !!(planned && planned !== current);
    assert.equal(materialsStale, true);
  });

  await test("CP1 representation blocks ungrounded「已拥有1000名用户」", () => {
    const text = "我们已拥有1000名用户，产品已验证市场。";
    const hits = findUnsupportedFabricatedFacts(text, "Digital Me 是个人数字主体系统。");
    assert.ok(hits.some((h) => h.id === "users"));
    assert.throws(
      () => assertRepresentationFactsGrounded(text, "无用户数据", "representation"),
      (e) => e && e.code === "ungrounded_representation_facts"
    );
    assert.throws(
      () =>
        assertGeneratedContentUsable(text, {
          kind: "document",
          goal: "对外介绍",
          contextClass: "representation",
          evidenceCorpus: "无用户数据",
        }),
      (e) => e && e.code === "ungrounded_representation_facts"
    );
  });

  await test("CP2 hedged pilot「可探索1000名种子用户」kept as hypothetical", () => {
    const text = "可探索1000名种子用户试点，作为待验证的获客假设。";
    const hits = findUnsupportedFabricatedFacts(text, "");
    assert.equal(hits.length, 0, "hedged claim must not be treated as fabricated fact");
    assert.equal(assertRepresentationFactsGrounded(text, "", "representation"), true);

    const keepAlso = [
      "可以考虑联邦学习作为未来技术路线",
      "资金用途可初步按若干方案测算",
      "未来可探索企业授权",
    ];
    for (const line of keepAlso) {
      assert.equal(
        findUnsupportedFabricatedFacts(line, "").length,
        0,
        "must keep: " + line
      );
    }
  });

  await test("CP3 exploration may invent business model not in memory", () => {
    const guidance = promptGuidanceForClass(
      "exploration",
      resolveAssemblyPolicy({ contextClass: "exploration" })
    );
    assert.match(guidance, /hypothetical|inferred|开放探索/);
    assert.match(guidance, /不要求字字来自记忆|memory/);

    const msgs = buildDocumentMessages({
      goal: "探索可能的商业模式",
      title: "商业模式草稿",
      purpose: "开放探索",
      contextClass: "exploration",
      allowAiExplorationBlock: true,
      subjectRenderedText: "本人专注 Digital Me。",
      attachmentText: "",
      subjectAssembly: {
        assemblyPolicy: { allowAiExplorationBlock: true },
      },
    });
    const blob = msgs.map((m) => m.content).join("\n");
    assert.match(blob, /Claim Posture|主张姿态|hypothetical/);
    assert.match(blob, /exploration|开放探索/);
    // Gate must NOT throw for exploration hypothetical revenue language
    assert.equal(
      assertRepresentationFactsGrounded(
        "可考虑按席位订阅的新商业模式，假设首年服务 50 家试点客户。",
        "",
        "exploration"
      ),
      true
    );
  });

  await test("CP4 new business model does not become new_fact", () => {
    const extracted = [
      {
        id: "ex_biz",
        layer: "semantic",
        text: "可考虑席位订阅作为未来商业模式假设，待验证。",
        confidence: "low",
      },
    ];
    const classified = autoLearn.classifyItems(extracted, "");
    assert.notEqual(classified[0].learnKind, "new_fact");
    assert.ok(
      classified[0].rejectReason === "hypothetical_not_fact" ||
        classified[0].logicalState === "session_only"
    );
    const cons = autoLearn.consolidate(classified);
    assert.equal(cons.kept.some((k) => k.learnKind === "new_fact"), false);
    assert.ok(cons.skipped.some((s) => s.action === "skip_hypothetical"));
  });

  await test("J1 judgment_candidate learn + soft readback (no attachment seed)", () => {
    // 1) First-task materials must NOT contain UNIQUE_JUDGMENT or the phrase.
    const materialsBlob = "任务说明：写一份阶段取舍备忘。不含预设判断句。";
    assert.equal(materialsBlob.includes("UNIQUE_JUDGMENT"), false);
    assert.equal(materialsBlob.includes(JUDGMENT_PHRASE), false);

    // 2–4) Model result contains judgment → Owner accept path classify → write candidate
    const extracted = [
      {
        id: "ex_j1",
        layer: "semantic",
        text: JUDGMENT_PHRASE,
        confidence: "low",
      },
    ];
    const classified = autoLearn.classifyItems(extracted, materialsBlob);
    assert.equal(classified[0].learnKind, "new_judgment");
    assert.equal(classified[0].logicalState, "judgment_candidate");
    assert.equal(classified[0].ownership, "subject_owned");
    const cons = autoLearn.consolidate(classified);
    assert.ok(cons.kept.some((k) => k.learnKind === "new_judgment"));

    const pkgDir = tempDir("mvp021-j1-");
    try {
      createMinimalFixture(pkgDir);
      appendMemory(pkgDir, {
        id: "mem_j1_cand",
        content: JUDGMENT_PHRASE,
        learnKind: "new_judgment",
        logicalState: "judgment_candidate",
        ownership: "subject_owned",
      });

      // 5–9) New decision_support task: no UNIQUE_JUDGMENT in attachment/input/history
      const goal = "对比下一阶段该优先验证什么";
      assert.equal(goal.includes("UNIQUE_JUDGMENT"), false);
      const c = classifyTaskContext({ goal, deliverableKind: "document" });
      assert.equal(c.contextClass, "decision_support");
      const policy = resolveAssemblyPolicy(c);
      assert.equal(policy.allowJudgmentCandidateSoft, true);

      let asm = assembleSubjectContext({
        packageDir: pkgDir,
        query: { goal, deliverableKind: "document" },
        policy,
        contextClass: c.contextClass,
      });
      asm = finalizeSubjectAssembly(asm, {
        classification: c,
        policy,
        attachmentRefs: [],
      });

      const jc = asm.refs.filter((r) => r.logicalState === "judgment_candidate");
      assert.ok(jc.length >= 1);
      assert.ok(jc.some((r) => String(r.statement || r.text || r.content || "").includes("优先验证")));
      assert.ok(jc.every((r) => r.hardJudgment !== true));
      assert.equal(/本人判断框架（须遵守）/.test(asm.renderedText), false);
      assert.match(asm.renderedText, /Judgment Candidate|待确认的取舍线索|judgment_candidate/i);

      const msgs = buildDocumentMessages({
        goal,
        title: "决策备忘",
        contextClass: "decision_support",
        subjectRenderedText: asm.renderedText,
        attachmentText: "",
        allowAiExplorationBlock: true,
        subjectAssembly: { assemblyPolicy: policy, contextClass: "decision_support" },
      });
      const prompt = msgs.map((m) => m.content).join("\n");
      assert.equal(/本人判断框架（须遵守）/.test(prompt), false);
      assert.match(prompt, /Claim Posture|主张姿态/);
      // Soft presence OK; must not claim permanent global Owner principle
      assert.equal(/永久|不容改变|全局原则/.test(prompt), false);
    } finally {
      cleanup(pkgDir);
    }
  });

  await test("F1 UNIQUE_CONFIRMED_FACT with task_material → new_fact/active_low", () => {
    const FACT = "UNIQUE_CONFIRMED_FACT_A1";
    const evidence = `任务材料记载：${FACT} 已由主体确认。`;
    const extracted = [
      {
        id: "ex_" + FACT,
        layer: "semantic",
        text: `从已接受成果中保留的要点标记：${FACT}`,
        confidence: "low",
      },
    ];
    const classified = autoLearn.classifyItems(extracted, evidence);
    assert.equal(classified[0].learnKind, "new_fact");
    assert.equal(classified[0].logicalState, "active_low");
    const cons = autoLearn.consolidate(classified);
    assert.ok(cons.kept.some((k) => k.learnKind === "new_fact"));
  });

  await test("F2 UNIQUE_UNVERIFIED_FACT without evidence → skip; hypothetical not new_fact", () => {
    const FAKE = "UNIQUE_UNVERIFIED_FACT_B2";
    const extracted = [
      {
        id: "ex_" + FAKE,
        layer: "semantic",
        text: `从已接受成果中保留的要点标记：${FAKE}`,
        confidence: "low",
      },
      {
        id: "ex_hyp",
        layer: "semantic",
        text: "假设未来可探索企业授权作为 hypothetical 方案。",
        confidence: "low",
      },
    ];
    const classified = autoLearn.classifyItems(extracted, "无关材料正文");
    const fake = classified.find((c) => String(c.text).includes(FAKE));
    const hyp = classified.find((c) => /假设未来/.test(c.text));
    assert.notEqual(fake.learnKind, "new_fact");
    assert.equal(fake.rejectReason, "unverified_fact_no_evidence");
    assert.notEqual(hyp.learnKind, "new_fact");
    assert.equal(hyp.rejectReason, "hypothetical_not_fact");

    const cons = autoLearn.consolidate(classified);
    assert.ok(cons.skipped.some((s) => s.action === "skip_unverified_fact"));
    assert.ok(cons.skipped.some((s) => s.action === "skip_hypothetical"));
    assert.equal(cons.kept.some((k) => k.learnKind === "new_fact"), false);

    // Generation of hypothetical must remain allowed (representation with hedge)
    assert.equal(
      assertRepresentationFactsGrounded(
        "假设未来可探索企业授权。",
        "",
        "representation"
      ),
      true
    );
  });

  await test("claim posture constants + guidance coverage", () => {
    assert.deepEqual([...CLAIM_POSTURES], [
      "confirmed",
      "attributed",
      "inferred",
      "hypothetical",
    ]);
    for (const c of ["representation", "decision_support", "exploration", "creation", "execution"]) {
      const g = promptGuidanceForClass(c, resolveAssemblyPolicy({ contextClass: c }));
      assert.match(g, /Claim Posture|主张姿态/);
    }
  });

  console.log(`\nCRT-MVP-02.1 unit: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);

  const { spawnSync } = require("node:child_process");
  const scripts = [
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
  console.log("\nAll CRT-MVP-02.1 + regressions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

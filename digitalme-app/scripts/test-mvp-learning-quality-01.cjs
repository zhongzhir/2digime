"use strict";

/**
 * MVP-LEARNING-QUALITY-01: classification, provenance, overlearn, revoke, resolver.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const autoLearn = require("../src/act-behalf/deliverable-auto-learn");
const { createMinimalFixture } = require("../src/package-store/fixture");
const assembler = require("../src/act-behalf/subject-context-assembler");
const projectKnowledgeStore = require("../src/act-behalf/project-knowledge-store");

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

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const FIVE_GUIDANCE = [
  "请按以下明确修改重写：",
  "1. 标题更有观点和冲突感",
  "2. 开头减少铺垫，直接进入问题",
  "3. 减少机械分点",
  "4. 事实新闻与趋势判断保持平衡",
  "5. 未完成或未验证的能力不得写成已经实现",
].join("\n");

const BODY_A =
  "最近一段时间，关于个人 AI 的讨论越来越多，很多人已经习惯把日常事务交给云端助手。";
const BODY_B =
  "目前主流的选择是放在云端，这样可以快速获得能力，但也会带来数据与控制权的问题。";

const DRAFT = [
  "# 个人 AI 助手的发展介绍",
  "",
  BODY_A,
  "",
  "- 点一",
  "- 点二",
  "- 点三",
  "- 点四",
  "- 点五",
].join("\n");

const ACCEPTED = [
  "# 云端便利背后：个人 AI 的控制权之争",
  "",
  "个人 AI 正从工具走向代理，真正的分歧不在功能清单，而在数据与控制权落在谁手里。",
  "",
  BODY_B,
  "",
  "外部协作网络尚未正式验证，支付结算尚未开始。未完成或未验证的能力不得写成已经实现。",
].join("\n");

async function pipelineFromGuidance(extra = {}) {
  const extracted = await autoLearn.extractLearningItems({
    title: "云端便利背后：个人 AI 的控制权之争",
    kind: "document",
    artifactKind: "document",
    excerpt: ACCEPTED,
    baselineExcerpt: DRAFT,
    revisionGuidance: FIVE_GUIDANCE,
    source: {
      taskId: "task_a_quality",
      deliverableVersionId: "ver_accepted_a",
      packageId: "pkg_test",
      deliverableId: "del_a",
      artifactKind: "document",
      acceptedAt: new Date().toISOString(),
    },
    evidenceCorpus: "",
    ...extra,
  });
  const classified = autoLearn.classifyItems(extracted, "", { artifactKind: "document" });
  const consolidated = autoLearn.consolidate(classified);
  return { extracted, classified, consolidated };
}

async function main() {
  await test("1. revisionGuidance 明确表达偏好正确分类", async () => {
    const { classified } = await pipelineFromGuidance();
    const prefs = classified.filter(
      (c) => c.learnKind === "expression_preference" && c.fromRevisionGuidance && c.resolverEligible
    );
    const texts = prefs.map((p) => p.canonicalStatement || p.text).join("\n");
    assert.match(texts, /标题更有观点/);
    assert.match(texts, /开头减少铺垫|直接进入问题/);
    assert.match(texts, /减少机械分点/);
    assert.match(texts, /事实.*趋势|趋势.*平衡|保持平衡/);
  });

  await test("2. 不得/不能/未验证不得 正确分类为 boundary", async () => {
    const inferred = autoLearn.inferLearnKind({
      text: "边界：未完成或未验证的能力不得写成已经实现",
      fromRevisionGuidance: true,
      learnHint: "boundary",
      layer: "semantic",
    });
    assert.equal(inferred.learnKind, "boundary");
    assert.equal(inferred.resolverEligible, true);
    assert.equal(autoLearn.isBoundaryText("未完成或未验证的能力不得写成已经实现"), true);
  });

  await test("3. 尚未验证 项目状态可归类 current_fact", async () => {
    const inferred = autoLearn.inferLearnKind({
      text: "用户确认的修正：外部协作网络尚未正式验证",
      fromRevisionGuidance: true,
      learnHint: "current_fact",
      layer: "semantic",
    });
    assert.equal(inferred.learnKind, "current_fact");
    assert.equal(autoLearn.isCurrentFactText("外部协作网络尚未正式验证"), true);
  });

  await test("4. revisionGuidance 标题不写长期记忆", async () => {
    const { consolidated, classified } = await pipelineFromGuidance();
    assert.equal(autoLearn.isRevisionGuidanceHeader("请按以下明确修改重写："), true);
    const headerKept = consolidated.kept.filter((k) =>
      /请按以下明确修改重写/.test(k.text || "")
    );
    assert.equal(headerKept.length, 0);
    const headerSkipped = consolidated.skipped.filter(
      (s) => s.action === "skip_revision_header" || s.rejectReason === "revision_header_not_reusable"
    );
    assert.ok(headerSkipped.length >= 1 || classified.some((c) => c.revisionHeader));
  });

  await test("5-7. 成果正文长段不进偏好、标 overlearn、resolverEligible=false", async () => {
    const { classified, consolidated } = await pipelineFromGuidance();
    const bodyItems = classified.filter((c) => c.fromBodyHarvest);
    assert.ok(bodyItems.length >= 1, "should harvest body for audit");
    for (const b of bodyItems) {
      assert.equal(b.resolverEligible, false);
      assert.ok(b.overlearnRisk || b.rejectReason === "artifact_body_overlearn_blocked");
    }
    // Explicit long paragraphs from the original probe must be overlearn risks.
    for (const sample of [BODY_A, BODY_B]) {
      const over = autoLearn.assessOverlearnRisk({ text: sample, fromBodyHarvest: true });
      assert.equal(over.overlearnRisk, true);
      assert.equal(over.blockLongTermPref, true);
    }
    const longPref = consolidated.kept.filter(
      (k) =>
        k.learnKind === "expression_preference" &&
        k.resolverEligible !== false &&
        (/最近一段时间|目前主流/.test(k.text || "") || (k.canonicalStatement || "").length > 120)
    );
    assert.equal(longPref.length, 0);
  });

  await test("8-9. revision diff 只生成抽象结构偏好，不复制采用稿正文", async () => {
    const { extracted, consolidated } = await pipelineFromGuidance();
    const diffItems = extracted.filter((e) => e.fromRevisionDiff);
    assert.ok(diffItems.some((d) => /减少机械分点|连贯叙述/.test(d.text)));
    assert.ok(diffItems.every((d) => !d.text.includes(BODY_A) && !d.text.includes(BODY_B)));
    assert.ok(
      diffItems.every((d) => !/采用「.+」这类表达/.test(d.text)),
      "must not paste full titles"
    );
    const keptBody = consolidated.kept.filter((k) => /最近一段时间|目前主流/.test(k.text || ""));
    assert.equal(keptBody.filter((k) => k.resolverEligible).length, 0);
  });

  await test("10-12. sourceTaskId / sourceVersionId / sourceLearnJobId 正确写入", async () => {
    const root = tempDir("dm-lq-prov-");
    const packageDir = createMinimalFixture(root);
    const { consolidated } = await pipelineFromGuidance();
    const source = {
      taskId: "task_a_quality",
      deliverableVersionId: "ver_accepted_a",
      packageId: "pkg_test",
      deliverableId: "del_a",
      learnJobId: "learn_job_quality_1",
      acceptedAt: new Date().toISOString(),
    };
    const commit = autoLearn.commitLearning(packageDir, consolidated.kept, source);
    assert.equal(commit.ok, true);
    const memPath = path.join(packageDir, "memory", "long-term-memory.jsonl");
    assert.ok(fs.existsSync(memPath));
    const rows = fs
      .readFileSync(memPath, "utf8")
      .split(/\n+/)
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const reusable = rows.filter((r) => r.resolverEligible !== false && r.learnKind !== "artifact_history");
    assert.ok(reusable.length >= 4, "expected reusable memory rows");
    for (const r of reusable) {
      assert.equal(r.sourceTaskId, "task_a_quality");
      assert.equal(r.sourceVersionId, "ver_accepted_a");
      assert.equal(r.sourceLearnJobId, "learn_job_quality_1");
      assert.ok(r.sourceType);
      assert.ok(r.createdAt);
    }
    cleanup(root);
  });

  await test("13-14. 同义偏好去重且保留多来源 refs", async () => {
    const classified = autoLearn.classifyItems(
      [
        {
          id: "a",
          layer: "semantic",
          text: "表达与成果偏好：减少机械分点",
          fromRevisionGuidance: true,
          learnHint: "expression_preference",
          confidence: "medium",
          preferenceKey: autoLearn.normalizePreferenceKey("减少机械分点"),
          canonicalStatement: "减少机械分点",
        },
        {
          id: "b",
          layer: "semantic",
          text: "结构偏好：减少机械分点，更多连贯叙述。",
          fromRevisionDiff: true,
          learnHint: "expression_preference",
          confidence: "medium",
          preferenceKey: autoLearn.normalizePreferenceKey("减少机械分点"),
          canonicalStatement: "减少机械分点，优先使用连贯叙述",
        },
      ],
      ""
    );
    const cons = autoLearn.consolidate(classified);
    const prefs = cons.kept.filter((k) => k.learnKind === "expression_preference");
    assert.equal(prefs.length, 1);
    assert.ok(Array.isArray(prefs[0].sourceRefsAccum) && prefs[0].sourceRefsAccum.length >= 2);
  });

  await test("15-16. 撤销一个来源不误删其他来源；rejected 不召回", async () => {
    const root = tempDir("dm-lq-rev-");
    const packageDir = createMinimalFixture(root);
    const memPath = path.join(packageDir, "memory", "long-term-memory.jsonl");
    fs.mkdirSync(path.dirname(memPath), { recursive: true });
    const rows = [
      {
        content: "表达与成果偏好：标题更有观点和冲突感",
        learnKind: "expression_preference",
        status: "active",
        resolverEligible: true,
        sourceTaskId: "t1",
        sourceVersionId: "ver_a",
        sourceLearnJobId: "j1",
        sourceType: "revision_guidance",
        qualityScope: { level: "artifact_kind", artifactKinds: ["document"], taskTypes: [] },
        learnProvenance: { deliverableVersionId: "ver_a", taskId: "t1" },
      },
      {
        content: "表达与成果偏好：减少机械分点",
        learnKind: "expression_preference",
        status: "active",
        resolverEligible: true,
        sourceTaskId: "t1",
        sourceVersionId: "ver_b",
        sourceLearnJobId: "j2",
        sourceType: "revision_guidance",
        qualityScope: { level: "artifact_kind", artifactKinds: ["document"], taskTypes: [] },
        learnProvenance: { deliverableVersionId: "ver_b", taskId: "t1" },
      },
    ];
    fs.writeFileSync(memPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    const suppressed = autoLearn.suppressRejectedVersion("ud", "ver_a", packageDir);
    assert.equal(suppressed.memoryRevoked, 1);
    const after = fs
      .readFileSync(memPath, "utf8")
      .split(/\n+/)
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    assert.equal(after.find((r) => r.sourceVersionId === "ver_a").status, "revoked");
    assert.equal(after.find((r) => r.sourceVersionId === "ver_b").status, "active");
    const assets = assembler.loadMemoryAssets(packageDir, 50, { artifactKind: "document" });
    assert.ok(!assets.some((a) => /标题更有观点/.test(a.statement)));
    assert.ok(assets.some((a) => /减少机械分点/.test(a.statement)));
    cleanup(root);
  });

  await test("17. boundary 比 expression_preference 优先", async () => {
    const assets = [
      {
        assetId: "p1",
        layer: "preference",
        statement: "表达与成果偏好：标题更有观点",
        learnKind: "expression_preference",
        confidence: "medium",
        sourceType: "revision_guidance",
      },
      {
        assetId: "b1",
        layer: "preference",
        statement: "边界：未完成或未验证的能力不得写成已经实现",
        learnKind: "boundary",
        confidence: "high",
        sourceType: "revision_guidance",
      },
    ];
    const scored = assets
      .map((a) => ({
        ...a,
        _score: assembler.scoreAsset
          ? assembler.scoreAsset(a, ["能力", "验证"], [])
          : 0,
      }))
      .sort((a, b) => b._score - a._score);
    if (typeof assembler.scoreAsset === "function") {
      assert.equal(scored[0].learnKind, "boundary");
    } else {
      // Fallback: ensure classify prioritizes boundary
      const b = autoLearn.inferLearnKind({
        text: "未完成或未验证的能力不得写成已经实现",
        fromRevisionGuidance: true,
        layer: "semantic",
      });
      const p = autoLearn.inferLearnKind({
        text: "标题更有观点和冲突感",
        fromRevisionGuidance: true,
        learnHint: "expression_preference",
        layer: "semantic",
      });
      assert.equal(b.learnKind, "boundary");
      assert.equal(p.learnKind, "expression_preference");
    }
  });

  await test("18. current_fact 不进入表达偏好", async () => {
    const inferred = autoLearn.inferLearnKind({
      text: "用户确认的修正：支付结算尚未开始",
      fromRevisionGuidance: true,
      layer: "semantic",
    });
    assert.equal(inferred.learnKind, "current_fact");
    assert.notEqual(inferred.learnKind, "expression_preference");
  });

  await test("19. artifact_history 不进入长期 Resolver", async () => {
    const inferred = autoLearn.inferLearnKind({
      text: "本人接受了「测试」这一成果版本。",
      layer: "artifact_history",
      artifactOnly: true,
    });
    assert.equal(inferred.resolverEligible, false);
    assert.equal(inferred.learnKind, "artifact_history");
    assert.equal(inferred.logicalState, "session_only");
  });

  await test("20-21. Task B 能召回 4 偏好 + 1 边界，不召回正文", async () => {
    const root = tempDir("dm-lq-res-");
    const packageDir = createMinimalFixture(root);
    const { consolidated } = await pipelineFromGuidance();
    const source = {
      taskId: "task_a_quality",
      deliverableVersionId: "ver_accepted_a",
      packageId: "pkg_test",
      learnJobId: "learn_job_quality_1",
    };
    autoLearn.commitLearning(packageDir, consolidated.kept, source);
    autoLearn.commitProjectKnowledgeCandidates(packageDir, consolidated.kept, {
      ...source,
      userData: root,
    });
    const assets = assembler.loadMemoryAssets(packageDir, 80, { artifactKind: "document" });
    const prefs = assets.filter((a) => a.learnKind === "expression_preference");
    const bounds = assets.filter((a) => a.learnKind === "boundary");
    assert.ok(prefs.length >= 4, `expected >=4 prefs, got ${prefs.length}: ${prefs.map((p) => p.statement).join(" | ")}`);
    assert.ok(bounds.length >= 1, "expected >=1 boundary");
    assert.ok(!assets.some((a) => /最近一段时间|目前主流/.test(a.statement)));
    cleanup(root);
  });

  await test("22-24. 价值相关：无错误旧事实、无 Task A 正文复制（静态契约）", async () => {
    const { consolidated } = await pipelineFromGuidance();
    const writablePrefs = consolidated.kept.filter(
      (k) => k.learnKind === "expression_preference" && k.resolverEligible !== false
    );
    for (const p of writablePrefs) {
      assert.ok(!/最近一段时间|目前主流的选择是放在云端/.test(p.text || ""));
      assert.ok((p.canonicalStatement || p.text || "").length < 120);
    }
    const facts = consolidated.kept.filter((k) => k.learnKind === "current_fact");
    for (const f of facts) {
      assert.ok(!/表达与成果偏好/.test(f.text || ""));
    }
    // Value A/B non-regression is covered by Owner real DeepSeek script; static gate:
    assert.ok(writablePrefs.length >= 4);
    assert.ok(consolidated.kept.some((k) => k.learnKind === "boundary"));
  });

  await test("FIX-01: boundary 标签不得触发 sensitive_or_identity 冲突", async () => {
    const { consolidated } = await pipelineFromGuidance();
    const boundary = consolidated.kept.find((k) => k.learnKind === "boundary");
    assert.ok(boundary, "expected boundary kept");
    assert.equal(autoLearn.requiresOwnerSensitiveConflict(boundary), false);
    const conflict = autoLearn.detectConflict({
      kept: consolidated.kept,
      packageDir: null,
    });
    assert.equal(conflict.required, false, "revision guidance must auto-commit without Owner conflict");
  });

  await test("FIX-01 production: Learn Job → disk → reload → Resolver 4+1", async () => {
    const actStore = require("../src/act-behalf/task-store");
    const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
    const planner = require("../src/act-behalf/deliverable-planner");
    const packageStore = require("../src/act-behalf/deliverable-package-store");
    const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
    const generation = require("../src/act-behalf/deliverable-generation");
    const artifactFs = require("../src/act-behalf/deliverable-artifact-fs");
    const policies = require("../src/policies");

    const ud = tempDir("dm-lq-prod-ud-");
    const pkgDir = tempDir("dm-lq-prod-pkg-");
    createMinimalFixture(pkgDir, { withMemoryLine: false });

    const taskId = "t_lq_prod_" + Date.now().toString(36);
    const goal = "请写一份项目介绍文档。";
    await actStore.saveTask(ud, {
      taskId,
      title: "learning-quality-prod",
      goal,
      request: goal,
      status: "draft",
    });
    const suggestion = planner.ruleBasedPlan({ goal });
    suggestion.items = [
      {
        id: "pd_document",
        kind: "document",
        title: "介绍文档",
        purpose: "生产链路学习",
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
      userData: ud,
      planRecord: applied.plan,
      saveTaskPointers: async ({ deliverablePlanning }) => {
        const got = actStore.getTask(ud, taskId, { heal: false }).task;
        return actStore.saveTask(ud, { ...got, deliverablePlanning });
      },
      cas: { expectAbsent: true },
    });
    assert.equal(committed.ok, true);
    const confirmed = planner.confirmDraft(committed.plan);
    await planConsistency.commitPlanThenTask({
      userData: ud,
      planRecord: confirmed.plan,
      saveTaskPointers: async ({ deliverablePlanning }) => {
        const got = actStore.getTask(ud, taskId, { heal: false }).task;
        return actStore.saveTask(ud, {
          ...got,
          deliverablePlanning,
          deliverableExecution: { activePackageId: null },
        });
      },
      cas: { expectedRevision: planConsistency.revisionTokensFromPlan(committed.plan) },
    });
    const prep = await prepareDeliverablePackage(
      ud,
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
    const gen = await generation.generateDeliverablePackage(
      ud,
      { packageId: prep.package.id },
      { callModel: null, imageMode: "mock" }
    );
    assert.equal(gen.ok, true);
    const view = packageStore.getPackageView(ud, prep.package.id);
    const del = (view.deliverables || []).find((d) => d.kind === "document");
    assert.ok(del && del.currentVersionId);
    const versionId = del.currentVersionId;

    await packageStore.mutateStore(ud, (store) => {
      const version = store.versions[versionId];
      assert.ok(version);
      const attemptId = version.generationAttemptId;
      if (attemptId && store.generationAttempts[attemptId]) {
        store.generationAttempts[attemptId].revisionGuidance = FIVE_GUIDANCE;
      } else {
        const aid = "gatt_lq_" + Date.now().toString(36);
        store.generationAttempts[aid] = {
          id: aid,
          packageId: prep.package.id,
          deliverableId: del.id,
          revisionGuidance: FIVE_GUIDANCE,
          createdAt: new Date().toISOString(),
        };
        version.generationAttemptId = aid;
      }
      // Attach accepted body with overlearn paragraphs + baseline for abstract diff.
      const arts = [];
      if (version.artifactRef) arts.push(version.artifactRef);
      if (Array.isArray(version.artifactRefs)) arts.push(...version.artifactRefs);
      const md = arts.find((a) => a && String(a.format || "").toLowerCase() === "md");
      if (md && md.relativePath) {
        const abs = artifactFs.resolveAbsolute(ud, md.relativePath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, ACCEPTED, "utf8");
      }
      // Create a synthetic baseline version for bullet/title diff.
      const baseId = "dver_lq_base_" + Date.now().toString(36);
      store.versions[baseId] = {
        ...version,
        id: baseId,
        reviewStatus: "superseded",
        supersedesVersionId: null,
      };
      version.supersedesVersionId = baseId;
      if (md && md.relativePath) {
        const baseRel = md.relativePath.replace(/dver_[^/]+/, baseId);
        const baseAbs = artifactFs.resolveAbsolute(ud, baseRel);
        fs.mkdirSync(path.dirname(baseAbs), { recursive: true });
        fs.writeFileSync(baseAbs, DRAFT, "utf8");
        const baseArtId = "aref_lq_base_" + Date.now().toString(36);
        store.artifacts = store.artifacts || {};
        store.artifacts[baseArtId] = {
          ...(store.artifacts[md.id] || {}),
          id: baseArtId,
          relativePath: baseRel,
          format: "md",
        };
        store.versions[baseId].artifactRef = { id: baseArtId, format: "md", relativePath: baseRel };
        store.versions[baseId].artifactRefs = [store.versions[baseId].artifactRef];
      }
      return { ok: true };
    });

    await generation.reviewDeliverableVersion(ud, {
      versionId,
      decision: "accepted",
    });
    const enq = await autoLearn.enqueueAfterAccept(ud, versionId, {
      packageDir: pkgDir,
      sync: true,
    });
    assert.equal(enq.ok, true, "enqueue ok");
    assert.equal(
      enq.job.status,
      "committed",
      "expected committed, got " + enq.job.status + " conflict=" + JSON.stringify(enq.job.conflict || null)
    );
    assert.ok(enq.job.commit && enq.job.commit.changeSetId);

    // Simulate new process: invalidate caches and re-read from disk.
    packageStore.invalidateStoreCache();
    const memPath = path.join(pkgDir, "memory", "long-term-memory.jsonl");
    assert.ok(fs.existsSync(memPath));
    const rawMem = fs.readFileSync(memPath, "utf8");
    const rows = rawMem
      .split(/\n+/)
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const prefRows = rows.filter(
      (r) => r.learnKind === "expression_preference" && r.resolverEligible === true && !r.revoked
    );
    const boundRows = rows.filter((r) => r.learnKind === "boundary" && r.resolverEligible === true);
    assert.ok(prefRows.length >= 4, "disk prefs=" + prefRows.length + " sample=" + prefRows.map((r) => r.content).join(" | "));
    assert.ok(boundRows.length >= 1, "disk boundaries=" + boundRows.length);
    for (const r of prefRows.concat(boundRows)) {
      assert.equal(r.sourceTaskId, taskId);
      assert.equal(r.sourceVersionId, versionId);
      assert.ok(r.sourceLearnJobId);
    }
    assert.ok(!rows.some((r) => r.resolverEligible === true && /最近一段时间|目前主流/.test(r.content || "")));

    const assets = assembler.loadMemoryAssets(pkgDir, 120, { artifactKind: "document" });
    const prefs = assets.filter((a) => a.learnKind === "expression_preference");
    const bounds = assets.filter((a) => a.learnKind === "boundary");
    assert.ok(prefs.length >= 4, "resolver prefs=" + prefs.length);
    assert.ok(bounds.length >= 1, "resolver bounds=" + bounds.length);
    assert.equal(
      assets.filter((a) => /最近一段时间|目前主流/.test(a.statement || "")).length,
      0
    );

    const bnd = policies.readBoundaries(pkgDir);
    assert.ok(
      (bnd.items || []).some((it) => /未完成或未验证的能力不得写成已经实现/.test(it.text || "")),
      "boundary authority layer missing learned item"
    );

    const assembled = assembler.assembleSubjectContext({
      packageDir: pkgDir,
      query: { goal: "写一份公众号文字稿", deliverableKind: "document" },
      limits: { maxPreference: 12, maxMemory: 12, subjectCharsLimit: 8000 },
    });
    const rendered = String((assembled && assembled.renderedText) || "");
    assert.ok(!/请按以下明确修改重写/.test(rendered), "Task A revisionGuidance must not bypass into Task B context");
    assert.ok(
      /标题更有观点|减少机械分点|开头减少铺垫|事实.*趋势|不得写成已经实现/.test(rendered),
      "resolver should inject learned prefs/boundary"
    );

    cleanup(ud);
    cleanup(pkgDir);
  });

  await test("scope isolation: software/image/video/podcast 不串味", async () => {
    const qs = require("../src/act-behalf/quality-experience-scope");
    const root = tempDir("dm-lq-scope-");
    const packageDir = createMinimalFixture(root);
    const memPath = path.join(packageDir, "memory", "long-term-memory.jsonl");
    const rows = [
      {
        content: "表达与成果偏好：减少机械分点",
        learnKind: "expression_preference",
        status: "active",
        resolverEligible: true,
        qualityScope: { level: "artifact_kind", artifactKinds: ["document"], taskTypes: [] },
        qualityApplications: ["generation_context", "revision_strategy"],
      },
      {
        content: "表达与成果偏好：标题更有观点和冲突感",
        learnKind: "expression_preference",
        status: "active",
        resolverEligible: true,
        qualityScope: { level: "artifact_kind", artifactKinds: ["document"], taskTypes: [] },
      },
      {
        content: "表达与成果偏好：必须完成真实运行验证",
        learnKind: "expression_preference",
        status: "active",
        resolverEligible: true,
        qualityScope: { level: "artifact_kind", artifactKinds: ["software"], taskTypes: [] },
        qualityApplications: ["automated_validation", "acceptance_criteria", "generation_context"],
      },
      {
        content: "表达与成果偏好：主体突出、文字少",
        learnKind: "expression_preference",
        status: "active",
        resolverEligible: true,
        qualityScope: { level: "artifact_kind", artifactKinds: ["image"], taskTypes: [] },
      },
      {
        content: "表达与成果偏好：语气自然、避免念稿感",
        learnKind: "expression_preference",
        status: "active",
        resolverEligible: true,
        qualityScope: { level: "artifact_kind", artifactKinds: ["podcast"], taskTypes: [] },
      },
      {
        content: "边界：未完成或未验证的能力不得写成已经实现",
        learnKind: "boundary",
        status: "active",
        resolverEligible: true,
        qualityScope: { level: "global", artifactKinds: [], taskTypes: [] },
      },
      {
        content: "用户确认的修正：外部协作网络尚未正式验证",
        learnKind: "current_fact",
        status: "active",
        resolverEligible: true,
        qualityScope: {
          level: "project",
          projectId: "proj_digital_me",
          artifactKinds: ["document"],
          taskTypes: [],
        },
      },
    ];
    fs.writeFileSync(memPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

    // 1) 文章「减少机械分点」不进入 software
    const soft = assembler.resolveQualityExperiences(packageDir, { artifactKind: "software" });
    assert.ok(!soft.some((e) => /减少机械分点/.test(e.canonicalStatement || e.statement)));
    assert.ok(!soft.some((e) => /结构化模块|禁止.*模块/.test(e.statement || "")));

    // 2) 文章标题冲突感不进入 software
    assert.ok(!soft.some((e) => /标题更有观点|冲突感/.test(e.canonicalStatement || e.statement)));

    // 3) 编程运行验证不进入 image
    const img = assembler.resolveQualityExperiences(packageDir, { artifactKind: "image" });
    assert.ok(!img.some((e) => /真实运行验证/.test(e.canonicalStatement || e.statement)));
    assert.ok(img.some((e) => /主体突出|文字少/.test(e.canonicalStatement || e.statement)));

    // 4) 图片偏好不进入 podcast
    const pod = assembler.resolveQualityExperiences(packageDir, { artifactKind: "podcast" });
    assert.ok(!pod.some((e) => /主体突出|文字少/.test(e.canonicalStatement || e.statement)));

    // 5) 播客语气可在 podcast 召回
    assert.ok(pod.some((e) => /语气自然|念稿感/.test(e.canonicalStatement || e.statement)));

    // 6) 全局 boundary 跨成果类型
    for (const kind of ["document", "software", "image", "video", "podcast"]) {
      const ex = assembler.resolveQualityExperiences(packageDir, { artifactKind: kind });
      assert.ok(
        ex.some((e) => e.learnKind === "boundary" && /未验证的能力不得写成已经实现/.test(e.canonicalStatement || e.statement)),
        "global boundary missing for " + kind
      );
    }

    // 7) project current_fact 只在相关项目
    const factHit = assembler.resolveQualityExperiences(packageDir, {
      artifactKind: "document",
      projectId: "proj_digital_me",
    });
    // current_fact with project scope — loadMemoryAssets filters qualityScope; current_fact included in resolveQualityExperiences
    const factMiss = assembler.resolveQualityExperiences(packageDir, {
      artifactKind: "document",
      projectId: "proj_other",
    });
    assert.ok(
      factHit.some((e) => e.learnKind === "current_fact" && /外部协作网络尚未正式验证/.test(e.canonicalStatement || e.statement))
    );
    assert.ok(
      !factMiss.some((e) => e.learnKind === "current_fact" && /外部协作网络尚未正式验证/.test(e.canonicalStatement || e.statement))
    );

    // 8) 多来源合并不得无依据扩大为 global
    const merged = qs.mergeScopeRecords(
      { level: "artifact_kind", artifactKinds: ["document"] },
      { level: "artifact_kind", artifactKinds: ["document"] }
    );
    assert.equal(merged.level, "artifact_kind");
    assert.ok(!merged.artifactKinds.includes("software"));
    const notWidened = qs.mergeScopeRecords(
      { level: "artifact_kind", artifactKinds: ["document"] },
      { level: "global", artifactKinds: [] }
    );
    // Prefer narrower when merging unequal broadness
    assert.equal(notWidened.level, "artifact_kind");

    // video isolation: software runtime validation must not alter video prompts
    const vid = assembler.resolveQualityExperiences(packageDir, { artifactKind: "video" });
    assert.ok(!vid.some((e) => /真实运行验证/.test(e.canonicalStatement || e.statement)));
    assert.ok(!vid.some((e) => /减少机械分点/.test(e.canonicalStatement || e.statement)));
    assert.ok(vid.some((e) => e.learnKind === "boundary"));

    // Structured applications exist (not prompt-only)
    const softExp = soft.find((e) => /真实运行验证/.test(e.canonicalStatement || e.statement));
    assert.ok(softExp);
    assert.ok(Array.isArray(softExp.qualityApplications));
    assert.ok(softExp.qualityApplications.includes("automated_validation"));

    cleanup(root);
  });

  console.log("");
  console.log(JSON.stringify({ passed, failed, ok: failed === 0 }));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

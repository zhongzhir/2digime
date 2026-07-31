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
    excerpt: ACCEPTED,
    baselineExcerpt: DRAFT,
    revisionGuidance: FIVE_GUIDANCE,
    source: {
      taskId: "task_a_quality",
      deliverableVersionId: "ver_accepted_a",
      packageId: "pkg_test",
      deliverableId: "del_a",
      acceptedAt: new Date().toISOString(),
    },
    evidenceCorpus: "",
    ...extra,
  });
  const classified = autoLearn.classifyItems(extracted, "");
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
    const assets = assembler.loadMemoryAssets(packageDir, 50);
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
    const assets = assembler.loadMemoryAssets(packageDir, 80);
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

  console.log("");
  console.log(JSON.stringify({ passed, failed, ok: failed === 0 }));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

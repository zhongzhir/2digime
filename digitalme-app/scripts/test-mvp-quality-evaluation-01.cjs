"use strict";

/**
 * MVP-QUALITY-EVALUATION-01 — static + deterministic closed-loop tests.
 *
 * Covers: unified contract, document/software real loops (mock model),
 * scope isolation for image/video/podcast, preservation of qualified sections,
 * stop conditions, Store/IPC increment = 0.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const qe = require("../src/act-behalf/quality-evaluation");
const docEval = require("../src/act-behalf/quality-document-evaluator");
const softEval = require("../src/act-behalf/quality-software-evaluator");
const generators = require("../src/act-behalf/deliverable-generators");
const qualityScope = require("../src/act-behalf/quality-experience-scope");

const EVIDENCE_DIR = path.join(__dirname, "_mvp-quality-evaluation-01-evidence");

let passed = 0;
let failed = 0;
const cases = [];

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      cases.push({ name, ok: true });
      console.log("PASS", name);
    })
    .catch((err) => {
      failed += 1;
      cases.push({ name, ok: false, error: String(err && err.stack ? err.stack : err) });
      console.error("FAIL", name);
      console.error(err && err.stack ? err.stack : err);
    });
}

function ensureEvidenceDir() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

async function main() {
  ensureEvidenceDir();

  await test("contract: registered evaluators include document+software+stubs", () => {
    const list = qe.listRegisteredEvaluators();
    assert.ok(list.includes("document"));
    assert.ok(list.includes("software"));
    assert.ok(list.includes("image"));
    assert.ok(list.includes("video"));
    assert.ok(list.includes("podcast"));
  });

  await test("scope: image/video/podcast return unsupported_scope (no fake validation)", async () => {
    for (const kind of ["image", "video", "podcast"]) {
      const ev = await qe.evaluateArtifact({ artifactType: kind, content: "x" });
      assert.equal(ev.status, "unsupported_scope");
      assert.equal(ev.passFail, "unsupported");
      assert.ok(ev.checks.some((c) => c.id.includes("real_quality") || c.category === "scope"));
    }
  });

  await test("scope: article aliases to document evaluator", async () => {
    const md = [
      "# 标题",
      "",
      "## 背景",
      "",
      "本文说明 Digital Me 本地任务成果质量评估如何工作。",
      "",
      "## 方案",
      "",
      "系统在生成后执行确定性检查，并只修复未达标项。",
      "",
      "## 边界",
      "",
      "图片视频播客本轮不做伪验证。",
    ].join("\n");
    const ev = await qe.evaluateArtifact({
      artifactType: "article",
      content: md,
      goal: "Digital Me 质量评估",
      forceDeterministicReview: true,
    });
    assert.equal(ev.artifactType, "document");
    assert.ok(ev.evaluatorProvenance.evaluatorId.includes("document"));
  });

  await test("document: fails hollow draft then improves via targeted revise", async () => {
    const goodSection = [
      "## 已合格章节",
      "",
      "本节说明质量系统负责验证本次成果是否达标，学习系统负责用户偏好。二者职责分离。",
    ].join("\n");
    let revisionCount = 0;
    const loop = await qe.runQualityClosedLoop({
      artifactType: "document",
      goal: "Digital Me 质量评估说明",
      criteria: { minChars: 200 },
      generate: async () => ({
        md: [
          "# Digital Me 质量评估说明",
          "",
          goodSection,
          "",
          "## 待完善",
          "",
          "待填写",
          "",
          "持续优化 全面赋能 打造生态 深度融合 全方位升级 不断提升",
        ].join("\n"),
      }),
      revise: async ({ artifact, actionableRevisions }) => {
        revisionCount += 1;
        assert.ok(actionableRevisions.length > 0);
        // Targeted fix: replace only failing parts; keep goodSection intact.
        let md = artifact.md;
        md = md.replace(/待填写/g, "本节补齐任务覆盖与可执行说明。");
        md = md.replace(
          /持续优化 全面赋能 打造生态 深度融合 全方位升级 不断提升/,
          "用具体检查项与证据说明是否达标。"
        );
        // Ensure length
        if (md.length < 220) {
          md +=
            "\n\n## 补充\n\n覆盖任务要求、结构、篇幅、表达偏好、边界与事实风险，并保留已合格内容不被重写。\n";
        }
        return { md };
      },
    });

    assert.ok(loop.improved || loop.status === "pass", "loop should improve or pass");
    assert.ok(revisionCount >= 1 && revisionCount <= 2);
    assert.ok(loop.artifact.md.includes("已合格章节"));
    assert.ok(loop.artifact.md.includes("学习系统负责用户偏好"));
    assert.ok(!loop.artifact.md.includes("待填写"));
    if (loop.qualifiedPartsPreserved) {
      assert.ok(
        loop.qualifiedPartsPreserved.preserved.some((s) => String(s).includes("已合格")) ||
          loop.qualifiedPartsPreserved.preservedRatio >= 0.3,
        "qualified section should largely be preserved"
      );
    }
    assert.ok((loop.score || 0) >= (loop.initialScore || 0));
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "document-deterministic-loop.json"),
      JSON.stringify(
        {
          status: loop.status,
          improved: loop.improved,
          revisionsUsed: loop.revisionsUsed,
          initialScore: loop.initialScore,
          score: loop.score,
          remainingIssues: loop.remainingIssues,
          preserved: loop.qualifiedPartsPreserved,
          history: loop.history,
        },
        null,
        2
      )
    );
  });

  await test("document: stop after max 2 revisions without false pass claim", async () => {
    const loop = await qe.runQualityClosedLoop({
      artifactType: "document",
      goal: "无法修好的草稿",
      criteria: { minChars: 5000 },
      generate: async () => ({ md: "# 短\n\n待填写\n" }),
      revise: async ({ artifact }) => ({ md: artifact.md + "\n仍不够长\n" }),
    });
    assert.equal(loop.revisionsUsed, 2);
    assert.equal(loop.stoppedReason, "max_revisions_exhausted");
    assert.equal(loop.claimedPass, false);
    assert.equal(loop.userFacingMetStandard, false);
    assert.ok(Array.isArray(loop.remainingIssues));
  });

  await test("software: broken script fails checks; targeted fix becomes runnable", async () => {
    const loop = await qe.runQualityClosedLoop({
      artifactType: "software",
      goal: "打印 hello-quality",
      viaProductPipeline: true,
      allowedFiles: ["main.js", "artifact.md"],
      generate: async () => ({
        files: {
          "main.js": '"use strict";\nconsole.log("broken"\n', // syntax error
          "artifact.md": "# software\n",
        },
        viaProductPipeline: true,
      }),
      revise: async ({ artifact, actionableRevisions }) => {
        assert.ok(actionableRevisions.some((r) => /parse|runnable|syntax|语法/i.test(r.checkId + r.message)));
        return {
          files: {
            "main.js":
              '"use strict";\nconsole.log("hello-quality");\nprocess.exit(0);\n',
            "artifact.md": "# software\n\nfixed\n",
          },
          viaProductPipeline: true,
        };
      },
    });
    assert.equal(loop.status, "pass");
    assert.equal(loop.improved, true);
    assert.ok(loop.revisionsUsed >= 1);
    const finalEval = await softEval.evaluateSoftwareArtifact(loop.artifact);
    const finalized = qe.finalizeEvaluation(finalEval);
    assert.equal(finalized.status, "pass");
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "software-deterministic-loop.json"),
      JSON.stringify(
        {
          status: loop.status,
          improved: loop.improved,
          revisionsUsed: loop.revisionsUsed,
          initialScore: loop.initialScore,
          score: loop.score,
          history: loop.history,
        },
        null,
        2
      )
    );
  });

  await test("software: security pattern blocks pass even if runnable", async () => {
    const ev = await qe.evaluateArtifact({
      artifactType: "software",
      files: {
        "main.js": '"use strict";\neval("1+1");\nconsole.log("x");\n',
      },
      viaProductPipeline: true,
    });
    assert.equal(ev.status, "fail");
    assert.ok(ev.checks.some((c) => c.id === "security_eval_usage" && !c.passed));
  });

  await test("software: generator produces runnable artifact without model", async () => {
    const produced = await generators.generateSoftware({
      deliverable: { title: "演示脚本", kind: "software", purpose: "可运行" },
      task: { goal: "输出 ok:demo", title: "demo" },
      callModel: null,
    });
    assert.equal(produced.kind, "software");
    assert.ok(produced.files["main.js"]);
    const ev = await qe.evaluateArtifact({
      artifactType: "software",
      files: produced.files,
      viaProductPipeline: true,
      goal: "输出 ok:demo",
    });
    assert.equal(ev.status, "pass", JSON.stringify(ev.remainingIssues, null, 2));
  });

  await test("learning quality modules untouched (smoke require + scope helpers)", () => {
    const autoLearn = require("../src/act-behalf/deliverable-auto-learn");
    assert.equal(typeof autoLearn.inferLearnKind, "function");
    assert.equal(qualityScope.normalizeArtifactKind("article"), "document");
    assert.equal(qualityScope.normalizeArtifactKind("code"), "software");
    assert.ok(qualityScope.QUALITY_APPLICATIONS.includes("automated_validation"));
  });

  await test("store_ipc_increment: no new *Store.js or actBehalf IPC in this task", () => {
    const actDir = path.join(__dirname, "..", "src", "act-behalf");
    const stores = fs.readdirSync(actDir).filter((f) => /Store\.js$/i.test(f) || /-store\.js$/i.test(f));
    const newStores = stores.filter((f) => /quality-eval|quality_evaluation|artifact-quality/i.test(f));
    assert.equal(newStores.length, 0);
    const mainJs = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
    assert.ok(!/actBehalf:evaluateQuality|actBehalf:qualityEvaluation/.test(mainJs));
  });

  await test("fingerprints: unchanged section detected as preserved", () => {
    const before = "# A\n\nkeep me\n\n## B\n\nbad TBD\n";
    const after = "# A\n\nkeep me\n\n## B\n\nfixed content here\n";
    const diff = qe.diffPreservedSections(
      qe.sectionFingerprints(before),
      qe.sectionFingerprints(after),
      ["placeholder"]
    );
    assert.ok(diff.preserved.some((s) => String(s).includes("A")));
    assert.ok(diff.changed.some((c) => String(c.section).includes("B")));
  });

  const summary = {
    task: "MVP-QUALITY-EVALUATION-01",
    passed,
    failed,
    cases,
    storeIpcIncrement: { store: 0, ipc: 0, knowledgeSource: 0 },
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, "unit-summary.json"), JSON.stringify(summary, null, 2));

  console.log("\nSummary: %d passed, %d failed", passed, failed);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

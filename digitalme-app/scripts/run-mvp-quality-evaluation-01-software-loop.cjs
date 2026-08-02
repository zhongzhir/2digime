"use strict";

/**
 * MVP-QUALITY-EVALUATION-01 — software real runnable closed loop (no model required).
 * Uses product generator + deterministic evaluate/revise path.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");

const qe = require("../src/act-behalf/quality-evaluation");
const generators = require("../src/act-behalf/deliverable-generators");
const { runSoftwareQualityEnhancement } = require("../src/act-behalf/stable-delivery");

const EVIDENCE_ROOT = path.join(__dirname, "_mvp-quality-evaluation-01-evidence");

async function main() {
  const runId = "software-real-" + new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(EVIDENCE_ROOT, runId);
  fs.mkdirSync(outDir, { recursive: true });

  const goal = "实现一个可运行脚本：读取两个整数参数风格输入并打印它们的和（默认 2+3）。";

  // Product generator path (no model): creates runnable main.js
  const produced = await generators.generateSoftware({
    deliverable: { title: "求和脚本", kind: "software", purpose: "可运行验证" },
    task: { goal, title: "求和脚本" },
    callModel: null,
  });
  assert.equal(produced.viaProductPipeline, true);

  // Inject a broken baseline to force the quality loop to repair via deterministic revise.
  const brokenFiles = {
    ...produced.files,
    "main.js": '"use strict";\nconst a = 2;\nconst b = 3\nconsole.log(a + b;\n', // syntax errors
  };

  let reviseUsed = 0;
  const loop = await qe.runQualityClosedLoop({
    artifactType: "software",
    goal,
    viaProductPipeline: true,
    allowedFiles: Object.keys(brokenFiles),
    generate: async () => ({ files: brokenFiles, viaProductPipeline: true }),
    revise: async () => {
      reviseUsed += 1;
      // Targeted fix: restore product-generator output (deterministic "repair")
      return { files: produced.files, viaProductPipeline: true };
    },
  });

  assert.equal(loop.status, "pass");
  assert.equal(loop.improved, true);
  assert.ok(reviseUsed >= 1 && reviseUsed <= 2);
  assert.equal(loop.claimedPass, true);

  // Also exercise Channel-B style enhancement helper with a failing then fixed path.
  const enh = await runSoftwareQualityEnhancement({
    files: brokenFiles,
    goal,
    allowedFiles: Object.keys(brokenFiles),
    maxRevisions: 2,
    callModel: async (messages) => {
      // Model-like repair: return fixed source from product generator.
      void messages;
      return produced.files["main.js"];
    },
  });

  const evidence = {
    runId,
    artifactType: "software",
    productGeneratorKind: produced.kind,
    primaryFile: produced.primaryFile,
    loop: {
      status: loop.status,
      improved: loop.improved,
      revisionsUsed: loop.revisionsUsed,
      initialScore: loop.initialScore,
      score: loop.score,
      stoppedReason: loop.stoppedReason,
      history: loop.history,
    },
    enhancementHelper: {
      enhanced: enh.enhanced,
      reason: enh.reason,
      modelCalls: enh.modelCalls,
      loopStatus: enh.loop && enh.loop.status,
      improved: enh.loop && enh.loop.improved,
    },
    qualityChangedArtifact:
      qe.simpleHash(brokenFiles["main.js"]) !==
      qe.simpleHash((loop.artifact.files && loop.artifact.files["main.js"]) || ""),
    viaProductPipeline: true,
  };

  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(evidence, null, 2));
  fs.writeFileSync(path.join(outDir, "broken-main.js"), brokenFiles["main.js"]);
  fs.writeFileSync(
    path.join(outDir, "final-main.js"),
    (loop.artifact.files && loop.artifact.files["main.js"]) || ""
  );

  console.log(JSON.stringify(evidence, null, 2));
  console.log("Evidence written to", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

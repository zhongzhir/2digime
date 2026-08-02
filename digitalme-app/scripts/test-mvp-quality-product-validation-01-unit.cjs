"use strict";

/**
 * MVP-QUALITY-PRODUCT-VALIDATION-01 — deterministic unit checks for product-path
 * section revise / claim negation / residue strip (no SecretStore, no network).
 */

const assert = require("node:assert/strict");
const {
  isDeniedOrAbsentClaimWindow,
  isMetaGuidanceRuleId,
  mergePreservingUneditedSections,
  stripInternalRevisionResidue,
  compressToMaxChars,
  locateEditableSections,
} = require("../src/act-behalf/document-section-revise");
const { inferLengthBoundsFromGoal } = require("../src/act-behalf/quality-document-evaluator");
const { evaluateArtifact } = require("../src/act-behalf/quality-evaluation");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.message ? err.message : err);
  }
}

async function main() {
  await test("goal length bounds inferred generically", () => {
    const b = inferLengthBoundsFromGoal("写一份 800 至 1200 字的说明");
    assert.equal(b.minChars, 800);
    assert.equal(b.maxChars, 1200);
    assert.equal(b.fromGoal, true);
  });

  await test("negated capability window is not an unsupported claim", () => {
    assert.equal(
      isDeniedOrAbsentClaimWindow("当前存储基于 JSON 文件；SQLite 持久化均未上线。"),
      true
    );
    assert.equal(isDeniedOrAbsentClaimWindow("推荐使用 SQLite 作为持久化后端。"), false);
  });

  await test("meta revision guidance is not actionable content defect id", () => {
    assert.equal(isMetaGuidanceRuleId("grounding_revision_guidance"), true);
    assert.equal(isMetaGuidanceRuleId("unsupported_architecture_assumption"), false);
  });

  await test("section merge preserves unedited chapters", () => {
    const original =
      "# T\n\n## 一、背景\nA保留\n\n## 二、目标用户与场景\nB保留\n\n## 四、明确边界\n旧边界\n";
    const revised =
      "# T\n\n## 一、背景\n被改坏\n\n## 二、目标用户与场景\nB保留\n\n## 四、明确边界\n新边界，SQLite 延后\n";
    const merged = mergePreservingUneditedSections(original, revised, ["四、明确边界"]);
    assert.ok(merged.includes("A保留"));
    assert.ok(merged.includes("B保留"));
    assert.ok(merged.includes("新边界，SQLite 延后"));
    assert.ok(!merged.includes("被改坏"));
  });

  await test("internal revision residue stripped from body", () => {
    const cleaned = stripInternalRevisionResidue(
      "正文保留\n修订方向：按「现有基础 → 实际缺口」重组方案\n完"
    );
    assert.ok(cleaned.includes("正文保留"));
    assert.ok(!cleaned.includes("修订方向"));
  });

  await test("compressToMaxChars keeps non-targeted section", () => {
    const md =
      "# t\n\n## 一、背景\n" +
      "甲".repeat(500) +
      "\n\n## 二、场景\n" +
      "乙".repeat(500) +
      "\n\n## 三、方式\n" +
      "丙".repeat(500);
    const out = compressToMaxChars(md, 800, ["一、背景", "三、方式"]);
    assert.ok(out.replace(/\s+/g, " ").trim().length <= 800);
    assert.ok(out.includes("乙".repeat(40)));
  });

  await test("length over goal max is blocking remainingIssue", async () => {
    const ev = await evaluateArtifact({
      md: "# t\n\n## a\n" + "字".repeat(1500),
      goal: "写一份 800 至 1200 字的说明",
      artifactType: "document",
      forceDeterministicReview: true,
    });
    assert.equal(ev.status, "fail");
    assert.ok(ev.remainingIssues.some((i) => i.checkId === "length_adequacy"));
    assert.ok(ev.remainingIssues.every((i) => i.severity === "blocking"));
  });

  await test("locateEditableSections prefers longest when unmapped", () => {
    const md = "## 短\nx\n\n## 长段\n" + "y".repeat(400) + "\n\n## 中\n" + "z".repeat(80);
    const loc = locateEditableSections(md, [
      { ruleId: "length_adequacy", message: "篇幅过长（1500 > 1200）" },
    ]);
    assert.ok(loc.keys.includes("长段"));
    assert.ok(!loc.keys.includes("短"));
  });

  console.log(`\nmvp-quality-product-validation-01-unit: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();

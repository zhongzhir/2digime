"use strict";

/**
 * VL1-FIX: calibrate-not-limit generation prompts.
 * Run: npm run test:vl1-prompt-calibration
 */

const assert = require("node:assert/strict");

const {
  buildGenerationMessages,
  buildEmailGenerationMessages,
  buildVideoAudioGenerationMessages,
  PROMPT_TEMPLATES,
} = require("../src/act-behalf/result-generation");

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

const SAMPLE_CLAIM = {
  claimId: "clm_1",
  kind: "opinion",
  text: "本地优先与本人控制",
  confirmationState: "confirmed",
  sourceRefs: [],
  subjectContextVersion: "v1",
};

const SAMPLE_INTENT = {
  goal: "评估 AI 主权协作的当前主流产品图景",
  role: "researcher",
  expectedOutcome: "一份可编辑研究报告",
  constraints: [],
};

function researchSystem(continueWithoutExternalSources) {
  const messages = buildGenerationMessages({
    intent: SAMPLE_INTENT,
    skill: {
      systemHint: "按通用调研步骤整理证据与推断。",
      steps: ["澄清问题", "收集来源", "综合表达"],
    },
    claims: [SAMPLE_CLAIM],
    externalEvidence: [],
    continueWithoutExternalSources: !!continueWithoutExternalSources,
  });
  return messages[0].content;
}

async function main() {
  await test('1. research prompt excludes "必须遵守已注入的 Skill 方法与证据边界"', () => {
    const sys = researchSystem(true);
    assert.ok(!sys.includes("必须遵守已注入的 Skill 方法与证据边界"));
  });

  await test('2. research prompt excludes "结论必须受限"', () => {
    const sys = researchSystem(true);
    assert.ok(!sys.includes("结论必须受限"));
  });

  await test('3. research prompt excludes "每条 inference 至少引用一个有效 claimId 或 resultRef"', () => {
    const sys = researchSystem(true);
    assert.ok(!sys.includes("每条 inference 至少引用一个有效 claimId 或 resultRef"));
  });

  await test('4. research prompt states AI 通用能力 + 能力上限', () => {
    const sys = researchSystem(false);
    assert.ok(sys.includes("AI 通用能力"));
    assert.ok(sys.includes("能力上限"));
  });

  await test('5. research prompt lists 价值观 / 风格 / 安全 / 边界 calibrate dimensions', () => {
    const sys = researchSystem(false);
    assert.ok(sys.includes("价值观"));
    assert.ok(sys.includes("风格"));
    assert.ok(sys.includes("安全"));
    assert.ok(sys.includes("边界"));
  });

  await test('6. research prompt forbids 禁止伪造 + 禁止编造 claimId / URL', () => {
    const sys = researchSystem(false);
    assert.ok(sys.includes("禁止伪造"));
    assert.ok(sys.includes("禁止编造 claimId"));
    assert.ok(sys.includes("禁止编造 URL") || sys.includes("URL 或 resultRef"));
  });

  await test('7. continueWithoutExternalSources allows 通用知识答 + 不限制输出', () => {
    const sys = researchSystem(true);
    assert.ok(sys.includes("通用知识答") || sys.includes("用通用知识答"));
    assert.ok(sys.includes("不要限制输出") || sys.includes("不限制输出"));
    assert.ok(sys.includes("仍可用通用知识生成") || sys.includes("通用推理须显式标注"));
  });

  await test('8. email prompt excludes "必须符合已确认本人条目体现的表达风格"', () => {
    const messages = buildEmailGenerationMessages({
      intent: SAMPLE_INTENT,
      claims: [SAMPLE_CLAIM],
    });
    const sys = messages[0].content;
    assert.ok(!sys.includes("必须符合已确认本人条目体现的表达风格"));
  });

  await test(
    '9. video/audio prompt excludes "叙事口吻、表达风格与创意偏好必须符合已确认本人条目体现的特点"',
    () => {
      const messages = buildVideoAudioGenerationMessages({
        intent: SAMPLE_INTENT,
        claims: [SAMPLE_CLAIM],
      });
      const sys = messages[0].content;
      assert.ok(
        !sys.includes("叙事口吻、表达风格与创意偏好必须符合已确认本人条目体现的特点")
      );
    }
  );

  await test("10. three prompts keep product JSON field definitions (regression guard)", () => {
    const research = researchSystem(false);
    for (const field of [
      "subjectSummary",
      "externalFindings",
      "inferences",
      "finalDraft",
      "basedOnSubjectClaimIds",
      "basedOnExternalResultRefs",
      "uncertainty",
    ]) {
      assert.ok(research.includes(field), "research missing field " + field);
    }

    const email = buildEmailGenerationMessages({
      intent: SAMPLE_INTENT,
      claims: [SAMPLE_CLAIM],
    })[0].content;
    for (const field of [
      '"to"',
      '"subject"',
      '"body"',
      "attachments",
      "needsConfirmation",
      "subjectSummary",
      "inferences",
    ]) {
      assert.ok(email.includes(field), "email missing field " + field);
    }

    const video = buildVideoAudioGenerationMessages({
      intent: SAMPLE_INTENT,
      claims: [SAMPLE_CLAIM],
    })[0].content;
    for (const field of [
      '"title"',
      '"duration"',
      "scenes",
      "creativeDirection",
      "productionTips",
      "needsConfirmation",
      "subjectSummary",
      "inferences",
    ]) {
      assert.ok(video.includes(field), "videoAudio missing field " + field);
    }
  });

  await test("11. PROMPT_TEMPLATES exported for all three prompts", () => {
    assert.equal(typeof PROMPT_TEMPLATES, "object");
    assert.ok(PROMPT_TEMPLATES.research);
    assert.ok(PROMPT_TEMPLATES.email);
    assert.ok(PROMPT_TEMPLATES.videoAudio);
    assert.equal(PROMPT_TEMPLATES.research.hasCalibrateLanguage, true);
    assert.equal(PROMPT_TEMPLATES.research.hasLimitLanguage, false);
    assert.equal(PROMPT_TEMPLATES.email.hasCalibrateLanguage, true);
    assert.equal(PROMPT_TEMPLATES.email.hasLimitLanguage, false);
    assert.equal(PROMPT_TEMPLATES.videoAudio.hasCalibrateLanguage, true);
    assert.equal(PROMPT_TEMPLATES.videoAudio.hasLimitLanguage, false);
    assert.ok(PROMPT_TEMPLATES.research.systemTemplate.includes("AI 通用能力"));
    assert.ok(PROMPT_TEMPLATES.email.systemTemplate.includes("AI 通用能力"));
    assert.ok(PROMPT_TEMPLATES.videoAudio.systemTemplate.includes("AI 通用能力"));
    assert.ok(!PROMPT_TEMPLATES.research.systemTemplate.includes("结论必须受限"));
    assert.ok(
      !PROMPT_TEMPLATES.email.systemTemplate.includes(
        "必须符合已确认本人条目体现的表达风格"
      )
    );
    assert.ok(
      !PROMPT_TEMPLATES.videoAudio.systemTemplate.includes(
        "叙事口吻、表达风格与创意偏好必须符合已确认本人条目体现的特点"
      )
    );
  });

  console.log("");
  console.log("Passed:", passed);
  console.log("Failed:", failed);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

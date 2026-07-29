"use strict";

/**
 * TASK-QUALITY-STABILIZE-01 — Channel B quality enhancement (non-blocking).
 *
 * experimental_advanced_quality_pipeline remains available for shadow mode;
 * this module only runs a bounded review→rewrite→review after baseline persist.
 *
 * Max 3 model calls. Failure never deletes baseline / never marks task failed.
 */

const { reviewDeliverableContent } = require("./deliverable-reviewer");
const { assertBaselineHardGates } = require("./stable-hard-gates");

const MAX_ENHANCEMENT_MODEL_CALLS = 3;

function clampText(s, max) {
  const t = String(s || "");
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n…";
}

function scoreReview(result) {
  if (!result) return 0;
  const blocking = (result.blockingIssues || []).length;
  const quality = (result.qualityIssues || []).length;
  const grounding =
    (result.grounding && result.grounding.blockingIssues && result.grounding.blockingIssues.length) ||
    0;
  // Higher is better.
  return 1000 - blocking * 50 - grounding * 40 - quality * 5;
}

/**
 * @returns {Promise<{
 *   enhanced: boolean,
 *   md: string|null,
 *   reviewResult: object|null,
 *   baselineReview: object|null,
 *   modelCalls: number,
 *   reason: string|null,
 * }>}
 */
async function runQualityEnhancement(opts) {
  const {
    baselineMd,
    kind,
    criteria,
    goal,
    isDigitalMeProject,
    callModel,
    snapshot,
    authorityMap,
  } = opts || {};

  let modelCalls = 0;
  const bounded =
    typeof callModel === "function"
      ? async (messages, options) => {
          modelCalls += 1;
          if (modelCalls > MAX_ENHANCEMENT_MODEL_CALLS) {
            const e = new Error("quality enhancement budget exceeded");
            e.code = "enhancement_budget_exceeded";
            throw e;
          }
          return callModel(messages, options);
        }
      : null;

  const baselineReview = await reviewDeliverableContent({
    content: baselineMd,
    kind,
    criteria,
    goal,
    isDigitalMeProject,
    callModel: bounded,
    snapshot,
    authorityMap,
  });

  if (baselineReview.status === "pass") {
    return {
      enhanced: false,
      md: null,
      reviewResult: baselineReview,
      baselineReview,
      modelCalls,
      reason: "baseline_already_passes",
    };
  }

  if (typeof bounded !== "function") {
    return {
      enhanced: false,
      md: null,
      reviewResult: baselineReview,
      baselineReview,
      modelCalls,
      reason: "no_model_for_enhancement",
    };
  }

  const issueLines = (baselineReview.blockingIssues || [])
    .concat(baselineReview.qualityIssues || [])
    .slice(0, 12)
    .map((i) => `- ${i.message || i.ruleId || "issue"}`)
    .join("\n");

  let rewritten = "";
  try {
    rewritten = String(
      await bounded(
        [
          {
            role: "system",
            content:
              "你在已有可用成果基础上做一次质量完善。输出完整 Markdown 正文。" +
              "保留已正确的事实；修正与当前系统冲突、空洞或重复建设的表述；不要输出 JSON 或协议字段。",
          },
          {
            role: "user",
            content: clampText(
              [
                `任务：${goal || ""}`,
                "待完善正文：",
                baselineMd,
                "需要改进的问题：",
                issueLines || "- 提升完整性与可实施性",
                "请输出完善后的完整正文。",
              ].join("\n\n"),
              24000
            ),
          },
        ],
        { taskType: "artifact", temperature: 0.25 }
      )
    ).trim();
  } catch (err) {
    return {
      enhanced: false,
      md: null,
      reviewResult: baselineReview,
      baselineReview,
      modelCalls,
      reason: (err && err.code) || "enhancement_rewrite_failed",
    };
  }

  const hard = assertBaselineHardGates(rewritten, { goal });
  if (!hard.ok) {
    return {
      enhanced: false,
      md: null,
      reviewResult: baselineReview,
      baselineReview,
      modelCalls,
      reason: hard.code || "enhanced_hard_gate_failed",
    };
  }

  let finalReview = null;
  try {
    finalReview = await reviewDeliverableContent({
      content: rewritten,
      kind,
      criteria,
      goal,
      isDigitalMeProject,
      callModel: bounded,
      snapshot,
      authorityMap,
    });
  } catch (err) {
    return {
      enhanced: false,
      md: null,
      reviewResult: baselineReview,
      baselineReview,
      modelCalls,
      reason: (err && err.code) || "enhancement_final_review_failed",
    };
  }

  const better =
    scoreReview(finalReview) > scoreReview(baselineReview) &&
    (finalReview.blockingIssues || []).length <= (baselineReview.blockingIssues || []).length;

  if (!better) {
    return {
      enhanced: false,
      md: null,
      reviewResult: finalReview,
      baselineReview,
      modelCalls,
      reason: "enhancement_not_better",
    };
  }

  return {
    enhanced: true,
    md: rewritten,
    reviewResult: finalReview,
    baselineReview,
    modelCalls,
    reason: null,
  };
}

module.exports = {
  MAX_ENHANCEMENT_MODEL_CALLS,
  runQualityEnhancement,
  scoreReview,
};

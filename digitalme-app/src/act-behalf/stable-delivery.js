"use strict";

/**
 * TASK-QUALITY-STABILIZE-01 — Channel B quality enhancement (non-blocking).
 * MVP-QUALITY-EVALUATION-01 — document enhancement uses unified evaluateArtifact.
 *
 * experimental_advanced_quality_pipeline remains available for shadow mode;
 * this module only runs a bounded review→rewrite→review after baseline persist.
 *
 * Max 3 model calls. Failure never deletes baseline / never marks task failed.
 */

const { reviewDeliverableContent } = require("./deliverable-reviewer");
const { assertBaselineHardGates } = require("./stable-hard-gates");
const { evaluateArtifact } = require("./quality-evaluation");
const { toTargetedRepairIssues } = require("./quality-document-evaluator");

const MAX_ENHANCEMENT_MODEL_CALLS = 3;

function clampText(s, max) {
  const t = String(s || "");
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n…";
}

function scoreReview(result) {
  if (!result) return 0;
  if (typeof result.score === "number" && result.checks) {
    return result.score;
  }
  const blocking = (result.blockingIssues || []).length;
  const quality = (result.qualityIssues || []).length;
  const grounding =
    (result.grounding && result.grounding.blockingIssues && result.grounding.blockingIssues.length) ||
    0;
  return 1000 - blocking * 50 - grounding * 40 - quality * 5;
}

function evaluationToLegacyReview(evaluation) {
  if (!evaluation) return null;
  if (evaluation.reviewResult) return evaluation.reviewResult;
  const blockingIssues = (evaluation.checks || [])
    .filter((c) => !c.passed && c.severity === "blocking")
    .map((c) => ({
      ruleId: c.id,
      message: c.message,
      severity: "blocking",
      source: "quality_evaluation",
    }));
  const qualityIssues = (evaluation.checks || [])
    .filter((c) => !c.passed && c.severity !== "blocking")
    .map((c) => ({
      ruleId: c.id,
      message: c.message,
      severity: "warning",
      source: "quality_evaluation",
    }));
  return {
    status: evaluation.status === "pass" ? "pass" : "fail",
    blockingIssues,
    qualityIssues,
    suggestedRevisions: (evaluation.actionableRevisions || []).map((r) => r.guidance || r.message),
    scores: { qualityEvaluation: (evaluation.score || 0) / 100 },
    qualityEvaluation: evaluation,
  };
}

/**
 * @returns {Promise<{
 *   enhanced: boolean,
 *   md: string|null,
 *   reviewResult: object|null,
 *   baselineReview: object|null,
 *   modelCalls: number,
 *   reason: string|null,
 *   qualityEvaluation?: object|null,
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
    packageDir,
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

  const baselineEvaluation = await evaluateArtifact({
    content: baselineMd,
    md: baselineMd,
    kind: kind || "document",
    artifactType: kind || "document",
    criteria,
    goal,
    isDigitalMeProject,
    callModel: bounded,
    snapshot,
    authorityMap,
    packageDir,
    evaluationIteration: 0,
  });
  const baselineReview = evaluationToLegacyReview(baselineEvaluation);

  if (baselineEvaluation.status === "pass") {
    return {
      enhanced: false,
      md: null,
      reviewResult: baselineReview,
      baselineReview,
      modelCalls,
      reason: "baseline_already_passes",
      qualityEvaluation: baselineEvaluation,
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
      qualityEvaluation: baselineEvaluation,
    };
  }

  const issueLines = (baselineEvaluation.actionableRevisions || [])
    .slice(0, 12)
    .map((i) => `- ${i.guidance || i.message || i.checkId || "issue"}`)
    .join("\n");

  let rewritten = "";
  try {
    rewritten = String(
      await bounded(
        [
          {
            role: "system",
            content:
              "你在已有可用成果基础上做定向质量完善。输出完整 Markdown 正文。" +
              "只修复未达标项；保留已经合格的章节与正确事实；不要无意义重写全文；不要输出 JSON 或协议字段。",
          },
          {
            role: "user",
            content: clampText(
              [
                `任务目标：${goal || ""}`,
                "",
                "当前正文：",
                baselineMd,
                "",
                "仅修复以下未达标项：",
                issueLines || "- 提升完整性与完整性",
                "",
                "请输出修订后的完整 Markdown。",
              ].join("\n"),
              28000
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
      qualityEvaluation: baselineEvaluation,
    };
  }

  if (!rewritten || rewritten.length < 40) {
    return {
      enhanced: false,
      md: null,
      reviewResult: baselineReview,
      baselineReview,
      modelCalls,
      reason: "empty_enhancement",
      qualityEvaluation: baselineEvaluation,
    };
  }

  const hard = assertBaselineHardGates(rewritten, { kind });
  if (!hard.ok) {
    return {
      enhanced: false,
      md: null,
      reviewResult: baselineReview,
      baselineReview,
      modelCalls,
      reason: hard.code || "enhanced_hard_gate_failed",
      qualityEvaluation: baselineEvaluation,
    };
  }

  let finalEvaluation;
  try {
    finalEvaluation = await evaluateArtifact({
      content: rewritten,
      md: rewritten,
      kind: kind || "document",
      artifactType: kind || "document",
      criteria,
      goal,
      isDigitalMeProject,
      callModel: bounded,
      snapshot,
      authorityMap,
      packageDir,
      evaluationIteration: 1,
    });
  } catch (err) {
    return {
      enhanced: false,
      md: null,
      reviewResult: baselineReview,
      baselineReview,
      modelCalls,
      reason: (err && err.code) || "enhancement_final_review_failed",
      qualityEvaluation: baselineEvaluation,
    };
  }

  const finalReview = evaluationToLegacyReview(finalEvaluation);
  if (scoreReview(finalEvaluation) <= scoreReview(baselineEvaluation)) {
    return {
      enhanced: false,
      md: null,
      reviewResult: finalReview,
      baselineReview,
      modelCalls,
      reason: "enhancement_not_better",
      qualityEvaluation: finalEvaluation,
    };
  }

  return {
    enhanced: true,
    md: rewritten,
    reviewResult: finalReview,
    baselineReview,
    modelCalls,
    reason: null,
    qualityEvaluation: finalEvaluation,
  };
}

/**
 * Software Channel B: deterministic evaluate → targeted revise → re-evaluate (≤2).
 * Model scores never override failing execute/syntax checks.
 */
async function runSoftwareQualityEnhancement(opts) {
  const {
    files,
    goal,
    callModel,
    allowedFiles,
    complexityBaseline,
    maxRevisions = 2,
  } = opts || {};
  const { runQualityClosedLoop } = require("./quality-evaluation");
  const { buildSoftwareRepairMessages, finalizeSoftware } = require("./deliverable-generators");

  let modelCalls = 0;
  const bounded =
    typeof callModel === "function"
      ? async (messages, options) => {
          modelCalls += 1;
          if (modelCalls > 4) {
            const e = new Error("software enhancement budget exceeded");
            e.code = "enhancement_budget_exceeded";
            throw e;
          }
          return callModel(messages, options);
        }
      : null;

  const loop = await runQualityClosedLoop({
    artifactType: "software",
    kind: "software",
    maxAutoRevisions: maxRevisions,
    goal,
    allowedFiles: allowedFiles || Object.keys(files || {}),
    complexityBaseline,
    viaProductPipeline: true,
    generate: async () => ({
      files: { ...(files || {}) },
      viaProductPipeline: true,
      content: (files && files["main.js"]) || "",
    }),
    evaluate: async (artifact, iteration) =>
      evaluateArtifact({
        ...artifact,
        artifactType: "software",
        kind: "software",
        goal,
        allowedFiles: allowedFiles || Object.keys(artifact.files || {}),
        complexityBaseline,
        viaProductPipeline: true,
        evaluationIteration: iteration,
      }),
    revise: async ({ artifact, actionableRevisions, evaluation }) => {
      if (typeof bounded !== "function") return null;
      const prior = (artifact.files && artifact.files["main.js"]) || artifact.content || "";
      const issues = toTargetedRepairIssues(evaluation).length
        ? toTargetedRepairIssues(evaluation)
        : (actionableRevisions || []).map((r, i) => ({
            ruleId: r.checkId,
            message: r.guidance || r.message,
            lineNumber: i + 1,
          }));
      const ctx = { goal: goal || "", title: "software", kind: "software" };
      const messages = buildSoftwareRepairMessages(ctx, prior, issues);
      const raw = String(await bounded(messages, { taskType: "artifact", temperature: 0.2 })).trim();
      const produced = finalizeSoftware(raw, ctx);
      return {
        files: produced.files,
        viaProductPipeline: true,
        content: produced.files["main.js"],
      };
    },
  });

  return {
    enhanced: !!(loop.improved && loop.artifact && loop.artifact.files),
    files: loop.artifact && loop.artifact.files,
    loop,
    modelCalls,
    reason: loop.stoppedReason,
  };
}

module.exports = {
  MAX_ENHANCEMENT_MODEL_CALLS,
  runQualityEnhancement,
  runSoftwareQualityEnhancement,
  scoreReview,
  evaluationToLegacyReview,
};

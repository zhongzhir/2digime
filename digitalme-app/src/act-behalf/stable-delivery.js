"use strict";

/**
 * TASK-QUALITY-STABILIZE-01 — Channel B quality enhancement (non-blocking).
 * MVP-QUALITY-EVALUATION-01 — document enhancement uses unified evaluateArtifact.
 * MVP-QUALITY-PRODUCT-VALIDATION-01 — document Channel B: targeted revise ≤2 with isBetterEvaluation.
 *
 * experimental_advanced_quality_pipeline remains available for shadow mode;
 * this module only runs a bounded review→rewrite→review after baseline persist.
 *
 * Failure never deletes baseline / never marks task failed.
 */

const { assertBaselineHardGates } = require("./stable-hard-gates");
const { evaluateArtifact, isBetterEvaluation } = require("./quality-evaluation");
const { toTargetedRepairIssues } = require("./quality-document-evaluator");
const { buildDocumentRepairMessages } = require("./deliverable-generators");
const {
  locateEditableSections,
  mergePreservingUneditedSections,
  stripInternalRevisionResidue,
  buildSectionScopedRepairAddon,
  compressToMaxChars,
  splitMarkdownSections,
} = require("./document-section-revise");
const { inferLengthBoundsFromGoal } = require("./quality-document-evaluator");

/** Reviews + up to 2 targeted rewrites (product path ≤2 auto revisions). */
const MAX_ENHANCEMENT_MODEL_CALLS = 6;

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
  if (evaluation.reviewResult) {
    return { ...evaluation.reviewResult, qualityEvaluation: evaluation };
  }
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

function contentChanged(a, b) {
  return String(a || "").trim() !== String(b || "").trim();
}

/**
 * Document Channel B: evaluate → targeted revise (≤2) → re-evaluate.
 * Uses isBetterEvaluation so model-score noise alone cannot reject a real fix.
 *
 * @returns {Promise<{
 *   enhanced: boolean,
 *   md: string|null,
 *   reviewResult: object|null,
 *   baselineReview: object|null,
 *   modelCalls: number,
 *   reason: string|null,
 *   qualityEvaluation?: object|null,
 *   revisionsUsed?: number,
 *   loop?: object|null,
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
    maxRevisions = 2,
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
      baselineEvaluation,
      modelCalls,
      reason: "baseline_already_passes",
      qualityEvaluation: baselineEvaluation,
      revisionsUsed: 0,
      loop: {
        status: baselineEvaluation.status,
        score: baselineEvaluation.score,
        initialScore: baselineEvaluation.score,
        improved: false,
        revisionsUsed: 0,
        remainingIssues: baselineEvaluation.remainingIssues || [],
        stoppedReason: "passed_initial",
      },
    };
  }

  if (typeof bounded !== "function") {
    return {
      enhanced: false,
      md: null,
      reviewResult: baselineReview,
      baselineReview,
      baselineEvaluation,
      modelCalls,
      reason: "no_model_for_enhancement",
      qualityEvaluation: baselineEvaluation,
      revisionsUsed: 0,
      loop: null,
    };
  }

  let best = {
    md: String(baselineMd || ""),
    evaluation: baselineEvaluation,
  };
  let revisionsUsed = 0;
  let lastCandidateEval = baselineEvaluation;

  while (revisionsUsed < maxRevisions) {
    const issues = toTargetedRepairIssues(best.evaluation).length
      ? toTargetedRepairIssues(best.evaluation)
      : (best.evaluation.actionableRevisions || []).map((r, i) => ({
          ruleId: r.checkId,
          message: r.guidance || r.message,
          lineNumber: i + 1,
        }));

    if (!issues.length) break;

    const editable = locateEditableSections(best.md, issues);
    const ctx = { goal: goal || "", title: "document", kind: kind || "document" };
    const repairMessages = buildDocumentRepairMessages(ctx, best.md, issues);
    // Keep Channel B intent: section-scoped fix; do not rewrite qualified parts.
    if (repairMessages[0] && repairMessages[0].role === "system") {
      repairMessages[0].content =
        "你在已有可用成果基础上做定向质量完善。输出完整 Markdown 正文。" +
        "只修复未达标项对应章节；未点名章节必须原样保留；不要无意义重写全文；" +
        "不要输出 JSON、协议字段、修订方向或评估内部指令。";
    }
    if (repairMessages[1] && repairMessages[1].role === "user") {
      repairMessages[1].content =
        String(repairMessages[1].content || "") + "\n\n" + buildSectionScopedRepairAddon(editable);
    }

    let rewritten = "";
    try {
      rewritten = String(
        await bounded(repairMessages, { taskType: "artifact", temperature: 0.25 })
      ).trim();
    } catch (err) {
      return {
        enhanced: false,
        md: null,
        reviewResult: baselineReview,
        baselineReview,
        baselineEvaluation,
        modelCalls,
        reason: (err && err.code) || "enhancement_rewrite_failed",
        qualityEvaluation: best.evaluation,
        revisionsUsed,
        loop: {
          status: best.evaluation.status,
          score: best.evaluation.score,
          initialScore: baselineEvaluation.score,
          improved: false,
          revisionsUsed,
          remainingIssues: best.evaluation.remainingIssues || [],
          stoppedReason: (err && err.code) || "enhancement_rewrite_failed",
        },
      };
    }

    revisionsUsed += 1;

    if (!rewritten || rewritten.length < 40) {
      return {
        enhanced: false,
        md: null,
        reviewResult: baselineReview,
        baselineReview,
        baselineEvaluation,
        modelCalls,
        reason: "empty_enhancement",
        qualityEvaluation: best.evaluation,
        revisionsUsed,
        loop: {
          status: best.evaluation.status,
          score: best.evaluation.score,
          initialScore: baselineEvaluation.score,
          improved: false,
          revisionsUsed,
          remainingIssues: best.evaluation.remainingIssues || [],
          stoppedReason: "empty_enhancement",
        },
      };
    }

    // Deterministic post-merge: preserve non-targeted sections; strip internal residue.
    rewritten = stripInternalRevisionResidue(rewritten);
    const merged = mergePreservingUneditedSections(best.md, rewritten, editable.keys);
    // If heading labels drifted and merge kept 100% original, fall back to revised text
    // only when it still contains the same section count (avoid accidental wipe).
    if (merged === best.md && rewritten !== best.md) {
      const oSecs = splitMarkdownSections(best.md);
      const rSecs = splitMarkdownSections(rewritten);
      rewritten =
        oSecs.length && rSecs.length && Math.abs(oSecs.length - rSecs.length) <= 1
          ? rewritten
          : merged;
    } else {
      rewritten = merged;
    }

    const lengthBounds = inferLengthBoundsFromGoal(goal);
    const maxChars =
      (criteria && criteria.maxChars) ||
      (criteria && criteria.length && criteria.length.maxChars) ||
      lengthBounds.maxChars;
    if (maxChars) {
      rewritten = compressToMaxChars(rewritten, maxChars, editable.keys);
    }

    const hard = assertBaselineHardGates(rewritten, { kind });
    if (!hard.ok) {
      // Skip this candidate; continue if budget remains.
      continue;
    }

    let nextEvaluation;
    try {
      nextEvaluation = await evaluateArtifact({
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
        evaluationIteration: revisionsUsed,
      });
    } catch (err) {
      return {
        enhanced: false,
        md: null,
        reviewResult: baselineReview,
        baselineReview,
        baselineEvaluation,
        modelCalls,
        reason: (err && err.code) || "enhancement_final_review_failed",
        qualityEvaluation: best.evaluation,
        revisionsUsed,
        loop: {
          status: best.evaluation.status,
          score: best.evaluation.score,
          initialScore: baselineEvaluation.score,
          improved: false,
          revisionsUsed,
          remainingIssues: best.evaluation.remainingIssues || [],
          stoppedReason: (err && err.code) || "enhancement_final_review_failed",
        },
      };
    }

    lastCandidateEval = nextEvaluation;
    if (isBetterEvaluation(nextEvaluation, best.evaluation) || nextEvaluation.status === "pass") {
      best = { md: rewritten, evaluation: nextEvaluation };
    }
    if (nextEvaluation.status === "pass") {
      break;
    }
  }

  const improved =
    contentChanged(best.md, baselineMd) && isBetterEvaluation(best.evaluation, baselineEvaluation);

  if (!improved) {
    return {
      enhanced: false,
      md: null,
      reviewResult: evaluationToLegacyReview(lastCandidateEval),
      baselineReview,
      baselineEvaluation,
      modelCalls,
      reason: revisionsUsed > 0 ? "enhancement_not_better" : "no_revision_attempted",
      qualityEvaluation: lastCandidateEval,
      revisionsUsed,
      loop: {
        status: lastCandidateEval.status,
        score: lastCandidateEval.score,
        initialScore: baselineEvaluation.score,
        improved: false,
        revisionsUsed,
        remainingIssues: lastCandidateEval.remainingIssues || [],
        stoppedReason: revisionsUsed >= maxRevisions ? "max_revisions_exhausted" : "enhancement_not_better",
      },
    };
  }

  return {
    enhanced: true,
    md: best.md,
    reviewResult: evaluationToLegacyReview(best.evaluation),
    baselineReview,
    baselineEvaluation,
    modelCalls,
    reason: null,
    qualityEvaluation: best.evaluation,
    revisionsUsed,
    loop: {
      status: best.evaluation.status,
      score: best.evaluation.score,
      initialScore: baselineEvaluation.score,
      improved: true,
      revisionsUsed,
      remainingIssues: best.evaluation.remainingIssues || [],
      stoppedReason:
        best.evaluation.status === "pass" ? "passed_after_revision" : "improved_with_remaining",
      qualifiedPartsPreserved: null,
    },
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

"use strict";

/**
 * TASK-QUALITY-LOOP-01.2 — UserFacingTaskView (runtime projection only).
 *
 * Renderer should consume this view instead of stitching raw attempt fields.
 * Not a persistent authority store.
 */

const { normalizeRecoveryActions } = require("./attempt-recovery");

const USER_STATUS = Object.freeze({
  IDLE: "idle",
  GENERATING: "generating",
  REFINING: "refining",
  COMPLETED: "completed",
  FAILED: "failed",
  AUTH_REVOKED: "auth_revoked",
});

function latestAttempt(deliverable, attempts) {
  if (!deliverable) return null;
  const id = deliverable.latestGenerationAttemptId;
  if (id && attempts && attempts[id]) return attempts[id];
  return null;
}

function mapInternalPhase(deliverable, attempt) {
  if (attempt && (attempt.status === "repairing" || attempt.outcome === "repair_initiated")) {
    return "refining";
  }
  const s = deliverable && deliverable.generationStatus;
  // Baseline already usable while Channel B runs — treat as completed for open action.
  if (s === "ready" || (deliverable && deliverable.currentVersionId && s !== "failed")) {
    return "completed";
  }
  if (s === "generating" || s === "queued" || s === "validating") return "generating";
  if (s === "failed" || s === "blocked" || s === "skipped_dependency") return "failed";
  return "idle";
}

function isEnhancementPending(attempt) {
  return !!(attempt && attempt.phase === "quality_enhancement");
}

function enhancementAuditNote(attempt) {
  if (!attempt || !attempt.enhancement) return null;
  if (attempt.enhancement.ok === false) {
    return "质量增强未完成，已保留基础版本。";
  }
  return null;
}

/**
 * @param {object} opts
 * @param {object} [opts.task]
 * @param {object} [opts.deliverable]
 * @param {object} [opts.packageView]
 * @param {object} [opts.authorizationStatus]
 * @param {string} [opts.userGoal] goal from the primary title/goal field
 */
function deriveUserFacingTaskState(opts) {
  const task = (opts && opts.task) || {};
  const view = (opts && opts.packageView) || {};
  const deliverables = (view.deliverables || []).filter((d) => d && d.planDisposition === "included");
  const primary = (opts && opts.deliverable) || deliverables[0] || null;
  const attempts = view.generationAttempts || {};
  const attempt = latestAttempt(primary, attempts);
  const auth = (opts && opts.authorizationStatus) || view.authorizationStatus || {};
  const authRevoked = auth.status === "revoked";

  const title =
    String(
      (primary && primary.title) ||
        (opts && opts.userGoal) ||
        task.goal ||
        task.request ||
        task.title ||
        ""
    ).trim() || "未命名任务";
  const fullGoal = String((opts && opts.userGoal) || task.goal || task.request || "").trim();

  if (authRevoked) {
    return {
      title,
      summary: null,
      status: USER_STATUS.AUTH_REVOKED,
      statusMessage: auth.message || "本次授权已撤销。已有成果会保留，但不能继续生成新版本。",
      primaryAction: null,
      secondaryAction: null,
      artifact: null,
      detailAvailable: true,
      recoveryActions: [],
    };
  }

  const phase = mapInternalPhase(primary, attempt);
  let status = USER_STATUS.IDLE;
  let statusMessage = "";
  let primaryAction = { id: "generate", label: "生成成果" };
  let secondaryAction = null;
  let artifact = null;

  if (phase === "generating") {
    status = USER_STATUS.GENERATING;
    statusMessage = "正在生成成果";
    primaryAction = null; // no duplicate click
  } else if (phase === "refining") {
    status = USER_STATUS.REFINING;
    statusMessage = "正在完善成果";
    primaryAction = null;
  } else if (phase === "completed") {
    status = USER_STATUS.COMPLETED;
    statusMessage = "成果已完成";
    const ver =
      primary && primary.currentVersionId && view.versions
        ? view.versions[primary.currentVersionId]
        : null;
    const arts =
      ver && Array.isArray(ver.artifactRefs) && ver.artifactRefs.length
        ? ver.artifactRefs
        : ver && ver.artifactRef
          ? [ver.artifactRef]
          : [];
    const primaryArt = arts[0] || null;
    artifact = primaryArt
      ? { artifactId: primaryArt.id, versionId: ver && ver.id, label: "打开成果" }
      : null;
    primaryAction = artifact
      ? { id: "open", label: "打开成果", artifactId: artifact.artifactId }
      : null;
    secondaryAction = {
      id: "regenerate",
      label: "重新生成",
      deliverableId: primary && primary.id,
      placement: "overflow",
    };
  } else if (phase === "failed") {
    status = USER_STATUS.FAILED;
    statusMessage = "成果未能生成";
    // Ordinary failures must not ask the user to continue the same flow.
    primaryAction = null;
    secondaryAction = { id: "details", label: "查看原因", placement: "secondary" };
  }

  const understanding = opts && opts.understanding;
  let summary = null;
  if (understanding) {
    const uGoal = String(
      (understanding.goal && understanding.goal.value) || understanding.goal || ""
    ).trim();
    const extra =
      String((understanding.summary && understanding.summary.value) || understanding.summary || "").trim() ||
      String((understanding.usage && understanding.usage.value) || understanding.usage || "").trim();
    // Only show summary when it adds value beyond repeating the user goal.
    if (extra && extra !== title && extra !== uGoal && extra !== fullGoal && !title.includes(extra) && !(fullGoal && fullGoal.includes(extra)) && extra.length > 8) {
      if (!uGoal || uGoal === title || uGoal === fullGoal || title.includes(uGoal) || (fullGoal && (fullGoal.includes(uGoal) || uGoal.includes(fullGoal)))) {
        summary = extra.slice(0, 120);
      } else if (extra !== uGoal) {
        summary = extra.slice(0, 120);
      }
    }
  }

  return {
    title,
    fullGoal: fullGoal || null,
    summary,
    status,
    statusMessage,
    enhancingHint: phase === "completed" && isEnhancementPending(attempt) ? "正在进一步完善" : null,
    primaryAction,
    secondaryAction,
    artifact,
    detailAvailable: phase === "failed",
    detailMessage:
      phase === "failed"
        ? (primary && primary.lastGenerationIssueSummary) ||
          (attempt && attempt.userIssueSummary) ||
          (attempt && attempt.errorSummary) ||
          "未能生成可用成果。"
        : null,
    auditNote: enhancementAuditNote(attempt),
    recoveryActions: normalizeRecoveryActions(attempt || {}),
    phase,
    deliverableId: primary && primary.id,
    planUiMode: (() => {
      if (phase === "generating" || phase === "refining") return "generating";
      if (phase === "completed") return "completed";
      if (phase === "failed") return "confirmed";
      if (opts && opts.planConfirmed) return "confirmed";
      return "editing";
    })(),
  };
}

module.exports = {
  USER_STATUS,
  deriveUserFacingTaskState,
  mapInternalPhase,
  latestAttempt,
  isEnhancementPending,
  enhancementAuditNote,
};

"use strict";

/**
 * DVL2-03 deliverable generation orchestrator.
 */

const crypto = require("node:crypto");
const packageStore = require("./deliverable-package-store");
const { nowIso, newId } = require("./deliverable-package-schema");
const { commitVersionFiles } = require("./deliverable-artifact-fs");
const { generateByKind, generateByKindWithRepair, documentFilesFromMarkdown } = require("./deliverable-generators");
const { isStableDeliveryMode } = require("./quality-pipeline-mode");
const { runQualityEnhancement, runSoftwareQualityEnhancement } = require("./stable-delivery");
const { evaluateArtifact } = require("./quality-evaluation");
const { toTargetedRepairIssues } = require("./quality-document-evaluator");
const actBehalfStore = require("./task-store");
const { assembleSubjectContext } = require("./subject-context-assembler");
const {
  classifyTaskContext,
  resolveAssemblyPolicy,
  finalizeSubjectAssembly,
  tagAttachmentRefs,
  isDigitalMeProjectContext,
} = require("./subject-context-engine");
const { unwrapField, buildFailureEvidence, userFacingIssueSummary } = require("./deliverable-context");
const actionIdentity = require("./action-identity");
const authorizationStore = require("./authorization-store");
const { resolveKnowledgeContext } = require("./knowledge-resolver");
const { buildOutcomeCriteria } = require("./outcome-criteria");
const {
  reviewDeliverableContent,
  toRepairIssues,
  userFacingReviewSummary,
  userFacingReviewFailure,
} = require("./deliverable-reviewer");
const {
  buildCurrentSystemSnapshot,
  renderSnapshotFacts,
} = require("./current-system-snapshot");
const { buildAuthorityMap } = require("./authority-map");
const {
  renderAuthoritativeSystemFactsBlock,
  buildGapStatement,
  ensureValidGapStatement,
  renderGapStatementBlock,
  demoteHistoricalMaterials,
  REPAIR_MODES,
  isGroundingFailure,
} = require("./grounded-generation");
const { buildAttemptAuditWrite } = require("./attempt-recovery");
const { deriveUserFacingTaskState } = require("./user-facing-task-view");

function newAttemptId() {
  return newId("dgatt_");
}

// TASK-QUALITY-LOOP-01: total automatic revision budget (shared by placeholder
// gate and quality Reviewer). At most 2 revisions after the first draft.
const MAX_PLACEHOLDER_REPAIR_ATTEMPTS = 2;
const MAX_QUALITY_REPAIR_ATTEMPTS = MAX_PLACEHOLDER_REPAIR_ATTEMPTS;
// FIX-01: hard ceiling on model invocations per generateOneDeliverable
// (drafts + reviews). Clean regeneration included; never unbounded.
const MAX_MODEL_CALLS_PER_GENERATION = 16;

function userMessageForFailure(err) {
  if (err && (err.code === "obvious_placeholder" || err.code === "placeholder_content_rejected")) {
    return (
      err.message ||
      "生成的内容仍包含未填写部分，暂未保存。"
    );
  }
  if (err && (err.code === "empty_content" || err.code === "empty_model_output")) {
    return "未能生成可用正文，暂未保存成果。";
  }
  if (err && err.code === "review_content_rejected") {
    return err.message || "成果还没有达到可直接使用的质量，暂未保存。";
  }
  return (err && err.message) || "生成失败。";
}

async function registerGenerationAttempt(userData, attempt, deliverableId, packageId) {
  await packageStore.mutateStore(userData, (s) => {
    s.generationAttempts = s.generationAttempts || {};
    s.generationAttempts[attempt.id] = attempt;
    const d = s.deliverables[String(deliverableId)];
    if (d) {
      d.generationStatus = attempt.status === "repairing" ? "generating" : attempt.status;
      d.latestGenerationAttemptId = attempt.id;
      if (attempt.userIssueSummary) d.lastGenerationIssueSummary = attempt.userIssueSummary;
      d.updatedAt = nowIso();
    }
    const p = s.packages[String(packageId)];
    if (p) {
      const dels = (p.deliverableIds || []).map((id) => s.deliverables[id]).filter(Boolean);
      const derived = derivePackageStatuses(dels);
      p.lifecycleStatus = derived.lifecycleStatus;
      p.completionStatus = derived.completionStatus;
      p.updatedAt = nowIso();
    }
    return true;
  });
}

async function markAttemptOutcome(userData, attemptId, patch) {
  await packageStore.mutateStore(userData, (s) => {
    const a = s.generationAttempts[attemptId];
    if (!a) return false;
    Object.assign(a, patch);
    return true;
  });
}

function newVersionId() {
  return newId("dver_");
}

function newArtifactId() {
  return newId("aref_");
}

function assertTaskMaterialsFresh(userData, taskId) {
  if (!taskId) return { ok: true };
  try {
    const got = actBehalfStore.getTask(userData, taskId, { heal: false });
    if (!got || !got.ok || !got.task) return { ok: true };
    const ptr = got.task.deliverablePlanning || {};
    if (ptr.materialsStale) {
      return {
        ok: false,
        code: "plan_materials_stale",
        message: "参考材料已变化，请重新形成预计交付后再生成。",
        materialsStale: true,
      };
    }
  } catch {
    /* ignore */
  }
  return { ok: true };
}

function mimeForName(name) {
  if (name.endsWith(".md")) return "text/markdown";
  if (name.endsWith(".html")) return "text/html";
  if (name.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".pptx"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function topoSortDeliverables(deliverables) {
  const byId = new Map(deliverables.map((d) => [String(d.id), d]));
  const visited = new Set();
  const stack = new Set();
  const ordered = [];
  function visit(id) {
    const key = String(id);
    if (visited.has(key)) return;
    if (stack.has(key)) return; // cycle: skip edge
    stack.add(key);
    const d = byId.get(key);
    if (d) {
      for (const dep of d.dependencies || []) {
        if (byId.has(String(dep))) visit(dep);
      }
      visited.add(key);
      ordered.push(d);
    }
    stack.delete(key);
  }
  for (const d of deliverables) visit(d.id);
  return ordered;
}

function derivePackageStatuses(deliverables) {
  const included = deliverables.filter((d) => d.planDisposition === "included");
  const gens = included.map((d) => d.generationStatus);
  let lifecycleStatus = "planned";
  let completionStatus = "none";
  if (gens.some((g) => g === "queued" || g === "generating")) {
    lifecycleStatus = "in_progress";
    completionStatus = "none";
  } else if (gens.every((g) => g === "planned")) {
    lifecycleStatus = "planned";
    completionStatus = "none";
  } else {
    const readyish = gens.filter((g) =>
      ["generated", "validating", "ready", "superseded"].includes(g)
    ).length;
    const failed = gens.filter((g) =>
      ["failed", "cancelled", "interrupted"].includes(g)
    ).length;
    if (readyish === included.length) {
      lifecycleStatus = "completed";
      completionStatus = "complete";
    } else if (readyish > 0 && failed > 0) {
      lifecycleStatus = "completed";
      completionStatus = "partial";
    } else if (readyish > 0) {
      lifecycleStatus = "completed";
      completionStatus = "partial";
    } else if (failed === included.length) {
      lifecycleStatus = "completed";
      completionStatus = "failed";
    } else {
      lifecycleStatus = "in_progress";
      completionStatus = "none";
    }
  }
  return { lifecycleStatus, completionStatus };
}

function makeArtifactRef({ versionId, relativePath, contentHash, byteSize, name }) {
  return {
    id: newArtifactId(),
    versionId,
    storageKind: "local_deliverable_relative",
    relativePath,
    externalUri: null,
    contentHash,
    mimeType: mimeForName(name),
    byteSize,
    absolutePathCache: null,
    format: name.includes(".") ? name.split(".").pop() : "",
    createdAt: nowIso(),
  };
}

/**
 * @param {object} deps
 * @param {Function} deps.callModel
 * @param {string} [deps.imageMode] 'mock' | 'real'
 */
async function generateOneDeliverable(userData, { packageId, deliverableId, revisionGuidance }, deps) {
  const store = packageStore.loadStore(userData);
  const pkg = store.packages[String(packageId)];
  if (!pkg || pkg.softDeletedAt) {
    return { ok: false, code: "package_not_found", message: "未找到成果包。" };
  }
  const deliverable = store.deliverables[String(deliverableId)];
  if (!deliverable || String(deliverable.packageId) !== String(packageId)) {
    return { ok: false, code: "deliverable_not_found", message: "未找到该项成果。" };
  }
  if (deliverable.planDisposition === "removed") {
    return { ok: false, code: "deliverable_removed", message: "该项已从计划中移除。" };
  }

  const materialsGate = assertTaskMaterialsFresh(userData, pkg.taskId);
  if (!materialsGate.ok) return materialsGate;

  // IDCOLLAB-MIN-01: always re-read authoritative Authorization Store (never trust snapshot status).
  const authGate = authorizationStore.resolveActiveTaskAuthorization(userData, {
    taskId: pkg.taskId,
    planVersionId: pkg.sourcePlanVersionId,
    actionType: "local_artifact_write",
  });
  if (!authGate.ok) {
    return { ok: false, code: authGate.code, message: authGate.message };
  }

  const attemptId = newAttemptId();
  const startedAt = nowIso();
  const attempt = {
    schemaVersion: 1,
    id: attemptId,
    packageId: String(packageId),
    deliverableId: String(deliverableId),
    status: "generating",
    startedAt,
    finishedAt: null,
    modelAdapter: "invokeModelRoute/callModel",
    inputDigest: "sha256:" + crypto.createHash("sha256").update(String(pkg.sourcePlanVersionId || "") + "|" + deliverableId).digest("hex"),
    errorCode: null,
    errorSummary: null,
    producedVersionId: null,
    outcome: null,
    repairPass: 0,
    parentAttemptId: null,
    failureEvidence: null,
    userIssueSummary: null,
    // MVP-RELEASE-GATE-01E: retain user revision guidance on the attempt (existing object).
    revisionGuidance: String(revisionGuidance || "").trim().slice(0, 8000) || null,
  };

  await registerGenerationAttempt(userData, attempt, deliverableId, packageId);

  let produced;
  let taskRecord = null;
  try {
    const taskGot = actBehalfStore.getTask(userData, pkg.taskId, { heal: false });
    taskRecord = taskGot && taskGot.ok ? taskGot.task : null;
  } catch {
    taskRecord = null;
  }

  const snap = (pkg && pkg.executionSnapshot) || {};
  const input = snap.inputSummary || {};
  const taskContext = {
    goal:
      unwrapField(input.goal) ||
      unwrapField(taskRecord && taskRecord.goal) ||
      unwrapField(taskRecord && taskRecord.request) ||
      "",
    audience: unwrapField(input.audience) || "",
    usage: unwrapField(input.usage) || "",
    constraints: unwrapField(input.constraints) || "",
    deliverableKind: deliverable.kind,
    deliverableTitle: deliverable.title,
    deliverablePurpose: deliverable.purpose,
  };
  const revisionText = String(revisionGuidance || "").trim();
  if (revisionText) {
    taskContext.constraints =
      (taskContext.constraints ? taskContext.constraints + "\n\n" : "") +
      "【用户对本成果的修改要求】\n" +
      revisionText;
  }
  const classification = classifyTaskContext(taskContext);
  const policy = resolveAssemblyPolicy(classification);
  const isDigitalMeProject = isDigitalMeProjectContext(taskContext);

  // TASK-QUALITY-LOOP-01: internal outcome quality basis for this deliverable.
  const outcomeCriteria = buildOutcomeCriteria({
    goal: taskContext.goal,
    audience: taskContext.audience,
    usage: taskContext.usage,
    constraints: taskContext.constraints,
    expectedQuality:
      unwrapField(input.expectedQuality) ||
      unwrapField(snap.understanding && snap.understanding.expectedQuality) ||
      "",
    kind: deliverable.kind,
    title: deliverable.title,
    isDigitalMeProject,
  });

  // TASK-QUALITY-LOOP-01.1 / FIX-01: current-system snapshot + authority map
  // become inviolable drafting constraints for current_implementation.
  let systemSnapshot = null;
  let authorityMap = null;
  let systemFactsText = "";
  let authoritativeFactsText = "";
  let gapStatement = null;
  let gapStatementText = "";
  if (isDigitalMeProject && outcomeCriteria.taskMode === "current_implementation") {
    systemSnapshot = buildCurrentSystemSnapshot({ goal: taskContext.goal });
    authorityMap = buildAuthorityMap();
    systemSnapshot.authorityObjects = authorityMap.entries.map((e) => ({
      entity: e.entity,
      authoritativeStore: e.authoritativeStore,
      status: e.status,
      sourceRef: e.sourceRef,
    }));
    systemFactsText = renderSnapshotFacts(systemSnapshot, 10);
    authoritativeFactsText = renderAuthoritativeSystemFactsBlock(systemSnapshot, authorityMap).text;
    gapStatement = ensureValidGapStatement(
      buildGapStatement({
        snapshot: systemSnapshot,
        authorityMap,
        goal: taskContext.goal,
      })
    );
    if (!gapStatement.validation || !gapStatement.validation.ok) {
      // Refuse to draft with a conflicting gap statement; recompute once more empty-safe.
      gapStatement = ensureValidGapStatement({
        ...gapStatement,
        ActualGaps: [],
        ProposedMinimumChanges: [],
      });
    }
    gapStatementText = renderGapStatementBlock(gapStatement);
  }

  let activeAttemptId = attemptId;
  let lastReviewResult = null;
  let groundingAudit = {
    groundedRebuildUsed: false,
    groundedRebuildCount: 0,
    cleanRegenerationUsed: false,
    repairModes: [],
    recoveryActions: [],
    modelCallCount: 0,
  };

  let projectResolved = null;
  let projectRetrieval = null;
  const resolved = resolveKnowledgeContext({
    query: taskContext.goal,
    packageDir: deps.packageDir || null,
    surface: "deliverable",
    task: taskRecord,
    taskContext,
    currentMaterials: (taskRecord && taskRecord.referenceMaterials) || [],
    tokenBudget: 18000,
  });

  if (
    (isDigitalMeProject || policy.requireProjectContext) &&
    resolved.detectedScope &&
    resolved.detectedScope.projectId &&
    resolved.detectedScope.confidence === "low" &&
    resolved.detectedScope.reason === "unresolved"
  ) {
    await packageStore.mutateStore(userData, (s) => {
      const a = s.generationAttempts[activeAttemptId];
      if (a) {
        a.status = "failed";
        a.finishedAt = nowIso();
        a.errorCode = "project_unresolved";
        a.errorSummary = "未能识别项目范围，已停止生成。";
        a.outcome = "failed";
      }
      const d = s.deliverables[String(deliverableId)];
      if (d) {
        d.generationStatus = "failed";
        d.updatedAt = nowIso();
      }
      return true;
    });
    return {
      ok: false,
      code: "project_unresolved",
      message: "未能识别项目范围，已停止生成。",
      attemptId,
    };
  }

  // FIX-01: demote superseded / historical materials before generation for
  // current_implementation tasks so stale "未开始/待实现" cannot override facts.
  let mergedMaterials = resolved.currentMaterials || [];
  if (isDigitalMeProject && outcomeCriteria.taskMode === "current_implementation") {
    const demoted = demoteHistoricalMaterials(mergedMaterials, {
      includeHistoricalAnnotated: false,
    });
    mergedMaterials = demoted.materials;
    groundingAudit.demotedMaterialCount = (demoted.demoted || []).length;
  }
  const attachmentBudget = resolved.attachmentBudget;
  projectRetrieval = resolved.projectRetrieval;
  if (resolved.projectContext) {
    projectResolved = {
      ok: true,
      projectId: resolved.projectContext.projectId,
      projectContextId: resolved.projectContext.projectContextId,
      displayLabel: resolved.projectContext.displayLabel,
      claims: resolved.selectedClaims,
      materials: mergedMaterials.filter((m) => m.note === "project_authoritative_source"),
    };
  }

  let subjectAssembly = resolved.subjectAssembly || resolved.subjectKnowledge;
  if (!subjectAssembly) {
    subjectAssembly = assembleSubjectContext({
      packageDir: deps.packageDir || null,
      query: {
        ...taskContext,
        attachmentKeywords: mergedMaterials.map((m) => m && m.name).filter(Boolean),
      },
      policy,
      contextClass: classification.contextClass,
      projectRenderedText: resolved.projectRetrieval
        ? require("./project-knowledge-retrieval").renderProjectClaimsSection(resolved.projectRetrieval)
        : "",
    });
  }
  subjectAssembly = finalizeSubjectAssembly(subjectAssembly, {
    classification,
    policy,
    attachmentRefs: attachmentBudget.usedRefs,
  });
  if (projectResolved) {
    subjectAssembly.projectContextId = projectResolved.projectContextId;
    subjectAssembly.projectId = projectResolved.projectId;
    subjectAssembly.projectRetrieval = projectRetrieval;
    subjectAssembly.projectContextLabel = projectResolved.displayLabel;
    subjectAssembly.knowledgeProvenance = resolved.provenance;
  }

  // Hard ceiling on model calls (artifact + review) for this generation run.
  const stableMode = isStableDeliveryMode(deps);
  const baseCallModel = deps.callModel;
  const callBudget = stableMode ? 8 : MAX_MODEL_CALLS_PER_GENERATION;
  const boundedCallModel =
    typeof baseCallModel === "function"
      ? async (messages, options) => {
          groundingAudit.modelCallCount += 1;
          if (groundingAudit.modelCallCount > callBudget) {
            const e = new Error("生成过程超过安全调用上限，已停止。");
            e.code = "model_call_budget_exceeded";
            throw e;
          }
          return baseCallModel(messages, options);
        }
      : baseCallModel;

  try {
    produced = await generateByKindWithRepair(
      deliverable.kind,
      {
        pkg,
        deliverable,
        task: taskRecord,
        referenceMaterials: mergedMaterials,
        subjectAssembly,
        callModel: boundedCallModel,
        imageMode: deps.imageMode,
        isDigitalMeProject,
        projectRetrieval,
        projectResolved,
        outcomeCriteria,
        systemFactsText,
        authoritativeFactsText,
        gapStatementText,
        gapStatement,
        // Stable delivery: one-shot whole document; advanced pipeline stays shadow-capable.
        useSemanticBlocks: stableMode ? false : deps.useSemanticBlocks === true,
        disableSemanticBlocks: stableMode ? true : !!deps.disableSemanticBlocks,
        hardGatesOnly: !!stableMode,
      },
      {
        maxRepairAttempts: stableMode ? 0 : MAX_QUALITY_REPAIR_ATTEMPTS,
        allowCleanRegeneration: stableMode
          ? false
          : isDigitalMeProject && outcomeCriteria.taskMode === "current_implementation",
        onDraftValidated: async ({ draft, ctx, audit }) => {
          if (audit) {
            groundingAudit = {
              ...groundingAudit,
              groundedRebuildUsed: !!audit.groundedRebuildUsed,
              groundedRebuildCount: audit.groundedRebuildCount || 0,
              cleanRegenerationUsed: !!audit.cleanRegenerationUsed,
              repairModes: Array.isArray(audit.repairModes) ? audit.repairModes.slice() : [],
            };
          }
          // Stable: Channel A does not block on soft Reviewer / grounding.
          if (stableMode) {
            lastReviewResult = null;
            void draft;
            void ctx;
            return;
          }
          const kind = String(deliverable.kind || "");
          if (kind === "software" || kind === "code") {
            const evaluation = await evaluateArtifact({
              content: draft,
              source: draft,
              files: { "main.js": draft },
              artifactType: "software",
              kind: "software",
              goal: taskContext.goal,
              viaProductPipeline: true,
              evaluationIteration: 0,
            });
            lastReviewResult = {
              status: evaluation.status,
              blockingIssues: (evaluation.checks || [])
                .filter((c) => !c.passed && c.severity === "blocking")
                .map((c) => ({ ruleId: c.id, message: c.message })),
              qualityIssues: (evaluation.checks || [])
                .filter((c) => !c.passed && c.severity !== "blocking")
                .map((c) => ({ ruleId: c.id, message: c.message })),
              suggestedRevisions: (evaluation.actionableRevisions || []).map(
                (r) => r.guidance || r.message
              ),
              scores: { qualityEvaluation: (evaluation.score || 0) / 100 },
              qualityEvaluation: evaluation,
              createdAt: evaluation.createdAt,
            };
            if (evaluation.status !== "pass") {
              const e = new Error(userFacingReviewFailure(lastReviewResult));
              e.code = "review_content_rejected";
              e.reviewResult = lastReviewResult;
              e.reviewIssues = toTargetedRepairIssues(evaluation);
              e.userIssueSummary = userFacingReviewSummary(lastReviewResult);
              e.failureStage = "quality_review";
              throw e;
            }
            void ctx;
            return;
          }
          const evaluation = await evaluateArtifact({
            content: draft,
            md: draft,
            kind: deliverable.kind,
            artifactType: deliverable.kind,
            criteria: outcomeCriteria,
            goal: taskContext.goal,
            isDigitalMeProject,
            callModel: boundedCallModel,
            snapshot: systemSnapshot,
            authorityMap,
            packageDir: deps.packageDir || null,
            evaluationIteration: 0,
          });
          const result = evaluation.reviewResult || {
            status: evaluation.status,
            taskMode: (outcomeCriteria && outcomeCriteria.taskMode) || null,
            blockingIssues: (evaluation.checks || [])
              .filter((c) => !c.passed && c.severity === "blocking")
              .map((c) => ({ ruleId: c.id, message: c.message })),
            qualityIssues: (evaluation.checks || [])
              .filter((c) => !c.passed && c.severity !== "blocking")
              .map((c) => ({ ruleId: c.id, message: c.message })),
            suggestedRevisions: (evaluation.actionableRevisions || []).map(
              (r) => r.guidance || r.message
            ),
            scores: evaluation.reviewResult && evaluation.reviewResult.scores
              ? evaluation.reviewResult.scores
              : { qualityEvaluation: (evaluation.score || 0) / 100 },
            modelReviewUsed: !!(evaluation.reviewResult && evaluation.reviewResult.modelReviewUsed),
            reviewerDegraded: !!(evaluation.reviewResult && evaluation.reviewResult.reviewerDegraded),
            criteriaDigest: (outcomeCriteria && outcomeCriteria.criteriaDigest) || null,
            createdAt: evaluation.createdAt,
          };
          lastReviewResult = {
            ...result,
            taskMode: result.taskMode || (outcomeCriteria && outcomeCriteria.taskMode) || null,
            qualityEvaluation: evaluation,
          };
          if (evaluation.status !== "pass") {
            const e = new Error(userFacingReviewFailure(lastReviewResult));
            e.code = "review_content_rejected";
            e.reviewResult = lastReviewResult;
            e.reviewIssues = toTargetedRepairIssues(evaluation).length
              ? toTargetedRepairIssues(evaluation)
              : toRepairIssues(result);
            e.userIssueSummary = userFacingReviewSummary(lastReviewResult);
            e.failureStage = "quality_review";
            throw e;
          }
          void ctx;
        },
        onDraftRejected: async ({ pass, draft, err, repairable, nextRepairContext, audit }) => {
          if (stableMode) return;
          if (!repairable) return;
          if (audit) {
            groundingAudit = {
              ...groundingAudit,
              groundedRebuildUsed: !!audit.groundedRebuildUsed || groundingAudit.groundedRebuildUsed,
              groundedRebuildCount: Math.max(
                groundingAudit.groundedRebuildCount || 0,
                audit.groundedRebuildCount || 0
              ),
              cleanRegenerationUsed:
                !!audit.cleanRegenerationUsed || groundingAudit.cleanRegenerationUsed,
              repairModes: Array.isArray(audit.repairModes)
                ? audit.repairModes.slice()
                : groundingAudit.repairModes,
            };
          }
          const isReviewRejection = err && err.code === "review_content_rejected";
          const repairIssues = isReviewRejection ? err.reviewIssues : err.placeholderIssues;
          const parentAttemptId = activeAttemptId;
          const evidence = buildFailureEvidence({
            attemptId: parentAttemptId,
            deliverableId,
            draft,
            issues: repairIssues,
            failureCode: err.code,
            failureStage: err.failureStage || "prewrite_validation",
          });
          if (isReviewRejection && err.reviewResult) {
            evidence.reviewResult = {
              status: err.reviewResult.status,
              taskMode: err.reviewResult.taskMode,
              scores: err.reviewResult.scores,
              criteriaDigest: err.reviewResult.criteriaDigest,
              blockingIssueCount: err.reviewResult.blockingIssues.length,
              qualityIssueCount: err.reviewResult.qualityIssues.length,
              grounding: err.reviewResult.grounding,
            };
          }
          const nextMode = nextRepairContext && nextRepairContext.mode;
          const willContinue = !!nextRepairContext;
          if (nextMode === REPAIR_MODES.GROUNDED_REBUILD) {
            groundingAudit.groundedRebuildUsed = true;
          }
          if (nextMode === REPAIR_MODES.CLEAN_REGENERATION) {
            groundingAudit.cleanRegenerationUsed = true;
          }

          const progressText = isReviewRejection
            ? "正在检查并完善成果"
            : "成果中还有未完成的模板内容，正在自动修正。";
          await markAttemptOutcome(userData, parentAttemptId, {
            status: "superseded",
            finishedAt: nowIso(),
            errorCode: err.code,
            errorSummary: progressText,
            outcome: "repair_initiated",
            failureEvidence: evidence,
            userIssueSummary: isReviewRejection
              ? err.userIssueSummary || userFacingReviewSummary(err.reviewResult)
              : userFacingIssueSummary(err.placeholderIssues),
            modelOutputDigest: evidence.modelOutputDigest,
            outputLength: evidence.outputLength,
            placeholderIssues: evidence.placeholderIssues,
            reviewIssues: isReviewRejection ? repairIssues : undefined,
            failureStage: err.failureStage || "prewrite_validation",
            groundedRebuildUsed: !!groundingAudit.groundedRebuildUsed,
            cleanRegenerationUsed: !!groundingAudit.cleanRegenerationUsed,
            initiatedNextRepairMode: nextMode || undefined,
          });

          if (!willContinue) return;

          const repairAttemptId = newAttemptId();
          const repairAttempt = {
            schemaVersion: 1,
            id: repairAttemptId,
            packageId: String(packageId),
            deliverableId: String(deliverableId),
            status: "repairing",
            startedAt: nowIso(),
            finishedAt: null,
            modelAdapter: "invokeModelRoute/callModel",
            inputDigest: attempt.inputDigest,
            errorCode: null,
            errorSummary: null,
            producedVersionId: null,
            outcome: null,
            repairPass: pass + 1,
            parentAttemptId,
            repairMode: nextMode || REPAIR_MODES.LOCAL_REPAIR,
          };
          await registerGenerationAttempt(userData, repairAttempt, deliverableId, packageId);
          activeAttemptId = repairAttemptId;
          void pass;
        },
      }
    );
    if (produced && produced.groundingAudit) {
      groundingAudit = {
        ...groundingAudit,
        groundedRebuildUsed:
          !!produced.groundingAudit.groundedRebuildUsed || groundingAudit.groundedRebuildUsed,
        groundedRebuildCount:
          produced.groundingAudit.groundedRebuildCount || groundingAudit.groundedRebuildCount,
        cleanRegenerationUsed:
          !!produced.groundingAudit.cleanRegenerationUsed || groundingAudit.cleanRegenerationUsed,
        repairModes: produced.groundingAudit.repairModes || groundingAudit.repairModes,
        recoveryActions: produced.groundingAudit.recoveryActions || groundingAudit.recoveryActions,
      };
    }
    if (produced && produced.semanticMeta && Array.isArray(produced.semanticMeta.recoveryActions)) {
      groundingAudit.recoveryActions = (groundingAudit.recoveryActions || []).concat(
        produced.semanticMeta.recoveryActions
      );
    }
  } catch (err) {
    if (err && err.groundingAudit) {
      groundingAudit = { ...groundingAudit, ...err.groundingAudit };
    }
    const code = (err && err.code) || "generation_failed";
    const message = userMessageForFailure(err);
    const isReviewRejection = err && err.code === "review_content_rejected";
    const isAuthorityRejection =
      err &&
      (err.code === "project_authority_conflict" ||
        err.code === "ungrounded_project_numbers" ||
        err.code === "internal_claim_tags_rejected");
    const evidence =
      err &&
      (err.code === "placeholder_content_rejected" || isReviewRejection || isAuthorityRejection)
        ? buildFailureEvidence({
            attemptId: activeAttemptId,
            deliverableId,
            draft: err.draft || "",
            issues:
              err.placeholderIssues ||
              err.reviewIssues ||
              (Array.isArray(err.hits)
                ? err.hits.map((h, i) => ({
                    ruleId: h.id || err.code,
                    message: h.snippet || err.message,
                    lineNumber: i + 1,
                    matchedText: h.snippet,
                  }))
                : []),
            failureCode: err.code,
            failureStage: err.failureStage || "prewrite_validation",
          })
        : null;
    if (evidence && isReviewRejection && err.reviewResult) {
      evidence.reviewResult = {
        status: err.reviewResult.status,
        taskMode: err.reviewResult.taskMode,
        scores: err.reviewResult.scores,
        criteriaDigest: err.reviewResult.criteriaDigest,
        blockingIssueCount: err.reviewResult.blockingIssues.length,
        qualityIssueCount: err.reviewResult.qualityIssues.length,
        grounding: err.reviewResult.grounding,
      };
    }
    await packageStore.mutateStore(userData, (s) => {
      const a = s.generationAttempts[activeAttemptId];
      if (a) {
        a.status = "failed";
        a.finishedAt = nowIso();
        a.errorCode = code;
        a.errorSummary = message;
        a.outcome = "failed";
        a.failureStage = (err && err.failureStage) || "model_generation";
        a.groundedRebuildUsed = !!groundingAudit.groundedRebuildUsed;
        a.cleanRegenerationUsed = !!groundingAudit.cleanRegenerationUsed;
        Object.assign(
          a,
          buildAttemptAuditWrite({
            recoveryActions: groundingAudit.recoveryActions || [],
            modelCallCount: groundingAudit.modelCallCount || 0,
            demotedMaterialCount: groundingAudit.demotedMaterialCount || 0,
            gapStatementValid: !!(gapStatement && gapStatement.validation && gapStatement.validation.ok),
          })
        );
        if (evidence) {
          a.failureEvidence = evidence;
          a.placeholderIssues = evidence.placeholderIssues;
          a.modelOutputDigest = evidence.modelOutputDigest;
          a.outputLength = evidence.outputLength;
        }
        if (isReviewRejection && err.reviewIssues) {
          a.reviewIssues = err.reviewIssues;
        }
        if (isAuthorityRejection && Array.isArray(err.hits)) {
          a.reviewIssues = (a.reviewIssues || []).concat(
            err.hits.map((h, i) => ({
              ruleId: h.id || err.code,
              message: h.snippet || message,
              lineNumber: i + 1,
            }))
          );
        }
        a.userIssueSummary =
          (err && err.userIssueSummary) ||
          userFacingIssueSummary(err && err.placeholderIssues) ||
          (isAuthorityRejection ? message : null);
      }
      const d = s.deliverables[String(deliverableId)];
      if (d) {
        d.generationStatus = "failed";
        d.lastGenerationIssueSummary =
          (a && a.userIssueSummary) ||
          (err && err.userIssueSummary) ||
          userFacingIssueSummary(err && err.placeholderIssues);
        d.updatedAt = nowIso();
      }
      const p = s.packages[String(packageId)];
      if (p) {
        const dels = (p.deliverableIds || []).map((id) => s.deliverables[id]).filter(Boolean);
        Object.assign(p, derivePackageStatuses(dels));
        p.updatedAt = nowIso();
      }
      return true;
    });
    return {
      ok: false,
      code,
      message,
      attemptId: activeAttemptId,
      userIssueSummary: err && err.userIssueSummary,
      groundingAudit,
    };
  }

  const versionId = newVersionId();
  const prevVersionId = deliverable.currentVersionId || null;
  let committed;
  try {
    committed = await commitVersionFiles(userData, {
      packageId,
      deliverableId,
      versionId,
      files: produced.files,
      manifest: {
        attemptId: activeAttemptId,
        kind: produced.kind,
        sourcePlanVersionId: pkg.sourcePlanVersionId,
        sourceSnapshotDigest: pkg.executionSnapshot && pkg.executionSnapshot.sourcePlanDigest,
        modelProvenanceSummary: { adapter: "callModel", taskType: "artifact" },
        uiFormatLabel: produced.uiFormatLabel || null,
      },
    });
  } catch (err) {
    await packageStore.mutateStore(userData, (s) => {
      const a = s.generationAttempts[activeAttemptId];
      if (a) {
        a.status = "failed";
        a.finishedAt = nowIso();
        a.errorCode = (err && err.code) || "write_failed";
        a.errorSummary = (err && err.message) || "写入成果文件失败。";
        a.outcome = "failed";
      }
      const d = s.deliverables[String(deliverableId)];
      if (d) {
        d.generationStatus = "failed";
        d.updatedAt = nowIso();
      }
      return true;
    });
    return {
      ok: false,
      code: (err && err.code) || "write_failed",
      message: (err && err.message) || "写入成果文件失败。",
      attemptId: activeAttemptId,
    };
  }

  const artifacts = committed.files.map((f) =>
    makeArtifactRef({
      versionId,
      relativePath: f.relativePath,
      contentHash: f.contentHash,
      byteSize: f.byteSize,
      name: f.name,
    })
  );
  const primary =
    artifacts.find((a) => a.relativePath.endsWith("/" + produced.primaryFile)) || artifacts[0];
  const preview =
    artifacts.find((a) => a.relativePath.endsWith(".html") && a !== primary) ||
    artifacts.find((a) => a.mimeType === "text/html") ||
    null;

  const executorRef = actionIdentity.makeDefaultModelExecutor({
    modelRef:
      (produced.generator && produced.generator.modelRoute && produced.generator.modelRoute.taskType) ||
      "artifact/default",
  });
  let identitySnapshot =
    (pkg.identityContextSnapshot && JSON.parse(JSON.stringify(pkg.identityContextSnapshot))) ||
    null;
  if (!identitySnapshot) {
    identitySnapshot = actionIdentity.buildLegacyIdentityView({
      packageDir: deps.packageDir || null,
    });
  }
  identitySnapshot = actionIdentity.attachExecutorToSnapshot(identitySnapshot, executorRef);
  if (authGate.ref) {
    identitySnapshot.authorizationRefs = [authGate.ref];
  }

  const version = {
    schemaVersion: 1,
    id: versionId,
    deliverableId: String(deliverableId),
    version: (Array.isArray(deliverable.versionIds) ? deliverable.versionIds.length : 0) + 1,
    generationAttemptId: activeAttemptId,
    generationStatus: "ready",
    reviewStatus: "unreviewed",
    artifactRef: primary,
    previewRef: preview,
    artifactRefs: artifacts,
    contentHash: primary ? primary.contentHash : null,
    contentAvailable: true,
    // IDCOLLAB-MIN-01 identity audit fields
    identityContextSnapshot: identitySnapshot,
    identityContextSource: identitySnapshot.identityContextSource || "native_snapshot",
    initiatorSubjectId: identitySnapshot.initiatorSubjectId,
    ownerSubjectId: identitySnapshot.ownerSubjectId,
    representedSubjectId: identitySnapshot.representedSubjectId,
    actingSubjectId: identitySnapshot.actingSubjectId,
    actingRoleRef: identitySnapshot.actingRoleRef || null,
    participantRefs: identitySnapshot.participantRefs || [],
    executorRefs: identitySnapshot.executorRefs || [],
    authorizationRefs: identitySnapshot.authorizationRefs || [],
    reviewerSubjectId: null,
    acceptedBySubjectId: null,
    responsibilityBoundary: identitySnapshot.responsibilityBoundary || [],
    generator: {
      executionMode: "model_plus_local_renderer",
      capabilityId: produced.kind,
      modelRoute: { taskType: "artifact" },
      fallbackUsed: false,
      uiFormatLabel: produced.uiFormatLabel || null,
    },
    provenance: {
      subjectContextSnapshotId:
        (produced.generationContext &&
          produced.generationContext.subjectAssembly &&
          produced.generationContext.subjectAssembly.assemblyId) ||
        null,
      subjectContextSnapshotVersion:
        (produced.generationContext &&
          produced.generationContext.subjectAssembly &&
          produced.generationContext.subjectAssembly.packageVersion) ||
        null,
      planVersion: pkg.sourcePlanVersionId,
      capabilityInvocationIds: [],
      modelRoute: { taskType: "artifact" },
      contextClass:
        (produced.generationContext && produced.generationContext.contextClass) ||
        (produced.generationContext &&
          produced.generationContext.subjectAssembly &&
          produced.generationContext.subjectAssembly.contextClass) ||
        null,
      contextClassification:
        (produced.generationContext && produced.generationContext.contextClassification) ||
        (produced.generationContext &&
          produced.generationContext.subjectAssembly &&
          produced.generationContext.subjectAssembly.contextClassification) ||
        null,
      assemblyPolicyDigest:
        (produced.generationContext && produced.generationContext.assemblyPolicyDigest) ||
        (produced.generationContext &&
          produced.generationContext.subjectAssembly &&
          produced.generationContext.subjectAssembly.assemblyPolicyDigest) ||
        null,
      claimPostures: ["confirmed", "attributed", "inferred", "hypothetical"],
      claimPosturePresentation: "natural",
      sourceRefs: (produced.generationContext && produced.generationContext.attachmentRefs
        ? produced.generationContext.attachmentRefs
            .filter((r) => r && r.included)
            .map((r) => ({
              kind: "reference_material",
              id: r.id,
              name: r.name,
              contentHash: r.contentHash,
              evidenceKind: "task_material",
              ownership: "task_owned",
            }))
        : []
      ).concat([
        {
          kind: "task_goal",
          taskId: pkg.taskId,
          goal:
            (produced.generationContext && produced.generationContext.goal) ||
            null,
        },
        {
          kind: "plan_version",
          planVersionId: pkg.sourcePlanVersionId,
        },
      ]),
      attachmentRefs: tagAttachmentRefs(
        (produced.generationContext && produced.generationContext.attachmentRefs) || []
      ),
      subjectRefs:
        (produced.generationContext && produced.generationContext.subjectRefs) || [],
      memoryRefs: (
        (produced.generationContext && produced.generationContext.subjectRefs) || []
      ).filter((r) => r && r.layer === "memory"),
      evidenceSummary:
        (produced.generationContext && produced.generationContext.evidenceSummary) ||
        (produced.generationContext &&
          produced.generationContext.subjectAssembly &&
          produced.generationContext.subjectAssembly.evidenceSummary) ||
        null,
      ownershipSummary:
        (produced.generationContext && produced.generationContext.ownershipSummary) ||
        (produced.generationContext &&
          produced.generationContext.subjectAssembly &&
          produced.generationContext.subjectAssembly.ownershipSummary) ||
        null,
      assembly:
        produced.generationContext && produced.generationContext.subjectAssembly
          ? {
              assemblyId: produced.generationContext.subjectAssembly.assemblyId,
              queryKeyDigest: produced.generationContext.subjectAssembly.queryKeyDigest,
              packageId: produced.generationContext.subjectAssembly.packageId,
              packageVersion: produced.generationContext.subjectAssembly.packageVersion,
              budget: produced.generationContext.subjectAssembly.budget,
              emptyReason: produced.generationContext.subjectAssembly.emptyReason,
              contextClass: produced.generationContext.subjectAssembly.contextClass || null,
              assemblyPolicyDigest:
                produced.generationContext.subjectAssembly.assemblyPolicyDigest || null,
            }
          : null,
      evidenceRefs: [],
      authorizationRefs: identitySnapshot.authorizationRefs || [],
      identityContextSnapshot: identitySnapshot,
      actor: "user",
      generatedAt: nowIso(),
      generation_stage: stableMode ? "baseline" : "legacy_advanced",
    },
    quality: lastReviewResult
      ? {
          verdict: "pass",
          checks: ["placeholder_gate", "authority_gate", "quality_reviewer", "grounded_generation"],
          reviewer: {
            status: lastReviewResult.status,
            taskMode: lastReviewResult.taskMode,
            scores: lastReviewResult.scores,
            criteriaDigest: lastReviewResult.criteriaDigest,
            blockingIssueCount: lastReviewResult.blockingIssues.length,
            qualityIssueCount: lastReviewResult.qualityIssues.length,
            qualityIssues: lastReviewResult.qualityIssues.slice(0, 8).map((i) => ({
              ruleId: i.ruleId,
              message: i.message,
              lineNumber: i.lineNumber,
            })),
            suggestedRevisionCount: lastReviewResult.suggestedRevisions.length,
            reviewerDegraded: !!lastReviewResult.reviewerDegraded,
            modelReviewUsed: !!lastReviewResult.modelReviewUsed,
            grounding: lastReviewResult.grounding,
            reviewedAt: lastReviewResult.createdAt,
          },
          groundingAudit: buildAttemptAuditWrite({
            recoveryActions: groundingAudit.recoveryActions || [],
            modelCallCount: groundingAudit.modelCallCount || 0,
            demotedMaterialCount: groundingAudit.demotedMaterialCount || 0,
            gapStatementValid: !!(gapStatement && gapStatement.validation && gapStatement.validation.ok),
          }).groundingAudit,
        }
      : {
          verdict: "pass",
          checks: stableMode ? ["baseline_hard_gates"] : [],
          pipelineMode: stableMode ? "stable_delivery" : "advanced_shadow",
        },
    supersedesVersionId: prevVersionId,
    supersededByVersionId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await packageStore.mutateStore(userData, (s) => {
    s.versions = s.versions || {};
    s.artifacts = s.artifacts || {};
    s.generationAttempts = s.generationAttempts || {};
    for (const art of artifacts) {
      s.artifacts[art.id] = art;
    }
    if (prevVersionId && s.versions[prevVersionId]) {
      s.versions[prevVersionId].supersededByVersionId = versionId;
      s.versions[prevVersionId].generationStatus = "superseded";
      s.versions[prevVersionId].updatedAt = nowIso();
    }
    s.versions[versionId] = version;
    const a = s.generationAttempts[activeAttemptId];
    if (a) {
      a.status = "succeeded";
      a.finishedAt = nowIso();
      a.producedVersionId = versionId;
      a.outcome = "created_new_version";
      a.phase =
        stableMode &&
        (deliverable.kind === "document" ||
          deliverable.kind === "software" ||
          deliverable.kind === "code")
          ? "quality_enhancement"
          : "completed";
      a.groundedRebuildUsed = !!groundingAudit.groundedRebuildUsed;
      a.cleanRegenerationUsed = !!groundingAudit.cleanRegenerationUsed;
      Object.assign(
        a,
        buildAttemptAuditWrite({
          recoveryActions: groundingAudit.recoveryActions || [],
          modelCallCount: groundingAudit.modelCallCount || 0,
          demotedMaterialCount: groundingAudit.demotedMaterialCount || 0,
          gapStatementValid: !!(gapStatement && gapStatement.validation && gapStatement.validation.ok),
        })
      );
    }
    const d = s.deliverables[String(deliverableId)];
    if (d) {
      d.currentVersionId = versionId;
      d.versionIds = Array.isArray(d.versionIds) ? d.versionIds.concat([versionId]) : [versionId];
      d.generationStatus = "ready";
      d.reviewStatus = "unreviewed";
      d.latestGenerationAttemptId = activeAttemptId;
      d.lastGenerationIssueSummary = null;
      d.updatedAt = nowIso();
    }
    const p = s.packages[String(packageId)];
    if (p) {
      const dels = (p.deliverableIds || []).map((id) => s.deliverables[id]).filter(Boolean);
      Object.assign(p, derivePackageStatuses(dels));
      p.updatedAt = nowIso();
    }
    return true;
  });

  const baselineResult = {
    ok: true,
    packageId,
    deliverableId,
    attemptId: activeAttemptId,
    version,
    artifacts,
    uiFormatLabel: produced.uiFormatLabel || null,
    message: "成果已生成。",
    groundingAudit,
    enhancement: {
      attempted: false,
      enhanced: false,
      reason: null,
      modelCalls: 0,
      pending: false,
    },
    pipelineMode: stableMode ? "stable_delivery" : "advanced_shadow",
  };

  if (typeof deps.onBaselinePersisted === "function") {
    try {
      await deps.onBaselinePersisted({
        packageId,
        deliverableId,
        attemptId: activeAttemptId,
        versionId,
        pipelineMode: baselineResult.pipelineMode,
      });
    } catch {
      /* UI notify must not fail delivery */
    }
  }

  // Channel B: quality enhancement after baseline is already usable.
  const kindForEnhancement = String(deliverable.kind || "");
  const runDocumentEnhancement = stableMode && kindForEnhancement === "document";
  const runSoftwareEnhancement =
    stableMode && (kindForEnhancement === "software" || kindForEnhancement === "code");
  if (!runDocumentEnhancement && !runSoftwareEnhancement) {
    return baselineResult;
  }

  if (runSoftwareEnhancement) {
    try {
      const softEnh = await runSoftwareQualityEnhancement({
        files: produced.files,
        goal: taskContext.goal,
        callModel: boundedCallModel,
        allowedFiles: Object.keys(produced.files || {}),
        maxRevisions: 2,
      });
      baselineResult.enhancement = {
        attempted: true,
        enhanced: !!softEnh.enhanced,
        reason: softEnh.reason || null,
        modelCalls: softEnh.modelCalls || 0,
        artifactType: "software",
        loop: softEnh.loop
          ? {
              status: softEnh.loop.status,
              score: softEnh.loop.score,
              improved: softEnh.loop.improved,
              revisionsUsed: softEnh.loop.revisionsUsed,
              remainingIssues: softEnh.loop.remainingIssues,
            }
          : null,
      };
      if (softEnh.enhanced && softEnh.files) {
        const enhVersionId = newVersionId();
        const enhCommitted = await commitVersionFiles(userData, {
          packageId,
          deliverableId,
          versionId: enhVersionId,
          files: softEnh.files,
          manifest: {
            attemptId: activeAttemptId,
            kind: "software",
            sourcePlanVersionId: pkg.sourcePlanVersionId,
            modelProvenanceSummary: {
              adapter: "callModel",
              taskType: "artifact",
              stage: "software_quality_enhanced",
            },
          },
        });
        const enhArts = enhCommitted.files.map((f) =>
          makeArtifactRef({
            versionId: enhVersionId,
            relativePath: f.relativePath,
            contentHash: f.contentHash,
            byteSize: f.byteSize,
            name: f.name,
          })
        );
        const enhPrimary =
          enhArts.find((a) => a.relativePath.endsWith("/main.js")) || enhArts[0];
        const enhancedVersion = {
          ...version,
          id: enhVersionId,
          version: (Array.isArray(deliverable.versionIds) ? deliverable.versionIds.length : 0) + 2,
          artifactRef: enhPrimary,
          previewRef: null,
          artifactRefs: enhArts,
          contentHash: enhPrimary ? enhPrimary.contentHash : null,
          supersedesVersionId: versionId,
          provenance: {
            ...(version.provenance || {}),
            generation_stage: "enhanced",
            generatedAt: nowIso(),
          },
          quality: {
            verdict: softEnh.loop && softEnh.loop.claimedPass ? "pass" : "improved_with_remaining",
            checks: ["software_quality_evaluation"],
            pipelineMode: "stable_delivery",
            derivedEvaluation: softEnh.loop && softEnh.loop.derivedQuality,
            enhancement: { fromVersionId: versionId, modelCalls: softEnh.modelCalls },
          },
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        await packageStore.mutateStore(userData, (s) => {
          for (const art of enhArts) s.artifacts[art.id] = art;
          if (s.versions[versionId]) {
            s.versions[versionId].supersededByVersionId = enhVersionId;
            s.versions[versionId].updatedAt = nowIso();
          }
          s.versions[enhVersionId] = enhancedVersion;
          const d = s.deliverables[deliverableId];
          if (d) {
            d.versionIds = Array.isArray(d.versionIds)
              ? d.versionIds.concat(enhVersionId)
              : [versionId, enhVersionId];
            d.currentVersionId = enhVersionId;
            d.generationStatus = "ready";
            d.updatedAt = nowIso();
          }
        });
        baselineResult.enhancedVersionId = enhVersionId;
      } else if (softEnh.loop && softEnh.loop.derivedQuality) {
        await packageStore.mutateStore(userData, (s) => {
          if (s.versions[versionId]) {
            s.versions[versionId].quality = {
              ...(s.versions[versionId].quality || {}),
              derivedEvaluation: softEnh.loop.derivedQuality,
              remainingIssues: softEnh.loop.remainingIssues || [],
            };
            s.versions[versionId].updatedAt = nowIso();
          }
        });
      }
    } catch {
      /* software enhancement must not fail baseline delivery */
    }
    return baselineResult;
  }

  const baselineMd = String((produced.files && produced.files["artifact.md"]) || "");
  const runEnhancementJob = async () => {
    const enhancementMeta = {
      attempted: true,
      enhanced: false,
      reason: null,
      modelCalls: 0,
      pending: false,
    };
    let currentVersion = version;
    let currentArtifacts = artifacts;
    try {
      const enh = await runQualityEnhancement({
        baselineMd,
        kind: deliverable.kind,
        criteria: outcomeCriteria,
        goal: taskContext.goal,
        isDigitalMeProject,
        callModel: boundedCallModel,
        snapshot: systemSnapshot,
        authorityMap,
        packageDir: deps.packageDir || null,
      });
      enhancementMeta.modelCalls = enh.modelCalls || 0;
      enhancementMeta.reason = enh.reason || null;
      if (enh.enhanced && enh.md) {
        const enhVersionId = newVersionId();
        const enhCtx = produced.generationContext || { title: deliverable.title, goal: taskContext.goal };
        const enhFiles = documentFilesFromMarkdown(enh.md, enhCtx);
        const enhCommitted = await commitVersionFiles(userData, {
          packageId,
          deliverableId,
          versionId: enhVersionId,
          files: enhFiles,
          manifest: {
            attemptId: activeAttemptId,
            kind: produced.kind,
            sourcePlanVersionId: pkg.sourcePlanVersionId,
            modelProvenanceSummary: { adapter: "callModel", taskType: "artifact", stage: "enhanced" },
          },
        });
        const enhArts = enhCommitted.files.map((f) =>
          makeArtifactRef({
            versionId: enhVersionId,
            relativePath: f.relativePath,
            contentHash: f.contentHash,
            byteSize: f.byteSize,
            name: f.name,
          })
        );
        const enhPrimary =
          enhArts.find((a) => a.relativePath.endsWith("/artifact.md")) ||
          enhArts.find((a) => a.relativePath.endsWith(".md")) ||
          enhArts[0];
        const enhPreview =
          enhArts.find((a) => a.relativePath.endsWith(".html") && a !== enhPrimary) || null;
        const enhancedVersion = {
          ...version,
          id: enhVersionId,
          version: (Array.isArray(deliverable.versionIds) ? deliverable.versionIds.length : 0) + 2,
          artifactRef: enhPrimary,
          previewRef: enhPreview,
          artifactRefs: enhArts,
          contentHash: enhPrimary ? enhPrimary.contentHash : null,
          supersedesVersionId: versionId,
          provenance: {
            ...(version.provenance || {}),
            generation_stage: "enhanced",
            generatedAt: nowIso(),
          },
          quality: {
            verdict: "pass",
            checks: ["baseline_hard_gates", "quality_enhancement"],
            pipelineMode: "stable_delivery",
            reviewer: enh.reviewResult
              ? {
                  status: enh.reviewResult.status,
                  blockingIssueCount: (enh.reviewResult.blockingIssues || []).length,
                  qualityIssueCount: (enh.reviewResult.qualityIssues || []).length,
                }
              : null,
            enhancement: { fromVersionId: versionId, modelCalls: enh.modelCalls },
          },
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        await packageStore.mutateStore(userData, (s) => {
          for (const art of enhArts) s.artifacts[art.id] = art;
          if (s.versions[versionId]) {
            s.versions[versionId].supersededByVersionId = enhVersionId;
            s.versions[versionId].updatedAt = nowIso();
          }
          s.versions[enhVersionId] = enhancedVersion;
          const d = s.deliverables[String(deliverableId)];
          if (d) {
            d.currentVersionId = enhVersionId;
            d.versionIds = Array.isArray(d.versionIds)
              ? d.versionIds.concat([enhVersionId])
              : [versionId, enhVersionId];
            d.generationStatus = "ready";
            d.updatedAt = nowIso();
          }
          const a = s.generationAttempts[activeAttemptId];
          if (a) {
            a.phase = "completed";
            a.enhancement = { ok: true, versionId: enhVersionId, modelCalls: enh.modelCalls };
            a.producedVersionId = enhVersionId;
          }
          return true;
        });
        enhancementMeta.enhanced = true;
        currentVersion = enhancedVersion;
        currentArtifacts = enhArts;
      } else {
        await markAttemptOutcome(userData, activeAttemptId, {
          phase: "completed",
          enhancement: {
            ok: false,
            reason: enh.reason || "quality_enhancement_failed",
            modelCalls: enh.modelCalls || 0,
          },
        });
      }
    } catch (enhErr) {
      await markAttemptOutcome(userData, activeAttemptId, {
        phase: "completed",
        enhancement: {
          ok: false,
          reason: (enhErr && enhErr.code) || (enhErr && enhErr.message) || "quality_enhancement_failed",
        },
      });
      enhancementMeta.reason = (enhErr && enhErr.code) || "quality_enhancement_failed";
    }
    if (typeof deps.onEnhancementSettled === "function") {
      try {
        await deps.onEnhancementSettled({
          packageId,
          deliverableId,
          attemptId: activeAttemptId,
          enhancement: enhancementMeta,
        });
      } catch {
        /* ignore */
      }
    }
    return {
      version: currentVersion,
      artifacts: currentArtifacts,
      enhancement: enhancementMeta,
    };
  };

  // Production Electron path returns after baseline so UI can open immediately.
  // Automated tests default to awaiting enhancement for deterministic assertions.
  if (deps.awaitEnhancement === false) {
    void runEnhancementJob().catch(async (err) => {
      try {
        await markAttemptOutcome(userData, activeAttemptId, {
          phase: "completed",
          enhancement: {
            ok: false,
            reason: (err && err.code) || (err && err.message) || "quality_enhancement_failed",
          },
        });
      } catch {
        /* ignore */
      }
      if (typeof deps.onEnhancementSettled === "function") {
        try {
          await deps.onEnhancementSettled({
            packageId,
            deliverableId,
            attemptId: activeAttemptId,
            enhancement: { attempted: true, enhanced: false, reason: "quality_enhancement_failed" },
          });
        } catch {
          /* ignore */
        }
      }
    });
    return {
      ...baselineResult,
      enhancement: { attempted: true, enhanced: false, reason: null, modelCalls: 0, pending: true },
    };
  }

  const settled = await runEnhancementJob();
  return {
    ...baselineResult,
    version: settled.version,
    artifacts: settled.artifacts,
    enhancement: settled.enhancement,
  };
}

async function generateDeliverablePackage(userData, { packageId }, deps) {
  const store = packageStore.loadStore(userData);
  const pkg = store.packages[String(packageId)];
  if (!pkg || pkg.softDeletedAt) {
    return { ok: false, code: "package_not_found", message: "未找到成果包。" };
  }
  const materialsGate = assertTaskMaterialsFresh(userData, pkg.taskId);
  if (!materialsGate.ok) return materialsGate;
  const deliverables = (pkg.deliverableIds || [])
    .map((id) => store.deliverables[id])
    .filter((d) => d && d.planDisposition === "included");
  const ordered = topoSortDeliverables(deliverables);
  const results = [];
  const failedIds = new Set();
  for (const d of ordered) {
    const depsBlocked = (d.dependencies || []).some((dep) => failedIds.has(String(dep)));
    if (depsBlocked) {
      await packageStore.mutateStore(userData, (s) => {
        const cur = s.deliverables[d.id];
        if (cur) {
          cur.generationStatus = "failed";
          cur.updatedAt = nowIso();
        }
        return true;
      });
      results.push({
        ok: false,
        deliverableId: d.id,
        code: "dependency_failed",
        message: "依赖的成果未成功生成，已跳过。",
      });
      failedIds.add(String(d.id));
      continue;
    }
    const one = await generateOneDeliverable(
      userData,
      { packageId, deliverableId: d.id },
      deps
    );
    results.push({ ...one, deliverableId: d.id, kind: d.kind });
    if (!one.ok) failedIds.add(String(d.id));
  }
  const view = packageStore.getPackageView(userData, packageId);
  const okCount = results.filter((r) => r.ok).length;
  return {
    ok: okCount > 0,
    packageId,
    results,
    package: view.package,
    deliverables: view.deliverables,
    message:
      okCount === results.length
        ? "成果包已全部生成。"
        : okCount > 0
          ? "部分成果已生成，其余未完成。"
          : "未能生成成果。",
  };
}

async function reviewDeliverableVersion(userData, { versionId, decision, packageDir }) {
  const id = String(versionId || "");
  const dec = String(decision || "");
  if (!id) return { ok: false, code: "version_required", message: "缺少版本。" };
  if (dec !== "accepted" && dec !== "rejected") {
    return { ok: false, code: "invalid_decision", message: "审阅决定无效。" };
  }
  const store = packageStore.loadStore(userData);
  const version = store.versions && store.versions[id];
  if (!version) return { ok: false, code: "version_not_found", message: "未找到该版本。" };

  // Accept path: re-read live authorization from store.
  if (dec === "accepted") {
    const deliverable = store.deliverables[version.deliverableId];
    const pkg =
      deliverable && deliverable.packageId
        ? store.packages[String(deliverable.packageId)]
        : null;
    if (pkg) {
      const gate = authorizationStore.resolveActiveTaskAuthorization(userData, {
        taskId: pkg.taskId,
        planVersionId: pkg.sourcePlanVersionId,
        actionType: "artifact_acceptance",
      });
      if (!gate.ok) {
        return { ok: false, code: gate.code, message: gate.message };
      }
    }
  }

  const ownerSubjectId =
    version.ownerSubjectId ||
    (version.identityContextSnapshot && version.identityContextSnapshot.ownerSubjectId) ||
    actionIdentity.STABLE_OWNER_SUBJECT_ID;

  await packageStore.mutateStore(userData, (s) => {
    const v = s.versions[id];
    if (!v) return false;
    v.reviewStatus = dec;
    v.reviewerSubjectId = ownerSubjectId;
    v.acceptedBySubjectId = dec === "accepted" ? ownerSubjectId : null;
    v.updatedAt = nowIso();
    const d = s.deliverables[v.deliverableId];
    if (d && d.currentVersionId === id) {
      d.reviewStatus = dec;
      d.updatedAt = nowIso();
    }
    return true;
  });

  if (dec === "rejected") {
    try {
      const autoLearn = require("./deliverable-auto-learn");
      autoLearn.suppressRejectedVersion(userData, id, packageDir || null);
    } catch (err) {
      console.error(
        "[reviewDeliverableVersion] suppress rejected failed",
        err && err.message ? err.message : err
      );
    }
  }

  return {
    ok: true,
    versionId: id,
    reviewStatus: dec,
    reviewerSubjectId: ownerSubjectId,
    acceptedBySubjectId: dec === "accepted" ? ownerSubjectId : null,
    message: dec === "accepted" ? "已接受此版本。" : "已否定此版本。",
  };
}

module.exports = {
  generateOneDeliverable,
  generateDeliverablePackage,
  reviewDeliverableVersion,
  topoSortDeliverables,
  derivePackageStatuses,
  MAX_PLACEHOLDER_REPAIR_ATTEMPTS,
  MAX_QUALITY_REPAIR_ATTEMPTS,
  MAX_MODEL_CALLS_PER_GENERATION,
  deriveUserFacingTaskState,
};

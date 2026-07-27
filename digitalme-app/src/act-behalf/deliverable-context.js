"use strict";

/**
 * Shared generation context for DVL2 deliverables.
 * Unwraps PlanVersion understanding objects; budgets attachment text into prompts.
 */

const crypto = require("node:crypto");
const {
  findPlaceholderIssues,
  getBlockingPlaceholderIssues,
  analyzePlaceholderIssues,
  validatePlaceholderContent,
  userFacingIssueSummary,
  buildFailureEvidence,
  buildRepairIssueLines,
} = require("./placeholder-validation");

/** @deprecated Legacy export; prefer analyzePlaceholderIssues(). */
const PLACEHOLDER_RES = Object.freeze([
  /待填写/,
  /待补充/,
  /lorem ipsum/i,
  /功能一/,
  /\[object Object\]/i,
]);

function unwrapField(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object" && value && "value" in value) {
    const v = value.value;
    if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean).join("；");
    if (v == null) return "";
    return String(v);
  }
  if (Array.isArray(value)) return value.map((x) => String(x || "").trim()).filter(Boolean).join("；");
  return "";
}

function sha256Text(text) {
  return "sha256:" + crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

/**
 * Normalize reference materials for task persistence.
 * Keeps truncated text for generation; never drops silently without meta.
 */
function normalizeReferenceMaterials(list, opts) {
  const maxFiles = (opts && opts.maxFiles) || 12;
  const maxCharsPerFile = (opts && opts.maxCharsPerFile) || 24000;
  const out = [];
  for (const raw of Array.isArray(list) ? list.slice(0, maxFiles) : []) {
    if (!raw || raw.ok === false) continue;
    const full = String(raw.text || "");
    const truncated = full.length > maxCharsPerFile;
    const text = truncated ? full.slice(0, maxCharsPerFile) : full;
    if (!text.trim() && !raw.name) continue;
    out.push({
      id: String(raw.id || sha256Text(String(raw.name || "") + "|" + text).slice(0, 24)),
      name: String(raw.name || "未命名附件"),
      path: raw.path ? String(raw.path) : null,
      charCount: full.length || text.length,
      truncated: !!truncated || !!raw.truncated,
      contentHash: raw.contentHash || sha256Text(full || text),
      text,
      note: raw.note ? String(raw.note) : "",
      ok: true,
    });
  }
  return out;
}

function budgetAttachmentContext(materials, maxChars) {
  const limit = Number(maxChars) > 0 ? Number(maxChars) : 18000;
  const list = normalizeReferenceMaterials(materials);
  const parts = [];
  const usedRefs = [];
  let used = 0;
  for (const m of list) {
    const header = `【参考材料（本次任务 · task_material / task_owned）：${m.name}】\n`;
    const remain = limit - used - header.length;
    if (remain <= 80) {
      usedRefs.push({
        id: m.id,
        name: m.name,
        contentHash: m.contentHash,
        included: false,
        reason: "token_budget_exhausted",
        evidenceKind: "task_material",
        ownership: "task_owned",
        logicalState: null,
      });
      continue;
    }
    const body = m.text.length > remain ? m.text.slice(0, remain) + "\n…（已按长度截断）" : m.text;
    parts.push(header + body);
    used += header.length + body.length + 8;
    usedRefs.push({
      id: m.id,
      name: m.name,
      contentHash: m.contentHash,
      included: true,
      truncated: m.truncated || body.length < m.text.length,
      charsUsed: body.length,
      evidenceKind: "task_material",
      ownership: "task_owned",
      logicalState: null,
    });
  }
  return {
    text: parts.join("\n\n---\n\n"),
    usedRefs,
    totalChars: used,
  };
}

function buildGenerationContext({
  pkg,
  deliverable,
  task,
  referenceMaterials,
  subjectAssembly,
  isDigitalMeProject,
  projectRetrieval,
  projectResolved,
}) {
  const snap = (pkg && pkg.executionSnapshot) || {};
  const input = snap.inputSummary || {};
  const understanding = snap.understanding || {};
  const planned = Array.isArray(snap.plannedDeliverables) ? snap.plannedDeliverables : [];
  const plannedItem =
    planned.find(
      (it) =>
        deliverable &&
        String(it.id) === String(deliverable.sourcePlannedDeliverableId)
    ) || null;

  const goal =
    unwrapField(input.goal) ||
    unwrapField(understanding.goal) ||
    unwrapField(task && task.goal) ||
    unwrapField(task && task.request) ||
    unwrapField(task && task.taskIntent && task.taskIntent.goal) ||
    "";
  const audience =
    unwrapField(input.audience) ||
    unwrapField(understanding.audience) ||
    "";
  const usage =
    unwrapField(input.usage) ||
    unwrapField(understanding.usage) ||
    "";
  const constraints =
    unwrapField(input.constraints) ||
    unwrapField(understanding.constraints) ||
    "";
  const summary =
    unwrapField(input.understandingSummary) ||
    unwrapField(understanding.summary) ||
    unwrapField(understanding.oneLineSummary) ||
    goal.slice(0, 200);

  const materials = referenceMaterials || (task && task.referenceMaterials) || [];
  const attachmentBudget = budgetAttachmentContext(materials, 18000);

  const assembly = subjectAssembly && typeof subjectAssembly === "object" ? subjectAssembly : null;
  const subjectRenderedText = assembly && assembly.renderedText ? String(assembly.renderedText) : "";
  const subjectRefs = assembly && Array.isArray(assembly.refs) ? assembly.refs : [];
  const attachmentRefs =
    assembly && Array.isArray(assembly.attachmentRefs) && assembly.attachmentRefs.length
      ? assembly.attachmentRefs
      : attachmentBudget.usedRefs.map((r) => ({
          ...r,
          evidenceKind: "task_material",
          ownership: "task_owned",
          logicalState: null,
        }));

  return {
    goal,
    audience,
    usage,
    constraints,
    summary,
    title: String((deliverable && deliverable.title) || (plannedItem && plannedItem.title) || "成果"),
    purpose: String(
      (deliverable && deliverable.purpose) ||
        (plannedItem && plannedItem.purpose) ||
        ""
    ),
    kind: String((deliverable && deliverable.kind) || "other"),
    taskId: String((task && task.taskId) || (pkg && pkg.taskId) || ""),
    planVersionId: String((pkg && pkg.sourcePlanVersionId) || ""),
    packageId: String((pkg && pkg.id) || ""),
    deliverableId: String((deliverable && deliverable.id) || ""),
    attachmentText: attachmentBudget.text,
    attachmentRefs,
    subjectAssembly: assembly,
    subjectRenderedText,
    subjectRefs,
    contextClass: (assembly && assembly.contextClass) || null,
    contextClassification: (assembly && assembly.contextClassification) || null,
    assemblyPolicyDigest: (assembly && assembly.assemblyPolicyDigest) || null,
    evidenceSummary: (assembly && assembly.evidenceSummary) || null,
    ownershipSummary: (assembly && assembly.ownershipSummary) || null,
    allowAiExplorationBlock: !!(
      assembly &&
      assembly.assemblyPolicy &&
      assembly.assemblyPolicy.allowAiExplorationBlock
    ),
    isDigitalMeProject: !!isDigitalMeProject,
    projectContextId: (assembly && assembly.projectContextId) || (projectResolved && projectResolved.projectContextId) || null,
    projectId: (assembly && assembly.projectId) || (projectResolved && projectResolved.projectId) || null,
    projectContextLabel: (assembly && assembly.projectContextLabel) || (projectResolved && projectResolved.displayLabel) || null,
    projectRetrieval: projectRetrieval || (assembly && assembly.projectRetrieval) || null,
    retrievedClaimIds: (projectRetrieval && projectRetrieval.retrievedClaimIds) || [],
    excludedClaims: (projectRetrieval && projectRetrieval.excludedClaims) || [],
  };
}

function assertGeneratedContentUsable(text, { kind, goal, contextClass, evidenceCorpus, claimPosturePresentation, isDigitalMeProject, projectContextEmpty } = {}) {
  const body = String(text || "").trim();
  if (!body || body.length < 12) {
    const e = new Error("模型未返回有效内容。");
    e.code = "empty_model_output";
    e.failureStage = "prewrite_validation";
    throw e;
  }
  const placeholderCheck = validatePlaceholderContent(body);
  if (placeholderCheck.hasBlocking) {
    const e = new Error("生成的内容仍包含未填写部分，暂未保存。你可以重试，或补充更明确的要求。");
    e.code = "placeholder_content_rejected";
    e.placeholders = placeholderCheck.blockingIssues.map((i) => i.ruleId);
    e.placeholderIssues = placeholderCheck.blockingIssues;
    e.userIssueSummary = userFacingIssueSummary(placeholderCheck.blockingIssues);
    e.failureStage = "prewrite_validation";
    throw e;
  }
  const g = String(goal || "");
  // Reject known fixture/demo industry bleed when the task is about Digital Me.
  if (/Digital\s*Me|数字之我/i.test(g) && /智能出行/.test(body)) {
    const e = new Error("生成结果偏离任务上下文，未保存为成果。");
    e.code = "off_topic_content_rejected";
    throw e;
  }
  const reviewOpts = {
    contextClass,
    evidenceCorpus: evidenceCorpus || "",
    claimPosturePresentation: claimPosturePresentation || "natural",
    isDigitalMeProject: !!isDigitalMeProject || /Digital\s*Me|数字之我|digitalme/i.test(g),
    projectContextEmpty: !!projectContextEmpty,
  };
  if (contextClass === "representation") {
    const { assertRepresentationFactsGrounded } = require("./subject-context-engine");
    assertRepresentationFactsGrounded(body, evidenceCorpus || "", contextClass);
  } else if (reviewOpts.isDigitalMeProject) {
    const { findUnsupportedFabricatedFacts, assertProjectAuthorityConsistency } = require("./subject-context-engine");
    const fabricated = findUnsupportedFabricatedFacts(body, evidenceCorpus || "");
    if (fabricated.length) {
      const e = new Error("生成结果含无来源的团队/预算/周期等具体数字，未保存为成果。");
      e.code = "ungrounded_project_numbers";
      e.hits = fabricated;
      throw e;
    }
    assertProjectAuthorityConsistency(body, evidenceCorpus || "", reviewOpts);
  }
  const { assertFormalArtifactPresentation } = require("./subject-context-engine");
  assertFormalArtifactPresentation(body, reviewOpts);
  void kind;
  return true;
}

module.exports = {
  unwrapField,
  normalizeReferenceMaterials,
  budgetAttachmentContext,
  buildGenerationContext,
  findPlaceholderIssues,
  getBlockingPlaceholderIssues,
  analyzePlaceholderIssues,
  validatePlaceholderContent,
  userFacingIssueSummary,
  buildFailureEvidence,
  buildRepairIssueLines,
  assertGeneratedContentUsable,
  sha256Text,
  PLACEHOLDER_RES,
};

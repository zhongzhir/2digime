"use strict";

/**
 * VL1 block 4: Experience Proposal + subject reflow via authoritative feedback:preview/apply.
 * adopted ≠ write Package; Owner must review → preview → explicit confirm apply.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readManifest, PackageStore } = require("../package-store");
const feedback = require("../feedback");
const {
  isResultCurrent,
  confirmedClaimsFromContext,
  extractJsonObject,
  OWNER_DECISION,
  RESULT_STATUS,
} = require("./result-generation");
const { safeErrorSummary } = require("./research-run");

const PROPOSAL_KIND = "experience_proposal";
const MAX_CANDIDATES = 8;
const MAX_CANDIDATE_CHARS = 800;
const MAX_RATIONALE_CHARS = 400;
const MAX_FINAL_TEXT_CHARS = 8000;
const MAX_CLAIMS_IN_PROMPT = 10;
const MAX_CLAIM_CHARS = 280;
const MAX_PACKAGE_SUMMARY_CHARS = 1200;
const MAX_SECTION_CHARS = 2000;
const MAX_REVISIONS = 30;

const SUPPORTED_TARGET_KINDS = Object.freeze(["memory", "style", "boundary", "persona"]);

const PROPOSAL_STATUS = Object.freeze({
  draft: "draft",
  reviewed: "reviewed",
  previewed: "previewed",
  applied: "applied",
  rejected: "rejected",
  failed: "failed",
  interrupted: "interrupted",
  generating: "generating",
  previewing: "previewing",
  applying: "applying",
});

const OWNER_CANDIDATE_STATE = Object.freeze({
  pending: "pending",
  accepted: "accepted",
  edited: "edited",
  excluded: "excluded",
});

const TRANSIENT_STATUSES = new Set([
  PROPOSAL_STATUS.generating,
  PROPOSAL_STATUS.previewing,
  PROPOSAL_STATUS.applying,
]);

function newId(prefix) {
  return (
    String(prefix || "id") +
    "_" +
    Date.now().toString(36) +
    "_" +
    crypto.randomBytes(3).toString("hex")
  );
}

function truncate(s, n) {
  const t = String(s || "");
  if (t.length <= n) return t;
  return t.slice(0, Math.max(0, n - 1)) + "…";
}

function packageBaseRefFromDir(packageDir) {
  const m = readManifest(packageDir) || {};
  return {
    version: String(m.revision != null ? m.revision : ""),
    digestOrEquivalent: String(m.rootSha256 || m.contentDigest || ""),
    packageVersion: String(m.packageVersion || ""),
  };
}

function boundedPackageSummary(pkg) {
  const parts = [];
  if (pkg && pkg.persona) parts.push("【人格摘要】\n" + truncate(pkg.persona, 400));
  if (pkg && pkg.styleGuide) parts.push("【风格摘要】\n" + truncate(pkg.styleGuide, 300));
  if (pkg && pkg.boundariesSummary) {
    parts.push("【边界摘要】\n" + truncate(pkg.boundariesSummary, 300));
  }
  if (pkg && pkg.preferences) parts.push("【偏好摘要】\n" + truncate(pkg.preferences, 200));
  return truncate(parts.join("\n\n"), MAX_PACKAGE_SUMMARY_CHARS);
}

function findResult(task, resultId) {
  const list = Array.isArray(task && task.results) ? task.results : [];
  return list.find((r) => r && r.resultId === String(resultId)) || null;
}

function resultFinalText(result) {
  const fd = (result && result.sections && result.sections.finalDraft) || {};
  return String(fd.currentText || fd.initialText || "").trim();
}

function healRunningProposals(proposals) {
  const list = Array.isArray(proposals) ? proposals.slice() : [];
  let changed = false;
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    if (!p) continue;
    // applying must NOT be blindly interrupted — reconcile via changeSet instead.
    if (
      p.status === PROPOSAL_STATUS.generating ||
      p.status === PROPOSAL_STATUS.previewing
    ) {
      list[i] = {
        ...p,
        status: PROPOSAL_STATUS.interrupted,
        updatedAt: new Date().toISOString(),
        interruptReason: "进程退出时提案操作未完成，已标记为中断。",
      };
      changed = true;
    }
  }
  return { proposals: list, changed };
}

/**
 * Inspect a PackageStore change set by id. Unique proof that this apply committed.
 * Does not infer from live Package revision alone.
 */
function inspectChangeSetCommit(packageDir, changeSetId) {
  if (!packageDir || !changeSetId) {
    return { ok: false, code: "changeset_not_found", message: "changeset_not_found" };
  }
  try {
    const store = new PackageStore({
      packageDir,
      ownerId: "owner:feedback",
    });
    return store.inspectChangeSet(String(changeSetId));
  } catch (err) {
    return {
      ok: false,
      code: "changeset_unreadable",
      message: safeErrorSummary(err) || "changeset_unreadable",
    };
  }
}

/**
 * Reconcile proposals stuck in applying after Package commit / audit-write failure.
 * Idempotent: committed changeSet → applied; uncommitted → previewed; unverifiable → interrupted (never applied).
 */
function reconcileApplyingProposals(proposals, packageDir) {
  const list = Array.isArray(proposals) ? proposals.slice() : [];
  let changed = false;
  if (!packageDir) return { proposals: list, changed: false };

  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    if (!p || p.status !== PROPOSAL_STATUS.applying) continue;
    if (p.status === PROPOSAL_STATUS.applied) continue;

    const pending = p.pendingApply && typeof p.pendingApply === "object" ? p.pendingApply : null;
    const changeSetId = String(
      (pending && (pending.changeSetId || pending.previewId)) ||
        (p.preview && p.preview.previewId) ||
        ""
    ).trim();

    if (!changeSetId || !pending) {
      list[i] = {
        ...p,
        status: PROPOSAL_STATUS.interrupted,
        updatedAt: new Date().toISOString(),
        interruptReason:
          "写入过程中断，且缺少可核验的 changeSet 关联信息，未标记为已应用。可重新预览后确认写入。",
        apply: {
          ...(p.apply || {}),
          status: "failed",
          errorSafeSummary: "unverified_applying_without_pending_apply",
          completedAt: new Date().toISOString(),
        },
      };
      changed = true;
      continue;
    }

    const insp = inspectChangeSetCommit(packageDir, changeSetId);
    if (insp.ok && insp.status === "committed") {
      const completedAt = insp.committedAt || new Date().toISOString();
      list[i] = {
        ...p,
        status: PROPOSAL_STATUS.applied,
        stale: false,
        pendingApply: pending,
        apply: {
          requestedAt: pending.requestedAt || p.updatedAt || completedAt,
          completedAt,
          status: "succeeded",
          previewId: changeSetId,
          changeSetId,
          packageBaseVersion: String(pending.packageBaseVersion),
          packageResultVersion: String(insp.resultRevision),
          rollbackVersion:
            insp.previousRevision != null ? "v" + String(insp.previousRevision) : null,
          rootSha256: insp.resultRootSha256 || null,
          appliedCandidateIds: Array.isArray(pending.appliedCandidateIds)
            ? pending.appliedCandidateIds.slice()
            : [],
          affectedPaths: Array.isArray(insp.affectedPaths) ? insp.affectedPaths.slice() : [],
          recoveredFromChangeSet: true,
          errorSafeSummary: null,
        },
        updatedAt: completedAt,
      };
      changed = true;
      continue;
    }

    if (insp.ok && insp.status !== "committed") {
      // Change set exists but was never committed — safe to return to previewed for retry.
      list[i] = {
        ...p,
        status: PROPOSAL_STATUS.previewed,
        pendingApply: null,
        apply: {
          requestedAt: pending.requestedAt || null,
          completedAt: new Date().toISOString(),
          status: "failed",
          previewId: changeSetId,
          changeSetId,
          packageBaseVersion: String(pending.packageBaseVersion),
          packageResultVersion: null,
          appliedCandidateIds: [],
          errorSafeSummary: "changeset_not_committed",
        },
        updatedAt: new Date().toISOString(),
        interruptReason: null,
      };
      changed = true;
      continue;
    }

    // Cannot verify (missing / unreadable) — must NOT guess applied from Package revision.
    list[i] = {
      ...p,
      status: PROPOSAL_STATUS.interrupted,
      updatedAt: new Date().toISOString(),
      interruptReason:
        "无法核验本次 changeSet 是否已提交，未标记为已应用。请勿凭资料包版本变化推测。",
      apply: {
        requestedAt: pending.requestedAt || null,
        completedAt: new Date().toISOString(),
        status: "failed",
        previewId: changeSetId,
        changeSetId,
        packageBaseVersion: String(pending.packageBaseVersion),
        packageResultVersion: null,
        appliedCandidateIds: Array.isArray(pending.appliedCandidateIds)
          ? pending.appliedCandidateIds.slice()
          : [],
        errorSafeSummary: insp.code || "changeset_unreadable",
      },
    };
    changed = true;
  }

  return { proposals: list, changed };
}

function healAndReconcileProposals(proposals, packageDir) {
  const healed = healRunningProposals(proposals);
  const reconciled = reconcileApplyingProposals(healed.proposals, packageDir);
  return {
    proposals: reconciled.proposals,
    changed: healed.changed || reconciled.changed,
  };
}

/**
 * Fail closed when Package cannot be safely read for proposal generation.
 * Manifest-only readability is not enough if content probes fail.
 */
function readPackageForProposal(packageDir, loadPackage) {
  if (!packageDir) {
    return {
      ok: false,
      code: "package_unreadable",
      message: "缺少主体资料包路径。",
    };
  }
  let manifest;
  try {
    manifest = readManifest(packageDir);
  } catch (err) {
    return {
      ok: false,
      code: "package_unreadable",
      message: "无法安全读取主体资料包清单。",
      errorSafeSummary: safeErrorSummary(err),
    };
  }
  if (!manifest || typeof manifest !== "object") {
    return {
      ok: false,
      code: "package_unreadable",
      message: "主体资料包清单不可用。",
    };
  }
  try {
    fs.readdirSync(packageDir);
  } catch (err) {
    return {
      ok: false,
      code: "package_unreadable",
      message: "无法安全读取主体资料包内容。",
      errorSafeSummary: safeErrorSummary(err),
    };
  }
  const probes = ["persona.md", "style-guide.md", "manifest.json"];
  for (const rel of probes) {
    const full = path.join(packageDir, rel);
    if (!fs.existsSync(full)) continue;
    try {
      fs.readFileSync(full, "utf8");
    } catch (err) {
      return {
        ok: false,
        code: "package_unreadable",
        message: "主体资料包内容无法安全读取。",
        errorSafeSummary: safeErrorSummary(err),
      };
    }
  }
  let pkg;
  try {
    pkg =
      typeof loadPackage === "function"
        ? loadPackage()
        : { dir: packageDir, exists: true, manifest };
  } catch (err) {
    return {
      ok: false,
      code: "package_unreadable",
      message: "无法安全读取主体资料包。",
      errorSafeSummary: safeErrorSummary(err),
    };
  }
  if (!pkg || typeof pkg !== "object") {
    return {
      ok: false,
      code: "package_unreadable",
      message: "无法安全读取主体资料包。",
    };
  }
  return { ok: true, pkg, manifest };
}

function markProposalsStale(proposals, reason) {
  const list = Array.isArray(proposals) ? proposals.slice() : [];
  let changed = false;
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    if (!p || p.status === PROPOSAL_STATUS.applied) continue;
    if (p.status === PROPOSAL_STATUS.rejected && p.stale) continue;
    list[i] = {
      ...p,
      stale: true,
      staleReason: String(reason || "提案已失效"),
      updatedAt: new Date().toISOString(),
    };
    changed = true;
  }
  return { proposals: list, changed };
}

function invalidateOpenProposalsForResult(proposals, resultId, reason) {
  const list = Array.isArray(proposals) ? proposals.slice() : [];
  let changed = false;
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    if (!p || p.status === PROPOSAL_STATUS.applied) continue;
    if (String(p.resultId) !== String(resultId)) continue;
    list[i] = {
      ...p,
      stale: true,
      staleReason: String(reason || "关联成果已变化"),
      updatedAt: new Date().toISOString(),
    };
    changed = true;
  }
  return { proposals: list, changed };
}

function assertCreatePreconditions(task, resultId, packageDir) {
  if (!task || !task.taskId) {
    return { ok: false, code: "task_not_found", message: "找不到该任务。" };
  }
  const result = findResult(task, resultId);
  if (!result) {
    return { ok: false, code: "result_not_found", message: "找不到该成果。" };
  }
  if (result.status !== RESULT_STATUS.succeeded) {
    return {
      ok: false,
      code: "result_not_succeeded",
      message: "仅成功生成的成果可总结学习建议。",
    };
  }
  if (result.ownerDecision !== OWNER_DECISION.adopted) {
    return {
      ok: false,
      code: "result_not_adopted",
      message: "请先采用成果。采用不等于写入 Digital Me。",
    };
  }
  if (!isResultCurrent(task, result)) {
    return {
      ok: false,
      code: "result_stale",
      message: "该成果不适用于当前目标或本人上下文，不能总结学习建议。",
    };
  }

  const open = (Array.isArray(task.proposals) ? task.proposals : []).find(
    (p) =>
      p &&
      p.resultId === result.resultId &&
      Number(p.resultRevision) === Number(result.currentRevision) &&
      !p.stale &&
      p.status !== PROPOSAL_STATUS.applied &&
      p.status !== PROPOSAL_STATUS.rejected &&
      p.status !== PROPOSAL_STATUS.failed &&
      p.status !== PROPOSAL_STATUS.interrupted
  );
  if (open) {
    return {
      ok: false,
      code: "proposal_in_progress",
      message: "该成果当前修订已有未完成的学习建议，请先审阅或拒绝后再新建。",
      proposalId: open.proposalId,
    };
  }

  let base;
  try {
    base = packageBaseRefFromDir(packageDir);
    if (!base.version && base.version !== "0") {
      // revision 0 is valid
    }
    if (base.version === "" || base.version == null) {
      return {
        ok: false,
        code: "package_unreadable",
        message: "无法安全读取主体资料包版本。",
      };
    }
  } catch (err) {
    return {
      ok: false,
      code: "package_unreadable",
      message: safeErrorSummary(err) || "无法安全读取主体资料包。",
    };
  }

  if (typeof feedback.previewFeedback !== "function" || typeof feedback.applyFeedback !== "function") {
    return {
      ok: false,
      code: "feedback_unavailable",
      message: "反馈写入边界不可用。",
    };
  }

  return { ok: true, result, packageBaseRef: base };
}

function buildProposalMessages({ intent, claims, result, packageSummary, allowedKinds }) {
  const claimBlock = (claims || [])
    .map((c) => `- claimId=${c.claimId} kind=${c.kind}\n  ${truncate(c.text, MAX_CLAIM_CHARS)}`)
    .join("\n");
  const sections = (result && result.sections) || {};
  const inferences = (sections.inferences || [])
    .slice(0, 8)
    .map((inf, i) => {
      return (
        `${i + 1}. ${truncate(inf.text, 240)}\n` +
        `   claims=${(inf.basedOnSubjectClaimIds || []).join(",") || "无"}; ` +
        `ext=${(inf.basedOnExternalResultRefs || []).join(",") || "无"}; ` +
        `u=${inf.uncertainty || "?"}`
      );
    })
    .join("\n");
  const finalText = truncate(resultFinalText(result), MAX_FINAL_TEXT_CHARS);

  const system =
    "你是 Digital Me 的经验提取助手。根据一次已采用的研究与表达成果，提出可写入主体资料包的候选经验。\n" +
    "输出必须是单个 JSON 对象，字段：\n" +
    '{"candidates":[{"targetKind":"memory|style|boundary|persona","proposedText":"...","rationale":"...","basedOnSubjectClaimIds":[],"basedOnExternalResultRefs":[],"basedOnResultSections":["finalDraft"|"inferences"|"subjectEvidence"],"confidence":"low|medium|high","caveat":"..."}]}\n' +
    "规则：\n" +
    "1. 最多 " +
    MAX_CANDIDATES +
    " 条；targetKind 仅允许：" +
    allowedKinds.join(", ") +
    "。\n" +
    "2. 不得把外部搜索摘要写成本人事实或观点；不得把新推断伪装成 Owner 已有认知。\n" +
    "3. 只能引用给出的 claimId / resultRef；不得发明 Package 路径、version、URL、feedback operation。\n" +
    "4. 依据不足时宁可不输出；高风险边界变化须写 caveat。\n" +
    "5. 不要输出 Markdown 围栏。";

  const user =
    "【任务目标】\n" +
    String((intent && intent.goal) || "") +
    "\n\n【已确认本人条目】\n" +
    (claimBlock || "（无）") +
    "\n\n【成果正文（Owner 当前修订）】\n" +
    (finalText || "（空）") +
    "\n\n【成果推断摘要】\n" +
    (inferences || "（无）") +
    "\n\n【主体资料包有界摘要（仅供对照，勿复述敏感无关内容）】\n" +
    (packageSummary || "（无）");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function materializeCandidates(raw, { claims, result }) {
  const claimIds = new Set((claims || []).map((c) => c.claimId));
  const extRefs = new Set(
    ((result && result.sections && result.sections.externalEvidence) || [])
      .map((e) => e && e.resultRef)
      .filter(Boolean)
  );
  const allowedSections = new Set(["finalDraft", "inferences", "subjectEvidence", "externalEvidence"]);
  const list = Array.isArray(raw && raw.candidates) ? raw.candidates : [];
  const out = [];
  const rejected = [];

  for (const row of list.slice(0, MAX_CANDIDATES * 2)) {
    if (!row || typeof row !== "object") continue;
    const targetKind = String(row.targetKind || "").trim();
    if (!SUPPORTED_TARGET_KINDS.includes(targetKind)) {
      rejected.push({ reason: "unsupported_targetKind", targetKind });
      continue;
    }
    const proposedText = truncate(String(row.proposedText || "").trim(), MAX_CANDIDATE_CHARS);
    if (!proposedText) {
      rejected.push({ reason: "empty_text", targetKind });
      continue;
    }

    const basedOnSubjectClaimIds = (Array.isArray(row.basedOnSubjectClaimIds) ? row.basedOnSubjectClaimIds : [])
      .map(String)
      .filter((id) => claimIds.has(id));
    const basedOnExternalResultRefs = (
      Array.isArray(row.basedOnExternalResultRefs) ? row.basedOnExternalResultRefs : []
    )
      .map(String)
      .filter((id) => extRefs.has(id));
    const basedOnResultSections = (Array.isArray(row.basedOnResultSections) ? row.basedOnResultSections : [])
      .map(String)
      .filter((s) => allowedSections.has(s));

    // External-only without subject/final → exclude (cannot become persona/memory/boundary as owner fact)
    if (
      basedOnExternalResultRefs.length > 0 &&
      basedOnSubjectClaimIds.length === 0 &&
      !basedOnResultSections.includes("finalDraft") &&
      !basedOnResultSections.includes("subjectEvidence") &&
      !basedOnResultSections.includes("inferences") &&
      (targetKind === "persona" || targetKind === "memory" || targetKind === "boundary")
    ) {
      rejected.push({ reason: "external_only_forbidden", targetKind });
      continue;
    }

    // Drop model-invented package / URL fields by never copying them
    const hasEvidence =
      basedOnSubjectClaimIds.length > 0 ||
      basedOnResultSections.includes("finalDraft") ||
      basedOnResultSections.includes("inferences") ||
      basedOnResultSections.includes("subjectEvidence");

    if (!hasEvidence) {
      rejected.push({ reason: "insufficient_evidence", targetKind, proposedText: truncate(proposedText, 80) });
      continue;
    }

    const confidence = ["low", "medium", "high"].includes(row.confidence) ? row.confidence : "medium";
    const caveat = truncate(String(row.caveat || ""), MAX_RATIONALE_CHARS);
    const warnings = [];
    if (targetKind === "boundary") {
      warnings.push("高风险：行为边界变化需 Owner 仔细确认。");
    }
    if (confidence === "low") warnings.push("依据较弱，建议排除或改写后再采用。");

    out.push({
      candidateId: newId("cand"),
      targetKind,
      proposedText,
      originalProposedText: proposedText,
      rationale: truncate(String(row.rationale || ""), MAX_RATIONALE_CHARS),
      basedOnResultSections,
      basedOnSubjectClaimIds,
      basedOnExternalResultRefs,
      confidence,
      caveat,
      ownerState: OWNER_CANDIDATE_STATE.pending,
      ownerText: proposedText,
      prohibitedUses: ["external_as_owner_fact", "model_inference_as_confirmed_claim"],
      conflictRefs: [],
      warnings,
    });
    if (out.length >= MAX_CANDIDATES) break;
  }

  return { candidates: out, rejectedMeta: rejected };
}

function isProposalApplicable(task, proposal, packageDir) {
  if (!task || !proposal) return { ok: false, code: "proposal_not_found", message: "找不到学习建议。" };
  if (proposal.stale) {
    return {
      ok: false,
      code: "proposal_stale",
      message: proposal.staleReason || "历史学习建议，不适用于当前状态。",
    };
  }
  if (proposal.status === PROPOSAL_STATUS.applied) {
    return { ok: false, code: "proposal_already_applied", message: "该学习建议已写入主体资料包。" };
  }
  if (proposal.status === PROPOSAL_STATUS.rejected) {
    return { ok: false, code: "proposal_rejected", message: "该学习建议已被拒绝。" };
  }
  const result = findResult(task, proposal.resultId);
  if (!result) {
    return { ok: false, code: "result_not_found", message: "关联成果不可读。" };
  }
  if (result.ownerDecision !== OWNER_DECISION.adopted) {
    return { ok: false, code: "result_not_adopted", message: "关联成果已不再处于采用状态。" };
  }
  if (!isResultCurrent(task, result)) {
    return { ok: false, code: "result_stale", message: "关联成果已过期。" };
  }
  if (Number(result.currentRevision) !== Number(proposal.resultRevision)) {
    return {
      ok: false,
      code: "result_revision_changed",
      message: "成果正文已更新，请基于当前成果重新总结学习建议。",
    };
  }
  const live = packageBaseRefFromDir(packageDir);
  const baseVer = String((proposal.packageBaseRef && proposal.packageBaseRef.version) || "");
  if (String(live.version) !== baseVer) {
    return {
      ok: false,
      code: "package_version_conflict",
      message: "主体资料包版本已变化，请重新生成预览。",
      currentVersion: live.version,
      baseVersion: baseVer,
    };
  }
  return { ok: true, result, packageBaseRef: live };
}

function acceptedCandidates(proposal) {
  return (Array.isArray(proposal.candidates) ? proposal.candidates : []).filter(
    (c) =>
      c &&
      (c.ownerState === OWNER_CANDIDATE_STATE.accepted ||
        c.ownerState === OWNER_CANDIDATE_STATE.edited)
  );
}

function projectFeedbackItems(proposal) {
  return acceptedCandidates(proposal).map((c) => ({
    category: c.targetKind,
    correction: String(c.ownerText || c.proposedText || "").trim(),
    userQuestion: String(
      (proposal.taskIntentRef && proposal.taskIntentRef.goal) || ""
    ).slice(0, 200),
    assistantExcerpt: truncate(c.rationale || "", 200),
    candidateId: c.candidateId,
  }));
}

function summarizeStorePreview(storePreview) {
  const sp = storePreview || {};
  const diffs = Array.isArray(sp.diffs) ? sp.diffs : [];
  const additions = diffs.filter((d) => d && (d.change === "created" || d.change === "add"));
  const updates = diffs.filter((d) => d && (d.change === "modified" || d.change === "update"));
  const skips = diffs.filter((d) => d && d.change === "unchanged");
  return {
    additions,
    updates,
    conflicts: Array.isArray(sp.conflicts) ? sp.conflicts : [],
    skips,
    warnings: Array.isArray(sp.warnings) ? sp.warnings : [],
    unchangedNote: "预览不会修改主体资料包；仅在确认应用后写入。",
    diffs,
    rawSafe: {
      affectedPaths: Array.isArray(sp.affectedPaths) ? sp.affectedPaths.slice(0, 20) : [],
      changeSetId: sp.changeSetId || null,
      baseRevision: sp.baseRevision,
    },
  };
}

async function createExperienceProposal(deps) {
  const {
    userData,
    taskId,
    resultId,
    store,
    callModel,
    packageDir,
    loadPackage,
    now,
    forceFake,
  } = deps || {};

  if (typeof callModel !== "function") {
    return { ok: false, code: "model_unavailable", message: "模型调用未接线。" };
  }
  if (!store || typeof store.getTask !== "function" || typeof store.saveTask !== "function") {
    return { ok: false, code: "store_unavailable", message: "任务存储不可用。" };
  }
  if (!packageDir) {
    return { ok: false, code: "package_unreadable", message: "缺少主体资料包路径。" };
  }

  const got = store.getTask(userData, taskId);
  if (!got || !got.ok) {
    return { ok: false, code: (got && got.code) || "task_not_found", message: (got && got.message) || "找不到任务。" };
  }
  let task = got.task;
  const healed = healAndReconcileProposals(task.proposals, packageDir);
  if (healed.changed) {
    const savedHeal = await store.saveTask(userData, { ...task, proposals: healed.proposals });
    task = savedHeal.task;
  }

  const pre = assertCreatePreconditions(task, resultId, packageDir);
  if (!pre.ok) return pre;

  const result = pre.result;
  const startedAt = (now && now()) || new Date().toISOString();
  const proposalId = newId("prop");

  const pkgRead = readPackageForProposal(packageDir, loadPackage);
  if (!pkgRead.ok) {
    const failed = {
      proposalId,
      taskId: task.taskId,
      resultId: result.resultId,
      resultRevision: Number(result.currentRevision) || 0,
      kind: PROPOSAL_KIND,
      status: PROPOSAL_STATUS.failed,
      stale: false,
      taskIntentRef: {
        goal: String((task.taskIntent && task.taskIntent.goal) || task.goal || ""),
        intentVersionOrDigest: String(
          (task.taskIntent && (task.taskIntent.updatedAt || task.taskIntent.version)) || ""
        ),
      },
      subjectContextRef: {
        version: String(
          (task.subjectContext &&
            (task.subjectContext.version || task.subjectContext.subjectVersion)) ||
            ""
        ),
      },
      resultRef: {
        resultId: result.resultId,
        revision: Number(result.currentRevision) || 0,
        ownerDecision: result.ownerDecision,
      },
      packageBaseRef: pre.packageBaseRef,
      candidates: [],
      modelInvocation: {
        providerSafeSummary: null,
        modelSafeSummary: null,
        startedAt,
        completedAt: startedAt,
        status: "failed",
        errorSafeSummary: pkgRead.errorSafeSummary || pkgRead.code || "package_unreadable",
        disclosedInputSummary: { modelCalls: 0, packageReadFailed: true },
      },
      preview: null,
      apply: null,
      currentRevision: 0,
      revisions: [],
      createdAt: startedAt,
      updatedAt: startedAt,
      rejectedMeta: [],
    };
    const prior = Array.isArray(task.proposals) ? task.proposals.slice() : [];
    const saved = await store.saveTask(userData, {
      ...task,
      proposals: prior.concat([failed]),
    });
    return {
      ok: false,
      code: "package_unreadable",
      message: pkgRead.message || "无法安全读取主体资料包，未调用模型。",
      task: saved.task,
      proposal: failed,
    };
  }

  const pkgSummary = boundedPackageSummary(pkgRead.pkg);
  const running = {
    proposalId,
    taskId: task.taskId,
    resultId: result.resultId,
    resultRevision: Number(result.currentRevision) || 0,
    kind: PROPOSAL_KIND,
    status: PROPOSAL_STATUS.generating,
    stale: false,
    taskIntentRef: {
      goal: String((task.taskIntent && task.taskIntent.goal) || task.goal || ""),
      intentVersionOrDigest: String(
        (task.taskIntent && (task.taskIntent.updatedAt || task.taskIntent.version)) || ""
      ),
    },
    subjectContextRef: {
      version: String(
        (task.subjectContext && (task.subjectContext.version || task.subjectContext.subjectVersion)) ||
          ""
      ),
    },
    resultRef: {
      resultId: result.resultId,
      revision: Number(result.currentRevision) || 0,
      ownerDecision: result.ownerDecision,
    },
    packageBaseRef: pre.packageBaseRef,
    candidates: [],
    modelInvocation: {
      providerSafeSummary: "pending",
      modelSafeSummary: null,
      startedAt,
      completedAt: null,
      status: "running",
      errorSafeSummary: null,
      disclosedInputSummary: null,
    },
    preview: null,
    apply: null,
    currentRevision: 0,
    revisions: [],
    createdAt: startedAt,
    updatedAt: startedAt,
    rejectedMeta: [],
  };

  const prior = Array.isArray(task.proposals) ? task.proposals.slice() : [];
  let runningTask = {
    ...task,
    proposals: prior.concat([running]),
  };
  const savedRunning = await store.saveTask(userData, runningTask);
  runningTask = savedRunning.task;

  const claims = confirmedClaimsFromContext(task.subjectContext);
  const messages = buildProposalMessages({
    intent: task.taskIntent || { goal: task.goal },
    claims,
    result,
    packageSummary: pkgSummary,
    allowedKinds: SUPPORTED_TARGET_KINDS.slice(),
  });

  // Bound audit: never store full package
  running.modelInvocation.disclosedInputSummary = {
    claimCount: claims.length,
    finalTextChars: resultFinalText(result).length,
    packageSummaryChars: pkgSummary.length,
    messageChars: messages.reduce((n, m) => n + String(m.content || "").length, 0),
    usedFake: !!forceFake,
  };

  let raw = "";
  let modelMeta = { provider: "unknown", model: null, usedFake: !!forceFake };
  try {
    const out = await callModel(messages, { temperature: 0.2, forceFake: !!forceFake });
    if (out && typeof out === "object" && out.content != null) {
      raw = String(out.content || "");
      modelMeta.provider = out.provider || modelMeta.provider;
      modelMeta.model = out.model || null;
      modelMeta.usedFake = !!out.usedFake || !!forceFake;
    } else {
      raw = String(out || "");
    }
    const parsed = extractJsonObject(raw);
    const mat = materializeCandidates(parsed, { claims, result });
    const completedAt = (now && now()) || new Date().toISOString();
    const latest = store.getTask(userData, task.taskId);
    const base = latest && latest.ok ? latest.task : runningTask;
    const proposals = Array.isArray(base.proposals) ? base.proposals.slice() : [];
    const idx = proposals.findIndex((p) => p && p.proposalId === proposalId);
    const draft = {
      ...(idx >= 0 ? proposals[idx] : running),
      status: PROPOSAL_STATUS.draft,
      candidates: mat.candidates,
      rejectedMeta: mat.rejectedMeta,
      modelInvocation: {
        providerSafeSummary: String(modelMeta.provider || "unknown").slice(0, 80),
        modelSafeSummary: modelMeta.model ? String(modelMeta.model).slice(0, 80) : null,
        startedAt,
        completedAt,
        status: "succeeded",
        errorSafeSummary: null,
        disclosedInputSummary: running.modelInvocation.disclosedInputSummary,
      },
      updatedAt: completedAt,
      currentRevision: 0,
    };
    if (idx >= 0) proposals[idx] = draft;
    else proposals.push(draft);
    const saved = await store.saveTask(userData, { ...base, proposals });
    return {
      ok: true,
      task: saved.task,
      proposal: draft,
      message:
        mat.candidates.length > 0
          ? "已生成学习建议，请审阅后预览变更。采用成果本身不会写入 Digital Me。"
          : "未能提取可用候选经验。可稍后重试，或确认成果中确有可回流内容。",
    };
  } catch (err) {
    const completedAt = (now && now()) || new Date().toISOString();
    const latest = store.getTask(userData, task.taskId);
    const base = latest && latest.ok ? latest.task : runningTask;
    const proposals = Array.isArray(base.proposals) ? base.proposals.slice() : [];
    const idx = proposals.findIndex((p) => p && p.proposalId === proposalId);
    const failed = {
      ...(idx >= 0 ? proposals[idx] : running),
      status: PROPOSAL_STATUS.failed,
      modelInvocation: {
        providerSafeSummary: String(modelMeta.provider || "unknown").slice(0, 80),
        modelSafeSummary: modelMeta.model ? String(modelMeta.model).slice(0, 80) : null,
        startedAt,
        completedAt,
        status: "failed",
        errorSafeSummary: safeErrorSummary(err),
        disclosedInputSummary: running.modelInvocation.disclosedInputSummary,
      },
      updatedAt: completedAt,
    };
    if (idx >= 0) proposals[idx] = failed;
    else proposals.push(failed);
    const saved = await store.saveTask(userData, { ...base, proposals });
    return {
      ok: false,
      code: "proposal_generation_failed",
      message: safeErrorSummary(err) || "无法生成学习建议。",
      task: saved.task,
      proposal: failed,
    };
  }
}

async function saveExperienceProposalReview(store, userData, payload) {
  const taskId = payload && payload.taskId;
  const proposalId = payload && payload.proposalId;
  const expectedRevision =
    payload && payload.expectedRevision != null ? Number(payload.expectedRevision) : null;
  const edits = Array.isArray(payload && payload.candidates) ? payload.candidates : [];

  if (!taskId || !proposalId) {
    return { ok: false, code: "invalid_payload", message: "缺少任务或提案标识。" };
  }
  if (expectedRevision == null || Number.isNaN(expectedRevision)) {
    return { ok: false, code: "revision_required", message: "缺少期望修订版本。" };
  }

  const got = store.getTask(userData, taskId);
  if (!got.ok) return got;
  const task = got.task;
  const proposals = Array.isArray(task.proposals) ? task.proposals.slice() : [];
  const idx = proposals.findIndex((p) => p && p.proposalId === String(proposalId));
  if (idx < 0) {
    return { ok: false, code: "proposal_not_found", message: "找不到学习建议。" };
  }
  const proposal = proposals[idx];
  if (proposal.stale) {
    return { ok: false, code: "proposal_stale", message: "历史学习建议不可再编辑。" };
  }
  if (
    proposal.status === PROPOSAL_STATUS.applied ||
    proposal.status === PROPOSAL_STATUS.rejected ||
    TRANSIENT_STATUSES.has(proposal.status)
  ) {
    return {
      ok: false,
      code: "proposal_not_editable",
      message: "当前状态不可保存审阅。",
    };
  }
  if (Number(proposal.currentRevision) !== Number(expectedRevision)) {
    return {
      ok: false,
      code: "stale_revision",
      message: "学习建议已被更新，请重新打开后再保存。",
      currentRevision: proposal.currentRevision,
    };
  }

  const byId = new Map(edits.map((e) => [String(e && e.candidateId), e]));
  const nextCandidates = (proposal.candidates || []).map((c) => {
    const e = byId.get(String(c.candidateId));
    if (!e) return c;
    let ownerState = String(e.ownerState || c.ownerState || OWNER_CANDIDATE_STATE.pending);
    if (!Object.values(OWNER_CANDIDATE_STATE).includes(ownerState)) {
      ownerState = c.ownerState;
    }
    let ownerText = c.ownerText;
    if (e.ownerText != null) {
      ownerText = truncate(String(e.ownerText), MAX_CANDIDATE_CHARS);
    }
    if (
      ownerState === OWNER_CANDIDATE_STATE.edited ||
      (ownerState === OWNER_CANDIDATE_STATE.accepted &&
        ownerText &&
        ownerText !== c.originalProposedText)
    ) {
      if (ownerText && ownerText !== c.originalProposedText) {
        ownerState = OWNER_CANDIDATE_STATE.edited;
      }
    }
    return {
      ...c,
      ownerState,
      ownerText: ownerText || c.proposedText,
      // Preserve authoritative fields
      originalProposedText: c.originalProposedText,
      basedOnSubjectClaimIds: c.basedOnSubjectClaimIds,
      basedOnExternalResultRefs: c.basedOnExternalResultRefs,
      basedOnResultSections: c.basedOnResultSections,
      targetKind: c.targetKind,
      rationale: c.rationale,
    };
  });

  const revEntry = {
    revision: Number(proposal.currentRevision) + 1,
    at: new Date().toISOString(),
    kind: "owner_review",
  };
  const updated = {
    ...proposal,
    candidates: nextCandidates,
    status: PROPOSAL_STATUS.reviewed,
    preview: null,
    currentRevision: revEntry.revision,
    revisions: (Array.isArray(proposal.revisions) ? proposal.revisions : [])
      .concat([revEntry])
      .slice(-MAX_REVISIONS),
    updatedAt: revEntry.at,
  };
  proposals[idx] = updated;
  const saved = await store.saveTask(userData, { ...task, proposals });
  return { ok: true, task: saved.task, proposal: updated, message: "审阅已保存。" };
}

async function previewExperienceProposal(deps) {
  const { userData, store, packageDir, payload } = deps || {};
  const taskId = payload && payload.taskId;
  const proposalId = payload && payload.proposalId;
  const expectedRevision =
    payload && payload.expectedRevision != null ? Number(payload.expectedRevision) : null;

  if (!taskId || !proposalId) {
    return { ok: false, code: "invalid_payload", message: "缺少任务或提案标识。" };
  }
  if (expectedRevision == null || Number.isNaN(expectedRevision)) {
    return { ok: false, code: "revision_required", message: "缺少期望修订版本。" };
  }
  if (
    payload &&
    (payload.ops || payload.changeSetId || payload.packageContent || payload.corrections)
  ) {
    return {
      ok: false,
      code: "untrusted_renderer_feedback",
      message: "不允许由界面构造反馈写入操作。",
    };
  }

  const got = store.getTask(userData, taskId);
  if (!got.ok) return got;
  let task = got.task;
  const healed = healAndReconcileProposals(task.proposals, packageDir);
  if (healed.changed) {
    const savedHeal = await store.saveTask(userData, { ...task, proposals: healed.proposals });
    task = savedHeal.task;
  }
  const proposals = Array.isArray(task.proposals) ? task.proposals.slice() : [];
  const idx = proposals.findIndex((p) => p && p.proposalId === String(proposalId));
  if (idx < 0) {
    return { ok: false, code: "proposal_not_found", message: "找不到学习建议。" };
  }
  let proposal = proposals[idx];
  if (Number(proposal.currentRevision) !== Number(expectedRevision)) {
    return {
      ok: false,
      code: "stale_revision",
      message: "学习建议已被更新，请重新打开后再预览。",
      currentRevision: proposal.currentRevision,
    };
  }

  const gate = isProposalApplicable(task, proposal, packageDir);
  if (!gate.ok) return gate;

  const items = projectFeedbackItems(proposal).filter((it) => it.correction);
  if (!items.length) {
    return {
      ok: false,
      code: "no_accepted_candidates",
      message: "请先采用至少一条候选经验后再生成变更预览。",
    };
  }
  for (const it of items) {
    if (!SUPPORTED_TARGET_KINDS.includes(it.category)) {
      return {
        ok: false,
        code: "unsupported_targetKind",
        message: "存在不受支持的候选类型，无法预览。",
      };
    }
  }

  const startedAt = new Date().toISOString();
  proposals[idx] = {
    ...proposal,
    status: PROPOSAL_STATUS.previewing,
    updatedAt: startedAt,
  };
  const savedStart = await store.saveTask(userData, { ...task, proposals });
  task = savedStart.task;

  try {
    const fb = feedback.previewFeedback(packageDir, { items });
    const completedAt = new Date().toISOString();
    const previewId = String(fb.changeSetId);
    const summarized = summarizeStorePreview(fb.storePreview);
    const latest = store.getTask(userData, taskId);
    const base = latest && latest.ok ? latest.task : task;
    const list = Array.isArray(base.proposals) ? base.proposals.slice() : [];
    const pidx = list.findIndex((p) => p && p.proposalId === String(proposalId));
    const preview = {
      previewId,
      changeSetId: previewId,
      requestedAt: startedAt,
      completedAt,
      status: "succeeded",
      packageBaseVersion: String(fb.baseRevision),
      acceptedCandidateIds: items.map((i) => i.candidateId),
      candidateFeedbackMap: items.map((i) => ({
        candidateId: i.candidateId,
        category: i.category,
      })),
      changes: summarized,
      warnings: summarized.warnings,
      conflicts: summarized.conflicts,
      errorSafeSummary: null,
      plans: Array.isArray(fb.plans)
        ? fb.plans.map((p) => ({
            category: p.category,
            targetFile: p.targetFile,
            summary: p.summary,
          }))
        : [{ category: fb.category, targetFile: fb.targetFile, summary: fb.summary }],
    };
    const updated = {
      ...(pidx >= 0 ? list[pidx] : proposal),
      status: PROPOSAL_STATUS.previewed,
      preview,
      updatedAt: completedAt,
    };
    if (pidx >= 0) list[pidx] = updated;
    const saved = await store.saveTask(userData, { ...base, proposals: list });
    return {
      ok: true,
      task: saved.task,
      proposal: updated,
      preview,
      message: "已生成对主体资料包的变更预览（尚未写入）。",
    };
  } catch (err) {
    const latest = store.getTask(userData, taskId);
    const base = latest && latest.ok ? latest.task : task;
    const list = Array.isArray(base.proposals) ? base.proposals.slice() : [];
    const pidx = list.findIndex((p) => p && p.proposalId === String(proposalId));
    const failedPrev = {
      ...(pidx >= 0 ? list[pidx] : proposal),
      status: PROPOSAL_STATUS.reviewed,
      preview: {
        previewId: null,
        requestedAt: startedAt,
        completedAt: new Date().toISOString(),
        status: "failed",
        errorSafeSummary: safeErrorSummary(err),
      },
      updatedAt: new Date().toISOString(),
    };
    if (pidx >= 0) list[pidx] = failedPrev;
    const saved = await store.saveTask(userData, { ...base, proposals: list });
    return {
      ok: false,
      code: (err && err.code) || "preview_failed",
      message: safeErrorSummary(err) || "无法生成变更预览。",
      task: saved.task,
      proposal: failedPrev,
    };
  }
}

async function applyExperienceProposal(deps) {
  const { userData, store, packageDir, payload } = deps || {};
  const taskId = payload && payload.taskId;
  const proposalId = payload && payload.proposalId;
  const previewId = payload && payload.previewId;
  const expectedRevision =
    payload && payload.expectedRevision != null ? Number(payload.expectedRevision) : null;
  const confirm = payload && (payload.confirm === true || payload.confirmed === true);

  if (!taskId || !proposalId || !previewId) {
    return { ok: false, code: "invalid_payload", message: "缺少任务、提案或预览标识。" };
  }
  if (expectedRevision == null || Number.isNaN(expectedRevision)) {
    return { ok: false, code: "revision_required", message: "缺少期望修订版本。" };
  }
  if (!confirm) {
    return {
      ok: false,
      code: "confirmation_required",
      message: "需要明确确认后才能写入主体资料包。",
    };
  }
  if (
    payload &&
    (payload.ops || payload.packageContent || payload.correction || payload.items || payload.memoryEntry)
  ) {
    return {
      ok: false,
      code: "untrusted_renderer_package",
      message: "不允许由界面提交资料包内容。",
    };
  }

  const got = store.getTask(userData, taskId);
  if (!got.ok) return got;
  let task = got.task;
  const healed = healAndReconcileProposals(task.proposals, packageDir);
  if (healed.changed) {
    const savedHeal = await store.saveTask(userData, { ...task, proposals: healed.proposals });
    task = savedHeal.task;
  }
  const proposals = Array.isArray(task.proposals) ? task.proposals.slice() : [];
  const idx = proposals.findIndex((p) => p && p.proposalId === String(proposalId));
  if (idx < 0) {
    return { ok: false, code: "proposal_not_found", message: "找不到学习建议。" };
  }
  let proposal = proposals[idx];
  if (Number(proposal.currentRevision) !== Number(expectedRevision)) {
    return {
      ok: false,
      code: "stale_revision",
      message: "学习建议已被更新，请重新打开后再应用。",
      currentRevision: proposal.currentRevision,
    };
  }
  if (proposal.status !== PROPOSAL_STATUS.previewed) {
    return {
      ok: false,
      code: "proposal_not_previewed",
      message: "请先生成变更预览，再确认写入。",
    };
  }
  if (!proposal.preview || String(proposal.preview.previewId) !== String(previewId)) {
    return {
      ok: false,
      code: "preview_mismatch",
      message: "预览标识不一致，请重新生成预览。",
    };
  }

  const gate = isProposalApplicable(task, proposal, packageDir);
  if (!gate.ok) return gate;

  const live = gate.packageBaseRef;
  if (String(proposal.preview.packageBaseVersion) !== String(live.version)) {
    return {
      ok: false,
      code: "package_version_conflict",
      message: "主体资料包版本已变化，旧预览已失效，请重新生成预览。",
      currentVersion: live.version,
      previewBaseVersion: proposal.preview.packageBaseVersion,
    };
  }

  const requestedAt = new Date().toISOString();
  const appliedCandidateIds = (proposal.preview.acceptedCandidateIds || []).slice();
  const pendingApply = {
    proposalId: String(proposalId),
    previewId: String(previewId),
    changeSetId: String(previewId),
    packageBaseVersion: String(live.version),
    appliedCandidateIds,
    requestedAt,
  };
  proposals[idx] = {
    ...proposal,
    status: PROPOSAL_STATUS.applying,
    pendingApply,
    apply: {
      requestedAt,
      completedAt: null,
      status: "pending",
      previewId: String(previewId),
      changeSetId: String(previewId),
      packageBaseVersion: String(live.version),
      packageResultVersion: null,
      appliedCandidateIds,
      errorSafeSummary: null,
    },
    updatedAt: requestedAt,
  };
  let savedStart;
  try {
    savedStart = await store.saveTask(userData, { ...task, proposals });
  } catch (err) {
    return {
      ok: false,
      code: "audit_write_failed",
      message: "无法在写入前保存待应用审计，已中止，未修改主体资料包。",
      errorSafeSummary: safeErrorSummary(err),
    };
  }
  task = savedStart.task;

  let applied;
  try {
    applied = feedback.applyFeedback(packageDir, {
      changeSetId: String(previewId),
      confirmed: true,
    });
  } catch (err) {
    const latest = store.getTask(userData, taskId);
    const base = latest && latest.ok ? latest.task : task;
    const list = Array.isArray(base.proposals) ? base.proposals.slice() : [];
    const pidx = list.findIndex((p) => p && p.proposalId === String(proposalId));
    const failed = {
      ...(pidx >= 0 ? list[pidx] : proposal),
      status: PROPOSAL_STATUS.previewed,
      pendingApply: null,
      apply: {
        requestedAt,
        completedAt: new Date().toISOString(),
        status: "failed",
        previewId: String(previewId),
        changeSetId: String(previewId),
        packageBaseVersion: String(live.version),
        packageResultVersion: null,
        appliedCandidateIds: [],
        errorSafeSummary: safeErrorSummary(err),
      },
      updatedAt: new Date().toISOString(),
    };
    if (pidx >= 0) list[pidx] = failed;
    const saved = await store.saveTask(userData, { ...base, proposals: list });
    return {
      ok: false,
      code: (err && err.code) || "apply_failed",
      message: safeErrorSummary(err) || "写入主体资料包失败。",
      task: saved.task,
      proposal: failed,
    };
  }

  const completedAt = new Date().toISOString();
  const applyRecord = {
    requestedAt,
    completedAt,
    status: "succeeded",
    previewId: String(previewId),
    changeSetId: String(previewId),
    packageBaseVersion: String(live.version),
    packageResultVersion: String(applied.revision),
    rollbackVersion: applied.rollbackVersion != null ? String(applied.rollbackVersion) : null,
    rootSha256: applied.rootSha256 || null,
    appliedCandidateIds,
    affectedPaths: Array.isArray(applied.affectedPaths) ? applied.affectedPaths.slice() : [],
    errorSafeSummary: null,
  };

  const latest = store.getTask(userData, taskId);
  const base = latest && latest.ok ? latest.task : task;
  const list = Array.isArray(base.proposals) ? base.proposals.slice() : [];
  const pidx = list.findIndex((p) => p && p.proposalId === String(proposalId));
  const updated = {
    ...(pidx >= 0 ? list[pidx] : proposal),
    status: PROPOSAL_STATUS.applied,
    pendingApply,
    apply: applyRecord,
    updatedAt: completedAt,
  };
  if (pidx >= 0) list[pidx] = updated;

  let saved;
  try {
    saved = await store.saveTask(userData, {
      ...base,
      proposals: list,
      results: base.results,
      invocations: base.invocations,
    });
  } catch (err) {
    // Package committed; disk proposal still applying + pendingApply — recoverable via changeSet.
    return {
      ok: false,
      code: "audit_write_failed",
      message:
        "主体资料包已写入，但任务审计未能保存。系统可按 changeSet 恢复为已应用，请重新打开任务。",
      packageResultVersion: String(applied.revision),
      changeSetId: String(previewId),
      previewId: String(previewId),
      rollbackVersion: applied.rollbackVersion,
      appliedCandidateIds,
      errorSafeSummary: safeErrorSummary(err),
      recoverable: true,
    };
  }

  return {
    ok: true,
    task: saved.task,
    proposal: updated,
    apply: applyRecord,
    message: "已将确认的学习内容写入主体资料包（新版本已生成）。",
  };
}

async function rejectExperienceProposal(store, userData, payload) {
  const taskId = payload && payload.taskId;
  const proposalId = payload && payload.proposalId;
  const expectedRevision =
    payload && payload.expectedRevision != null ? Number(payload.expectedRevision) : null;
  if (!taskId || !proposalId) {
    return { ok: false, code: "invalid_payload", message: "缺少任务或提案标识。" };
  }
  if (expectedRevision == null || Number.isNaN(expectedRevision)) {
    return { ok: false, code: "revision_required", message: "缺少期望修订版本。" };
  }
  const got = store.getTask(userData, taskId);
  if (!got.ok) return got;
  const task = got.task;
  const proposals = Array.isArray(task.proposals) ? task.proposals.slice() : [];
  const idx = proposals.findIndex((p) => p && p.proposalId === String(proposalId));
  if (idx < 0) {
    return { ok: false, code: "proposal_not_found", message: "找不到学习建议。" };
  }
  const proposal = proposals[idx];
  if (proposal.status === PROPOSAL_STATUS.applied) {
    return { ok: false, code: "proposal_already_applied", message: "已写入的提案不能拒绝撤销写入。" };
  }
  if (Number(proposal.currentRevision) !== Number(expectedRevision)) {
    return {
      ok: false,
      code: "stale_revision",
      message: "学习建议已被更新，请重新打开后再拒绝。",
      currentRevision: proposal.currentRevision,
    };
  }
  const updated = {
    ...proposal,
    status: PROPOSAL_STATUS.rejected,
    updatedAt: new Date().toISOString(),
  };
  proposals[idx] = updated;
  const saved = await store.saveTask(userData, { ...task, proposals });
  return { ok: true, task: saved.task, proposal: updated, message: "已拒绝本学习建议（未修改主体资料包）。" };
}

module.exports = {
  PROPOSAL_KIND,
  PROPOSAL_STATUS,
  OWNER_CANDIDATE_STATE,
  SUPPORTED_TARGET_KINDS,
  MAX_CANDIDATES,
  packageBaseRefFromDir,
  boundedPackageSummary,
  healRunningProposals,
  reconcileApplyingProposals,
  healAndReconcileProposals,
  inspectChangeSetCommit,
  readPackageForProposal,
  markProposalsStale,
  invalidateOpenProposalsForResult,
  assertCreatePreconditions,
  buildProposalMessages,
  materializeCandidates,
  isProposalApplicable,
  projectFeedbackItems,
  createExperienceProposal,
  saveExperienceProposalReview,
  previewExperienceProposal,
  applyExperienceProposal,
  rejectExperienceProposal,
};

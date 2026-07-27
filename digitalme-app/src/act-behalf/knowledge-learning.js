"use strict";

/**
 * LEARN-LOOP-FIX-02 / 02.1: learning cycle — candidate formation, auto-adoption, confirmation, supersession.
 */

const projectStore = require("./project-knowledge-store");
const { detectProjectScope } = require("./project-detection");
const { newClaimId, nowIso, PROJECT_IDS } = require("./project-knowledge-schema");
const {
  evaluateLearningAdoption,
  detectPrincipleConflict,
  detectUserCorrectionIntent,
  classifyRisk,
} = require("./learning-adoption-policy");

const PRINCIPLE_PATTERNS = [
  /默认.{0,20}界面.{0,40}(?:只显示|仅显示|只展示)/,
  /界面设计.{0,30}原则/,
  /产品原则/,
  /工作原则/,
  /必须按需展开/,
  /其余.{0,10}按需展开/,
  /默认展示所有/i,
];

const ACTIVE_LEARN_STATUSES = new Set([
  "owner_confirmed",
  "auto_adopted",
  "reinforced",
  "accepted",
  "frozen",
]);

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCandidatesFromUserInput(text, opts) {
  const input = normalizeText(text);
  if (!input || input.length < 12) return [];

  const correction = detectUserCorrectionIntent(input);
  if (correction && correction.action === "reject" && !PRINCIPLE_PATTERNS.some((re) => re.test(input))) {
    return [];
  }

  const detected = detectProjectScope({
    query: input,
    projectHint: opts && opts.projectHint,
    boundProjectId: opts && opts.boundProjectId,
    conversationProjectId: opts && opts.conversationProjectId,
  });

  let projectId =
    (opts && opts.projectId) ||
    detected.projectId ||
    (opts && opts.boundProjectId) ||
    null;
  if (!projectId && /按需展开|界面|工作界面|产品原则/.test(input) && opts && opts.boundProjectId) {
    projectId = opts.boundProjectId;
  }
  if (!projectId) return [];

  const sentences = input
    .split(/[。！？\n；;]+/)
    .map((s) => normalizeText(s))
    .filter((s) => s.length >= 12);

  const existingClaims =
    opts && opts.packageDir
      ? projectStore.getClaimsForProject(opts.packageDir, projectId)
      : [];

  const candidates = [];
  for (const sentence of sentences) {
    const looksPrinciple =
      PRINCIPLE_PATTERNS.some((re) => re.test(sentence)) ||
      /原则|应当|必须|默认/.test(sentence);
    if (!looksPrinciple) continue;

    const risk = classifyRisk(sentence);
    const conflicts = detectPrincipleConflict(sentence, existingClaims);
    const sourceRef = (opts && opts.sourceRef) || "direct_user_statement";
    const adoption = evaluateLearningAdoption({
      candidate: {
        claimText: sentence,
        projectId,
        confidence: detected.confidence === "high" ? "high" : "medium",
      },
      source: sourceRef,
      conflicts,
      riskLevel: risk,
      confidence: detected.confidence === "high" ? "high" : "medium",
    });

    candidates.push({
      candidateId: "kcand_" + newClaimId().slice(6),
      claimText: sentence,
      claimType: risk === "high" ? "confirmed_decision" : "work_principle",
      scope: "digital_me_project",
      projectId,
      sourceRef,
      source: "direct_user_statement",
      confidence: detected.confidence === "high" ? "high" : "medium",
      conflictRefs: conflicts,
      riskLevel: risk,
      adoption,
      proposedAction: adoption.decision,
      confirmationPrompt:
        conflicts.length > 0
          ? "这与当前已确认原则不同，以哪项为准？"
          : projectId === PROJECT_IDS.DIGITAL_ME
            ? "是否将这条作为 Digital Me 项目的当前产品原则？"
            : "是否记住这条项目原则？",
    });
  }
  return candidates;
}

function findSupersededTarget(packageDir, projectId, claimText) {
  const claims = projectStore.getClaimsForProject(packageDir, projectId);
  const compact = normalizeText(claimText);
  const isPrinciple = /原则|界面|按需展开|工作界面|产品原则/.test(compact);
  for (const c of claims) {
    if (!c || c.supersededBy) continue;
    if (c.confirmationStatus === "rejected") continue;
    if (isPrinciple && c.claimType !== "work_principle") continue;
    const existing = normalizeText(c.claimText);
    const shared =
      existing.slice(0, 20) === compact.slice(0, 20) ||
      (isPrinciple &&
        /界面|按需展开|工作界面|产品原则/.test(existing) &&
        /界面|按需展开|工作界面|产品原则/.test(compact));
    if (shared) return c;
  }
  return null;
}

function buildClaimFromCandidate(candidate, opts) {
  const mode = (opts && opts.mode) || "auto_adopted";
  const now = nowIso();
  const projectId = candidate.projectId || PROJECT_IDS.DIGITAL_ME;
  const claimId = newClaimId();

  let confirmationStatus = "candidate";
  let authorityLevel = "current_project_record";
  let learnCategory = "learning_candidate";

  if (mode === "owner_confirmed") {
    confirmationStatus = "owner_confirmed";
    authorityLevel = "owner_confirmed";
    learnCategory = "owner_chat_confirmed";
  } else if (mode === "auto_adopted") {
    confirmationStatus = "auto_adopted";
    authorityLevel = "current_project_record";
    learnCategory = "auto_adopted_direct_statement";
  } else if (mode === "reinforced") {
    confirmationStatus = "reinforced";
    authorityLevel = "current_project_record";
    learnCategory = "reinforced_usage";
  }

  return {
    claimId,
    projectId,
    claimText: candidate.claimText,
    claimType:
      candidate.claimType ||
      (candidate.riskLevel === "high" ? "confirmed_decision" : "work_principle"),
    sourceRefs: [candidate.sourceRef || candidate.source || "direct_user_statement"],
    authorityLevel,
    confirmationStatus,
    effectiveFrom: now,
    observationTime: now,
    supersededBy: null,
    supersedes: [],
    contradictedBy: null,
    scope: candidate.scope || "digital_me_project",
    freshness: now,
    confidence: candidate.confidence || "high",
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
    learnCategory,
    candidateId: candidate.candidateId || null,
    adoptionDecision: candidate.adoption || null,
    usageCount: 0,
    successfulUsageCount: 0,
    correctionCount: 0,
    lastUsedAt: null,
    lastValidatedAt: null,
  };
}

function adoptCandidate(packageDir, candidate, opts) {
  if (!packageDir || !candidate) return { ok: false, code: "invalid_input" };
  const mode = (opts && opts.mode) || "auto_adopted";
  if (mode === "session_only" || mode === "dismiss" || mode === "reject") {
    return { ok: true, mode, committed: false };
  }

  projectStore.ensureDigitalMeProjectKnowledge(packageDir);
  const projectId = candidate.projectId || PROJECT_IDS.DIGITAL_ME;
  const claim = buildClaimFromCandidate(candidate, { mode });
  const now = nowIso();

  const supersedeTarget = findSupersededTarget(packageDir, projectId, candidate.claimText);
  if (supersedeTarget) {
    projectStore.supersedeClaim(packageDir, supersedeTarget.claimId, claim.claimId, {
      reason: mode === "auto_adopted" ? "auto_correction" : "owner_correction",
      sourceRef: candidate.sourceRef || "direct_user_statement",
    });
    claim.supersedes = [supersedeTarget.claimId];
  }

  claim.updatedAt = now;
  projectStore.upsertClaim(packageDir, claim);
  return {
    ok: true,
    committed: true,
    mode,
    claimId: claim.claimId,
    supersededClaimId: supersedeTarget ? supersedeTarget.claimId : null,
    claim,
  };
}

function confirmCandidate(packageDir, candidate, opts) {
  return adoptCandidate(packageDir, candidate, { ...(opts || {}), mode: "owner_confirmed" });
}

function claimExistsInStore(packageDir, claimText) {
  const needle = normalizeText(claimText);
  if (!needle) return false;
  const claims = projectStore.getClaimsForProject(packageDir, PROJECT_IDS.DIGITAL_ME);
  return claims.some(
    (c) =>
      c &&
      !c.supersededBy &&
      c.confirmationStatus !== "rejected" &&
      normalizeText(c.claimText) === needle
  );
}

function findRelatedPrincipleClaims(packageDir, projectId) {
  return projectStore
    .getClaimsForProject(packageDir, projectId)
    .filter(
      (c) =>
        c &&
        !c.supersededBy &&
        c.confirmationStatus !== "rejected" &&
        (c.claimType === "work_principle" || /界面|按需展开|原则/.test(c.claimText || ""))
    );
}

function processUserCorrection(packageDir, text, opts) {
  const intent = detectUserCorrectionIntent(text);
  if (!intent) return { ok: true, handled: false };

  const projectId = (opts && opts.projectId) || PROJECT_IDS.DIGITAL_ME;
  const related = findRelatedPrincipleClaims(packageDir, projectId);
  const results = [];

  if (intent.action === "reject" || intent.action === "supersede") {
    for (const c of related.slice(-1)) {
      projectStore.revokeClaim(packageDir, c.claimId, { reason: intent.action });
      results.push({ claimId: c.claimId, action: "rejected" });
    }
    return {
      ok: true,
      handled: true,
      intent,
      results,
      notice: { type: "revoked", message: "已撤销相关原则，后续任务不再使用。" },
    };
  }

  if (intent.action === "session_only") {
    return {
      ok: true,
      handled: true,
      intent,
      notice: { type: "session_only", message: "本次对话会参考这条，但不会写入长期知识。" },
    };
  }

  return { ok: true, handled: false, intent };
}

/**
 * Process user input: corrections, auto-adopt, or queue confirmation.
 */
function processUserInputLearning(packageDir, text, opts) {
  const out = {
    adopted: [],
    pendingConfirmation: [],
    notices: [],
    corrections: [],
  };
  if (!packageDir || !text) return out;

  const correction = processUserCorrection(packageDir, text, opts);
  if (correction.handled) {
    out.corrections.push(correction);
    if (correction.notice) out.notices.push(correction.notice);
    if (correction.intent && correction.intent.action === "reject") return out;
  }

  const candidates = extractCandidatesFromUserInput(text, {
    ...(opts || {}),
    packageDir,
  }).filter((c) => !claimExistsInStore(packageDir, c.claimText));

  for (const candidate of candidates) {
    const adoption =
      candidate.adoption ||
      evaluateLearningAdoption({
        candidate,
        source: candidate.sourceRef,
        conflicts: candidate.conflictRefs,
        riskLevel: candidate.riskLevel,
        confidence: candidate.confidence,
      });

    if (adoption.decision === "auto_adopt") {
      const result = adoptCandidate(packageDir, { ...candidate, adoption }, { mode: "auto_adopted" });
      if (result.committed) {
        out.adopted.push(result);
        const isUpdate = !!result.supersededClaimId;
        out.notices.push({
          type: isUpdate ? "updated" : "adopted",
          message: isUpdate ? "已更新这项原则。" : "已记住这项原则。",
          claimId: result.claimId,
          claimText: candidate.claimText,
          status: "auto_adopted",
        });
      }
    } else if (adoption.decision === "ask_confirmation") {
      out.pendingConfirmation.push({ candidate, adoption });
    }
  }

  return out;
}

function recordClaimUsage(packageDir, claimId, opts) {
  if (!packageDir || !claimId) return { ok: false };
  const store = projectStore.loadStore(packageDir);
  const claim = store.claims[claimId];
  if (!claim || claim.supersededBy || claim.confirmationStatus === "rejected") {
    return { ok: false, code: "claim_inactive" };
  }

  const now = nowIso();
  claim.usageCount = (claim.usageCount || 0) + 1;
  if (opts && opts.successful !== false) {
    claim.successfulUsageCount = (claim.successfulUsageCount || 0) + 1;
  }
  claim.lastUsedAt = now;
  claim.lastValidatedAt = now;
  claim.updatedAt = now;

  if (
    claim.confirmationStatus === "auto_adopted" &&
    claim.successfulUsageCount >= 3 &&
    claim.correctionCount === 0
  ) {
    claim.confirmationStatus = "reinforced";
    claim.learnCategory = "reinforced_usage";
  }

  projectStore.upsertClaim(packageDir, claim);
  return { ok: true, claim };
}

module.exports = {
  extractCandidatesFromUserInput,
  classifyRisk,
  adoptCandidate,
  confirmCandidate,
  findSupersededTarget,
  claimExistsInStore,
  processUserInputLearning,
  processUserCorrection,
  recordClaimUsage,
  ACTIVE_LEARN_STATUSES,
};

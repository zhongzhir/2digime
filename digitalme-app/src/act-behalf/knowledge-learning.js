"use strict";

/**
 * LEARN-LOOP-FIX-02: minimal learning cycle — candidate formation, risk grading, confirmation, supersession.
 */

const projectStore = require("./project-knowledge-store");
const { detectProjectScope } = require("./project-detection");
const { newClaimId, nowIso, PROJECT_IDS } = require("./project-knowledge-schema");

const PRINCIPLE_PATTERNS = [
  /默认.{0,20}界面.{0,40}(?:只显示|仅显示|只展示)/,
  /界面设计.{0,30}原则/,
  /产品原则/,
  /工作原则/,
  /必须按需展开/,
  /其余.{0,10}按需展开/,
];

const HIGH_IMPACT_RE =
  /项目方向|身份|价值观|授权边界|对外承诺|不得代表|隐私|敏感|融资|代币|区块链主/;

const LOW_RISK_RE =
  /表达偏好|文风|语气|篇幅|界面.{0,20}原则|工作界面|按需展开|极简/;

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCandidatesFromUserInput(text, opts) {
  const input = normalizeText(text);
  if (!input || input.length < 12) return [];

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
  if (!projectId && /按需展开|界面|工作界面|产品原则/.test(input) && (opts && opts.boundProjectId)) {
    projectId = opts.boundProjectId;
  }
  if (!projectId) return [];

  const sentences = input
    .split(/[。！？\n；;]+/)
    .map((s) => normalizeText(s))
    .filter((s) => s.length >= 12);

  const candidates = [];
  for (const sentence of sentences) {
    const looksPrinciple =
      PRINCIPLE_PATTERNS.some((re) => re.test(sentence)) ||
      /原则|应当|必须|默认/.test(sentence);
    if (!looksPrinciple) continue;

    const risk = classifyRisk(sentence);
    candidates.push({
      candidateId: "kcand_" + newClaimId().slice(6),
      claimText: sentence,
      claimType: risk === "high" ? "confirmed_decision" : "work_principle",
      scope: "digital_me_project",
      projectId,
      sourceRef: opts && opts.sourceRef ? opts.sourceRef : "owner_chat_input",
      confidence: detected.confidence === "high" ? "high" : "medium",
      conflictRefs: [],
      proposedAction: risk === "high" ? "owner_confirm_required" : "suggest_confirm",
      riskLevel: risk,
      confirmationPrompt:
        projectId === PROJECT_IDS.DIGITAL_ME
          ? "是否将这条作为 Digital Me 项目的当前产品原则？"
          : "是否记住这条项目原则？",
    });
  }
  return candidates;
}

function classifyRisk(text) {
  if (HIGH_IMPACT_RE.test(text)) return "high";
  if (LOW_RISK_RE.test(text)) return "low";
  if (/原则|界面|默认/.test(text)) return "low";
  return "medium";
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

function confirmCandidate(packageDir, candidate, opts) {
  if (!packageDir || !candidate) return { ok: false, code: "invalid_input" };
  const mode = (opts && opts.mode) || "owner_confirmed";
  if (mode === "session_only" || mode === "dismiss") {
    return { ok: true, mode, committed: false };
  }

  projectStore.ensureDigitalMeProjectKnowledge(packageDir);
  const projectId = candidate.projectId || PROJECT_IDS.DIGITAL_ME;
  const claimId = newClaimId();
  const now = nowIso();

  const supersedeTarget = findSupersededTarget(packageDir, projectId, candidate.claimText);
  if (supersedeTarget) {
    projectStore.supersedeClaim(packageDir, supersedeTarget.claimId, claimId, {
      reason: "owner_correction",
      sourceRef: candidate.sourceRef || "owner_chat_confirm",
    });
  }

  const claim = {
    claimId,
    projectId,
    claimText: candidate.claimText,
    claimType:
      candidate.claimType ||
      (candidate.riskLevel === "high" ? "confirmed_decision" : "work_principle"),
    sourceRefs: [candidate.sourceRef || "owner_chat_confirm"],
    authorityLevel: mode === "owner_confirmed" ? "owner_confirmed" : "current_project_record",
    confirmationStatus: mode === "owner_confirmed" ? "owner_confirmed" : "candidate",
    effectiveFrom: now,
    observationTime: now,
    supersededBy: null,
    supersedes: supersedeTarget ? [supersedeTarget.claimId] : [],
    contradictedBy: null,
    scope: candidate.scope || "digital_me_project",
    freshness: now,
    confidence: candidate.confidence || "high",
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
    learnCategory: "owner_chat_confirmed",
    candidateId: candidate.candidateId || null,
  };

  projectStore.upsertClaim(packageDir, claim);
  return {
    ok: true,
    committed: true,
    claimId,
    supersededClaimId: supersedeTarget ? supersedeTarget.claimId : null,
    claim,
  };
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

module.exports = {
  extractCandidatesFromUserInput,
  classifyRisk,
  confirmCandidate,
  findSupersededTarget,
  claimExistsInStore,
};

"use strict";

/**
 * LEARN-LOOP-FIX-02.1: unified learning adoption policy.
 * Main / knowledge layer is authoritative — renderer must not decide.
 */

const HIGH_IMPACT_RE =
  /项目方向|价值观|授权边界|对外承诺|不得代表|隐私|敏感|融资|代币|区块链.*交易|自动代表.*发布|无需确认.*付款/;

const LOW_RISK_RE =
  /表达偏好|文风|语气|篇幅|界面.{0,20}原则|工作界面|按需展开|极简|只显示|仅显示/;

function classifyRisk(text) {
  if (HIGH_IMPACT_RE.test(text)) return "high";
  if (LOW_RISK_RE.test(text)) return "low";
  if (/原则|界面|默认/.test(text)) return "low";
  return "medium";
}

const MUST_CONFIRM_PATTERNS = Object.freeze([
  { re: /区块链.*交易|交易平台|改为区块链/i, reason: "strategic_direction_change" },
  { re: /自动代表.*发布|无需确认.*发布|自动发布内容/i, reason: "authorization_boundary" },
  { re: /无需确认.*付款|自动付款|自动签约/i, reason: "external_commitment" },
  { re: /(?:改变|调整).*(?:身份|人格|价值观)/i, reason: "identity_value_change" },
  { re: /授权边界|对外承诺|签约|付款结算/i, reason: "high_impact_authorization" },
  { re: /展示所有.*(?:身份|授权|来源|审计)|默认展示所有.*细节/i, reason: "conflicts_minimal_principle" },
]);

const DIRECT_USER_SOURCES = new Set([
  "direct_user_statement",
  "owner_chat_input",
  "user_correction",
  "accepted_deliverable",
]);

const CORRECTION_PATTERNS = Object.freeze([
  { re: /不要记住|以后不要这样|不要记|不记录|不要记成/i, action: "reject" },
  { re: /不是这个意思|应该改成|改成/i, action: "correct" },
  { re: /这只适用于本次|仅本次使用|只要这一次/i, action: "session_only" },
  { re: /这条过时了|已经过时/i, action: "supersede" },
]);

function normalizeSource(source) {
  const s = String(source || "");
  if (s.startsWith("owner_chat_input")) return "direct_user_statement";
  if (s.startsWith("owner_chat_confirm")) return "owner_confirmed_input";
  return s;
}

function isDirectUserSource(source) {
  const norm = normalizeSource(source);
  return DIRECT_USER_SOURCES.has(norm) || norm.startsWith("owner_chat_input");
}

function detectPrincipleConflict(candidateText, existingClaims) {
  const conflicts = [];
  const text = String(candidateText || "");
  const wantsVerbose = /展示所有|全部展示|默认展示所有|完整展示|所有.{0,8}细节|身份.*授权.*来源.*审计/i.test(
    text
  );
  const wantsMinimal = /只显示|仅显示|按需展开|极简|最少信息|必需的信息/i.test(text);

  for (const c of existingClaims || []) {
    if (!c || c.supersededBy || c.confirmationStatus === "rejected") continue;
    if (c.claimType !== "work_principle" && c.claimType !== "confirmed_decision") continue;
    const existing = String(c.claimText || "");
    const existingMinimal = /只显示|仅显示|按需展开|极简|最少信息|必需的信息/i.test(existing);
    const existingVerbose = /展示所有|全部展示|默认展示所有|完整展示/i.test(existing);

    if (wantsVerbose && existingMinimal) {
      conflicts.push({
        claimId: c.claimId,
        claimText: existing,
        reason: "principle_conflict_verbose_vs_minimal",
      });
    }
    if (wantsMinimal && existingVerbose) {
      conflicts.push({
        claimId: c.claimId,
        claimText: existing,
        reason: "principle_conflict_minimal_vs_verbose",
      });
    }
  }
  return conflicts;
}

/**
 * @param {object} opts
 * @param {object} opts.candidate
 * @param {string} [opts.source]
 * @param {object} [opts.scope]
 * @param {object[]} [opts.conflicts]
 * @param {string} [opts.authority]
 * @param {string} [opts.confidence]
 * @param {string} [opts.riskLevel]
 */
function evaluateLearningAdoption(opts) {
  const candidate = (opts && opts.candidate) || {};
  const text = String(candidate.claimText || "");
  const source = normalizeSource((opts && opts.source) || candidate.sourceRef || "");
  const conflicts = (opts && opts.conflicts) || candidate.conflictRefs || [];
  const confidence = (opts && opts.confidence) || candidate.confidence || "medium";
  const riskLevel = (opts && opts.riskLevel) || classifyRisk(text);
  const reasons = [];

  for (const pat of MUST_CONFIRM_PATTERNS) {
    if (pat.re.test(text)) {
      reasons.push(pat.reason);
      return {
        decision: "ask_confirmation",
        reasons,
        confidence,
        riskLevel: "high",
        conflicts,
      };
    }
  }

  if (Array.isArray(conflicts) && conflicts.length > 0) {
    reasons.push("conflict_with_existing_authority");
    return {
      decision: "ask_confirmation",
      reasons,
      confidence,
      riskLevel,
      conflicts,
    };
  }

  if (!candidate.projectId) {
    reasons.push("scope_unresolved");
    return { decision: "ask_confirmation", reasons, confidence, riskLevel: "medium", conflicts: [] };
  }

  if (confidence === "low") {
    reasons.push("low_confidence");
    return { decision: "ask_confirmation", reasons, confidence, riskLevel, conflicts: [] };
  }

  if (riskLevel === "high") {
    reasons.push("high_impact_content");
    return { decision: "ask_confirmation", reasons, confidence, riskLevel, conflicts: [] };
  }

  if (riskLevel === "medium" && !isDirectUserSource(source)) {
    reasons.push("medium_risk_indirect_source");
    return { decision: "ask_confirmation", reasons, confidence, riskLevel, conflicts: [] };
  }

  if (isDirectUserSource(source) && (riskLevel === "low" || riskLevel === "medium")) {
    reasons.push("low_risk_direct_user_statement");
    return { decision: "auto_adopt", reasons, confidence, riskLevel, conflicts: [] };
  }

  reasons.push("default_requires_confirmation");
  return { decision: "ask_confirmation", reasons, confidence, riskLevel, conflicts: [] };
}

function detectUserCorrectionIntent(text) {
  const input = String(text || "").trim();
  if (!input) return null;
  for (const pat of CORRECTION_PATTERNS) {
    if (pat.re.test(input)) {
      return { action: pat.action, matched: pat.re.source };
    }
  }
  return null;
}

function confirmationStatusLabel(status) {
  switch (String(status || "")) {
    case "owner_confirmed":
      return "你已明确确认";
    case "reinforced":
      return "多次使用后已稳定";
    case "auto_adopted":
      return "系统已记住";
    case "superseded":
      return "已被新版本替代";
    case "rejected":
      return "你已撤销";
    case "candidate":
      return "待确认";
    default:
      return "参考";
  }
}

module.exports = {
  evaluateLearningAdoption,
  detectPrincipleConflict,
  detectUserCorrectionIntent,
  confirmationStatusLabel,
  isDirectUserSource,
  classifyRisk,
  MUST_CONFIRM_PATTERNS,
};

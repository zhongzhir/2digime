"use strict";

/**
 * LEARN-LOOP-FIX-01: authority-priority project knowledge retrieval for generation.
 */

const { AUTHORITY_RANK } = require("./project-knowledge-schema");

const DEFAULT_EXCLUDE_TYPES = new Set([
  "historical_exploration",
  "rejected_direction",
  "future_direction",
]);

const HISTORICAL_MEMORY_IDS = new Set(["core_006", "core_008", "core_009", "core_010", "core_011", "core_012"]);

function rankClaim(claim) {
  const auth = AUTHORITY_RANK[claim.authorityLevel] || 0;
  let score = auth * 10;
  const type = String(claim.claimType || "");
  if (type === "current_fact" || type === "confirmed_decision") score += 50;
  else if (type === "work_principle") score += 48;
  else if (type === "current_status") score += 40;
  else if (type === "proposal") score += 10;
  else if (type === "historical_exploration") score -= 80;
  else if (type === "rejected_direction") score -= 100;

  if (claim.confirmationStatus === "owner_confirmed" || claim.confirmationStatus === "frozen") {
    score += 30;
  } else if (claim.confirmationStatus === "superseded" || claim.confirmationStatus === "rejected") {
    score -= 60;
  } else if (claim.confirmationStatus === "pending_conflict") {
    score -= 40;
  }

  if (claim.supersededBy) score -= 50;
  return score;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^\u4e00-\u9fff\w]+/)
    .filter((t) => t.length >= 2);
}

function relevanceScore(claim, queryTokens) {
  const hay = new Set(tokenize(claim.claimText));
  let overlap = 0;
  for (const t of queryTokens) {
    if (hay.has(t)) overlap += 1;
  }
  return overlap;
}

/**
 * @param {object} opts
 * @param {object[]} opts.claims
 * @param {string} opts.query
 * @param {string} [opts.projectId]
 * @param {boolean} [opts.includeHistorical]
 * @param {number} [opts.topK]
 */
function retrieveProjectClaims(opts) {
  const claims = Array.isArray(opts.claims) ? opts.claims : [];
  const queryTokens = tokenize(opts.query);
  const includeHistorical = !!opts.includeHistorical;
  const topK = Number(opts.topK) > 0 ? Number(opts.topK) : 16;
  const projectId = opts.projectId || null;

  const excluded = [];
  const scored = [];

  for (const claim of claims) {
    if (!claim || !claim.claimText) continue;
    if (projectId && claim.projectId && claim.projectId !== projectId) {
      excluded.push({ claimId: claim.claimId, reason: "wrong_project_scope" });
      continue;
    }
    if (claim.supersededBy) {
      excluded.push({ claimId: claim.claimId, reason: "superseded" });
      continue;
    }
    if (claim.confirmationStatus === "rejected" || claim.confirmationStatus === "pending_conflict") {
      excluded.push({ claimId: claim.claimId, reason: claim.confirmationStatus });
      continue;
    }
    const type = String(claim.claimType || "");
    if (!includeHistorical && DEFAULT_EXCLUDE_TYPES.has(type)) {
      excluded.push({ claimId: claim.claimId, reason: "historical_excluded_by_default" });
      continue;
    }
    if (claim.authorityLevel === "model_generated" && claim.confirmationStatus !== "owner_confirmed") {
      excluded.push({ claimId: claim.claimId, reason: "unconfirmed_model_generated" });
      continue;
    }

    const base = rankClaim(claim);
    const rel = relevanceScore(claim, queryTokens);
    const total = base + rel * 5;
    scored.push({ claim, score: total, base, relevance: rel });
  }

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, topK);

  return {
    claims: selected.map((s) => s.claim),
    retrievedClaimIds: selected.map((s) => s.claim.claimId),
    excludedClaims: excluded,
    authoritySummary: {
      topAuthority: selected[0] ? selected[0].claim.authorityLevel : null,
      count: selected.length,
    },
  };
}

function renderProjectClaimsSection(result) {
  if (!result || !result.claims || !result.claims.length) return "";
  const parts = ["## 当前项目权威事实与状态（须优先遵循；历史探索不得写成现状）"];
  const order = ["current_fact", "confirmed_decision", "work_principle", "current_status", "proposal"];
  const byType = {};
  for (const c of result.claims) {
    const t = c.claimType || "other";
    if (!byType[t]) byType[t] = [];
    byType[t].push(c);
  }
  for (const t of order) {
    const list = byType[t];
    if (!list || !list.length) continue;
    const label =
      t === "current_fact"
        ? "已确认事实"
        : t === "confirmed_decision"
          ? "已确认决策"
          : t === "work_principle"
            ? "产品原则"
          : t === "current_status"
            ? "当前状态"
            : "建议/提案";
    parts.push(`### ${label}`);
    for (const c of list) {
      const src = (c.sourceRefs || []).slice(0, 2).join("、") || "项目资料";
      parts.push(`- ${c.claimText}（来源：${src}）`);
    }
  }
  return parts.join("\n");
}

function classifyMemoryAsset(asset) {
  const id = String((asset && asset.assetId) || "");
  if (HISTORICAL_MEMORY_IDS.has(id)) {
    return {
      excluded: true,
      reason: "historical_exploration_memory",
      downgradeAuthority: "historical_record",
      claimType: "historical_exploration",
    };
  }
  const stmt = String((asset && asset.statement) || "");
  if (/稳定币|UBC|通用基本资本|治理代币|智能合约.*交易|代币经济/i.test(stmt)) {
    return {
      excluded: true,
      reason: "blockchain_finance_exploration",
      downgradeAuthority: "historical_record",
      claimType: "historical_exploration",
    };
  }
  return { excluded: false };
}

module.exports = {
  retrieveProjectClaims,
  renderProjectClaimsSection,
  classifyMemoryAsset,
  rankClaim,
  HISTORICAL_MEMORY_IDS,
};

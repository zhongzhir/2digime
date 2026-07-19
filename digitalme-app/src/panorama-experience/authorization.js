"use strict";

/**
 * PAN-01R authorization preview + single-use tokens.
 * Evidence re-resolved from package by IDs; renderer text/kind ignored.
 */

const crypto = require("node:crypto");
const {
  getRequest,
  isRequestExpired,
  RESULT_DESTINATION,
} = require("./request");
const { resolveEvidenceByIds, sanitizeShortText } = require("./subject-brief");

const TOKEN_TTL_MS = 5 * 60 * 1000;

/** @type {Map<string, object>} */
const tokenStore = new Map();

function nowMs(now) {
  if (typeof now === "function") return now();
  if (typeof now === "number") return now;
  return Date.now();
}

function digestText(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function buildInferenceEnvironment(getRuntimeConfig) {
  let cfg = null;
  try {
    cfg = typeof getRuntimeConfig === "function" ? getRuntimeConfig() : null;
  } catch {
    cfg = null;
  }
  const hasKey = !!(cfg && cfg.apiKey && String(cfg.apiKey).trim());
  const hasModel = !!(cfg && cfg.model && String(cfg.model).trim());
  const configured = hasKey && hasModel && !(cfg && cfg.configUnreadable);
  const providerLabel = configured ? "已配置的云端模型服务" : "未连接";
  const modelLabel = configured ? sanitizeShortText(String(cfg.model), 80) : null;
  const dataDestinationDisclosure = configured
    ? "本地模拟仅覆盖协作关系与流程。确认执行后，选中的任务说明与主体依据将发送给已配置的云端模型服务用于推理；不会发送给模拟协作伙伴。"
    : "当前未连接智能引擎。确认后也不会向外部推理服务发送内容。";
  return {
    configured,
    providerLabel,
    modelLabel,
    dataDestinationDisclosure,
    localCollaborationOnly: true,
    sentToSimulationPartner: false,
  };
}

function resolveSelectedEvidence(packageDir, requestId, selectedEvidenceIds) {
  const rec = getRequest(requestId);
  if (!rec) return { ok: false, code: "request_not_found", message: "协作请求不存在" };

  const ids = Array.isArray(selectedEvidenceIds)
    ? selectedEvidenceIds.map(String).filter(Boolean)
    : [];
  const unique = [...new Set(ids)].sort();
  const { evidence, boundaries } = resolveEvidenceByIds(packageDir, unique);

  if (unique.length !== evidence.length) {
    const found = new Set(evidence.map((e) => e.id));
    const unknown = unique.filter((id) => !found.has(id));
    return {
      ok: false,
      code: "unknown_evidence_id",
      message: "存在无法识别或不可用的主体依据",
      unknownIds: unknown,
    };
  }
  return { ok: true, evidence, boundaries, evidenceIds: unique, request: rec };
}

function buildPreviewObject(rec, evidence, inferenceEnvironment, expiresAt) {
  return {
    requestId: rec.requestId,
    requester: { ...rec.requester },
    taskSummary: sanitizeShortText(`${rec.topic}：${rec.task}`, 200),
    capabilities: rec.allowedCapabilities.map((c) => ({ ...c })),
    selectedEvidence: evidence.map((e) => ({
      id: e.id,
      shortText: e.shortText,
      kindLabel: e.kindLabel,
    })),
    durationLabel: "仅本次有效",
    resultDestination: { ...RESULT_DESTINATION },
    inferenceEnvironment,
    expiresAt,
    localSimulation: true,
  };
}

/**
 * Authorization preview (token not yet consumable).
 */
function buildAuthorizationPreview({
  requestId,
  senderId,
  selectedEvidenceIds,
  packageDir,
  getRuntimeConfig,
  now,
}) {
  const resolved = resolveSelectedEvidence(packageDir, requestId, selectedEvidenceIds);
  if (!resolved.ok) return resolved;
  const { evidence, request: rec } = resolved;
  if (String(rec.senderId) !== String(senderId)) {
    return { ok: false, code: "sender_mismatch", message: "发送方不匹配" };
  }
  if (rec.status === "rejected") {
    return { ok: false, code: "request_rejected", message: "协作请求已拒绝" };
  }
  if (isRequestExpired(rec, now)) {
    return { ok: false, code: "request_expired", message: "协作请求已过期" };
  }
  const inferenceEnvironment = buildInferenceEnvironment(getRuntimeConfig);
  const t = nowMs(now);
  const expiresAt = new Date(t + TOKEN_TTL_MS).toISOString();
  return {
    ok: true,
    ...buildPreviewObject(rec, evidence, inferenceEnvironment, expiresAt),
  };
}

/**
 * Grant single-use authorization token.
 */
function grantAuthorization({
  requestId,
  senderId,
  selectedEvidenceIds,
  packageDir,
  getRuntimeConfig,
  appendAudit,
  userData,
  now,
}) {
  const resolved = resolveSelectedEvidence(packageDir, requestId, selectedEvidenceIds);
  if (!resolved.ok) return resolved;
  const { evidence, evidenceIds, request: rec } = resolved;
  if (String(rec.senderId) !== String(senderId)) {
    return { ok: false, code: "sender_mismatch", message: "发送方不匹配" };
  }
  if (rec.status === "rejected") {
    return { ok: false, code: "request_rejected", message: "协作请求已拒绝" };
  }
  if (isRequestExpired(rec, now)) {
    return { ok: false, code: "request_expired", message: "协作请求已过期" };
  }

  const t = nowMs(now);
  const tokenId = "tok_" + crypto.randomBytes(12).toString("hex");
  const capabilityIds = rec.allowedCapabilities.map((c) => c.id).sort();
  const taskDigest = digestText(`${rec.topic}|${rec.task}`);
  const expiresAtMs = t + TOKEN_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const inferenceEnvironment = buildInferenceEnvironment(getRuntimeConfig);
  const preview = buildPreviewObject(rec, evidence, inferenceEnvironment, expiresAt);

  if (typeof appendAudit === "function" && userData) {
    try {
      appendAudit(userData, {
        event: "authorization_granted",
        decisionId: tokenId,
        policyVersion: "pan01r-v1",
        requestDigest: rec.requestId,
        actor: `owner:sender:${senderId}`,
        purpose: "panorama_sovereign_collaboration",
        action: "grant_authorization",
        dataScopes: ["selected_evidence_ids", "task_digest"],
        destination: "owner_local_review",
        outcome: {
          status: "granted",
          evidenceCount: evidenceIds.length,
          capabilityIds,
          taskDigest,
          tokenExpiresAt: expiresAt,
        },
      });
    } catch {
      return {
        ok: false,
        code: "audit_failed",
        message: "无法写入决策记录，已阻止授权",
      };
    }
  }

  tokenStore.set(tokenId, {
    tokenId,
    requestId: rec.requestId,
    senderId: String(senderId),
    evidenceIds: evidenceIds.slice().sort(),
    capabilityIds,
    taskDigest,
    topic: rec.topic,
    task: rec.task,
    expiresAt,
    expiresAtMs,
    consumed: false,
    createdAt: new Date(t).toISOString(),
  });

  return { ok: true, tokenId, preview, expiresAt };
}

/**
 * Consume token once. Fail-closed on expiry / reuse / sender / scope mismatch.
 */
function consumeToken(tokenId, senderId, expectedEvidenceIds, now) {
  const tok = tokenStore.get(String(tokenId || ""));
  if (!tok) {
    return { ok: false, code: "token_not_found", message: "授权已失效或不存在" };
  }
  if (String(tok.senderId) !== String(senderId)) {
    return { ok: false, code: "sender_mismatch", message: "发送方不匹配" };
  }
  if (tok.consumed) {
    return { ok: false, code: "token_consumed", message: "授权已使用，不可重复执行" };
  }
  if (nowMs(now) > tok.expiresAtMs) {
    return { ok: false, code: "token_expired", message: "授权已过期" };
  }
  if (Array.isArray(expectedEvidenceIds)) {
    const expected = [...new Set(expectedEvidenceIds.map(String))].sort().join(",");
    const actual = tok.evidenceIds.slice().sort().join(",");
    if (expected !== actual) {
      return { ok: false, code: "scope_mismatch", message: "授权范围不一致" };
    }
  }
  tok.consumed = true;
  tok.consumedAt = new Date(nowMs(now)).toISOString();
  return { ok: true, token: { ...tok, evidenceIds: tok.evidenceIds.slice() } };
}

function getToken(tokenId) {
  return tokenStore.get(String(tokenId || "")) || null;
}

function clearTokenStoreForTests() {
  tokenStore.clear();
}

module.exports = {
  buildAuthorizationPreview,
  grantAuthorization,
  consumeToken,
  getToken,
  buildInferenceEnvironment,
  clearTokenStoreForTests,
  TOKEN_TTL_MS,
  digestText,
};

"use strict";

/**
 * PAN-01R authorization preview freeze + single-use tokens.
 * Evidence re-resolved from package by IDs; renderer text/kind ignored.
 */

const crypto = require("node:crypto");
const {
  getRequest,
  isRequestExpired,
  RESULT_DESTINATION,
} = require("./request");
const {
  resolveEvidenceByIds,
  sanitizeShortText,
  computePersonalized,
} = require("./subject-brief");

const TOKEN_TTL_MS = 5 * 60 * 1000;
const PREVIEW_TTL_MS = 5 * 60 * 1000;

/** @type {Map<string, object>} */
const tokenStore = new Map();
/** @type {Map<string, object>} */
const previewStore = new Map();

function nowMs(now) {
  if (typeof now === "function") return now();
  if (typeof now === "number") return now;
  return Date.now();
}

function digestText(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function stableJsonDigest(obj) {
  const keys = Object.keys(obj || {}).sort();
  const ordered = {};
  for (const k of keys) ordered[k] = obj[k];
  return digestText(JSON.stringify(ordered));
}

function classifyEndpoint(baseURL) {
  if (!baseURL || !String(baseURL).trim()) {
    return { category: null, origin: null };
  }
  try {
    const u = new URL(String(baseURL).trim());
    const host = String(u.hostname || "").toLowerCase();
    const origin = `${u.protocol}//${u.host}`.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return { category: "local_loopback", origin };
    }
    if (host) {
      return { category: "remote_endpoint", origin };
    }
    return { category: "unknown", origin: origin || null };
  } catch {
    return { category: "unknown", origin: null };
  }
}

function publicInferenceEnvironment(env) {
  if (!env) return null;
  return {
    configured: !!env.configured,
    category: env.category || null,
    providerLabel: env.providerLabel,
    modelLabel: env.modelLabel,
    dataDestinationDisclosure: env.dataDestinationDisclosure,
    localCollaborationOnly: true,
    sentToSimulationPartner: false,
  };
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
  const modelLabel = configured ? sanitizeShortText(String(cfg.model), 80) : null;

  let category = null;
  let providerLabel = "未连接";
  let endpointDigest = "none";
  let dataDestinationDisclosure =
    "当前未连接智能引擎。确认后也不会向外部推理服务发送内容。";

  if (configured) {
    const ep = classifyEndpoint(cfg && cfg.baseURL);
    category = ep.category || "unknown";
    endpointDigest = ep.origin ? digestText(ep.origin) : "none";
    if (category === "local_loopback") {
      providerLabel = "已配置的本机推理服务";
      dataDestinationDisclosure =
        "本地模拟仅覆盖协作关系与流程。确认执行后，选中的任务说明与主体依据将发送给已配置的本机推理服务用于推理；不会发送给模拟协作伙伴。";
    } else if (category === "remote_endpoint") {
      providerLabel = "已配置的远程推理服务";
      dataDestinationDisclosure =
        "本地模拟仅覆盖协作关系与流程。确认执行后，选中的任务说明与主体依据将发送给已配置的远程推理服务用于推理；不会发送给模拟协作伙伴。";
    } else {
      category = "unknown";
      providerLabel = "已配置的推理服务，位置无法确认";
      dataDestinationDisclosure =
        "本地模拟仅覆盖协作关系与流程。确认执行后，选中的任务说明与主体依据将发送给已配置的推理服务用于推理（位置无法确认）；不会发送给模拟协作伙伴。";
    }
  }

  const inferenceEnvironmentDigest = configured
    ? stableJsonDigest({
        category,
        model: modelLabel || "",
        endpointDigest,
      })
    : digestText("none");

  return {
    configured,
    category,
    providerLabel,
    modelLabel,
    endpointDigest,
    inferenceEnvironmentDigest,
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
  const allowed = new Set((rec.optionalEvidenceIds || []).map(String));

  const outOfScope = unique.filter((id) => !allowed.has(id));
  if (outOfScope.length > 0) {
    // Distinguish: unknown to package vs known but outside request scope
    const { evidence: packageHits } = resolveEvidenceByIds(packageDir, outOfScope);
    const foundInPackage = new Set(packageHits.map((e) => e.id));
    const unknown = outOfScope.filter((id) => !foundInPackage.has(id));
    if (unknown.length > 0) {
      return {
        ok: false,
        code: "unknown_evidence_id",
        message: "存在无法识别或不可用的主体依据",
        unknownIds: unknown,
      };
    }
    return {
      ok: false,
      code: "scope_expansion_rejected",
      message: "所选依据超出本次请求允许范围",
      rejectedIds: outOfScope,
    };
  }

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

function buildPreviewObject(rec, evidence, inferenceEnvironment, expiresAt, extras = {}) {
  return {
    previewId: extras.previewId || null,
    requestId: rec.requestId,
    requester: { ...rec.requester },
    taskSummary: sanitizeShortText(`${rec.topic}：${rec.task}`, 200),
    capabilities: rec.allowedCapabilities.map((c) => ({ ...c })),
    selectedEvidence: evidence.map((e) => ({
      id: e.id,
      shortText: e.shortText,
      kind: e.kind,
      kindLabel: e.kindLabel,
      sourceLabel: e.sourceLabel,
      ownerConfirmed: !!e.ownerConfirmed,
    })),
    durationLabel: "仅本次有效",
    resultDestination: { ...RESULT_DESTINATION },
    inferenceEnvironment: publicInferenceEnvironment(inferenceEnvironment),
    personalizedAvailable: !!extras.personalizedAvailable,
    previewMode: extras.previewMode !== undefined ? !!extras.previewMode : !extras.personalizedAvailable,
    expiresAt,
    localSimulation: true,
  };
}

/**
 * Authorization preview — freezes scope into previewStore (token not yet consumable).
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

  const inferenceEnvironment = buildInferenceEnvironment(getRuntimeConfig);
  const t = nowMs(now);
  const expiresAtMs = t + PREVIEW_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const personalizedAvailable = computePersonalized(evidence);
  const previewMode = !personalizedAvailable;
  const previewId = "prv_" + crypto.randomBytes(12).toString("hex");
  const capabilityIds = rec.allowedCapabilities.map((c) => c.id).sort();
  const taskDigest = digestText(`${rec.topic}|${rec.task}`);
  const selectedSorted = evidenceIds.slice().sort();

  previewStore.set(previewId, {
    previewId,
    requestId: rec.requestId,
    senderId: String(senderId),
    selectedEvidenceIds: selectedSorted,
    capabilityIds,
    taskDigest,
    topic: rec.topic,
    task: rec.task,
    inferenceEnvironmentDigest: inferenceEnvironment.inferenceEnvironmentDigest,
    inferenceEnvironment: publicInferenceEnvironment(inferenceEnvironment),
    resultDestination: { ...RESULT_DESTINATION },
    personalizedAvailable,
    previewMode,
    createdAt: new Date(t).toISOString(),
    expiresAt,
    expiresAtMs,
    consumed: false,
  });

  return {
    ok: true,
    ...buildPreviewObject(rec, evidence, inferenceEnvironment, expiresAt, {
      previewId,
      personalizedAvailable,
      previewMode,
    }),
  };
}

/**
 * Confirm from frozen preview → single-use token.
 */
function confirmFromPreview({
  previewId,
  senderId,
  confirmed,
  packageDir,
  userData,
  getRuntimeConfig,
  appendAudit,
  now,
}) {
  if (confirmed !== true) {
    return { ok: false, code: "not_confirmed", message: "未确认授权" };
  }

  const preview = previewStore.get(String(previewId || ""));
  if (!preview) {
    return { ok: false, code: "preview_not_found", message: "授权预览不存在或已失效" };
  }
  if (String(preview.senderId) !== String(senderId)) {
    return { ok: false, code: "sender_mismatch", message: "发送方不匹配" };
  }
  if (preview.consumed) {
    return { ok: false, code: "preview_consumed", message: "授权预览已使用" };
  }
  if (nowMs(now) > preview.expiresAtMs) {
    return { ok: false, code: "preview_expired", message: "授权预览已过期" };
  }

  const rec = getRequest(preview.requestId);
  if (!rec) {
    return { ok: false, code: "request_not_found", message: "协作请求不存在" };
  }
  if (rec.status === "rejected") {
    return { ok: false, code: "request_rejected", message: "协作请求已拒绝" };
  }
  if (isRequestExpired(rec, now)) {
    return { ok: false, code: "request_expired", message: "协作请求已过期" };
  }

  const inferenceEnvironment = buildInferenceEnvironment(getRuntimeConfig);
  if (
    inferenceEnvironment.inferenceEnvironmentDigest !== preview.inferenceEnvironmentDigest
  ) {
    return {
      ok: false,
      code: "inference_environment_changed",
      message: "推理环境已变化，请重新生成授权预览",
    };
  }

  const allowed = new Set((rec.optionalEvidenceIds || []).map(String));
  for (const id of preview.selectedEvidenceIds) {
    if (!allowed.has(id)) {
      return {
        ok: false,
        code: "scope_expansion_rejected",
        message: "所选依据超出本次请求允许范围",
      };
    }
  }

  const { evidence } = resolveEvidenceByIds(packageDir, preview.selectedEvidenceIds);
  if (evidence.length !== preview.selectedEvidenceIds.length) {
    return {
      ok: false,
      code: "evidence_resolve_failed",
      message: "无法解析已授权的主体依据",
    };
  }

  const personalizedNow = computePersonalized(evidence);
  if (preview.personalizedAvailable && !personalizedNow) {
    return {
      ok: false,
      code: "personalized_insufficient",
      message: "主体依据已不足以支持个性化结果",
    };
  }
  // If frozen was false, keep false (preview path)
  const personalizedAvailable = preview.personalizedAvailable ? personalizedNow : false;

  const t = nowMs(now);
  const tokenId = "tok_" + crypto.randomBytes(12).toString("hex");
  const expiresAtMs = t + TOKEN_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();

  preview.consumed = true;
  preview.consumedAt = new Date(t).toISOString();

  if (typeof appendAudit === "function" && userData) {
    try {
      appendAudit(userData, {
        event: "authorization_granted",
        decisionId: tokenId,
        policyVersion: "pan01r-v1",
        requestDigest: rec.requestId,
        actor: `owner:sender:${senderId}`,
        purpose: "panorama_sovereign_collaboration",
        action: "confirm_from_preview",
        dataScopes: ["selected_evidence_ids", "task_digest"],
        destination: "owner_local_review",
        outcome: {
          status: "granted",
          evidenceCount: preview.selectedEvidenceIds.length,
          capabilityIds: preview.capabilityIds.slice(),
          taskDigest: preview.taskDigest,
          previewId: preview.previewId,
          personalizedAvailable,
          inferenceEnvironmentDigest: preview.inferenceEnvironmentDigest,
          tokenExpiresAt: expiresAt,
        },
      });
    } catch {
      // Roll back consume so caller can retry after audit recovery
      preview.consumed = false;
      delete preview.consumedAt;
      return {
        ok: false,
        code: "audit_failed",
        message: "无法写入决策记录，已阻止授权",
      };
    }
  }

  tokenStore.set(tokenId, {
    tokenId,
    previewId: preview.previewId,
    requestId: rec.requestId,
    senderId: String(senderId),
    evidenceIds: preview.selectedEvidenceIds.slice().sort(),
    capabilityIds: preview.capabilityIds.slice(),
    taskDigest: preview.taskDigest,
    topic: preview.topic,
    task: preview.task,
    personalizedAvailable,
    previewMode: !personalizedAvailable,
    inferenceEnvironmentDigest: preview.inferenceEnvironmentDigest,
    inferenceEnvironment: preview.inferenceEnvironment
      ? { ...preview.inferenceEnvironment }
      : publicInferenceEnvironment(inferenceEnvironment),
    resultDestination: { ...preview.resultDestination },
    expiresAt,
    expiresAtMs,
    consumed: false,
    createdAt: new Date(t).toISOString(),
  });

  const publicPreview = buildPreviewObject(
    rec,
    evidence,
    inferenceEnvironment,
    preview.expiresAt,
    {
      previewId: preview.previewId,
      personalizedAvailable,
      previewMode: !personalizedAvailable,
    }
  );

  return { ok: true, tokenId, preview: publicPreview, expiresAt };
}

/**
 * Grant single-use authorization token (internal / hermetic test helper).
 * Prefer confirmFromPreview in production IPC path.
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
  const previewed = buildAuthorizationPreview({
    requestId,
    senderId,
    selectedEvidenceIds,
    packageDir,
    getRuntimeConfig,
    now,
  });
  if (!previewed.ok) return previewed;
  return confirmFromPreview({
    previewId: previewed.previewId,
    senderId,
    confirmed: true,
    packageDir,
    userData,
    getRuntimeConfig,
    appendAudit,
    now,
  });
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

function getPreview(previewId) {
  return previewStore.get(String(previewId || "")) || null;
}

function clearTokenStoreForTests() {
  tokenStore.clear();
}

function clearPreviewStoreForTests() {
  previewStore.clear();
}

module.exports = {
  buildAuthorizationPreview,
  confirmFromPreview,
  grantAuthorization,
  consumeToken,
  getToken,
  getPreview,
  buildInferenceEnvironment,
  publicInferenceEnvironment,
  clearTokenStoreForTests,
  clearPreviewStoreForTests,
  TOKEN_TTL_MS,
  PREVIEW_TTL_MS,
  digestText,
};

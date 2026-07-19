"use strict";

/**
 * PAN-01R collaboration request store (in-memory, local simulation only).
 * Renderer cannot inject requester, capabilities, destination, or system prompt.
 */

const crypto = require("node:crypto");
const { buildSubjectBrief, listUsableEvidenceIds } = require("./subject-brief");

const REQUEST_TTL_MS = 15 * 60 * 1000;
const TOPIC_MAX = 200;
const DEFAULT_TOPIC = "个人研究方向判断";
const DEFAULT_TEMPLATE_ID = "research_judgment_v1";
const TEMPLATE_ALLOWLIST = new Set(["research_judgment_v1"]);

const TASK_TEMPLATE =
  "围绕选定主题，形成一份简短的研究判断框架，说明核心判断、依据、不确定性和下一步研究问题。";

const SIM_REQUESTER = Object.freeze({
  id: "local_sim_research_partner",
  label: "本地模拟研究伙伴",
  localSimulation: true,
});

const ALLOWED_CAPABILITY = Object.freeze({
  id: "cap_research_judgment",
  label: "受控研究判断",
  userStatus: "local_sim",
});

const RESULT_DESTINATION = Object.freeze({
  kind: "owner_local_review",
  label: "仅返回给你本人审阅",
  sentToPartner: false,
});

/** @type {Map<string, object>} */
const requestStore = new Map();

function nowMs(now) {
  if (typeof now === "function") return now();
  if (typeof now === "number") return now;
  return Date.now();
}

function validateTopic(topic) {
  if (topic == null || topic === "") return { ok: true, topic: DEFAULT_TOPIC };
  if (typeof topic !== "string") {
    return { ok: false, code: "topic_invalid", message: "主题格式无效" };
  }
  const trimmed = topic.trim();
  if (!trimmed) return { ok: false, code: "topic_empty", message: "主题不能为空" };
  if (trimmed.length > TOPIC_MAX) {
    return { ok: false, code: "topic_too_long", message: "主题过长" };
  }
  if (/[\u0000]/.test(trimmed) || /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(trimmed)) {
    return { ok: false, code: "topic_control_chars", message: "主题含非法字符" };
  }
  return { ok: true, topic: trimmed };
}

function publicRequestView(rec) {
  return {
    ok: true,
    requestId: rec.requestId,
    requester: { ...rec.requester },
    task: rec.task,
    topic: rec.topic,
    templateId: rec.templateId,
    allowedCapabilities: rec.allowedCapabilities.map((c) => ({ ...c })),
    optionalEvidenceIds: rec.optionalEvidenceIds.slice(),
    resultDestination: { ...rec.resultDestination },
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt,
    status: rec.status,
    localSimulation: true,
  };
}

/**
 * @param {{ senderId: string|number, topic?: string, templateId?: string, evidenceIds?: string[], packageDir: string, now?: function|number, appendAudit?: function, userData?: string }} input
 */
function createResearchRequest(input) {
  const senderId = String(input && input.senderId != null ? input.senderId : "");
  if (!senderId) {
    return { ok: false, code: "sender_required", message: "缺少发送方标识" };
  }
  const topicCheck = validateTopic(input.topic);
  if (!topicCheck.ok) return topicCheck;

  const packageDir = String(input.packageDir || "");
  if (!packageDir) {
    return { ok: false, code: "package_required", message: "缺少资料目录" };
  }

  const rawTemplate =
    typeof input.templateId === "string" && input.templateId.trim()
      ? String(input.templateId).trim().slice(0, 64)
      : DEFAULT_TEMPLATE_ID;
  if (!TEMPLATE_ALLOWLIST.has(rawTemplate)) {
    return { ok: false, code: "unknown_template_id", message: "未知的任务模板" };
  }
  const templateId = rawTemplate;

  const brief = buildSubjectBrief(packageDir);
  const usableIds = new Set(listUsableEvidenceIds(brief));
  const requestedIds = Array.isArray(input.evidenceIds) ? input.evidenceIds.map(String) : [];

  let optionalEvidenceIds;
  if (requestedIds.length > 0) {
    const unknown = requestedIds.filter((id) => !usableIds.has(id));
    if (unknown.length > 0) {
      return {
        ok: false,
        code: "unknown_evidence_id",
        message: "存在无法识别或不可用的主体依据",
        unknownIds: unknown,
      };
    }
    // Intersection (all requested are known); preserve order, unique
    const seen = new Set();
    optionalEvidenceIds = [];
    for (const id of requestedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      optionalEvidenceIds.push(id);
    }
  } else {
    optionalEvidenceIds = (brief.evidence || [])
      .filter((e) => e.usableInExperience && e.selectedByDefault)
      .map((e) => e.id);
  }

  const t = nowMs(input.now);
  const requestId = "req_" + crypto.randomBytes(12).toString("hex");

  const rec = {
    requestId,
    senderId,
    requester: { ...SIM_REQUESTER },
    task: TASK_TEMPLATE,
    topic: topicCheck.topic,
    templateId,
    allowedCapabilities: [{ ...ALLOWED_CAPABILITY }],
    optionalEvidenceIds,
    resultDestination: { ...RESULT_DESTINATION },
    createdAt: new Date(t).toISOString(),
    expiresAt: new Date(t + REQUEST_TTL_MS).toISOString(),
    expiresAtMs: t + REQUEST_TTL_MS,
    status: "open",
    rejectedAt: null,
  };
  requestStore.set(requestId, rec);

  if (typeof input.appendAudit === "function" && input.userData) {
    try {
      input.appendAudit(input.userData, {
        event: "collaboration_request_created",
        decisionId: requestId,
        policyVersion: "pan01r-v1",
        requestDigest: requestId,
        actor: `owner:sender:${senderId}`,
        purpose: "panorama_sovereign_collaboration",
        action: "create_research_request",
        dataScopes: ["selected_evidence_ids", "task_topic"],
        destination: "owner_local_review",
        outcome: {
          status: "created",
          topicLength: topicCheck.topic.length,
          evidenceCount: optionalEvidenceIds.length,
        },
      });
    } catch {
      /* request creation itself is local; audit failure logged via caller if needed */
    }
  }

  return publicRequestView(rec);
}

function getRequest(requestId) {
  const rec = requestStore.get(String(requestId || ""));
  if (!rec) return null;
  return rec;
}

function getPublicRequest(requestId) {
  const rec = getRequest(requestId);
  if (!rec) return { ok: false, code: "request_not_found", message: "协作请求不存在" };
  return publicRequestView(rec);
}

function isRequestExpired(rec, now) {
  return nowMs(now) > rec.expiresAtMs;
}

/**
 * @returns {{ ok: boolean, code?: string, message?: string }}
 */
function rejectRequest(requestId, senderId, userData, deps = {}) {
  const rec = getRequest(requestId);
  if (!rec) return { ok: false, code: "request_not_found", message: "协作请求不存在" };
  if (String(rec.senderId) !== String(senderId)) {
    return { ok: false, code: "sender_mismatch", message: "发送方不匹配" };
  }
  if (rec.status === "rejected") {
    return { ok: true, alreadyRejected: true, requestId: rec.requestId };
  }
  if (isRequestExpired(rec, deps.now)) {
    return { ok: false, code: "request_expired", message: "协作请求已过期" };
  }
  rec.status = "rejected";
  rec.rejectedAt = new Date(nowMs(deps.now)).toISOString();

  const appendAudit = deps.appendAudit;
  if (typeof appendAudit === "function" && userData) {
    try {
      appendAudit(userData, {
        event: "collaboration_request_rejected",
        decisionId: rec.requestId,
        policyVersion: "pan01r-v1",
        requestDigest: rec.requestId,
        actor: `owner:sender:${senderId}`,
        purpose: "panorama_sovereign_collaboration",
        action: "reject_research_request",
        dataScopes: [],
        destination: "none",
        outcome: { status: "rejected" },
      });
    } catch (err) {
      return {
        ok: false,
        code: "audit_failed",
        message: "无法写入决策记录，已阻止操作",
      };
    }
  }
  return { ok: true, requestId: rec.requestId, status: "rejected" };
}

function clearRequestStoreForTests() {
  requestStore.clear();
}

module.exports = {
  createResearchRequest,
  getRequest,
  getPublicRequest,
  rejectRequest,
  isRequestExpired,
  validateTopic,
  clearRequestStoreForTests,
  TASK_TEMPLATE,
  DEFAULT_TOPIC,
  DEFAULT_TEMPLATE_ID,
  TEMPLATE_ALLOWLIST,
  SIM_REQUESTER,
  ALLOWED_CAPABILITY,
  RESULT_DESTINATION,
  REQUEST_TTL_MS,
};

"use strict";

/**
 * PAN-01R result adopt / reject / receipt summary.
 * Never writes subject Package; never stores secrets or absolute paths.
 */

const library = require("../outputs/library");
const { getRunRecord } = require("./execute");
const { getRequest } = require("./request");
const { sanitizeShortText } = require("./subject-brief");

const REJECT_REASON_ALLOWLIST = Object.freeze([
  "not_useful",
  "inaccurate",
  "out_of_scope",
  "privacy_concern",
  "other",
]);

const REJECT_REASON_LABELS = Object.freeze({
  not_useful: "用处不大",
  inaccurate: "不够准确",
  out_of_scope: "超出范围",
  privacy_concern: "隐私顾虑",
  other: "其他",
});

function adoptResult({ runId, senderId, userData, deps = {} }) {
  const run = getRunRecord(runId);
  if (!run) return { ok: false, code: "run_not_found", message: "运行不存在" };
  if (String(run.senderId) !== String(senderId)) {
    return { ok: false, code: "sender_mismatch", message: "发送方不匹配" };
  }
  if (run.status === "cancelled" || run.status === "abandoned") {
    return { ok: false, code: "run_cancelled", message: "已取消的结果不可采纳" };
  }
  if (run.status !== "completed" || !run.adoptable || !run.completionAuditOk) {
    return { ok: false, code: "not_adoptable", message: "当前结果不可采纳" };
  }
  if (!run.result || !run.result.digitalMeText) {
    return { ok: false, code: "no_result", message: "没有可保存的结果" };
  }
  if (run.adoptedDeliverableId) {
    return {
      ok: true,
      deliverableId: run.adoptedDeliverableId,
      message: "已保存为你的本地成果",
      alreadyAdopted: true,
    };
  }

  // Ignore any renderer-injected body — only use main-process stored Digital Me text.
  const content = String(run.result.digitalMeText);
  const title = sanitizeShortText(`研究判断：${run.topic || "未命名主题"}`, 80);

  let item;
  try {
    item = library.importFromArtifact(userData, {
      title,
      content,
      type: "report",
      status: "ready",
      sourceSessionId: run.runId,
      packageRef: null,
    });
    // Enrich with evidence / capability refs without package paths
    item = library.upsertDeliverable(userData, {
      ...item,
      evidenceRefs: (run.evidenceIds || []).slice(),
      packageRef: {
        kind: "pan01r_run",
        runId: run.runId,
        requestId: run.requestId,
        capabilityIds: (run.capabilityIds || []).slice(),
        decisionId: run.decisionId || run.runId,
      },
    });
  } catch {
    return { ok: false, code: "library_write_failed", message: "保存本地成果失败" };
  }

  run.adoptedDeliverableId = item.id;
  run.adoptedAt = new Date().toISOString();

  if (typeof deps.appendAudit === "function") {
    try {
      deps.appendAudit(userData, {
        event: "result_adopted",
        decisionId: run.decisionId || run.runId,
        policyVersion: "pan01r-v1",
        requestDigest: run.requestId,
        actor: `owner:sender:${senderId}`,
        purpose: "panorama_sovereign_collaboration",
        action: "adopt_result",
        dataScopes: ["digital_me_result_digest"],
        destination: "local_library",
        outcome: {
          status: "adopted",
          deliverableId: item.id,
          digitalMeDigest: run.result.digitalMeDigest,
        },
      });
    } catch {
      return {
        ok: false,
        code: "audit_failed",
        message: "成果已写入，但决策记录失败",
        deliverableId: item.id,
      };
    }
  }

  return {
    ok: true,
    deliverableId: item.id,
    message: "已保存为你的本地成果",
  };
}

function rejectResult({ runId, senderId, userData, reasonCategory, deps = {} }) {
  const run = getRunRecord(runId);
  if (!run) return { ok: false, code: "run_not_found", message: "运行不存在" };
  if (String(run.senderId) !== String(senderId)) {
    return { ok: false, code: "sender_mismatch", message: "发送方不匹配" };
  }
  if (run.status !== "completed" && run.status !== "failed") {
    return { ok: false, code: "invalid_state", message: "当前状态不可拒绝结果" };
  }

  let reason = String(reasonCategory || "other");
  if (!REJECT_REASON_ALLOWLIST.includes(reason)) reason = "other";

  run.rejectedAt = new Date().toISOString();
  run.rejectReason = reason;
  run.adoptable = false;

  if (typeof deps.appendAudit === "function" && userData) {
    try {
      deps.appendAudit(userData, {
        event: "result_rejected",
        decisionId: run.decisionId || run.runId,
        policyVersion: "pan01r-v1",
        requestDigest: run.requestId,
        actor: `owner:sender:${senderId}`,
        purpose: "panorama_sovereign_collaboration",
        action: "reject_result",
        dataScopes: [],
        destination: "none",
        outcome: {
          status: "rejected",
          reasonCategory: reason,
          digitalMeDigest: run.result ? run.result.digitalMeDigest : undefined,
        },
      });
    } catch {
      return { ok: false, code: "audit_failed", message: "无法写入决策记录" };
    }
  }

  return {
    ok: true,
    runId: run.runId,
    reasonCategory: reason,
    reasonLabel: REJECT_REASON_LABELS[reason],
    message: "已拒绝本次结果，未写入成果库",
  };
}

function getReceiptSummary({ requestId, runId, userData, deps = {} }) {
  const run = runId ? getRunRecord(runId) : null;
  const reqId = requestId || (run && run.requestId);
  const req = reqId ? getRequest(reqId) : null;

  const summary = {
    ok: true,
    requestId: reqId || null,
    runId: run ? run.runId : null,
    requestStatus: req ? req.status : null,
    runStatus: run ? run.status : null,
    topic: req ? sanitizeShortText(req.topic, 80) : run ? sanitizeShortText(run.topic, 80) : null,
    localSimulation: true,
    sentToSimulationPartner: false,
    adoptable: run ? !!run.adoptable : false,
    adoptedDeliverableId: run ? run.adoptedDeliverableId || null : null,
    rejected: !!(run && run.rejectedAt),
    rejectReason: run && run.rejectReason ? run.rejectReason : null,
    evidenceCount: run ? run.evidenceIds.length : req ? req.optionalEvidenceIds.length : 0,
    capabilityIds: run
      ? run.capabilityIds.slice()
      : req
        ? req.allowedCapabilities.map((c) => c.id)
        : [],
    inferenceDisclosure: run && run.inferenceEnvironment
      ? run.inferenceEnvironment.dataDestinationDisclosure
      : null,
    events: [],
  };

  if (userData && typeof deps.listAudit === "function") {
    try {
      const entries = deps.listAudit(userData, { limit: 50 }) || [];
      summary.events = entries
        .filter((e) => {
          const dig = String(e.requestDigest || "");
          const dec = String(e.decisionId || "");
          return (
            (reqId && (dig === reqId || dec === reqId)) ||
            (run && (dig === run.requestId || dec === run.runId || dec === run.tokenId))
          );
        })
        .map((e) => ({
          event: e.event,
          at: e.at,
          decisionId: e.decisionId,
          outcomeStatus: e.outcome && e.outcome.status,
        }));
    } catch {
      /* ignore */
    }
  }

  return summary;
}

module.exports = {
  adoptResult,
  rejectResult,
  getReceiptSummary,
  REJECT_REASON_ALLOWLIST,
  REJECT_REASON_LABELS,
};

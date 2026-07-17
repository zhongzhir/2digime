"use strict";

const crypto = require("node:crypto");
const {
  evaluatePolicy,
  buildExternalCliRequest,
  POLICY_VERSION,
} = require("../policy-engine");
const { digestTaskText } = require("../policy-engine/digest");
const confirmationStore = require("../policy-engine/confirmation-store");
const decisionAudit = require("../decision-audit");

function senderIdFromEvent(event) {
  return event && event.sender && event.sender.id != null ? String(event.sender.id) : "unknown";
}

function auditFieldsFromDecision(decision) {
  const req = decision.request || {};
  return {
    decisionId: decision.decisionId,
    policyVersion: decision.policyVersion || POLICY_VERSION,
    requestDigest: decision.requestDigest,
    actor: req.actor || "",
    purpose: req.purpose || "",
    action: req.action || "",
    dataScopes: req.dataScopes || [],
    destination: req.destination || "",
  };
}

function appendAuditOrThrow(userData, fields) {
  try {
    return decisionAudit.appendEntry(userData, fields);
  } catch (err) {
    const e = new Error("决策记录写入失败，已阻止启动外部程序。");
    e.code = "audit_write_failed";
    e.cause = err;
    throw e;
  }
}

function resolveDataScopes(payload) {
  const scopes = [];
  if (payload && Array.isArray(payload.dataScopes)) {
    for (const s of payload.dataScopes) {
      const v = String(s || "").trim();
      if (v) scopes.push(v);
    }
  }
  const writeIntent = !!(payload && payload.writeIntent) || !!(payload && payload.allowWorkspaceWrite);
  if (writeIntent && !scopes.includes("workspace_files")) scopes.push("workspace_files");
  if (!scopes.includes("task_text")) scopes.push("task_text");
  if (!scopes.includes("env_inherit")) scopes.push("env_inherit");
  return { scopes, writeIntent };
}

function safeDenyReason(reason) {
  const reasons = {
    missing_token: "缺少有效确认凭据。",
    unknown_token: "确认凭据无效或已失效。",
    token_replayed: "该确认凭据已使用，不能重复执行。",
    token_expired: "确认凭据已过期，请重新发起请求。",
    token_revoked: "该确认已取消，请重新发起请求。",
    token_binding_mismatch: "请求内容或执行配置与确认时不一致，已拒绝。",
    token_scope_mismatch: "数据范围与确认时不一致，已拒绝。",
  };
  return reasons[reason] || "确认凭据校验失败。";
}

function correlationApproval(token) {
  return {
    confirmationId: token.correlationId,
    confirmedAt: token.consumedAt,
  };
}

function appendDecisionEvent(userData, decision, event, extra = {}) {
  return appendAuditOrThrow(userData, {
    ...auditFieldsFromDecision(decision),
    event,
    approval: extra.approval || null,
    outcome: extra.outcome || null,
  });
}

function ensureAuditHealthy(userData) {
  const resolved = decisionAudit.resolveState(userData, { allowInitialize: true, allowRecover: true });
  const verify = resolved.verify || decisionAudit.verify(userData);
  if (!resolved.ok || !verify.healthy) {
    const err = new Error("决策记录完整性异常，已阻止高风险执行。");
    err.code = "audit_unhealthy";
    err.auditVerify = verify;
    throw err;
  }
  return verify;
}

function resolveCliSnapshot(userData, agents) {
  const snapshot = agents.getActiveCliAgentSnapshot(userData);
  if (!snapshot) throw new Error("当前未选用外部命令执行体");
  return snapshot;
}

/**
 * Phase 1: evaluate policy, issue confirmation token if needed.
 */
function requestExternalAgent(userData, event, payload, agents) {
  ensureAuditHealthy(userData);
  const task = String((payload && payload.task) || "").trim();
  if (!task) throw new Error("任务为空");

  const ag = resolveCliSnapshot(userData, agents);

  const { scopes, writeIntent } = resolveDataScopes(payload);
  if (!scopes.includes("workspace_files")) {
    throw new Error("外部执行体未沙箱化，必须先明确确认可改动授权目录中的文件。");
  }

  // decisionId is always minted by the main process; renderer-supplied values are ignored.
  const rawRequest = buildExternalCliRequest({
    taskText: task,
    dataScopes: scopes,
    agent: ag,
    writeIntent,
  });
  const decision = evaluatePolicy(
    rawRequest,
    {
      cliEnabled: !!ag.enabled && !!ag.command,
      hasCommand: !!(ag.command && String(ag.command).trim()),
    }
  );

  appendDecisionEvent(userData, decision, "policy_evaluated", {
    outcome: { status: decision.effect, reasonCodes: decision.reasonCodes },
  });

  if (decision.effect === "deny") {
    const msg =
      decision.reasonCodes.includes("cli_not_configured")
        ? "请先在设置中启用并填写外部命令。"
        : "当前请求未通过安全策略，无法委派外部程序。";
    const e = new Error(msg);
    e.code = "policy_denied";
    e.decision = decision;
    throw e;
  }

  if (decision.effect !== "require_confirmation") {
    const e = new Error("当前请求未通过安全策略，无法委派外部程序。");
    e.code = "policy_denied";
    throw e;
  }

  const senderId = senderIdFromEvent(event);
  const { tokenId, correlationId, expiresAt } = confirmationStore.issueToken(
    {
      requestDigest: decision.requestDigest,
      actor: decision.request.actor,
      action: decision.request.action,
      destination: decision.request.destination,
      dataScopes: decision.request.dataScopes,
      cwd: decision.request.resource.cwdNormalized || "",
      senderId,
      taskDigest: decision.request.taskDigest,
      decisionId: decision.decisionId,
      executorConfigFingerprint: decision.request.resource.configFingerprint,
    },
  );

  appendDecisionEvent(userData, decision, "confirmation_issued", {
    approval: { confirmationId: correlationId },
    outcome: { status: "awaiting_confirmation", expiresAt, reasonCodes: decision.reasonCodes },
  });

  return {
    status: "require_confirmation",
    decisionId: decision.decisionId,
    confirmationToken: tokenId,
    expiresAt,
    summary: decision.confirmationSummary,
    policyVersion: decision.policyVersion,
    requestDigest: decision.requestDigest,
  };
}

function cancelExternalAgentConfirmation(userData, event, payload) {
  ensureAuditHealthy(userData);
  const tokenId = String((payload && payload.confirmationToken) || "").trim();
  const decisionId = String((payload && payload.decisionId) || "").trim();
  const senderId = senderIdFromEvent(event);
  const result = confirmationStore.revokeToken(tokenId, {
    reason: "owner_canceled",
    senderId,
    decisionId,
  });
  if (!result.ok) {
    throw new Error(safeDenyReason(result.reason));
  }
  const token = result.token;
  appendAuditOrThrow(userData, {
    decisionId: token.decisionId,
    policyVersion: POLICY_VERSION,
    requestDigest: token.requestDigest,
    actor: token.actor,
    purpose: "code_delegate",
    action: token.action,
    dataScopes: token.dataScopes,
    destination: token.destination,
    event: "confirmation_canceled",
    approval: {
      confirmationId: token.correlationId,
      canceledAt: token.revokedAt,
    },
    outcome: { status: "canceled" },
  });
  return { ok: true, decisionId: token.decisionId };
}

function requestAuditRotate(userData, event) {
  ensureAuditHealthy(userData);
  const verify = decisionAudit.verify(userData);
  const decisionId = "rot_" + crypto.randomBytes(8).toString("hex");
  const currentGeneration = verify.meta ? verify.meta.currentGeneration : 1;
  const current = verify.generations.find((item) => item.generation === currentGeneration);
  const senderId = senderIdFromEvent(event);
  const { tokenId, correlationId, expiresAt } = confirmationStore.issueToken({
    requestDigest: `rotate:${currentGeneration}`,
    actor: "owner:settings",
    action: "rotate_generation",
    destination: "local_ledger",
    dataScopes: [],
    cwd: "",
    senderId,
    taskDigest: `rotate:${currentGeneration}`,
    decisionId,
    executorConfigFingerprint: "decision-audit",
  });
  appendAuditOrThrow(userData, {
    decisionId,
    policyVersion: POLICY_VERSION,
    requestDigest: `rotate:${currentGeneration}`,
    actor: "owner:settings",
    purpose: "audit_maintenance",
    action: "rotate_generation",
    dataScopes: [],
    destination: "local_ledger",
    event: "rotation_confirmation_issued",
    approval: { confirmationId: correlationId },
    outcome: {
      status: "awaiting_confirmation",
      expiresAt,
      fromGeneration: currentGeneration,
      previousGenerationLastHash: current ? current.lastHash : decisionAudit.GENESIS_HASH,
    },
  });
  return {
    decisionId,
    rotationToken: tokenId,
    expiresAt,
    currentGeneration,
  };
}

function confirmAuditRotate(userData, event, payload) {
  ensureAuditHealthy(userData);
  const tokenId = String((payload && payload.rotationToken) || "").trim();
  const decisionId = String((payload && payload.decisionId) || "").trim();
  const senderId = senderIdFromEvent(event);
  const verify = decisionAudit.verify(userData);
  const currentGeneration = verify.meta ? verify.meta.currentGeneration : 1;
  const consumed = confirmationStore.consumeToken(tokenId, {
    requestDigest: `rotate:${currentGeneration}`,
    actor: "owner:settings",
    action: "rotate_generation",
    destination: "local_ledger",
    dataScopes: [],
    cwd: "",
    senderId,
    taskDigest: `rotate:${currentGeneration}`,
    decisionId,
    executorConfigFingerprint: "decision-audit",
  });
  if (!consumed.ok) throw new Error(safeDenyReason(consumed.reason));
  appendAuditOrThrow(userData, {
    decisionId,
    policyVersion: POLICY_VERSION,
    requestDigest: `rotate:${currentGeneration}`,
    actor: "owner:settings",
    purpose: "audit_maintenance",
    action: "rotate_generation",
    dataScopes: [],
    destination: "local_ledger",
    event: "rotation_confirmation_consumed",
    approval: correlationApproval(consumed.token),
    outcome: { status: "confirmed", fromGeneration: currentGeneration },
  });
  return decisionAudit.rotate(userData, {
    decisionId,
    policyVersion: POLICY_VERSION,
    actor: "owner:settings",
    approval: correlationApproval(consumed.token),
  });
}

function appendDeniedConfirmation(userData, decision, token, reason) {
  appendAuditOrThrow(userData, {
    ...auditFieldsFromDecision(decision),
    event: "confirmation_denied",
    approval: token ? { confirmationId: token.correlationId } : null,
    outcome: { status: "denied", reasonCodes: [reason] },
  });
}

function buildDecisionForExecution(userData, event, payload, agents) {
  const { scopes, writeIntent } = resolveDataScopes(payload);
  if (!scopes.includes("workspace_files")) {
    throw new Error("外部执行体未沙箱化，必须先明确确认可改动授权目录中的文件。");
  }
  const ag = resolveCliSnapshot(userData, agents);
  const decisionId = String((payload && payload.decisionId) || "").trim();
  if (!decisionId) throw new Error("缺少原始决策编号，请重新发起确认。");
  const rawRequest = buildExternalCliRequest({
    taskText: String((payload && payload.task) || "").trim(),
    dataScopes: scopes,
    agent: ag,
    writeIntent,
  });
  const decision = evaluatePolicy(
    rawRequest,
    {
      cliEnabled: !!ag.enabled && !!ag.command,
      hasCommand: !!(ag.command && String(ag.command).trim()),
    },
    { decisionId }
  );
  return { decision, agentSnapshot: ag };
}

/**
 * Phase 2: re-evaluate, consume token, audit-approved, execute.
 */
async function runExternalAgent(userData, event, payload, agents, deps = {}) {
  ensureAuditHealthy(userData);
  const runCliAgent = deps.runCliAgent || agents.runCliAgent;
  const onProgress = deps.onProgress || (() => {});

  const task = String((payload && payload.task) || "").trim();
  if (!task) throw new Error("任务为空");

  const tokenId = String((payload && payload.confirmationToken) || "").trim();
  if (!tokenId) {
    throw new Error("缺少确认凭据：请先查看确认摘要并同意后再执行。");
  }
  if (payload && (payload.writeAuthorized || payload.confirmed)) {
    throw new Error("确认须由主进程签发的一次性凭据完成，界面勾选不能代替确认。");
  }

  const { decision, agentSnapshot } = buildDecisionForExecution(userData, event, payload, agents);
  appendDecisionEvent(userData, decision, "policy_evaluated", {
    outcome: { status: decision.effect, reasonCodes: decision.reasonCodes },
  });

  if (decision.effect !== "require_confirmation") {
    throw new Error("当前请求未通过安全策略，无法委派外部程序。");
  }

  const senderId = senderIdFromEvent(event);
  const consumed = confirmationStore.consumeToken(tokenId, {
    requestDigest: decision.requestDigest,
    actor: decision.request.actor,
    action: decision.request.action,
    destination: decision.request.destination,
    dataScopes: decision.request.dataScopes,
    cwd: decision.request.resource.cwdNormalized || "",
    senderId,
    taskDigest: decision.request.taskDigest,
    decisionId: decision.decisionId,
    executorConfigFingerprint: decision.request.resource.configFingerprint,
  });
  if (!consumed.ok) {
    const peek = confirmationStore.peekToken(tokenId);
    try {
      appendDeniedConfirmation(userData, decision, peek, consumed.reason);
    } catch {
      /* fail-closed path will surface original error */
    }
    throw new Error(safeDenyReason(consumed.reason));
  }
  const token = consumed.token;

  appendDecisionEvent(userData, decision, "confirmation_consumed", {
    approval: correlationApproval(token),
    outcome: { status: "confirmed" },
  });

  appendDecisionEvent(userData, decision, "execution_approved", {
    approval: correlationApproval(token),
    outcome: { status: "approved" },
  });

  const rid = (payload && payload.requestId) || "dlg_" + Date.now();
  const signal = deps.signal;

  appendDecisionEvent(userData, decision, "execution_started", {
    approval: correlationApproval(token),
    outcome: { status: "started" },
  });

  onProgress({ phase: "thinking", label: "正在调度外部执行体…" });

  let auditIncomplete = false;
  try {
    const result = await runCliAgent(userData, { task, signal, agentConfig: agentSnapshot });
    const outputDigest = decisionAudit.digestOutput(result.output || "");
    const outcomeStatus = result.aborted
      ? "aborted"
      : result.ok
        ? "completed"
        : "failed";

    try {
      appendAuditOrThrow(userData, {
        ...auditFieldsFromDecision(decision),
        event: result.aborted
          ? "execution_aborted"
          : result.ok
            ? "execution_completed"
            : "execution_failed",
        approval: correlationApproval(token),
        outcome: {
          status: outcomeStatus,
          exitCode: result.code,
          ...outputDigest,
        },
      });
    } catch {
      auditIncomplete = true;
    }

    if (result.aborted) {
      onProgress({ phase: "done" });
      return {
        ok: false,
        aborted: true,
        reply: auditIncomplete
          ? "已停止外部执行体。注意：部分决策记录未能写入（audit_incomplete）。"
          : "已停止外部执行体。",
        meta: { capabilitiesUsed: [agentSnapshot.id], auditIncomplete },
      };
    }

    const replyPrefix = result.ok
      ? "外部执行体已结束。\n\n"
      : "外部执行体结束（可能非零退出码）。\n\n";
    const reply =
      replyPrefix +
      (result.output || "（无输出）") +
      (auditIncomplete ? "\n\n注意：部分决策记录未能写入（audit_incomplete）。" : "");

    onProgress({ phase: "done" });
    return {
      ok: result.ok,
      reply,
      meta: {
        capabilitiesUsed: [agentSnapshot.id],
        usedTools: true,
        executor: agentSnapshot.name,
        auditIncomplete,
      },
    };
  } catch (err) {
    try {
      appendAuditOrThrow(userData, {
        ...auditFieldsFromDecision(decision),
        event: "execution_failed",
        approval: correlationApproval(token),
        outcome: { status: "error" },
      });
    } catch {
      auditIncomplete = true;
    }
    onProgress({ phase: "done" });
    const e = new Error(
      String(err.message || err) +
        (auditIncomplete ? "（决策记录未完整写入：audit_incomplete）" : "")
    );
    e.auditIncomplete = auditIncomplete;
    throw e;
  }
}

module.exports = {
  confirmAuditRotate,
  cancelExternalAgentConfirmation,
  requestExternalAgent,
  requestAuditRotate,
  runExternalAgent,
  senderIdFromEvent,
  resolveDataScopes,
  digestTaskText,
};

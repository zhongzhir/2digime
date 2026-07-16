"use strict";

const path = require("node:path");
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
  const writeIntent =
    !!(payload && payload.writeIntent) ||
    !!(payload && payload.allowWorkspaceWrite);
  if (writeIntent && !scopes.includes("workspace_files")) scopes.push("workspace_files");
  if (!scopes.includes("task_text")) scopes.push("task_text");
  if (!scopes.includes("env_inherit")) scopes.push("env_inherit");
  return { scopes, writeIntent };
}

/**
 * Phase 1: evaluate policy, issue confirmation token if needed.
 */
function requestExternalAgent(userData, event, payload, agents) {
  const task = String((payload && payload.task) || "").trim();
  if (!task) throw new Error("任务为空");

  const ag = agents.getActiveAgent(userData);
  if (!ag || ag.kind !== "cli") throw new Error("当前未选用外部命令执行体");

  const { scopes, writeIntent } = resolveDataScopes(payload);
  if (writeIntent && !scopes.includes("workspace_files")) {
    throw new Error("外部执行体可能改文件：请勾选允许改动授权目录中的文件。");
  }

  const rawRequest = buildExternalCliRequest({
    taskText: task,
    dataScopes: scopes,
    agent: ag,
    writeIntent,
  });
  const decision = evaluatePolicy(rawRequest, {
    cliEnabled: !!ag.enabled && !!ag.command,
    hasCommand: !!(ag.command && String(ag.command).trim()),
  });

  appendAuditOrThrow(userData, {
    ...auditFieldsFromDecision(decision),
    event: "policy_evaluated",
    approval: null,
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
  const { tokenId, expiresAt } = confirmationStore.issueToken(
    {
      requestDigest: decision.requestDigest,
      actor: decision.request.actor,
      action: decision.request.action,
      destination: decision.request.destination,
      dataScopes: decision.request.dataScopes,
      cwd: decision.request.resource.cwd || "",
      senderId,
      taskDigest: decision.request.taskDigest,
      decisionId: decision.decisionId,
    },
    { ttlMs: payload && payload.confirmationTtlMs }
  );

  appendAuditOrThrow(userData, {
    ...auditFieldsFromDecision(decision),
    event: "confirmation_issued",
    approval: { tokenId },
    outcome: { status: "awaiting_confirmation", expiresAt },
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

/**
 * Phase 2: re-evaluate, consume token, audit-approved, execute.
 */
async function runExternalAgent(userData, event, payload, agents, deps = {}) {
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

  const ag = agents.getActiveAgent(userData);
  if (!ag || ag.kind !== "cli") throw new Error("当前未选用外部命令执行体");

  const { scopes, writeIntent } = resolveDataScopes(payload);
  if (writeIntent && !scopes.includes("workspace_files")) {
    throw new Error("外部执行体可能改文件：请勾选允许改动授权目录中的文件。");
  }

  const rawRequest = buildExternalCliRequest({
    taskText: task,
    dataScopes: scopes,
    agent: ag,
    writeIntent,
  });
  const decision = evaluatePolicy(rawRequest, {
    cliEnabled: !!ag.enabled && !!ag.command,
    hasCommand: !!(ag.command && String(ag.command).trim()),
  });

  appendAuditOrThrow(userData, {
    ...auditFieldsFromDecision(decision),
    event: "policy_evaluated",
    approval: null,
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
    cwd: decision.request.resource.cwd || "",
    senderId,
    taskDigest: decision.request.taskDigest,
  });
  if (!consumed.ok) {
    const reasons = {
      missing_token: "缺少有效确认凭据。",
      unknown_token: "确认凭据无效或已失效。",
      token_replayed: "该确认凭据已使用，不能重复执行。",
      token_expired: "确认凭据已过期，请重新发起请求。",
      token_binding_mismatch: "请求内容与确认时不一致，已拒绝。",
      token_scope_mismatch: "数据范围与确认时不一致，已拒绝。",
    };
    throw new Error(reasons[consumed.reason] || "确认凭据校验失败。");
  }

  appendAuditOrThrow(userData, {
    ...auditFieldsFromDecision(decision),
    event: "confirmation_consumed",
    approval: { tokenId, confirmedAt: consumed.token.consumedAt },
    outcome: { status: "confirmed" },
  });

  appendAuditOrThrow(userData, {
    ...auditFieldsFromDecision(decision),
    event: "execution_approved",
    approval: { tokenId },
    outcome: { status: "approved" },
  });

  const rid = (payload && payload.requestId) || "dlg_" + Date.now();
  const signal = deps.signal;

  appendAuditOrThrow(userData, {
    ...auditFieldsFromDecision(decision),
    event: "execution_started",
    approval: { tokenId },
    outcome: { status: "started", executorId: ag.id },
  });

  onProgress({ phase: "thinking", label: "正在调度外部执行体…" });

  let auditIncomplete = false;
  try {
    const result = await runCliAgent(userData, { task, signal });
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
        approval: { tokenId },
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
        meta: { capabilitiesUsed: [ag.id], auditIncomplete },
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
        capabilitiesUsed: [ag.id],
        usedTools: true,
        executor: ag.name,
        auditIncomplete,
      },
    };
  } catch (err) {
    try {
      appendAuditOrThrow(userData, {
        ...auditFieldsFromDecision(decision),
        event: "execution_failed",
        approval: { tokenId },
        outcome: { status: "error", message: String(err.message || err).slice(0, 120) },
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
  requestExternalAgent,
  runExternalAgent,
  senderIdFromEvent,
  resolveDataScopes,
  digestTaskText,
};

"use strict";

const crypto = require("node:crypto");
const { POLICY_VERSION, normalizePolicyRequest } = require("./schema");
const { buildRequestDigest, digestTaskText, digestValue, stableStringify } = require("./digest");

function newDecisionId() {
  return "dec_" + crypto.randomBytes(8).toString("hex");
}

function buildConfirmationSummary(request) {
  return {
    headline: "即将让本机外部程序执行任务",
    notSandboxNotice: "受限执行，不是安全沙箱",
    executorName: request.resource.executorName,
    toolId: request.resource.toolId,
    definitionVersion: request.resource.definitionVersion,
    commandLabel: request.resource.commandBasename,
    executableAbsolute: request.resource.executableAbsolute || "",
    cwd: request.resource.cwdDisplay || request.resource.cwdNormalized || "（未指定）",
    envKeyNames: Array.isArray(request.resource.envKeyNames) ? [...request.resource.envKeyNames] : [],
    timeoutMs: Number(request.resource.timeoutMs) || 0,
    maxOutputBytes: Number(request.resource.maxOutputBytes) || 0,
    dataScopes: request.dataScopes.map(scopeLabel),
    mayModifyFiles: true,
    risk: riskLabel(request.risk),
    taskLength: request.taskLength,
  };
}

function scopeLabel(scope) {
  if (scope === "task_text") return "任务说明文本";
  if (scope === "workspace_files") return "授权目录中的文件";
  if (scope === "env_inherit") return "白名单环境变量（不含值）";
  return scope;
}

function riskLabel(risk) {
  if (risk === "high") return "高";
  if (risk === "medium") return "中";
  if (risk === "low") return "低";
  return risk;
}

/**
 * v1 内置规则表（版本化，fail-closed）
 * @param {object} request normalized request
 * @param {{ cliEnabled?: boolean, hasCommand?: boolean, hasPlan?: boolean }} context
 */
function evaluateRules(request, context = {}) {
  if (!context.cliEnabled || !context.hasCommand || !context.hasPlan) {
    return {
      effect: "deny",
      reasonCodes: ["cli_not_configured"],
      obligations: [],
    };
  }
  if (!request.dataScopes.includes("workspace_files")) {
    return {
      effect: "deny",
      reasonCodes: ["workspace_write_confirmation_required"],
      obligations: [],
    };
  }

  if (request.action === "external_cli_execute" && request.destination === "local_subprocess") {
    if (request.risk === "high") {
      const obligations = [
        { type: "owner_confirmation", message: "须由你亲自确认后才会启动外部程序" },
      ];
      if (request.dataScopes.includes("workspace_files")) {
        obligations.push({
          type: "acknowledge_write_scope",
          message: "本次可能改动授权目录中的文件",
        });
      }
      obligations.push({
        type: "acknowledge_not_sandbox",
        message: "本次为受限执行，不是安全沙箱",
      });
      return {
        effect: "require_confirmation",
        reasonCodes: ["external_cli_requires_confirmation"],
        obligations,
      };
    }
    return {
      effect: "deny",
      reasonCodes: ["risk_not_allowed"],
      obligations: [],
    };
  }

  return {
    effect: "deny",
    reasonCodes: ["rule_miss"],
    obligations: [],
  };
}

/**
 * @param {object} rawRequest
 * @param {{ cliEnabled?: boolean, hasCommand?: boolean, hasPlan?: boolean }} context
 * @param {{ decisionId?: string }} options
 */
function evaluatePolicy(rawRequest, context = {}, options = {}) {
  const normalized = normalizePolicyRequest(rawRequest);
  if (!normalized.ok) {
    return {
      policyVersion: POLICY_VERSION,
      effect: "deny",
      decisionId: options.decisionId || newDecisionId(),
      reasonCodes: normalized.reasonCodes,
      obligations: [],
      requestDigest: "",
      request: null,
      confirmationSummary: null,
    };
  }

  const request = normalized.request;
  const requestDigest = buildRequestDigest(request);
  const rules = evaluateRules(request, context);

  const decision = {
    policyVersion: POLICY_VERSION,
    effect: rules.effect,
    decisionId: options.decisionId || newDecisionId(),
    reasonCodes: rules.reasonCodes,
    obligations: rules.obligations,
    requestDigest,
    request,
    confirmationSummary:
      rules.effect === "require_confirmation" ? buildConfirmationSummary(request) : null,
  };
  return decision;
}

/**
 * Build policy request from a ToolBroker plan (+ agent display metadata).
 */
function buildExternalCliRequest({ taskText, dataScopes, agent, writeIntent, plan, planDigest }) {
  const task = digestTaskText(taskText);
  const scopes = Array.isArray(dataScopes) ? [...dataScopes] : [];
  if (!scopes.includes("task_text")) scopes.push("task_text");
  if (writeIntent && !scopes.includes("workspace_files")) scopes.push("workspace_files");
  if (!scopes.includes("env_inherit")) scopes.push("env_inherit");

  if (!plan || !planDigest) {
    return {
      actor: "owner:renderer",
      purpose: "code_delegate",
      action: "external_cli_execute",
      destination: "local_subprocess",
      risk: "high",
      dataScopes: scopes,
      resource: {
        executorId: String((agent && agent.id) || "cli-coder"),
        executorName: String((agent && agent.name) || "本地命令工具"),
        commandBasename: "",
        cwdDisplay: "",
        cwdNormalized: "",
        commandFingerprint: "",
        argsTemplateFingerprint: "",
        cwdFingerprint: "",
        configFingerprint: "",
        toolId: "",
        definitionVersion: "",
        executableAbsolute: "",
        executableFingerprint: "",
        planDigest: "",
        envKeyNames: [],
        timeoutMs: 0,
        maxOutputBytes: 0,
      },
      taskDigest: task.taskDigest,
      taskLength: task.taskLength,
    };
  }

  const argsTemplate = Array.isArray(plan.argsTemplate) ? plan.argsTemplate.map(String) : [];
  const configFingerprint = digestValue(
    stableStringify({
      toolId: plan.toolId,
      definitionVersion: plan.definitionVersion,
      executableFingerprint: plan.executableFingerprint,
      argsTemplate,
      cwd: plan.cwd,
      envKeyNames: plan.envKeyNames,
      timeoutMs: plan.timeoutMs,
      maxOutputBytes: plan.maxOutputBytes,
      planDigest,
    })
  );

  return {
    actor: "owner:renderer",
    purpose: "code_delegate",
    action: "external_cli_execute",
    destination: "local_subprocess",
    risk: "high",
    dataScopes: scopes,
    resource: {
      executorId: String((agent && agent.id) || plan.toolId || "cli-coder"),
      executorName: String((agent && agent.name) || plan.toolName || "本地命令工具"),
      commandBasename: plan.executableBasename || pathBasename(plan.executable),
      cwdDisplay: plan.cwd,
      cwdNormalized: plan.cwd,
      commandFingerprint: digestValue(plan.executable),
      argsTemplateFingerprint: digestValue(stableStringify(argsTemplate)),
      cwdFingerprint: digestValue(plan.cwd),
      configFingerprint,
      toolId: plan.toolId,
      definitionVersion: plan.definitionVersion,
      executableAbsolute: plan.executable,
      executableFingerprint: plan.executableFingerprint,
      planDigest,
      envKeyNames: Array.isArray(plan.envKeyNames) ? [...plan.envKeyNames] : [],
      timeoutMs: plan.timeoutMs,
      maxOutputBytes: plan.maxOutputBytes,
    },
    taskDigest: task.taskDigest,
    taskLength: task.taskLength,
  };
}

function pathBasename(p) {
  const s = String(p || "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

module.exports = {
  POLICY_VERSION,
  evaluatePolicy,
  buildExternalCliRequest,
  buildConfirmationSummary,
  buildRequestDigest,
};

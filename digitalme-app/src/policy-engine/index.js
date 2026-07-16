"use strict";

const crypto = require("node:crypto");
const { POLICY_VERSION, normalizePolicyRequest } = require("./schema");
const { buildRequestDigest } = require("./digest");

function newDecisionId() {
  return "dec_" + crypto.randomBytes(8).toString("hex");
}

function buildConfirmationSummary(request) {
  const mayWrite = request.dataScopes.includes("workspace_files");
  return {
    headline: "即将让本机外部程序执行任务",
    executorName: request.resource.executorName,
    commandLabel: request.resource.commandBasename,
    cwd: request.resource.cwd || "（未指定，使用进程默认目录）",
    dataScopes: request.dataScopes.map(scopeLabel),
    mayModifyFiles: mayWrite,
    risk: riskLabel(request.risk),
    taskLength: request.taskLength,
  };
}

function scopeLabel(scope) {
  if (scope === "task_text") return "任务说明文本";
  if (scope === "workspace_files") return "授权目录中的文件";
  if (scope === "env_inherit") return "本机环境变量";
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
 * @param {{ cliEnabled?: boolean, hasCommand?: boolean }} context
 */
function evaluateRules(request, context = {}) {
  if (!context.cliEnabled || !context.hasCommand) {
    return {
      effect: "deny",
      reasonCodes: ["cli_not_configured"],
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
 * @param {{ cliEnabled?: boolean, hasCommand?: boolean }} context
 */
function evaluatePolicy(rawRequest, context = {}) {
  const normalized = normalizePolicyRequest(rawRequest);
  if (!normalized.ok) {
    return {
      policyVersion: POLICY_VERSION,
      effect: "deny",
      decisionId: newDecisionId(),
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
    decisionId: newDecisionId(),
    reasonCodes: rules.reasonCodes,
    obligations: rules.obligations,
    requestDigest,
    request,
    confirmationSummary:
      rules.effect === "require_confirmation" ? buildConfirmationSummary(request) : null,
  };
  return decision;
}

function buildExternalCliRequest({
  taskText,
  dataScopes,
  agent,
  writeIntent,
}) {
  const { digestTaskText } = require("./digest");
  const task = digestTaskText(taskText);
  const scopes = Array.isArray(dataScopes) ? [...dataScopes] : [];
  if (!scopes.includes("task_text")) scopes.push("task_text");
  if (writeIntent && !scopes.includes("workspace_files")) scopes.push("workspace_files");
  scopes.push("env_inherit");
  const command = String((agent && agent.command) || "").trim();
  const commandBasename = command ? command.replace(/^.*[\\/]/, "") : "";
  return {
    actor: "owner:renderer",
    purpose: "code_delegate",
    action: "external_cli_execute",
    destination: "local_subprocess",
    risk: "high",
    dataScopes: scopes,
    resource: {
      executorId: String((agent && agent.id) || "cli-coder"),
      executorName: String((agent && agent.name) || "外部命令执行体"),
      commandBasename: commandBasename || "（未配置）",
      cwd: String((agent && agent.cwd) || ""),
    },
    taskDigest: task.taskDigest,
    taskLength: task.taskLength,
  };
}

module.exports = {
  POLICY_VERSION,
  evaluatePolicy,
  buildExternalCliRequest,
  buildConfirmationSummary,
  buildRequestDigest,
};

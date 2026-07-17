"use strict";

const TOOL_BROKER_VERSION = "p1-05-v1";
const LOCAL_CLI_TOOL_ID = "local_cli";

const DEFAULT_TIMEOUT_MS = 60 * 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_TASK_CHARS = 8 * 1024;
const MAX_ARG_COUNT = 32;

/** Windows process-required keys (matched case-insensitively). No PATH by default. */
const DEFAULT_ENV_ALLOWLIST = Object.freeze(["SystemRoot", "WINDIR", "TEMP", "TMP"]);

const FORBIDDEN_EXECUTABLE_EXTS = new Set([
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".js",
  ".jse",
  ".wsf",
  ".wsh",
]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * @param {object} raw
 * @returns {{ ok: true, definition: object } | { ok: false, reasonCodes: string[] }}
 */
function normalizeToolDefinition(raw) {
  const reasonCodes = [];
  if (!raw || typeof raw !== "object") {
    return { ok: false, reasonCodes: ["invalid_tool_definition"] };
  }
  const toolId = String(raw.toolId || "").trim();
  const definitionVersion = String(raw.definitionVersion || "").trim();
  const name = String(raw.name || "").trim();
  const executable = String(raw.executable || "").trim();
  const argsTemplate = Array.isArray(raw.argsTemplate) ? raw.argsTemplate.map(String) : null;
  const allowedActions = Array.isArray(raw.allowedActions)
    ? raw.allowedActions.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const timeoutMs = Number(raw.timeoutMs);
  const maxOutputBytes = Number(raw.maxOutputBytes);
  const envAllowlist = Array.isArray(raw.envAllowlist)
    ? raw.envAllowlist.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const authorizedCwdRoot = String(raw.authorizedCwdRoot || "").trim();
  const enabled = !!raw.enabled;

  if (toolId !== LOCAL_CLI_TOOL_ID) reasonCodes.push("unknown_tool_id");
  if (!isNonEmptyString(definitionVersion)) reasonCodes.push("missing_definition_version");
  if (!isNonEmptyString(name)) reasonCodes.push("missing_tool_name");
  if (!Array.isArray(argsTemplate) || !argsTemplate.length) reasonCodes.push("missing_args_template");
  else if (argsTemplate.length > MAX_ARG_COUNT) reasonCodes.push("args_template_too_long");
  else {
    for (const part of argsTemplate) {
      if (typeof part !== "string") reasonCodes.push("invalid_args_template");
      if (part.includes("\0")) reasonCodes.push("args_nul");
    }
  }
  if (!allowedActions.includes("execute_task")) reasonCodes.push("missing_allowed_action");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 500 || timeoutMs > 10 * 60 * 1000) {
    reasonCodes.push("invalid_timeout");
  }
  if (!Number.isFinite(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 2 * 1024 * 1024) {
    reasonCodes.push("invalid_max_output");
  }
  if (!envAllowlist.length) reasonCodes.push("missing_env_allowlist");

  if (reasonCodes.length) return { ok: false, reasonCodes };

  return {
    ok: true,
    definition: {
      toolId,
      definitionVersion,
      name,
      executable,
      argsTemplate: [...argsTemplate],
      allowedActions: [...new Set(allowedActions)].sort(),
      timeoutMs: Math.floor(timeoutMs),
      maxOutputBytes: Math.floor(maxOutputBytes),
      envAllowlist: [...new Set(envAllowlist)],
      authorizedCwdRoot,
      enabled,
    },
  };
}

function defaultLocalCliDefinition() {
  return {
    toolId: LOCAL_CLI_TOOL_ID,
    definitionVersion: TOOL_BROKER_VERSION,
    name: "本地命令工具",
    executable: "",
    argsTemplate: ["{{task}}"],
    allowedActions: ["execute_task"],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    envAllowlist: [...DEFAULT_ENV_ALLOWLIST],
    authorizedCwdRoot: "",
    enabled: false,
  };
}

module.exports = {
  TOOL_BROKER_VERSION,
  LOCAL_CLI_TOOL_ID,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_ENV_ALLOWLIST,
  FORBIDDEN_EXECUTABLE_EXTS,
  MAX_TASK_CHARS,
  MAX_ARG_COUNT,
  normalizeToolDefinition,
  defaultLocalCliDefinition,
};

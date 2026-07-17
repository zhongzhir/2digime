"use strict";

const TOOL_BROKER_VERSION = "p1-05-v1";
const LOCAL_CLI_TOOL_ID = "local_cli";

const DEFAULT_TIMEOUT_MS = 60 * 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_TASK_CHARS = 8 * 1024;
const MAX_ARG_COUNT = 32;

/** Windows process-required keys (matched case-insensitively). No PATH by default. */
const DEFAULT_ENV_ALLOWLIST = Object.freeze(["SystemRoot", "WINDIR", "TEMP", "TMP"]);

/**
 * Code-owned fixed args contract for local_cli.
 * Owner settings cannot widen this; only the whole-token {{task}} placeholder is allowed.
 */
const FIXED_LOCAL_CLI_ARGS_TEMPLATE = Object.freeze(["{{task}}"]);

const FORBIDDEN_EXECUTABLE_EXTS = new Set([
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".js",
  ".jse",
  ".wsf",
  ".wsh",
  ".vbe",
  ".ws",
  ".msc",
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
  const argsTemplate = [...FIXED_LOCAL_CLI_ARGS_TEMPLATE];
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
  const profileId = String(raw.profileId || "local_cli_task_passthrough_v1").trim();

  if (toolId !== LOCAL_CLI_TOOL_ID) reasonCodes.push("unknown_tool_id");
  if (!isNonEmptyString(definitionVersion)) reasonCodes.push("missing_definition_version");
  if (!isNonEmptyString(name)) reasonCodes.push("missing_tool_name");
  if (!allowedActions.includes("execute_task")) reasonCodes.push("missing_allowed_action");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 500 || timeoutMs > 10 * 60 * 1000) {
    reasonCodes.push("invalid_timeout");
  }
  if (!Number.isFinite(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 2 * 1024 * 1024) {
    reasonCodes.push("invalid_max_output");
  }
  if (!envAllowlist.length) reasonCodes.push("missing_env_allowlist");
  if (profileId !== "local_cli_task_passthrough_v1") reasonCodes.push("unknown_tool_profile");

  if (reasonCodes.length) return { ok: false, reasonCodes };

  return {
    ok: true,
    definition: {
      toolId,
      definitionVersion,
      profileId,
      name,
      executable,
      argsTemplate,
      allowedActions: [...new Set(allowedActions)].sort(),
      timeoutMs: Math.floor(timeoutMs),
      maxOutputBytes: Math.floor(maxOutputBytes),
      envAllowlist: [...new Set(envAllowlist)],
      authorizedCwdRoot,
      enabled,
      pinnedIdentity: raw.pinnedIdentity && typeof raw.pinnedIdentity === "object" ? raw.pinnedIdentity : null,
    },
  };
}

function defaultLocalCliDefinition() {
  return {
    toolId: LOCAL_CLI_TOOL_ID,
    definitionVersion: TOOL_BROKER_VERSION,
    profileId: "local_cli_task_passthrough_v1",
    name: "本地命令工具",
    executable: "",
    argsTemplate: [...FIXED_LOCAL_CLI_ARGS_TEMPLATE],
    allowedActions: ["execute_task"],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    envAllowlist: [...DEFAULT_ENV_ALLOWLIST],
    authorizedCwdRoot: "",
    enabled: false,
    pinnedIdentity: null,
  };
}

module.exports = {
  TOOL_BROKER_VERSION,
  LOCAL_CLI_TOOL_ID,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_ENV_ALLOWLIST,
  FIXED_LOCAL_CLI_ARGS_TEMPLATE,
  FORBIDDEN_EXECUTABLE_EXTS,
  MAX_TASK_CHARS,
  MAX_ARG_COUNT,
  normalizeToolDefinition,
  defaultLocalCliDefinition,
};

"use strict";

const POLICY_VERSION = "p1-05-v1";

const ACTORS = new Set(["owner:renderer"]);
const PURPOSES = new Set(["code_delegate"]);
const ACTIONS = new Set(["external_cli_execute"]);
const DESTINATIONS = new Set(["local_subprocess"]);
const RISKS = new Set(["low", "medium", "high"]);
const DATA_SCOPES = new Set(["task_text", "workspace_files", "env_inherit"]);
const EFFECTS = new Set(["allow", "deny", "require_confirmation"]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeStringArray(values, allowed) {
  if (!Array.isArray(values)) return { ok: false, values: [] };
  const out = [];
  for (const raw of values) {
    const v = String(raw || "").trim();
    if (!v) continue;
    if (!allowed.has(v)) return { ok: false, values: [] };
    if (!out.includes(v)) out.push(v);
  }
  out.sort();
  return { ok: true, values: out };
}

/**
 * @param {object} raw
 * @returns {{ ok: true, request: object } | { ok: false, reasonCodes: string[] }}
 */
function normalizePolicyRequest(raw) {
  const reasonCodes = [];
  if (!raw || typeof raw !== "object") {
    return { ok: false, reasonCodes: ["invalid_request"] };
  }

  const actor = String(raw.actor || "").trim();
  const purpose = String(raw.purpose || "").trim();
  const action = String(raw.action || "").trim();
  const destination = String(raw.destination || "").trim();
  const risk = String(raw.risk || "").trim();

  if (!isNonEmptyString(actor)) reasonCodes.push("missing_actor");
  else if (!ACTORS.has(actor)) reasonCodes.push("unknown_actor");

  if (!isNonEmptyString(purpose)) reasonCodes.push("missing_purpose");
  else if (!PURPOSES.has(purpose)) reasonCodes.push("unknown_purpose");

  if (!isNonEmptyString(action)) reasonCodes.push("missing_action");
  else if (!ACTIONS.has(action)) reasonCodes.push("unknown_action");

  if (!isNonEmptyString(destination)) reasonCodes.push("missing_destination");
  else if (!DESTINATIONS.has(destination)) reasonCodes.push("unknown_destination");

  if (!isNonEmptyString(risk)) reasonCodes.push("missing_risk");
  else if (!RISKS.has(risk)) reasonCodes.push("unknown_risk");

  const scopeNorm = normalizeStringArray(raw.dataScopes, DATA_SCOPES);
  if (!scopeNorm.ok) reasonCodes.push("unknown_data_scope");
  if (!scopeNorm.values.length) reasonCodes.push("missing_data_scopes");

  const resource = raw.resource && typeof raw.resource === "object" ? raw.resource : null;
  if (!resource) reasonCodes.push("missing_resource");
  else {
    if (!isNonEmptyString(resource.executorId)) reasonCodes.push("missing_executor_id");
    if (!isNonEmptyString(resource.executorName)) reasonCodes.push("missing_executor_name");
    if (!isNonEmptyString(resource.commandBasename)) reasonCodes.push("missing_command");
    if (!isNonEmptyString(resource.commandFingerprint)) reasonCodes.push("missing_command_fingerprint");
    if (!isNonEmptyString(resource.argsTemplateFingerprint)) reasonCodes.push("missing_args_fingerprint");
    if (!isNonEmptyString(resource.cwdFingerprint)) reasonCodes.push("missing_cwd_fingerprint");
    if (!isNonEmptyString(resource.configFingerprint)) reasonCodes.push("missing_config_fingerprint");
    if (!isNonEmptyString(resource.toolId)) reasonCodes.push("missing_tool_id");
    if (!isNonEmptyString(resource.definitionVersion)) reasonCodes.push("missing_definition_version");
    if (!isNonEmptyString(resource.executableFingerprint)) reasonCodes.push("missing_executable_fingerprint");
    if (!isNonEmptyString(resource.planDigest)) reasonCodes.push("missing_plan_digest");
    if (resource.cwdDisplay != null && typeof resource.cwdDisplay !== "string") reasonCodes.push("invalid_cwd");
    if (resource.cwdNormalized != null && typeof resource.cwdNormalized !== "string") {
      reasonCodes.push("invalid_cwd_normalized");
    }
    if (resource.envKeyNames != null && !Array.isArray(resource.envKeyNames)) {
      reasonCodes.push("invalid_env_key_names");
    }
    if (resource.timeoutMs != null && !Number.isFinite(Number(resource.timeoutMs))) {
      reasonCodes.push("invalid_timeout");
    }
  }

  if (reasonCodes.length) return { ok: false, reasonCodes };

  const envKeyNames = Array.isArray(resource.envKeyNames)
    ? resource.envKeyNames.map((k) => String(k)).filter(Boolean).sort()
    : [];

  return {
    ok: true,
    request: {
      actor,
      purpose,
      action,
      destination,
      risk,
      dataScopes: scopeNorm.values,
      resource: {
        executorId: String(resource.executorId).trim(),
        executorName: String(resource.executorName).trim(),
        commandBasename: String(resource.commandBasename).trim(),
        cwdDisplay: resource.cwdDisplay != null ? String(resource.cwdDisplay).trim() : "",
        cwdNormalized: resource.cwdNormalized != null ? String(resource.cwdNormalized).trim() : "",
        commandFingerprint: String(resource.commandFingerprint || "").trim(),
        argsTemplateFingerprint: String(resource.argsTemplateFingerprint || "").trim(),
        cwdFingerprint: String(resource.cwdFingerprint || "").trim(),
        configFingerprint: String(resource.configFingerprint || "").trim(),
        toolId: String(resource.toolId).trim(),
        definitionVersion: String(resource.definitionVersion).trim(),
        executableAbsolute: resource.executableAbsolute != null ? String(resource.executableAbsolute).trim() : "",
        executableFingerprint: String(resource.executableFingerprint).trim(),
        planDigest: String(resource.planDigest).trim(),
        envKeyNames,
        timeoutMs: Number(resource.timeoutMs) || 0,
        maxOutputBytes: Number(resource.maxOutputBytes) || 0,
      },
      taskDigest: String(raw.taskDigest || "").trim(),
      taskLength: Number(raw.taskLength) || 0,
    },
  };
}

module.exports = {
  POLICY_VERSION,
  ACTORS,
  PURPOSES,
  ACTIONS,
  DESTINATIONS,
  RISKS,
  DATA_SCOPES,
  EFFECTS,
  normalizePolicyRequest,
};

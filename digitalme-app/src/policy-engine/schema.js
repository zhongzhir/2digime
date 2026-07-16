"use strict";

const POLICY_VERSION = "p1-04-v1";

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
    if (resource.cwd != null && typeof resource.cwd !== "string") reasonCodes.push("invalid_cwd");
  }

  if (reasonCodes.length) return { ok: false, reasonCodes };

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
        cwd: resource.cwd != null ? String(resource.cwd).trim() : "",
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

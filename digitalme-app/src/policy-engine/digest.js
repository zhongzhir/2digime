"use strict";

const crypto = require("node:crypto");

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}

function digestTaskText(taskText) {
  const text = String(taskText || "");
  const hash = crypto.createHash("sha256").update(text, "utf8").digest("hex");
  return { taskDigest: hash, taskLength: text.length };
}

function digestValue(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function buildRequestDigest(request) {
  const payload = {
    actor: request.actor,
    purpose: request.purpose,
    action: request.action,
    destination: request.destination,
    risk: request.risk,
    dataScopes: [...request.dataScopes].sort(),
    resource: {
      executorId: request.resource.executorId,
      executorName: request.resource.executorName,
      commandBasename: request.resource.commandBasename,
      cwdDisplay: request.resource.cwdDisplay || "",
      cwdNormalized: request.resource.cwdNormalized || "",
      commandFingerprint: request.resource.commandFingerprint || "",
      argsTemplateFingerprint: request.resource.argsTemplateFingerprint || "",
      cwdFingerprint: request.resource.cwdFingerprint || "",
      configFingerprint: request.resource.configFingerprint || "",
      toolId: request.resource.toolId || "",
      definitionVersion: request.resource.definitionVersion || "",
      executableAbsolute: request.resource.executableAbsolute || "",
      executableFingerprint: request.resource.executableFingerprint || "",
      planDigest: request.resource.planDigest || "",
      envKeyNames: Array.isArray(request.resource.envKeyNames)
        ? [...request.resource.envKeyNames].sort()
        : [],
      timeoutMs: Number(request.resource.timeoutMs) || 0,
      maxOutputBytes: Number(request.resource.maxOutputBytes) || 0,
    },
    taskDigest: request.taskDigest,
    taskLength: request.taskLength,
  };
  return crypto.createHash("sha256").update(stableStringify(payload), "utf8").digest("hex");
}

module.exports = {
  stableStringify,
  digestTaskText,
  digestValue,
  buildRequestDigest,
};

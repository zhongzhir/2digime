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
      cwd: request.resource.cwd || "",
    },
    taskDigest: request.taskDigest,
    taskLength: request.taskLength,
  };
  return crypto.createHash("sha256").update(stableStringify(payload), "utf8").digest("hex");
}

module.exports = {
  stableStringify,
  digestTaskText,
  buildRequestDigest,
};

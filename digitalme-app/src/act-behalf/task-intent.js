"use strict";

/**
 * Task Intent helpers for first vertical loop block 1.
 */

const DEFAULT_ROLE = "代表本人做研究与表达";
const DEFAULT_EXPECTED_OUTCOME = "可编辑短文或纪要";
const DEFAULT_APPROVAL_POLICY = Object.freeze({
  allowExternalSend: false,
  packageWriteRequiresConfirmation: true,
  description: "本闭环禁止对外发送；写入主体资料须另行确认。",
});

function buildDefaultTaskIntent({ taskId, goal, role, expectedOutcome, constraints } = {}) {
  const g = String(goal || "").trim();
  return {
    taskId: taskId ? String(taskId) : "",
    goal: g,
    role: String(role || DEFAULT_ROLE).trim() || DEFAULT_ROLE,
    expectedOutcome:
      String(expectedOutcome || DEFAULT_EXPECTED_OUTCOME).trim() || DEFAULT_EXPECTED_OUTCOME,
    constraints: Array.isArray(constraints)
      ? constraints.map((c) => String(c || "").trim()).filter(Boolean)
      : [],
    riskLevel: "low",
    approvalPolicy: {
      allowExternalSend: false,
      packageWriteRequiresConfirmation: true,
      description: DEFAULT_APPROVAL_POLICY.description,
    },
  };
}

function normalizeTaskIntent(input, fallbackTaskId) {
  const src = input && typeof input === "object" ? input : {};
  const goal = String(src.goal || "").trim();
  const intent = buildDefaultTaskIntent({
    taskId: src.taskId || fallbackTaskId || "",
    goal,
    role: src.role,
    expectedOutcome: src.expectedOutcome,
    constraints: src.constraints,
  });
  if (src.riskLevel === "medium" || src.riskLevel === "high") {
    // First loop forces low; ignore elevation attempts.
    intent.riskLevel = "low";
  }
  if (src.approvalPolicy && typeof src.approvalPolicy === "object") {
    intent.approvalPolicy = {
      allowExternalSend: false,
      packageWriteRequiresConfirmation: true,
      description:
        String(src.approvalPolicy.description || DEFAULT_APPROVAL_POLICY.description).trim() ||
        DEFAULT_APPROVAL_POLICY.description,
    };
  }
  return intent;
}

function assertTaskIntentMinimal(intent) {
  const i = intent || {};
  const missing = [];
  for (const k of [
    "taskId",
    "goal",
    "role",
    "expectedOutcome",
    "constraints",
    "riskLevel",
    "approvalPolicy",
  ]) {
    if (i[k] === undefined || i[k] === null) missing.push(k);
  }
  if (!Array.isArray(i.constraints)) missing.push("constraints(array)");
  if (!i.approvalPolicy || typeof i.approvalPolicy !== "object") {
    missing.push("approvalPolicy(object)");
  }
  return { ok: missing.length === 0, missing };
}

module.exports = {
  DEFAULT_ROLE,
  DEFAULT_EXPECTED_OUTCOME,
  DEFAULT_APPROVAL_POLICY,
  buildDefaultTaskIntent,
  normalizeTaskIntent,
  assertTaskIntentMinimal,
};

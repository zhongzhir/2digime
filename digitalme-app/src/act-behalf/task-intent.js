"use strict";

/**
 * Task Intent helpers for first vertical loop block 1.
 */

const { getRoleContext } = require("../identity/role-view");

const DEFAULT_ROLE = "根据你的目标自动组合所需能力";
const DEFAULT_EXPECTED_OUTCOME = "可编辑短文或纪要";
const DEFAULT_APPROVAL_POLICY = Object.freeze({
  allowExternalSend: false,
  packageWriteRequiresConfirmation: true,
  description: "本闭环禁止对外发送；写入主体资料须另行确认。",
});

const TASK_TYPES = Object.freeze({
  general: "general",
  email: "email",
  videoAudio: "video_audio",
});

/** Keywords (case-insensitive) that mark a goal as an email drafting task. */
const EMAIL_KEYWORDS = Object.freeze([
  "邮件",
  "电邮",
  "发信",
  "回信",
  "写封信",
  "email",
  "e-mail",
  "mail",
]);

/** Keywords (case-insensitive) that mark a goal as a video/audio scripting task. */
const VIDEO_AUDIO_KEYWORDS = Object.freeze([
  "视频",
  "音频",
  "短片",
  "分镜",
  "脚本",
  "旁白",
  "播客",
  "配音",
  "video",
  "audio",
  "podcast",
  "storyboard",
  "voiceover",
]);

function detectTaskType(goal) {
  const g = String(goal || "").toLowerCase();
  if (!g) return TASK_TYPES.general;
  // Video/audio keywords take precedence: the deliverable is a script/storyboard.
  for (const kw of VIDEO_AUDIO_KEYWORDS) {
    if (g.includes(kw.toLowerCase())) return TASK_TYPES.videoAudio;
  }
  for (const kw of EMAIL_KEYWORDS) {
    if (g.includes(kw.toLowerCase())) return TASK_TYPES.email;
  }
  return TASK_TYPES.general;
}

function normalizeTaskType(value, goal) {
  const v = String(value || "").trim().toLowerCase();
  if (v === TASK_TYPES.email || v === TASK_TYPES.general || v === TASK_TYPES.videoAudio) return v;
  return detectTaskType(goal);
}

function buildDefaultTaskIntent({ taskId, goal, role, expectedOutcome, constraints, taskType } = {}) {
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
    taskType: normalizeTaskType(taskType, g),
    riskLevel: "low",
    approvalPolicy: {
      allowExternalSend: false,
      packageWriteRequiresConfirmation: true,
      description: DEFAULT_APPROVAL_POLICY.description,
    },
  };
}

function normalizeTaskIntent(input, fallbackTaskId, packageDir) {
  const src = input && typeof input === "object" ? input : {};
  const goal = String(src.goal || "").trim();

  // ID-02: attach current role context when a Package dir is available.
  let roleContext = null;
  if (packageDir) {
    try {
      roleContext = getRoleContext(packageDir);
    } catch (err) {
      console.warn("[task-intent] failed to load role context:", err.message);
    }
  }

  const intent = buildDefaultTaskIntent({
    taskId: src.taskId || fallbackTaskId || "",
    goal,
    role: src.role || (roleContext && roleContext.roleLabel) || "",
    expectedOutcome: src.expectedOutcome,
    constraints: src.constraints,
    taskType: src.taskType,
  });
  if (roleContext) {
    intent.roleContext = roleContext;
  }
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
  TASK_TYPES,
  EMAIL_KEYWORDS,
  VIDEO_AUDIO_KEYWORDS,
  detectTaskType,
  normalizeTaskType,
  buildDefaultTaskIntent,
  normalizeTaskIntent,
  assertTaskIntentMinimal,
};

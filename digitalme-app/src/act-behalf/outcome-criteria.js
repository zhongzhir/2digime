"use strict";

/**
 * TASK-QUALITY-LOOP-01 — OutcomeCriteria & task mode detection.
 *
 * Internal quality basis for the quality-reviewed deliverable loop.
 * Not shown to users by default; not locked to any fixed document type.
 */

const crypto = require("node:crypto");

const TASK_MODES = Object.freeze({
  CURRENT_IMPLEMENTATION: "current_implementation",
  SOLUTION_EXPLORATION: "solution_exploration",
  STRATEGIC_PLANNING: "strategic_planning",
});

const EXPLORATION_RE =
  /(方案比较|路线比较|多(个|种|条)?(方案|路线)|对比(多个|两种|几种)?方案|探索|不要求近期|远期支持|未来如何|将来如何|候选路线)/i;
const STRATEGIC_RE =
  /(战略规划|三年|五年|长期规划|路线图|roadmap|愿景规划|战略方向)/i;
const CURRENT_IMPL_RE =
  /(可直接(用于|开发|实施|交付|落地)|直接用于|当前(实现|实施|开发|产品|版本)|交给.{0,8}(实施|开发)|用于(当前)?(产品)?开发|可落地|实施就绪|即可开发)/i;

/**
 * Decide the task mode from the user's goal and plan understanding.
 * Precedence: exploration > strategic > current implementation.
 * Default: current_implementation (conservative: keeps output grounded).
 */
function detectTaskMode({ goal, usage, expectedQuality } = {}) {
  const text = [goal, usage, expectedQuality]
    .map((v) => String(v || ""))
    .join("\n");
  if (EXPLORATION_RE.test(text)) return TASK_MODES.SOLUTION_EXPLORATION;
  if (STRATEGIC_RE.test(text)) return TASK_MODES.STRATEGIC_PLANNING;
  if (CURRENT_IMPL_RE.test(text)) return TASK_MODES.CURRENT_IMPLEMENTATION;
  return TASK_MODES.CURRENT_IMPLEMENTATION;
}

const PRD_KEYWORD_RE = /(PRD|产品需求文档|需求文档)/i;

/**
 * Infer required sections for the outcome. Only confident, doc-type-driven
 * inferences are returned; keyed on the inferred document intent, never on a
 * fixed document title.
 */
function inferRequiredSections({ goal, title, kind, taskMode }) {
  const text = `${String(goal || "")}\n${String(title || "")}`;
  const isMarkdownKind = kind === "document" || kind === "webpage";
  if (!isMarkdownKind) return [];
  if (PRD_KEYWORD_RE.test(text)) {
    return ["背景", "目标", "范围", "功能需求", "验收"];
  }
  if (taskMode === TASK_MODES.SOLUTION_EXPLORATION) {
    return ["当前基础", "方案", "远期"];
  }
  if (taskMode === TASK_MODES.STRATEGIC_PLANNING) {
    return ["现状", "目标", "阶段"];
  }
  return [];
}

const DIGITAL_ME_PROJECT_CONSTRAINTS = Object.freeze([
  "以当前仓库、现有架构与已确认主线为基础",
  "不得削弱接入模型的通用能力",
  "本地优先、用户主权、可审计",
]);

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}

/**
 * Build the internal OutcomeCriteria for one deliverable.
 */
function buildOutcomeCriteria({
  goal,
  audience,
  usage,
  constraints,
  expectedQuality,
  kind,
  title,
  isDigitalMeProject,
} = {}) {
  const taskMode = detectTaskMode({ goal, usage, expectedQuality });
  const requiredSections = inferRequiredSections({ goal, title, kind, taskMode });
  const projectConstraints = [];
  if (constraints) projectConstraints.push(String(constraints));
  if (isDigitalMeProject) {
    for (const c of DIGITAL_ME_PROJECT_CONSTRAINTS) projectConstraints.push(c);
  }
  const criteria = {
    schemaVersion: 1,
    taskMode,
    targetAudience: String(audience || ""),
    intendedUse: String(usage || expectedQuality || ""),
    requiredSections,
    projectConstraints,
    evidenceRequirements: [
      "涉及项目事实的表述须与当前项目权威上下文一致",
      "不得出现无来源的归因套话",
    ],
    implementationAlignment: {
      mode: taskMode,
      requireCurrentImplementationBasis: taskMode === TASK_MODES.CURRENT_IMPLEMENTATION,
      farFutureMaxRatio: taskMode === TASK_MODES.CURRENT_IMPLEMENTATION ? 0.15 : 1,
    },
    completenessRequirements: requiredSections.length
      ? ["关键章节齐全", "每章有实质正文"]
      : ["结构完整、各节有实质正文"],
    usabilityRequirements: ["可直接打开阅读", "可直接交给后续实施或使用"],
    expectedQuality: String(expectedQuality || ""),
  };
  criteria.criteriaDigest =
    "sha256:" +
    crypto
      .createHash("sha256")
      .update(stableStringify({ ...criteria, criteriaDigest: undefined }))
      .digest("hex");
  return criteria;
}

const MODE_GUIDANCE = Object.freeze({
  [TASK_MODES.CURRENT_IMPLEMENTATION]:
    "本次成果为当前实施模式：必须以当前仓库、现有架构与已确认主线为基础撰写；" +
    "远期方向（如区块链、联邦学习、外部 Agent 网络等）不得占据主体，只能作为明确标记的后续方向简要提及；" +
    "不得用宏大愿景代替当前可实施设计；内容应可直接交给后续实施。",
  [TASK_MODES.SOLUTION_EXPLORATION]:
    "本次成果为方案探索模式：允许并应当比较多个路线，明确区分当前基础与远期方案；" +
    "不得把任务收缩成当前实施计划；每条路线说明价值、风险与验证方式。",
  [TASK_MODES.STRATEGIC_PLANNING]:
    "本次成果为战略规划模式：允许远期视角与分阶段安排，但须与当前能力基线明确衔接，不得脱离现状空谈。",
});

function modeGuidanceFor(taskMode) {
  return MODE_GUIDANCE[taskMode] || MODE_GUIDANCE[TASK_MODES.CURRENT_IMPLEMENTATION];
}

module.exports = {
  TASK_MODES,
  detectTaskMode,
  inferRequiredSections,
  buildOutcomeCriteria,
  modeGuidanceFor,
};

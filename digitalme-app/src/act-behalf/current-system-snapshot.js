"use strict";

/**
 * TASK-QUALITY-LOOP-01.1 — CurrentSystemSnapshot.
 *
 * Minimal, task-relevant snapshot of what the current system actually has.
 * Evidence-first: capabilities are asserted only when their module files
 * exist in this repository; anything unconfirmed is marked "unknown" and
 * must never be auto-completed. Not a second fact source: entries carry
 * source references into the repo / accepted project documents.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * Registry of accepted capabilities that a current-implementation outcome
 * may wrongly ignore or re-build. Each entry is verified against real files.
 */
const CAPABILITY_REGISTRY = Object.freeze([
  {
    id: "project_knowledge_store",
    label: "项目知识存储（ProjectContextSet / ProjectKnowledgeClaim，含权威等级与 supersede）",
    moduleFiles: [
      "src/act-behalf/project-knowledge-store.js",
      "src/act-behalf/project-knowledge-schema.js",
    ],
    keywords: ["项目知识", "知识功能", "知识库", "knowledge"],
    domainNouns: ["项目知识", "知识管理", "知识存储", "知识库"],
    mentionTokens: [
      "project-knowledge-store",
      "ProjectKnowledgeClaim",
      "knowledge-claims",
      "项目知识存储",
      "项目知识声明",
    ],
    sourceRef: "src/act-behalf/project-knowledge-store.js",
  },
  {
    id: "knowledge_resolver",
    label: "统一知识解析 Knowledge Resolver（跨对话/做事/研究/写作统一调用）",
    moduleFiles: ["src/act-behalf/knowledge-resolver.js"],
    keywords: ["项目知识", "知识功能", "知识库", "知识调用", "knowledge"],
    domainNouns: ["知识解析", "知识调用", "知识检索", "知识注入"],
    mentionTokens: [
      "Knowledge Resolver",
      "knowledge-resolver",
      "统一知识解析",
      "知识解析器",
    ],
    sourceRef: "src/act-behalf/knowledge-resolver.js",
  },
  {
    id: "low_friction_learning",
    label: "低打扰学习闭环（低风险自动采纳 / 修正替代 supersede / 冲突选择 / 来源可见 / 撤销停止调用）",
    moduleFiles: [
      "src/act-behalf/knowledge-learning.js",
      "src/act-behalf/learning-adoption-policy.js",
    ],
    keywords: ["项目知识", "知识功能", "知识库", "学习", "知识修正", "knowledge"],
    domainNouns: ["知识学习", "学习闭环", "知识修正", "来源可见"],
    mentionTokens: [
      "学习闭环",
      "自动采纳",
      "supersede",
      "修正替代",
      "来源可见",
      "撤销",
    ],
    sourceRef: "src/act-behalf/knowledge-learning.js",
  },
  {
    id: "deliverable_pipeline",
    label: "成果生成管线（PlanRecord 计划 → 成果包 → 真实文件 → DeliverableVersion / ArtifactRef / provenance → 接受后学习）",
    moduleFiles: [
      "src/act-behalf/deliverable-generation.js",
      "src/act-behalf/deliverable-planner.js",
      "src/act-behalf/deliverable-package-store.js",
    ],
    keywords: ["成果", "交付", "deliverable", "prd", "文档", "ppt", "网页"],
    domainNouns: ["成果生成", "成果包", "交付物生成"],
    mentionTokens: ["PlanRecord", "ArtifactRef", "成果包", "DeliverableVersion", "provenance"],
    sourceRef: "src/act-behalf/deliverable-generation.js",
  },
  {
    id: "task_management",
    label: "做事任务管理（Task 生命周期：搜索/改名/归档/恢复/删除，TASK-UX-MIN-01 已验收）",
    moduleFiles: ["src/act-behalf/task-store.js", "src/act-behalf/task-lifecycle.js"],
    keywords: ["任务管理", "任务列表", "task"],
    domainNouns: ["任务管理", "任务生命周期"],
    mentionTokens: ["Task", "task-store", "任务管理", "任务生命周期"],
    sourceRef: "src/act-behalf/task-store.js",
  },
  {
    id: "action_identity_authorization",
    label: "最小行动身份与本地授权（IDCOLLAB-MIN-01 已验收：AuthorizationRecord 主表、快照、撤销即时生效）",
    moduleFiles: [
      "src/act-behalf/authorization-store.js",
      "src/act-behalf/action-identity.js",
    ],
    keywords: ["授权", "身份", "协作", "authorization", "identity"],
    domainNouns: ["本地授权", "行动身份", "授权记录"],
    mentionTokens: ["AuthorizationRecord", "authorization-store", "本地授权", "行动身份"],
    sourceRef: "src/act-behalf/authorization-store.js",
  },
  {
    id: "quality_review_loop",
    label: "成果质量闭环（OutcomeCriteria + Reviewer + ≤2 次自动修订，TASK-QUALITY-LOOP-01）",
    moduleFiles: [
      "src/act-behalf/outcome-criteria.js",
      "src/act-behalf/deliverable-reviewer.js",
    ],
    keywords: ["质量", "review", "评审", "成果"],
    domainNouns: ["质量检查", "成果评审"],
    mentionTokens: ["OutcomeCriteria", "Reviewer", "质量闭环"],
    sourceRef: "src/act-behalf/deliverable-reviewer.js",
  },
  {
    id: "secret_policy_baseline",
    label: "SecretStore 与 PolicyEngine 基线（P1-01 / P1-04 已验收）",
    moduleFiles: ["src/security/secret-store.js", "src/policy-engine/index.js"],
    keywords: ["加密", "密钥", "策略", "secret", "policy", "安全"],
    domainNouns: ["密钥管理", "策略引擎"],
    mentionTokens: ["SecretStore", "PolicyEngine"],
    sourceRef: "src/security/secret-store.js",
  },
]);

/** Accepted boundaries (unfinished / deferred), with document source refs. */
const BOUNDARY_REGISTRY = Object.freeze([
  {
    id: "no_real_video_audio",
    label: "视频/音频本轮不实现真实生成（决策 #107）",
    sourceRef: "digitalme_context.md §3 第 32 条",
  },
  {
    id: "external_collaboration_not_validated",
    label: "外部协作网络未验证（IDCOLLAB-MIN-01 仅最小身份协作闭环）",
    sourceRef: "digitalme_phase1_task_IDCOLLAB-MIN-01_action_identity_and_authorization_v0.1.md",
  },
  {
    id: "market_settlement_not_started",
    label: "能力市场与结算未启动",
    sourceRef: "digitalme_context.md §7.12（协作服务面分期）",
  },
  {
    id: "sqlite_deferred",
    label: "SQLite 持久化为 R2.5 deferred；当前存储为 JSON 文件，不存在既有 SQLite 后端",
    sourceRef: "digitalme_context.md（R2.5 deferred）",
  },
  {
    id: "r3_paused",
    label: "R3 迁移 paused；R2 代码保留为基础设施",
    sourceRef: "digitalme_context.md 文首",
  },
]);

const PRESENT = "present";
const UNKNOWN = "unknown";

function appRoot() {
  return path.join(__dirname, "..", "..");
}

function fileExists(root, rel) {
  try {
    return fs.existsSync(path.join(root, rel));
  } catch {
    return false;
  }
}

function goalMatchesKeywords(goal, keywords) {
  const g = String(goal || "").toLowerCase();
  return (keywords || []).some((k) => g.includes(String(k).toLowerCase()));
}

function detectPersistence(root) {
  const mechanisms = [];
  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    pkg = null;
  }
  const deps = Object.assign({}, (pkg && pkg.dependencies) || {}, (pkg && pkg.devDependencies) || {});
  const sqliteDep = Object.keys(deps).find((d) => /sqlite/i.test(d));
  mechanisms.push({
    kind: "json_file_stores",
    status: PRESENT,
    detail:
      "用户数据以 JSON 文件持久化（act-behalf-tasks.json / deliverable-plans.json / deliverable-packages.json / authorizations.json / deliverable-learn-jobs.json；项目知识在 packageDir/project/*.json）",
    sourceRef: "src/act-behalf/*-store.js",
  });
  mechanisms.push({
    kind: "sqlite",
    status: sqliteDep ? PRESENT : "absent",
    detail: sqliteDep
      ? `package.json 存在 SQLite 依赖：${sqliteDep}`
      : "package.json 无 SQLite 依赖；R2.5 SQLite deferred；不存在既有 SQLite 后端或数据表",
    sourceRef: sqliteDep ? "package.json" : "package.json + digitalme_context.md（R2.5 deferred）",
  });
  mechanisms.push({ kind: "cloud_sync", status: "absent", detail: "无云同步运行时", sourceRef: "digitalme_architecture_edge_sovereign_v0.1.md（分期）" });
  mechanisms.push({ kind: "external_agent_adapter", status: "absent", detail: "外部强力 Agent 适配层未接入（接口预留）", sourceRef: "TASK-QUALITY-LOOP-01 任务包 §5" });
  return mechanisms;
}

/**
 * Build a minimal task-relevant CurrentSystemSnapshot.
 * @param {object} opts
 * @param {string} opts.goal
 * @param {string} [opts.appRootOverride] test hook
 */
function buildCurrentSystemSnapshot({ goal } = {}) {
  const root = appRoot();
  const relevantModules = [];
  const acceptedCapabilities = [];
  const missingOrUnknown = [];
  for (const cap of CAPABILITY_REGISTRY) {
    if (!goalMatchesKeywords(goal, cap.keywords)) continue;
    const missing = cap.moduleFiles.filter((f) => !fileExists(root, f));
    if (missing.length === 0) {
      relevantModules.push({
        id: cap.id,
        label: cap.label,
        moduleFiles: cap.moduleFiles.slice(),
        mentionTokens: cap.mentionTokens.slice(),
        domainNouns: cap.domainNouns.slice(),
        status: PRESENT,
        sourceRef: cap.sourceRef,
      });
      acceptedCapabilities.push({ id: cap.id, label: cap.label, sourceRef: cap.sourceRef });
    } else {
      // Unconfirmed: mark unknown, never auto-complete.
      missingOrUnknown.push({ id: cap.id, label: cap.label, status: UNKNOWN, missingFiles: missing });
    }
  }
  const snapshot = {
    schemaVersion: 1,
    relevantModules,
    acceptedCapabilities,
    authorityObjects: [], // filled by buildAuthorityMap caller
    persistenceMechanisms: detectPersistence(root),
    knownBoundaries: BOUNDARY_REGISTRY.map((b) => ({ id: b.id, label: b.label, sourceRef: b.sourceRef })),
    unfinishedCapabilities: BOUNDARY_REGISTRY.map((b) => b.label),
    unknownCapabilities: missingOrUnknown,
    sourceRefs: relevantModules.map((m) => m.sourceRef).concat(BOUNDARY_REGISTRY.map((b) => b.sourceRef)),
    createdAt: new Date().toISOString(),
  };
  snapshot.snapshotDigest =
    "sha256:" +
    crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          modules: relevantModules.map((m) => m.id),
          boundaries: snapshot.knownBoundaries.map((b) => b.id),
          persistence: snapshot.persistenceMechanisms.map((p) => p.kind + ":" + p.status),
        })
      )
      .digest("hex");
  return snapshot;
}

/** Bounded plain-text facts for first-draft prompt injection (internal use). */
function renderSnapshotFacts(snapshot, maxLines) {
  const limit = Number(maxLines) > 0 ? Number(maxLines) : 10;
  if (!snapshot) return "";
  const lines = [];
  for (const cap of (snapshot.acceptedCapabilities || []).slice(0, 6)) {
    lines.push(`- 已具备：${cap.label}`);
  }
  for (const p of snapshot.persistenceMechanisms || []) {
    if (p.status === "absent") lines.push(`- 不存在：${p.detail}`);
  }
  for (const b of (snapshot.knownBoundaries || []).slice(0, 4)) {
    lines.push(`- 边界：${b.label}`);
  }
  return lines.slice(0, limit).join("\n");
}

module.exports = {
  CAPABILITY_REGISTRY,
  BOUNDARY_REGISTRY,
  PRESENT,
  UNKNOWN,
  buildCurrentSystemSnapshot,
  renderSnapshotFacts,
};

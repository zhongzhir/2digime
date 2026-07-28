"use strict";

/**
 * TASK-QUALITY-LOOP-01.1-FIX-01 — Grounded Generation helpers.
 *
 * Makes CurrentSystemSnapshot an inviolable drafting constraint, demotes
 * historical materials, builds a Gap Statement before PRD drafting, and
 * switches repair strategy from local patch to grounded_rebuild /
 * clean_regeneration when architecture grounding fails.
 */

const fs = require("node:fs");
const path = require("node:path");

const MATERIAL_AUTHORITY = Object.freeze({
  CURRENT_AUTHORITATIVE: "current_authoritative",
  HISTORICAL_SUPERSEDED: "historical_superseded",
  PLANNING_ONLY: "planning_only",
  UNKNOWN: "unknown",
});

const GROUNDED_REBUILD_RULE_IDS = Object.freeze([
  "current_state_incorrect",
  "existing_capability_ignored",
  "duplicate_authority_source",
  "unsupported_architecture_assumption",
]);

const REPAIR_MODES = Object.freeze({
  LOCAL_REPAIR: "local_repair",
  GROUNDED_REBUILD: "grounded_rebuild",
  CLEAN_REGENERATION: "clean_regeneration",
});

/** Soft product gaps probed against the repo — never claim a present capability is missing. */
const GAP_PROBES = Object.freeze([
  {
    id: "project_knowledge_browse_ux",
    label: "项目知识的独立浏览与管理体验尚未作为完整、已验收的产品面交付",
    // No dedicated browse surface module today; treat as soft gap when knowledge stack exists.
    requiresPresentCapabilityIds: ["project_knowledge_store"],
    evidenceCheck: (root) =>
      !fileExists(root, "src/renderer/project-knowledge-browser.js") &&
      !fileExists(root, "src/renderer/views/project-knowledge.js"),
  },
  {
    id: "cross_surface_knowledge_validation",
    label: "独立研究、写作等产品面的统一知识调用仍需按面验证完整性",
    requiresPresentCapabilityIds: ["knowledge_resolver"],
    evidenceCheck: () => true, // resolver exists; cross-surface proof is incomplete by product boundary
  },
  {
    id: "project_isolation_hardening",
    label: "项目隔离与防串用在用户可见路径上的完整验收仍可加强",
    requiresPresentCapabilityIds: ["project_knowledge_store"],
    evidenceCheck: () => true,
  },
  {
    id: "low_friction_knowledge_correction_ux",
    label: "用户低打扰地查看、修正与撤销项目知识的界面路径仍可完善",
    requiresPresentCapabilityIds: ["low_friction_learning"],
    evidenceCheck: () => true,
  },
  {
    id: "artifact_knowledge_citation",
    label: "成果与项目知识的引用关系展示仍可加强",
    requiresPresentCapabilityIds: ["deliverable_pipeline", "project_knowledge_store"],
    evidenceCheck: () => true,
  },
]);

const STALE_STATUS_RE =
  /(尚未启动|尚未实现|尚未建立|未开始|待实现|待建设|从零开始|缺乏统一|处于初级阶段|仍是空白)/;

const HISTORICAL_CLAIM_TYPES = new Set([
  "historical_exploration",
  "rejected_direction",
  "future_direction",
]);

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

function needsGroundedRebuild(reviewResult) {
  const issues = (reviewResult && reviewResult.blockingIssues) || [];
  return issues.some((i) => i && GROUNDED_REBUILD_RULE_IDS.includes(i.ruleId));
}

function isGroundingFailure(reviewResult) {
  const issues = (reviewResult && reviewResult.blockingIssues) || [];
  return issues.some(
    (i) =>
      i &&
      (i.source === "grounding" ||
        GROUNDED_REBUILD_RULE_IDS.includes(i.ruleId) ||
        [
          "acceptance_only_tests_crud",
          "owner_decision_overreach",
          "unsubstantiated_estimate",
          "grounding_revision_guidance",
        ].includes(i.ruleId))
  );
}

/**
 * Structured authoritative facts for prompt injection (not a prose-only summary).
 */
function buildStructuredSystemFacts(snapshot, authorityMap) {
  const facts = [];
  for (const mod of (snapshot && snapshot.relevantModules) || []) {
    if (mod.status !== "present") continue;
    facts.push({
      capabilityId: mod.id,
      currentStatus: "present",
      authoritativeModule: (mod.moduleFiles && mod.moduleFiles[0]) || mod.sourceRef,
      validatedBehavior: mod.label,
      knownBoundary: null,
      sourceRef: mod.sourceRef,
    });
  }
  for (const b of (snapshot && snapshot.knownBoundaries) || []) {
    facts.push({
      capabilityId: b.id,
      currentStatus: "boundary",
      authoritativeModule: null,
      validatedBehavior: null,
      knownBoundary: b.label,
      sourceRef: b.sourceRef,
    });
  }
  for (const p of (snapshot && snapshot.persistenceMechanisms) || []) {
    if (p.status === "absent") {
      facts.push({
        capabilityId: "persistence_" + p.kind,
        currentStatus: "absent",
        authoritativeModule: null,
        validatedBehavior: null,
        knownBoundary: p.detail,
        sourceRef: p.sourceRef,
      });
    }
  }
  for (const e of (authorityMap && authorityMap.entries) || []) {
    if (e.status !== "present") continue;
    facts.push({
      capabilityId: "authority_" + e.entity,
      currentStatus: "present",
      authoritativeModule: e.sourceRef,
      validatedBehavior: e.entity + " @ " + e.authoritativeStore,
      knownBoundary: e.duplicationRisk || null,
      sourceRef: e.sourceRef,
    });
  }
  return facts;
}

function renderAuthoritativeSystemFactsBlock(snapshot, authorityMap) {
  const facts = buildStructuredSystemFacts(snapshot, authorityMap);
  if (!facts.length) return { text: "", facts: [] };
  const lines = [
    "CURRENT SYSTEM FACTS — AUTHORITATIVE",
    "以下事实来自当前仓库和已验收状态，属于本次文档的现状基线：",
    "- 必须以这些事实为前提；",
    "- 不得宣称其中任何能力不存在、尚未启动或仅为规划；",
    "- 历史材料与本区块冲突时，以本区块为准；",
    "- 无法确认的事实标记为 unknown，不得自行推断。",
    "",
    "结构化现状事实：",
  ];
  for (const f of facts.slice(0, 24)) {
    lines.push(
      [
        `- capabilityId=${f.capabilityId}`,
        `currentStatus=${f.currentStatus}`,
        f.authoritativeModule ? `authoritativeModule=${f.authoritativeModule}` : null,
        f.validatedBehavior ? `validatedBehavior=${f.validatedBehavior}` : null,
        f.knownBoundary ? `knownBoundary=${f.knownBoundary}` : null,
        `sourceRef=${f.sourceRef}`,
      ]
        .filter(Boolean)
        .join("；")
    );
  }
  return { text: lines.join("\n"), facts };
}

function classifyMaterialAuthority(item) {
  if (!item || typeof item !== "object") return MATERIAL_AUTHORITY.UNKNOWN;
  if (item.materialAuthority) return item.materialAuthority;
  if (item.supersededBy || item.confirmationStatus === "superseded") {
    return MATERIAL_AUTHORITY.HISTORICAL_SUPERSEDED;
  }
  const claimType = String(item.claimType || item.note || "");
  if (HISTORICAL_CLAIM_TYPES.has(claimType) || item.authorityLevel === "historical_record") {
    return MATERIAL_AUTHORITY.HISTORICAL_SUPERSEDED;
  }
  if (
    claimType === "future_direction" ||
    claimType === "proposal" ||
    /planning|plan_only|规划/.test(String(item.note || ""))
  ) {
    return MATERIAL_AUTHORITY.PLANNING_ONLY;
  }
  if (
    item.authorityLevel === "owner_confirmed" ||
    item.authorityLevel === "frozen_spec" ||
    item.authorityLevel === "accepted_runtime_state" ||
    item.authorityLevel === "current_project_record" ||
    item.note === "project_authoritative_source" ||
    item.confirmationStatus === "owner_confirmed" ||
    item.confirmationStatus === "frozen"
  ) {
    return MATERIAL_AUTHORITY.CURRENT_AUTHORITATIVE;
  }
  const text = String(item.text || item.claimText || "");
  if (STALE_STATUS_RE.test(text) && !/已具备|已实现|已验收|当前系统/.test(text)) {
    return MATERIAL_AUTHORITY.PLANNING_ONLY;
  }
  if (text.trim()) return MATERIAL_AUTHORITY.CURRENT_AUTHORITATIVE;
  return MATERIAL_AUTHORITY.UNKNOWN;
}

/**
 * Demote / annotate materials so superseded history cannot override current facts.
 */
function demoteHistoricalMaterials(materials, { includeHistoricalAnnotated } = {}) {
  const list = Array.isArray(materials) ? materials : [];
  const kept = [];
  const demoted = [];
  for (const raw of list) {
    if (!raw) continue;
    const authority = classifyMaterialAuthority(raw);
    if (authority === MATERIAL_AUTHORITY.HISTORICAL_SUPERSEDED) {
      demoted.push({
        id: raw.id || raw.claimId || null,
        reason: "historical_superseded",
        materialAuthority: authority,
      });
      if (includeHistoricalAnnotated) {
        kept.push({
          ...raw,
          materialAuthority: authority,
          text:
            "【历史记录，不代表当前状态】\n" +
            String(raw.text || raw.claimText || "").slice(0, 4000),
          note: (raw.note ? raw.note + "；" : "") + "historical_record_not_current",
        });
      }
      continue;
    }
    if (authority === MATERIAL_AUTHORITY.PLANNING_ONLY) {
      kept.push({
        ...raw,
        materialAuthority: authority,
        text:
          "【规划/提案材料，不得覆盖当前已验收状态】\n" +
          String(raw.text || raw.claimText || ""),
        note: (raw.note ? raw.note + "；" : "") + "planning_only",
      });
      continue;
    }
    kept.push({ ...raw, materialAuthority: authority || MATERIAL_AUTHORITY.UNKNOWN });
  }
  return { materials: kept, demoted };
}

function presentCapabilityIds(snapshot) {
  return ((snapshot && snapshot.acceptedCapabilities) || [])
    .map((c) => c.id)
    .filter(Boolean);
}

function buildGapStatement({ snapshot, authorityMap, goal } = {}) {
  const root = appRoot();
  const existing = ((snapshot && snapshot.acceptedCapabilities) || []).map((c) => ({
    id: c.id,
    label: c.label,
    sourceRef: c.sourceRef,
  }));
  const existingIds = new Set(existing.map((c) => c.id));
  const existingLabels = existing.map((c) => c.label);

  const actualGaps = [];
  for (const probe of GAP_PROBES) {
    const requiredOk = (probe.requiresPresentCapabilityIds || []).every((id) => existingIds.has(id));
    if (!requiredOk) continue;
    if (typeof probe.evidenceCheck === "function" && !probe.evidenceCheck(root)) continue;
    // Never emit a gap that restates a present capability as missing.
    if (gapConflictsWithExisting(probe.label, existing)) continue;
    actualGaps.push({ id: probe.id, label: probe.label });
  }

  const reused = ((authorityMap && authorityMap.entries) || [])
    .filter((e) => e.status === "present")
    .map((e) => ({
      entity: e.entity,
      authoritativeStore: e.authoritativeStore,
      sourceRef: e.sourceRef,
    }));

  const nonGoals = ((snapshot && snapshot.knownBoundaries) || []).map((b) => ({
    id: b.id,
    label: b.label,
    sourceRef: b.sourceRef,
  }));

  const proposed = actualGaps.map((g) => ({
    id: "change_" + g.id,
    label: "针对「" + g.label + "」做最小增量，不得重建已有权威对象或已具备能力",
  }));

  const statement = {
    schemaVersion: 1,
    goal: String(goal || ""),
    ExistingCapabilities: existing,
    ActualGaps: actualGaps,
    ProposedMinimumChanges: proposed,
    ReusedAuthorityObjects: reused,
    ExplicitNonGoals: nonGoals,
  };
  const validation = validateGapStatement(statement);
  statement.validation = validation;
  return statement;
}

function gapConflictsWithExisting(gapLabel, existing) {
  const label = String(gapLabel || "");
  for (const cap of existing || []) {
    const tokens = []
      .concat(cap.id ? [cap.id.replace(/_/g, " ")] : [])
      .concat(extractCapabilityTokens(cap.label));
    for (const t of tokens) {
      if (!t || t.length < 4) continue;
      const rebuild = new RegExp(
        `(建立|新建|从零|缺乏|缺失|尚未|没有|缺少).{0,12}${escapeRe(t)}|${escapeRe(t)}.{0,12}(尚未|未实现|从零)`
      );
      if (rebuild.test(label)) return true;
      // Exact "建立 X" where X is the capability label fragment
      if (label.includes("建立") && label.includes(t) && /建立|新建|从零/.test(label)) return true;
    }
  }
  return false;
}

function extractCapabilityTokens(label) {
  const s = String(label || "");
  const out = [];
  if (/Knowledge Resolver/i.test(s)) out.push("Knowledge Resolver", "知识解析");
  if (/项目知识/.test(s)) out.push("项目知识存储", "项目知识");
  if (/学习闭环/.test(s)) out.push("学习闭环");
  if (/成果生成/.test(s)) out.push("成果生成");
  if (/任务管理/.test(s)) out.push("任务管理");
  if (/授权/.test(s)) out.push("本地授权");
  return out;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateGapStatement(statement) {
  const existing = (statement && statement.ExistingCapabilities) || [];
  const gaps = (statement && statement.ActualGaps) || [];
  const conflicts = [];
  for (const gap of gaps) {
    if (gapConflictsWithExisting(gap.label || gap.id, existing)) {
      conflicts.push({
        gapId: gap.id,
        gapLabel: gap.label,
        reason: "ActualGaps must not restate an ExistingCapability as missing",
      });
    }
    for (const cap of existing) {
      if (gap.id === cap.id || (gap.label && gap.label === cap.label)) {
        conflicts.push({
          gapId: gap.id,
          capabilityId: cap.id,
          reason: "ActualGaps entry duplicates ExistingCapabilities",
        });
      }
    }
  }
  return { ok: conflicts.length === 0, conflicts };
}

/**
 * If validation fails, drop conflicting gaps and recompute proposed changes.
 */
function ensureValidGapStatement(statement) {
  let current = statement;
  let guard = 0;
  while (current && current.validation && !current.validation.ok && guard < 3) {
    const bad = new Set((current.validation.conflicts || []).map((c) => c.gapId));
    current = {
      ...current,
      ActualGaps: (current.ActualGaps || []).filter((g) => !bad.has(g.id)),
      ProposedMinimumChanges: (current.ProposedMinimumChanges || []).filter(
        (p) => !bad.has(String(p.id || "").replace(/^change_/, ""))
      ),
    };
    current.validation = validateGapStatement(current);
    guard += 1;
  }
  return current;
}

function renderGapStatementBlock(statement) {
  if (!statement) return "";
  const s = ensureValidGapStatement(statement);
  if (!s.validation.ok) return ""; // refuse to inject an invalid gap statement
  const lines = [
    "内部 Gap Statement（生成正文前必须遵守；ActualGaps 不得与 ExistingCapabilities 重复）：",
    "ExistingCapabilities:",
    ...(s.ExistingCapabilities || []).map((c) => `  - [${c.id}] ${c.label}`),
    "ActualGaps:",
    ...(s.ActualGaps || []).length
      ? (s.ActualGaps || []).map((g) => `  - [${g.id}] ${g.label}`)
      : ["  - （经仓库核对，本次无与已有能力冲突的额外缺口条目）"],
    "ProposedMinimumChanges:",
    ...(s.ProposedMinimumChanges || []).map((p) => `  - ${p.label}`),
    "ReusedAuthorityObjects:",
    ...(s.ReusedAuthorityObjects || []).map(
      (r) => `  - ${r.entity}（${r.authoritativeStore}；${r.sourceRef}）`
    ),
    "ExplicitNonGoals:",
    ...(s.ExplicitNonGoals || []).map((n) => `  - ${n.label}`),
  ];
  return lines.join("\n");
}

function summarizeForbiddenProblems(issues, maxItems) {
  const limit = Number(maxItems) > 0 ? Number(maxItems) : 8;
  const list = Array.isArray(issues) ? issues : [];
  const lines = [];
  for (const i of list) {
    if (!i) continue;
    if (i.ruleId === "grounding_revision_guidance") continue;
    const msg = String(i.message || i.ruleId || "").trim();
    if (!msg) continue;
    lines.push(`- [${i.ruleId || "issue"}] ${msg.slice(0, 160)}`);
    if (lines.length >= limit) break;
  }
  return lines.join("\n");
}

function groundedRebuildStructureGuidance() {
  return [
    "必须按以下结构重新生成完整文档（不得只改几句）：",
    "1. 现有基础",
    "2. 真实用户问题",
    "3. 实际缺口",
    "4. 最小新增能力",
    "5. 与现有权威对象的关系",
    "6. 用户路径",
    "7. 验收标准",
    "8. 不做事项",
  ].join("\n");
}

function buildGroundedRebuildMessages(ctx, issues) {
  const forbidden = summarizeForbiddenProblems(issues);
  return [
    {
      role: "system",
      content:
        "你是 Digital Me 的成果写作者。上一次草稿因与当前系统事实冲突被拒绝。" +
        "请基于权威系统事实与 Gap Statement 重新生成完整 Markdown 文档，不要局部修补旧稿。" +
        "不得把失败稿全文当作素材。使用中文。",
    },
    {
      role: "user",
      content: [
        ctx.authoritativeFactsText || ctx.systemFactsText || "",
        ctx.gapStatementText || "",
        `任务目标：${ctx.goal || ""}`,
        ctx.modeGuidance ? `成果要求：${ctx.modeGuidance}` : "",
        ctx.outcomeCriteria && ctx.outcomeCriteria.requiredSections
          ? `应包含：${ctx.outcomeCriteria.requiredSections.join("、")}`
          : "",
        groundedRebuildStructureGuidance(),
        "",
        "禁止再次出现的问题（摘要，非原文）：",
        forbidden || "- （无额外摘要）",
        "",
        "请直接输出完整 Markdown 正文。",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

function buildCleanRegenerationMessages(ctx) {
  return [
    {
      role: "system",
      content:
        "你是 Digital Me 的成果写作者。请在干净上下文中重新生成完整 Markdown 文档。" +
        "只依据用户目标、成果要求与权威系统事实；不要依赖任何失败草稿。" +
        "必须准确反映当前已具备能力，不得写成缺失或初级阶段。使用中文。",
    },
    {
      role: "user",
      content: [
        ctx.authoritativeFactsText || ctx.systemFactsText || "",
        ctx.gapStatementText || "",
        `任务目标：${ctx.goal || ""}`,
        ctx.audience ? `受众：${ctx.audience}` : "",
        ctx.usage ? `用途：${ctx.usage}` : "",
        ctx.constraints ? `约束：${ctx.constraints}` : "",
        `成果标题：${ctx.title || ""}`,
        ctx.modeGuidance ? `成果要求：${ctx.modeGuidance}` : "",
        groundedRebuildStructureGuidance(),
        "",
        "请直接输出完整 Markdown 正文。",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

module.exports = {
  MATERIAL_AUTHORITY,
  GROUNDED_REBUILD_RULE_IDS,
  REPAIR_MODES,
  GAP_PROBES,
  needsGroundedRebuild,
  isGroundingFailure,
  buildStructuredSystemFacts,
  renderAuthoritativeSystemFactsBlock,
  classifyMaterialAuthority,
  demoteHistoricalMaterials,
  buildGapStatement,
  validateGapStatement,
  ensureValidGapStatement,
  renderGapStatementBlock,
  summarizeForbiddenProblems,
  groundedRebuildStructureGuidance,
  buildGroundedRebuildMessages,
  buildCleanRegenerationMessages,
  presentCapabilityIds,
};

"use strict";

/**
 * DVL2-01 deliverable plan schema, graph validation, and confirmation rules.
 * Pure functions only — no I/O.
 */

const crypto = require("node:crypto");

const KIND_BASELINE = Object.freeze({
  document: { contractSupport: "in_current_product_scope", runtimeAvailability: "unavailable", format: "docx" },
  presentation: { contractSupport: "in_current_product_scope", runtimeAvailability: "unavailable", format: "pptx" },
  webpage: { contractSupport: "in_current_product_scope", runtimeAvailability: "unavailable", format: "html" },
  image: { contractSupport: "in_current_product_scope", runtimeAvailability: "unavailable", format: "png" },
  audio: { contractSupport: "reserved_for_future", runtimeAvailability: "unavailable", format: "mp3" },
  video: { contractSupport: "reserved_for_future", runtimeAvailability: "unavailable", format: "mp4" },
  dataset: { contractSupport: "reserved_for_future", runtimeAvailability: "unavailable", format: "csv" },
  code: { contractSupport: "reserved_for_future", runtimeAvailability: "unavailable", format: "zip" },
  dashboard: { contractSupport: "reserved_for_future", runtimeAvailability: "unavailable", format: "html" },
  archive: { contractSupport: "out_of_scope", runtimeAvailability: "unavailable", format: "zip" },
  other: { contractSupport: "out_of_scope", runtimeAvailability: "unavailable", format: "" },
});

const PLAN_VERSION_STATUSES = Object.freeze([
  "draft",
  "needs_user_input",
  "ready_for_confirmation",
  "confirmed",
  "superseded",
  "cancelled",
]);

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + crypto.randomBytes(3).toString("hex");
}

function newPlanId() {
  return newId("dplan");
}

function newVersionId() {
  return newId("dpv");
}

function newItemId() {
  return newId("pdi");
}

function provenanceString(value, provenance) {
  const v = value == null ? null : String(value);
  const p = provenance || (v && String(v).trim() ? "user_provided" : "unresolved");
  return { value: v, provenance: p };
}

function emptyUnderstanding(goal) {
  const g = String(goal || "").trim();
  return {
    goal: provenanceString(g || null, g ? "user_provided" : "unresolved"),
    audience: provenanceString(null, "unresolved"),
    usage: provenanceString(null, "unresolved"),
    constraints: { value: [], provenance: "unresolved" },
    deadline: provenanceString(null, "unresolved"),
    expectedQuality: provenanceString(null, "unresolved"),
    assumptions: [],
    unresolvedQuestions: [],
    subjectContextUsedRefs: [],
  };
}

function normalizeKind(kind) {
  const k = String(kind || "other");
  return KIND_BASELINE[k] ? k : "other";
}

function baselineForKind(kind) {
  return KIND_BASELINE[normalizeKind(kind)];
}

function normalizeItem(raw, index) {
  const kind = normalizeKind(raw && raw.kind);
  const base = baselineForKind(kind);
  const id = String((raw && raw.id) || newItemId());
  const disposition = raw && raw.planDisposition === "removed" ? "removed" : "included";
  const priority =
    raw && (raw.priority === "required" || raw.priority === "recommended" || raw.priority === "optional")
      ? raw.priority
      : "recommended";
  const order = Number.isFinite(Number(raw && raw.order)) ? Number(raw.order) : index;
  return {
    id,
    planDisposition: disposition,
    kind,
    format: String((raw && raw.format) != null ? raw.format : base.format || ""),
    title: String((raw && raw.title) || "").trim() || defaultTitleForKind(kind),
    purpose: String((raw && raw.purpose) || "").trim() || defaultPurposeForKind(kind),
    priority,
    order,
    dependencies: Array.isArray(raw && raw.dependencies)
      ? raw.dependencies.map((d) => String(d || "").trim()).filter(Boolean)
      : [],
    suggestedExecutionMode:
      raw && raw.suggestedExecutionMode
        ? String(raw.suggestedExecutionMode)
        : "digital_me_direct",
    capabilityRequirements: Array.isArray(raw && raw.capabilityRequirements)
      ? raw.capabilityRequirements.map((c) => String(c || "").trim()).filter(Boolean)
      : [],
    riskFlags: Array.isArray(raw && raw.riskFlags)
      ? raw.riskFlags.map((c) => String(c || "").trim()).filter(Boolean)
      : [],
    contractSupport: base.contractSupport,
    runtimeAvailability: base.runtimeAvailability,
  };
}

function defaultTitleForKind(kind) {
  const map = {
    document: "正式介绍文档",
    presentation: "演示文稿",
    webpage: "单页介绍网站",
    image: "封面图片",
    audio: "音频介绍（当前不可执行）",
    video: "宣传视频（当前不可执行）",
  };
  return map[kind] || "预计交付";
}

function defaultPurposeForKind(kind) {
  const map = {
    document: "完整说明项目背景、价值与要点",
    presentation: "面向会议或路演的结构化讲解",
    webpage: "便于在线分享的单页介绍",
    image: "作为封面或视觉入口",
    audio: "音频形态介绍（本版本暂不执行生成）",
    video: "视频形态介绍（本版本暂不执行生成）",
  };
  return map[kind] || "服务当前任务目标";
}

function normalizeOrder(items) {
  const list = (items || []).slice().sort((a, b) => Number(a.order) - Number(b.order));
  return list.map((it, i) => ({ ...it, order: i }));
}

function includedItems(items) {
  return (items || []).filter((it) => it && it.planDisposition === "included");
}

function validateDependencyGraph(items) {
  const errors = [];
  const included = includedItems(items);
  const idSet = new Set(included.map((it) => it.id));
  const byId = new Map(included.map((it) => [it.id, it]));

  for (const it of included) {
    for (const dep of it.dependencies || []) {
      if (dep === it.id) {
        errors.push({ code: "self_dependency", itemId: it.id, message: "不得自依赖。" });
        continue;
      }
      if (!idSet.has(dep)) {
        errors.push({
          code: "invalid_dependency",
          itemId: it.id,
          message: "依赖只能引用同版本未删除项。",
          dep,
        });
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function dfs(id, stack) {
    if (visiting.has(id)) {
      errors.push({ code: "cycle", itemId: id, message: "存在循环依赖。", path: stack.concat(id) });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const node = byId.get(id);
    for (const dep of (node && node.dependencies) || []) {
      if (idSet.has(dep)) dfs(dep, stack.concat(id));
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const it of included) dfs(it.id, []);

  return { ok: errors.length === 0, errors };
}

function buildAvailabilitySnapshot(items) {
  const included = includedItems(items);
  return {
    schemaVersion: 1,
    capturedAt: nowIso(),
    capabilitySummaryRef: null,
    itemSnapshots: included.map((it) => ({
      itemId: it.id,
      contractSupport: it.contractSupport,
      runtimeAvailability: it.runtimeAvailability,
      capabilityRequirements: it.capabilityRequirements.slice(),
    })),
  };
}

function canConfirmVersion(version) {
  const items = (version && version.items) || [];
  const included = includedItems(items);
  if (included.length === 0) {
    return { ok: false, code: "empty_included", message: "请至少保留一项预计交付后再确认。" };
  }
  const graph = validateDependencyGraph(items);
  if (!graph.ok) {
    return { ok: false, code: "graph_invalid", message: "预计交付依赖关系无效，请先修正。", errors: graph.errors };
  }
  return { ok: true };
}

function normalizeUnderstanding(raw, goalFallback) {
  const base = emptyUnderstanding(goalFallback);
  if (!raw || typeof raw !== "object") return base;
  const pick = (field, fallbackProv) => {
    if (raw[field] && typeof raw[field] === "object" && "value" in raw[field]) {
      return {
        value: raw[field].value == null ? null : String(raw[field].value),
        provenance: String(raw[field].provenance || fallbackProv || "system_inferred"),
      };
    }
    if (raw[field] != null && typeof raw[field] === "string") {
      return provenanceString(raw[field], "system_inferred");
    }
    return base[field];
  };
  let constraints = base.constraints;
  if (raw.constraints && typeof raw.constraints === "object" && Array.isArray(raw.constraints.value)) {
    constraints = {
      value: raw.constraints.value.map((c) => String(c || "").trim()).filter(Boolean),
      provenance: String(raw.constraints.provenance || "system_inferred"),
    };
  } else if (Array.isArray(raw.constraints)) {
    constraints = {
      value: raw.constraints.map((c) => String(c || "").trim()).filter(Boolean),
      provenance: "system_inferred",
    };
  }
  return {
    goal: pick("goal", "user_provided"),
    audience: pick("audience", "system_inferred"),
    usage: pick("usage", "system_inferred"),
    constraints,
    deadline: pick("deadline", "system_inferred"),
    expectedQuality: pick("expectedQuality", "system_inferred"),
    assumptions: Array.isArray(raw.assumptions)
      ? raw.assumptions.map((a) => String(a || "").trim()).filter(Boolean)
      : base.assumptions,
    unresolvedQuestions: Array.isArray(raw.unresolvedQuestions)
      ? raw.unresolvedQuestions.map((a) => String(a || "").trim()).filter(Boolean)
      : base.unresolvedQuestions,
    subjectContextUsedRefs: Array.isArray(raw.subjectContextUsedRefs)
      ? raw.subjectContextUsedRefs.map((a) => String(a || "").trim()).filter(Boolean)
      : [],
  };
}

function createDraftVersion({
  planId,
  taskId,
  versionNumber,
  understanding,
  items,
  basedOnVersionId,
  status,
  planningInvocationRef,
}) {
  const normalizedItems = normalizeOrder((items || []).map((it, i) => normalizeItem(it, i)));
  const now = nowIso();
  return {
    schemaVersion: 1,
    versionId: newVersionId(),
    planId,
    taskId,
    versionNumber: Number(versionNumber) || 1,
    planVersion: Number(versionNumber) || 1,
    understanding: normalizeUnderstanding(understanding, understanding && understanding.goal && understanding.goal.value),
    items: normalizedItems,
    riskSummary: { flags: [], notes: [] },
    status: PLAN_VERSION_STATUSES.includes(status) ? status : "draft",
    planningAvailabilitySnapshot: buildAvailabilitySnapshot(normalizedItems),
    planningInvocationRef: planningInvocationRef || null,
    basedOnVersionId: basedOnVersionId || null,
    sourceVersionId: basedOnVersionId || null,
    createdAt: now,
    updatedAt: now,
    confirmedAt: null,
  };
}

function createPlanRecord({ planId, taskId, draftVersion }) {
  const now = nowIso();
  const id = planId || newPlanId();
  const version = draftVersion || createDraftVersion({
    planId: id,
    taskId,
    versionNumber: 1,
    understanding: emptyUnderstanding(""),
    items: [],
  });
  version.planId = id;
  version.taskId = taskId;
  return {
    schemaVersion: 1,
    planId: id,
    taskId,
    currentDraftVersionId: version.versionId,
    activeConfirmedVersionId: null,
    versionIds: [version.versionId],
    lifecycleStatus: "active",
    createdAt: now,
    updatedAt: now,
    versions: { [version.versionId]: version },
  };
}

function repairModelPlanJson(raw) {
  if (raw == null) return { ok: false, code: "empty", message: "规划结果为空。" };
  if (typeof raw === "object") return { ok: true, value: raw };
  let text = String(raw).trim();
  if (!text) return { ok: false, code: "empty", message: "规划结果为空。" };
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, code: "invalid_json", message: "规划结果不是有效结构。", cause: err };
  }
}

function assertPointersInvariant(record) {
  const errors = [];
  if (!record || typeof record !== "object") {
    return { ok: false, errors: [{ code: "missing_record", message: "缺少计划记录。" }] };
  }
  if (record.currentDraftVersionId) {
    const v = record.versions && record.versions[record.currentDraftVersionId];
    if (!v) errors.push({ code: "draft_pointer_invalid", message: "草稿指针无效。" });
    else if (!record.versionIds.includes(record.currentDraftVersionId)) {
      errors.push({ code: "draft_not_listed", message: "草稿不在版本清单中。" });
    }
  }
  if (record.activeConfirmedVersionId) {
    const v = record.versions && record.versions[record.activeConfirmedVersionId];
    if (!v) errors.push({ code: "confirmed_pointer_invalid", message: "确认指针无效。" });
    else if (v.status !== "confirmed" && v.status !== "superseded") {
      // active must be confirmed; superseded should not remain active
      if (v.status !== "confirmed") {
        errors.push({ code: "confirmed_status_invalid", message: "有效确认版本状态不正确。" });
      }
    } else if (v.status === "superseded") {
      errors.push({ code: "active_is_superseded", message: "有效确认指针指向已替代版本。" });
    }
  }
  const confirmedActive = Object.values(record.versions || {}).filter((v) => v && v.status === "confirmed");
  if (confirmedActive.length > 1) {
    errors.push({ code: "multiple_active_confirmed", message: "存在多个未替代的确认版本。" });
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  KIND_BASELINE,
  PLAN_VERSION_STATUSES,
  nowIso,
  newPlanId,
  newVersionId,
  newItemId,
  provenanceString,
  emptyUnderstanding,
  normalizeKind,
  baselineForKind,
  normalizeItem,
  normalizeOrder,
  includedItems,
  validateDependencyGraph,
  buildAvailabilitySnapshot,
  canConfirmVersion,
  normalizeUnderstanding,
  createDraftVersion,
  createPlanRecord,
  repairModelPlanJson,
  assertPointersInvariant,
  defaultTitleForKind,
  defaultPurposeForKind,
};

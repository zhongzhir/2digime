"use strict";

/**
 * DVL2-01 planner: rule-based fallback + model-assisted planning (schema-validated).
 * Does not create artifact capability invocations or real deliverable files.
 */

const {
  emptyUnderstanding,
  provenanceString,
  normalizeUnderstanding,
  normalizeItem,
  normalizeOrder,
  repairModelPlanJson,
  createDraftVersion,
  createPlanRecord,
  nowIso,
  baselineForKind,
} = require("./deliverable-plan-schema");

function detectScene(goal) {
  const g = String(goal || "");
  const introHints = /介绍|投资人|合作伙伴|路演|官网|对外|宣传材料|成果包/;
  const videoHints = /视频|短片|宣传片/;
  const audioHints = /音频|播客|口播/;
  const docOnly = /写一份|一份.*文档|介绍文档|说明书/;
  return {
    introPackage: introHints.test(g),
    video: videoHints.test(g),
    audio: audioHints.test(g),
    singleDoc: docOnly.test(g) && !introHints.test(g),
  };
}

function applyDefaultAssumptions(understanding) {
  const u = { ...understanding, assumptions: (understanding.assumptions || []).slice() };
  if (!u.audience.value) {
    u.audience = provenanceString("面向与该任务相关的一般读者或相关方", "system_inferred");
    u.assumptions.push("受众未明确时，按一般相关读者理解。");
  }
  if (!u.usage.value) {
    u.usage = provenanceString("用于说明与沟通", "system_inferred");
    u.assumptions.push("用途未明确时，按说明与沟通理解。");
  }
  if (!u.expectedQuality.value) {
    u.expectedQuality = provenanceString("清晰、可直接对外使用的完整稿", "system_inferred");
  }
  return u;
}

function buildRuleBasedItems(goal, understanding) {
  const scene = detectScene(goal);
  const items = [];
  if (scene.video) {
    items.push(
      normalizeItem(
        {
          kind: "video",
          title: "项目宣传视频",
          purpose: "视频形态对外介绍",
          priority: "recommended",
          riskFlags: ["当前版本暂不执行真实视频生成"],
        },
        0
      )
    );
    items.push(
      normalizeItem(
        {
          kind: "document",
          title: "视频脚本",
          purpose: "作为当前可规划的文字替代交付",
          priority: "required",
        },
        1
      )
    );
    items.push(
      normalizeItem(
        {
          kind: "image",
          title: "封面图片",
          purpose: "作为视觉入口替代",
          priority: "recommended",
        },
        2
      )
    );
  } else if (scene.audio) {
    items.push(
      normalizeItem(
        {
          kind: "audio",
          title: "音频介绍",
          purpose: "音频形态介绍",
          priority: "recommended",
          riskFlags: ["当前版本暂不执行真实音频生成"],
        },
        0
      )
    );
    items.push(
      normalizeItem(
        {
          kind: "document",
          title: "口播稿",
          purpose: "作为当前可规划的文字替代交付",
          priority: "required",
        },
        1
      )
    );
  } else if (scene.singleDoc) {
    items.push(
      normalizeItem(
        {
          kind: "document",
          title: "项目介绍文档",
          purpose: understanding.usage.value || "正式介绍",
          priority: "required",
        },
        0
      )
    );
  } else if (scene.introPackage) {
    const kinds = ["document", "presentation", "webpage", "image"];
    // Trim by usage hints — not always all four
    const usage = String((understanding.usage && understanding.usage.value) || "") + goal;
    let selected = kinds.slice();
    if (/官网|落地页|网页/.test(usage) && !/路演|投资人|PPT|演示/.test(usage)) {
      selected = ["webpage", "image", "document"];
    }
    selected.forEach((kind, i) => {
      items.push(
        normalizeItem(
          {
            kind,
            priority: kind === "document" || kind === "presentation" ? "required" : "recommended",
          },
          i
        )
      );
    });
  } else {
    items.push(
      normalizeItem(
        {
          kind: "document",
          title: "任务说明文档",
          purpose: "围绕当前目标形成可修改的正式文稿计划",
          priority: "required",
        },
        0
      )
    );
  }
  return normalizeOrder(items);
}

function ruleBasedPlan({ goal, audience, usage, constraints, deadline, expectedQuality }) {
  const g = String(goal || "").trim();
  if (!g) {
    return { ok: false, code: "empty_goal", message: "请先填写任务目标。" };
  }
  let understanding = emptyUnderstanding(g);
  if (audience) understanding.audience = provenanceString(String(audience), "user_provided");
  if (usage) understanding.usage = provenanceString(String(usage), "user_provided");
  if (Array.isArray(constraints) && constraints.length) {
    understanding.constraints = {
      value: constraints.map((c) => String(c || "").trim()).filter(Boolean),
      provenance: "user_provided",
    };
  }
  if (deadline) understanding.deadline = provenanceString(String(deadline), "user_provided");
  if (expectedQuality) {
    understanding.expectedQuality = provenanceString(String(expectedQuality), "user_provided");
  }
  understanding = applyDefaultAssumptions(understanding);
  const scene = detectScene(g);
  if (!audience && scene.introPackage) {
    understanding.unresolvedQuestions = ["这次材料主要面向谁？"];
  }
  const items = buildRuleBasedItems(g, understanding);
  return {
    ok: true,
    mode: "rule_based",
    understanding,
    items,
    planningInvocationRef: null,
  };
}

function buildPlanningModelMessages(input) {
  const goal = String(input.goal || "").trim();
  const audience = input.audience ? String(input.audience) : "";
  const usage = input.usage ? String(input.usage) : "";
  const constraints = Array.isArray(input.constraints) ? input.constraints : [];
  const deadline = input.deadline ? String(input.deadline) : "";
  const expectedQuality = input.expectedQuality ? String(input.expectedQuality) : "";

  const system =
    "你是成果规划助手。只根据用户给出的最小字段，输出一个 JSON 对象，不要输出其它文字。" +
    "JSON 字段：understanding{goal,audience,usage,constraints,deadline,expectedQuality,assumptions,unresolvedQuestions}," +
    "items[{kind,title,purpose,priority,format}]。" +
    "kind 仅可：document,presentation,webpage,image,audio,video,dataset,code,dashboard,archive,other。" +
    "不要编造附件或主体资料；信息不足时用 assumptions，不要拒绝规划。";

  const user = JSON.stringify({
    goal,
    audience: audience || null,
    usage: usage || null,
    constraints,
    deadline: deadline || null,
    expectedQuality: expectedQuality || null,
  });

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function normalizeModelSuggestion(parsed, goal) {
  const understanding = normalizeUnderstanding(
    {
      goal: { value: goal, provenance: "user_provided" },
      audience: parsed.understanding && parsed.understanding.audience,
      usage: parsed.understanding && parsed.understanding.usage,
      constraints: parsed.understanding && parsed.understanding.constraints,
      deadline: parsed.understanding && parsed.understanding.deadline,
      expectedQuality: parsed.understanding && parsed.understanding.expectedQuality,
      assumptions: parsed.understanding && parsed.understanding.assumptions,
      unresolvedQuestions: parsed.understanding && parsed.understanding.unresolvedQuestions,
    },
    goal
  );
  const fixed = applyDefaultAssumptions(understanding);
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  let items = normalizeOrder(rawItems.map((it, i) => normalizeItem(it, i)));
  // Force baseline availability (never claim currently generatable)
  items = items.map((it) => {
    const base = baselineForKind(it.kind);
    return {
      ...it,
      contractSupport: base.contractSupport,
      runtimeAvailability: base.runtimeAvailability,
    };
  });
  if (!items.length) {
    return { ok: false, code: "empty_items", message: "规划结果未包含预计交付。" };
  }
  return { ok: true, understanding: fixed, items };
}

async function modelAssistedPlan(input, { callModel } = {}) {
  const g = String((input && input.goal) || "").trim();
  if (!g) return { ok: false, code: "empty_goal", message: "请先填写任务目标。" };
  if (typeof callModel !== "function") {
    return { ok: false, code: "no_model", message: "规划模型不可用。" };
  }
  const messages = buildPlanningModelMessages(input);
  let raw;
  try {
    // Contract: callModel(messages, options) → string. Route metadata stays in main closure.
    raw = await callModel(messages, {
      temperature: 0.2,
      purpose: "deliverable_planning",
    });
  } catch (err) {
    return {
      ok: false,
      code: (err && err.code) || "model_failed",
      message: (err && err.message) || "规划模型调用失败。",
    };
  }
  if (typeof raw !== "string") {
    return {
      ok: false,
      code: "invalid_model_response",
      message: "规划模型返回格式无效。",
    };
  }
  const repaired = repairModelPlanJson(raw);
  if (!repaired.ok) return repaired;
  const normalized = normalizeModelSuggestion(repaired.value, g);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    mode: "model_assisted",
    understanding: normalized.understanding,
    items: normalized.items,
    planningInvocationRef: null,
  };
}

async function generatePlanSuggestion(input, options) {
  const opts = options || {};
  // Prefer model when provided; always allow rule fallback.
  if (opts.callModel && opts.forceRule !== true) {
    const modeled = await modelAssistedPlan(input, { callModel: opts.callModel });
    if (modeled.ok) return modeled;
    const fallback = ruleBasedPlan(input || {});
    if (fallback.ok) {
      return {
        ...fallback,
        mode: "rule_based_fallback",
        modelError: { code: modeled.code, message: modeled.message },
      };
    }
    return modeled;
  }
  return ruleBasedPlan(input || {});
}

function applySuggestionToRecord({ taskId, existingRecord, suggestion, goal }) {
  if (!suggestion || !suggestion.ok) return { ok: false, code: "no_suggestion", message: "没有可用的规划建议。" };
  if (!existingRecord) {
    const draft = createDraftVersion({
      planId: undefined,
      taskId,
      versionNumber: 1,
      understanding: suggestion.understanding,
      items: suggestion.items,
      status: "draft",
      planningInvocationRef: suggestion.planningInvocationRef,
    });
    const record = createPlanRecord({ taskId, draftVersion: draft });
    draft.planId = record.planId;
    record.versions[draft.versionId] = draft;
    record.currentDraftVersionId = draft.versionId;
    return { ok: true, plan: record, version: draft };
  }

  const record = JSON.parse(JSON.stringify(existingRecord));
  const confirmedId = record.activeConfirmedVersionId;
  const confirmed = confirmedId && record.versions[confirmedId];
  let versionNumber = 1;
  const nums = Object.values(record.versions || {}).map((v) => Number(v.versionNumber) || 0);
  if (nums.length) versionNumber = Math.max(...nums) + 1;

  let basedOn = null;
  if (confirmed && confirmed.status === "confirmed") {
    basedOn = confirmed.versionId;
  } else if (record.currentDraftVersionId && record.versions[record.currentDraftVersionId]) {
    const cur = record.versions[record.currentDraftVersionId];
    if (cur.status === "draft" || cur.status === "needs_user_input" || cur.status === "ready_for_confirmation") {
      cur.understanding = suggestion.understanding;
      cur.items = normalizeOrder(suggestion.items.map((it, i) => normalizeItem(it, i)));
      cur.planningAvailabilitySnapshot = require("./deliverable-plan-schema").buildAvailabilitySnapshot(cur.items);
      cur.planningInvocationRef = suggestion.planningInvocationRef || cur.planningInvocationRef;
      cur.updatedAt = nowIso();
      cur.status = "draft";
      record.updatedAt = nowIso();
      return { ok: true, plan: record, version: cur };
    }
  }

  const draft = createDraftVersion({
    planId: record.planId,
    taskId,
    versionNumber,
    understanding: suggestion.understanding,
    items: suggestion.items,
    basedOnVersionId: basedOn,
    status: "draft",
    planningInvocationRef: suggestion.planningInvocationRef,
  });
  if (record.currentDraftVersionId && record.versions[record.currentDraftVersionId]) {
    const prev = record.versions[record.currentDraftVersionId];
    if (prev.status === "draft" || prev.status === "needs_user_input" || prev.status === "ready_for_confirmation") {
      prev.status = "cancelled";
      prev.updatedAt = nowIso();
    }
  }
  record.versions[draft.versionId] = draft;
  record.versionIds.push(draft.versionId);
  record.currentDraftVersionId = draft.versionId;
  record.updatedAt = nowIso();
  return { ok: true, plan: record, version: draft };
}

function saveDraftEdits(record, { understanding, items }) {
  const next = JSON.parse(JSON.stringify(record));
  let draftId = next.currentDraftVersionId;
  let draft = draftId && next.versions[draftId];
  if (!draft || draft.status === "confirmed" || draft.status === "superseded" || draft.status === "cancelled") {
    // fork from active confirmed
    const baseId = next.activeConfirmedVersionId;
    const base = baseId && next.versions[baseId];
    if (!base) {
      return { ok: false, code: "no_draft_base", message: "没有可编辑的计划草稿。" };
    }
    const nums = Object.values(next.versions || {}).map((v) => Number(v.versionNumber) || 0);
    const versionNumber = (nums.length ? Math.max(...nums) : 0) + 1;
    draft = createDraftVersion({
      planId: next.planId,
      taskId: next.taskId,
      versionNumber,
      understanding: understanding || base.understanding,
      items: items || base.items,
      basedOnVersionId: base.versionId,
      status: "draft",
    });
    next.versions[draft.versionId] = draft;
    next.versionIds.push(draft.versionId);
    next.currentDraftVersionId = draft.versionId;
  } else {
    if (understanding) draft.understanding = normalizeUnderstanding(understanding, understanding.goal && understanding.goal.value);
    if (items) {
      draft.items = normalizeOrder(items.map((it, i) => normalizeItem(it, i)));
      draft.planningAvailabilitySnapshot = require("./deliverable-plan-schema").buildAvailabilitySnapshot(draft.items);
    }
    draft.updatedAt = nowIso();
  }
  next.updatedAt = nowIso();
  return { ok: true, plan: next, version: next.versions[next.currentDraftVersionId] };
}

function confirmDraft(record) {
  const { canConfirmVersion, buildAvailabilitySnapshot } = require("./deliverable-plan-schema");
  const next = JSON.parse(JSON.stringify(record));
  const draftId = next.currentDraftVersionId;
  const draft = draftId && next.versions[draftId];
  if (!draft) return { ok: false, code: "no_draft", message: "没有待确认的草稿。" };
  if (draft.status === "confirmed") {
    return { ok: false, code: "already_confirmed", message: "该版本已确认。" };
  }
  const check = canConfirmVersion(draft);
  if (!check.ok) return check;
  const prevConfirmedId = next.activeConfirmedVersionId;
  if (prevConfirmedId && next.versions[prevConfirmedId] && prevConfirmedId !== draft.versionId) {
    next.versions[prevConfirmedId].status = "superseded";
    next.versions[prevConfirmedId].updatedAt = nowIso();
  }
  draft.status = "confirmed";
  draft.confirmedAt = nowIso();
  draft.updatedAt = nowIso();
  draft.planningAvailabilitySnapshot = buildAvailabilitySnapshot(draft.items);
  next.activeConfirmedVersionId = draft.versionId;
  next.currentDraftVersionId = null;
  next.updatedAt = nowIso();
  return { ok: true, plan: next, version: draft };
}

function cancelDraft(record) {
  const next = JSON.parse(JSON.stringify(record));
  const draftId = next.currentDraftVersionId;
  const draft = draftId && next.versions[draftId];
  if (!draft) return { ok: false, code: "no_draft", message: "没有可取消的草稿。" };
  if (draft.status === "confirmed") {
    return { ok: false, code: "cannot_cancel_confirmed", message: "已确认版本不能取消为草稿。" };
  }
  draft.status = "cancelled";
  draft.updatedAt = nowIso();
  next.currentDraftVersionId = null;
  next.updatedAt = nowIso();
  return { ok: true, plan: next, version: draft };
}

module.exports = {
  detectScene,
  ruleBasedPlan,
  buildPlanningModelMessages,
  modelAssistedPlan,
  generatePlanSuggestion,
  applySuggestionToRecord,
  applyDefaultAssumptions,
  saveDraftEdits,
  confirmDraft,
  cancelDraft,
};

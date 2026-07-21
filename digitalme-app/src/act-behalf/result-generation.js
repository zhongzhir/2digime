"use strict";

/**
 * VL1 block 3: source-constrained research expression results (four evidence columns).
 * Does not write Package, call feedback, run new web search, or generate Experience Proposals.
 */

const crypto = require("node:crypto");
const { assertTaskIntentMinimal } = require("./task-intent");
const {
  ALLOWED_SKILL_ID,
  TOOL_CAPABILITY_ID,
  MAX_SOURCES_TOTAL,
  normalizeUrlKey,
  safeErrorSummary,
  isResearchResultCurrent,
} = require("./research-run");

const RESULT_KIND = "research_expression";
const MAX_CLAIMS_IN_PROMPT = 12;
const MAX_CLAIM_TEXT_CHARS = 360;
const MAX_EXTERNAL_IN_PROMPT = MAX_SOURCES_TOTAL;
const MAX_SNIPPET_CHARS = 280;
const MAX_INFERENCES = 12;
const MAX_INFERENCE_CHARS = 600;
const MAX_FINAL_DRAFT_CHARS = 12000;
const MAX_REVISIONS = 20;
const MAX_SUBJECT_SUMMARY_CHARS = 4000;

const RESULT_STATUS = Object.freeze({
  pending: "pending",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  interrupted: "interrupted",
});

const OWNER_DECISION = Object.freeze({
  pending: "pending",
  adopted: "adopted",
  rejected: "rejected",
});

function newId(prefix) {
  return (
    String(prefix || "id") +
    "_" +
    Date.now().toString(36) +
    "_" +
    crypto.randomBytes(3).toString("hex")
  );
}

function truncate(text, max) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function hostnameOf(url) {
  try {
    return new URL(String(url || "")).hostname || "";
  } catch {
    return "";
  }
}

function confirmedClaimsFromContext(subjectContext) {
  const out = [];
  for (const c of (subjectContext && subjectContext.claims) || []) {
    if (!c || !c.id) continue;
    const st = c.confirmationState;
    if (st !== "confirmed" && st !== "user_edited") continue;
    out.push({
      claimId: String(c.id),
      kind: String(c.kind || "other"),
      text: truncate(c.text || "", MAX_CLAIM_TEXT_CHARS),
      label: String(c.label || ""),
      sourceRefs: Array.isArray(c.sourceRefs)
        ? c.sourceRefs.map((r) => ({
            source: r && r.source != null ? String(r.source) : "",
            locator: r && r.locator != null ? String(r.locator) : undefined,
          }))
        : [],
      confirmationState: st,
      subjectContextVersion: String(
        (subjectContext && (subjectContext.version || subjectContext.subjectVersion)) || "unknown"
      ),
    });
  }
  return out.slice(0, MAX_CLAIMS_IN_PROMPT);
}

function currentSubjectVersion(subjectContext) {
  return String(
    (subjectContext && (subjectContext.version || subjectContext.subjectVersion)) || ""
  ).trim();
}

function invocationGoal(inv) {
  return String(
    (inv && inv.disclosedContext && inv.disclosedContext.goal) ||
      (inv && inv.input && inv.input.goal) ||
      ""
  ).trim();
}

function invocationSubjectVersion(inv) {
  return String(
    (inv && inv.subjectContextVersion) ||
      (inv && inv.disclosedContext && inv.disclosedContext.subjectVersion) ||
      ""
  ).trim();
}

function strictEqualNonEmpty(a, b) {
  const x = String(a || "").trim();
  const y = String(b || "").trim();
  return !!x && !!y && x === y;
}

function isAllowedResearchToolInvocation(inv) {
  if (!inv || inv.kind !== "tool") return false;
  return String(inv.capabilityId || "") === TOOL_CAPABILITY_ID;
}

function isMatchingSkillInvocation(inv, { goal, subjectVersion } = {}) {
  if (!inv || inv.kind !== "skill") return false;
  if (inv.capabilityId !== ALLOWED_SKILL_ID && inv.skillId !== ALLOWED_SKILL_ID) return false;
  if (inv.status !== "succeeded") return false;
  if (!strictEqualNonEmpty(invocationGoal(inv), goal)) return false;
  if (!strictEqualNonEmpty(invocationSubjectVersion(inv), subjectVersion)) return false;
  return true;
}

function isMatchingToolInvocation(inv, { goal, subjectVersion } = {}) {
  if (!isAllowedResearchToolInvocation(inv)) return false;
  if (!strictEqualNonEmpty(invocationGoal(inv), goal)) return false;
  if (!strictEqualNonEmpty(invocationSubjectVersion(inv), subjectVersion)) return false;
  return true;
}

function findMatchingSkillInvocation(task, goal) {
  const invs = Array.isArray(task && task.invocations) ? task.invocations : [];
  const subjectVersion = currentSubjectVersion(task && task.subjectContext);
  const g = String(goal || "").trim();
  for (let i = invs.length - 1; i >= 0; i -= 1) {
    if (isMatchingSkillInvocation(invs[i], { goal: g, subjectVersion })) return invs[i];
  }
  return null;
}

function findMatchingToolInvocation(task) {
  const invs = Array.isArray(task && task.invocations) ? task.invocations : [];
  const goal = String((task && task.taskIntent && task.taskIntent.goal) || (task && task.goal) || "").trim();
  const subjectVersion = currentSubjectVersion(task && task.subjectContext);
  for (let i = invs.length - 1; i >= 0; i -= 1) {
    if (isMatchingToolInvocation(invs[i], { goal, subjectVersion })) return invs[i];
  }
  return null;
}

function projectExternalEvidenceFromTask(task) {
  const tool = findMatchingToolInvocation(task);

  if (!tool) {
    return {
      toolInvocation: null,
      externalEvidence: [],
      emptyReason: "当前目标与本人上下文版本下，没有匹配的只读外部调研调用。",
      hasReliableSources: false,
      toolStatus: null,
    };
  }

  const sources = [];
  const seen = new Set();
  const rawList = []
    .concat(Array.isArray(tool.discoveredSources) ? tool.discoveredSources : [])
    .concat(
      Array.isArray(tool.resultRefs)
        ? tool.resultRefs.map((r, idx) => ({
            sourceId: "rr_" + idx,
            title: r.title,
            url: r.url,
            snippet: r.snippet,
            provider: r.provider,
          }))
        : []
    );

  for (const s of rawList) {
    if (!s || !s.url) continue;
    const provider = String(s.provider || tool.provider || "").trim();
    if (!provider) continue;
    const key = normalizeUrlKey(s.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const sourceId = String(s.sourceId || newId("src"));
    sources.push({
      evidenceId: newId("ev"),
      sourceId,
      resultRef: sourceId,
      title: truncate(s.title || s.url, 200),
      url: String(s.url),
      snippet: truncate(s.snippet || s.summary || "", MAX_SNIPPET_CHARS),
      summary: truncate(s.snippet || s.summary || "", MAX_SNIPPET_CHARS),
      provider,
      query: String(s.query || (tool.input && tool.input.queries && tool.input.queries[0]) || ""),
      discoveredAt: String(s.discoveredAt || tool.completedAt || tool.startedAt || ""),
      retrievalStatus: String(s.retrievalStatus || "retrieved"),
      hostname: hostnameOf(s.url),
      provenance: s.provenance || {
        kind: "external_search",
        capabilityId: TOOL_CAPABILITY_ID,
        provider,
        invocationId: tool.invocationId,
      },
      sourceRef: s.sourceRef || {
        source: "external_web",
        locator: String(s.url),
        provider,
      },
      usageNote: "来源摘要，待核实；不得视为已充分证明的事实。",
    });
    if (sources.length >= MAX_EXTERNAL_IN_PROMPT) break;
  }

  const ok = tool.status === "succeeded" && sources.length > 0;
  let emptyReason = null;
  if (!ok) {
    if (tool.status === "failed") {
      emptyReason =
        (tool.error && tool.error.message) || "本次外部调研失败，未取得可用外部来源。";
    } else if (tool.status === "interrupted") {
      emptyReason = "外部调研中断，未取得可用外部来源。";
    } else if (tool.status === "running") {
      emptyReason = "外部调研仍在进行中。";
    } else {
      emptyReason = "本次未取得可用外部来源。";
    }
  }

  return {
    toolInvocation: tool,
    externalEvidence: sources,
    emptyReason,
    hasReliableSources: ok,
    toolStatus: tool.status,
  };
}

function assertGeneratePreconditions(task, opts = {}) {
  if (!task || !task.taskId) {
    return { ok: false, code: "task_not_found", message: "找不到该任务。" };
  }
  const intent = {
    ...(task.taskIntent || {}),
    taskId: task.taskId,
    goal: (task.taskIntent && task.taskIntent.goal) || task.goal || "",
  };
  const intentCheck = assertTaskIntentMinimal(intent);
  if (!intentCheck.ok) {
    return {
      ok: false,
      code: "intent_incomplete",
      message: "任务意图字段不完整：" + intentCheck.missing.join(", "),
    };
  }
  if (!String(intent.goal || "").trim()) {
    return { ok: false, code: "empty_goal", message: "请先填写研究与表达目标。" };
  }

  const sc = task.subjectContext;
  if (!sc || sc.confirmationState !== "confirmed") {
    return {
      ok: false,
      code: "context_not_confirmed",
      message: "请先确认与当前目标对应的本人上下文快照。",
    };
  }
  const snapGoal = String((sc.rankingMeta && sc.rankingMeta.goal) || "").trim();
  if (!snapGoal || snapGoal !== String(intent.goal).trim()) {
    return {
      ok: false,
      code: "context_stale_for_goal",
      message: "已确认快照与当前目标不一致，请重新确认本人上下文。",
    };
  }

  const skillId = String(task.selectedSkillId || ALLOWED_SKILL_ID);
  if (skillId !== ALLOWED_SKILL_ID) {
    return {
      ok: false,
      code: "skill_not_allowed",
      message: "本阶段仅允许使用「通用调研」Skill。",
    };
  }

  const skillInv = findMatchingSkillInvocation(task, intent.goal);
  if (!skillInv) {
    return {
      ok: false,
      code: "skill_invocation_missing",
      message: "请先完成通用调研 Skill 调用后再生成成果。",
    };
  }

  const external = projectExternalEvidenceFromTask(task);
  if (external.toolStatus === "running") {
    return {
      ok: false,
      code: "research_running",
      message: "外部调研仍在进行中，请等待完成后再生成成果。",
    };
  }

  const results = Array.isArray(task.results) ? task.results : [];
  if (results.some((r) => r && r.status === RESULT_STATUS.running)) {
    return {
      ok: false,
      code: "result_running",
      message: "已有成果正在生成，请稍候。",
    };
  }

  const policy = intent.approvalPolicy || {};
  if (policy.allowExternalSend === true) {
    return {
      ok: false,
      code: "external_send_forbidden",
      message: "当前策略禁止对外发送；无法生成可外发成果。",
    };
  }

  if (!external.hasReliableSources && !opts.continueWithoutExternalSources) {
    return {
      ok: false,
      code: "external_sources_unavailable",
      message: "本次未取得可用外部来源。若仍要生成，请明确确认在无外部来源条件下继续。",
      emptyReason: external.emptyReason,
      requiresContinueWithoutExternalSources: true,
    };
  }

  return {
    ok: true,
    intent,
    skillInvocation: skillInv,
    external,
  };
}

function buildSubjectEvidenceSection(claims) {
  return (claims || []).map((c) => ({
    claimId: c.claimId,
    kind: c.kind,
    text: c.text,
    label: c.label,
    sourceRefs: c.sourceRefs,
    confirmationState: c.confirmationState,
    subjectContextVersion: c.subjectContextVersion,
  }));
}

function buildGenerationMessages({ intent, skill, claims, externalEvidence, continueWithoutExternalSources }) {
  const systemHint = String((skill && skill.systemHint) || "").trim();
  const steps = Array.isArray(skill && skill.steps) ? skill.steps.map(String) : [];
  const claimBlock = claims
    .map(
      (c) =>
        `- claimId=${c.claimId} kind=${c.kind} state=${c.confirmationState}\n  ${c.text}`
    )
    .join("\n");
  const extBlock = (externalEvidence || []).length
    ? externalEvidence
        .map(
          (e) =>
            `- resultRef=${e.resultRef} provider=${e.provider}\n  title=${e.title}\n  url=${e.url}\n  snippet=${e.snippet}`
        )
        .join("\n")
    : "（无可用外部来源）";

  const system =
    "你是 Digital Me 的研究与表达助手。必须遵守已注入的 Skill 方法与证据边界。\n" +
    (systemHint ? "\n【Skill 方法提示】\n" + systemHint + "\n" : "") +
    (steps.length ? "\n【Skill 步骤顺序】\n" + steps.map((s, i) => i + 1 + ". " + s).join("\n") + "\n" : "") +
    "\n输出必须是单个 JSON 对象，不要 Markdown 代码围栏，字段为：\n" +
    "{\n" +
    '  "subjectSummary": "对本人已有事实/观点的整理（供参考）",\n' +
    '  "externalFindings": [{"resultRef":"...","note":"..."}],\n' +
    '  "inferences": [{"text":"...","basedOnSubjectClaimIds":["..."],"basedOnExternalResultRefs":["..."],"uncertainty":"low|medium|high","caveat":"..."}],\n' +
    '  "finalDraft": "最终可编辑成果正文"\n' +
    "}\n" +
    "规则：\n" +
    "1. 只能引用下方给出的 claimId 与 resultRef；不得发明新的 ID 或 URL。\n" +
    "2. externalFindings 不得改写 URL/provider；只能基于给定来源写 note。\n" +
    "3. 每条 inference 至少引用一个有效 claimId 或 resultRef；不确定时写 uncertainty=high。\n" +
    "4. 禁止把外部摘要写成已证实事实；禁止把推断写成 Owner 已有观点。\n" +
    (continueWithoutExternalSources
      ? "5. 本次无可用外部来源：不得虚构外部事实或引用；结论必须受限并标明不确定。\n"
      : "5. 有外部来源时仍须区分本人信息与外部摘要。\n");

  const user =
    "Task Intent\n" +
    "- goal: " +
    intent.goal +
    "\n- role: " +
    intent.role +
    "\n- expectedOutcome: " +
    intent.expectedOutcome +
    "\n- constraints: " +
    JSON.stringify(intent.constraints || []) +
    "\n\n已确认本人条目（唯一允许的本人事实/观点）\n" +
    (claimBlock || "（无）") +
    "\n范围：" +
    String((claims[0] && claims[0].subjectContextVersion) || "") +
    "\n\n外部来源（系统权威；勿改 URL）\n" +
    extBlock +
    "\n\n请生成结构化 JSON。";

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function extractJsonObject(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* continue */
  }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* continue */
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Parse + validate model JSON against whitelist claim/result IDs.
 * Authoritative external evidence always comes from `externalEvidence`, never model URLs.
 */
function materializeResultSections({
  parsed,
  claims,
  externalEvidence,
  subjectContext,
  continueWithoutExternalSources,
}) {
  const claimIds = new Set((claims || []).map((c) => c.claimId));
  const resultRefs = new Set((externalEvidence || []).map((e) => e.resultRef));
  const byResultRef = new Map((externalEvidence || []).map((e) => [e.resultRef, e]));

  const subjectEvidence = buildSubjectEvidenceSection(claims);
  // External column is authoritative projection — ignore model URLs entirely
  const externalColumn = (externalEvidence || []).map((e) => ({ ...e }));
  if (!externalColumn.length && continueWithoutExternalSources) {
    // keep empty with note at result level
  }

  const inferences = [];
  const rawInfs = Array.isArray(parsed && parsed.inferences) ? parsed.inferences : [];
  for (const inf of rawInfs.slice(0, MAX_INFERENCES)) {
    if (!inf || typeof inf !== "object") continue;
    const text = truncate(inf.text || "", MAX_INFERENCE_CHARS);
    if (!text) continue;
    const basedClaims = []
      .concat(inf.basedOnSubjectClaimIds || [])
      .map(String)
      .filter((id) => claimIds.has(id));
    const basedExt = []
      .concat(inf.basedOnExternalResultRefs || [])
      .map(String)
      .filter((id) => resultRefs.has(id));
    // Drop forged refs (already filtered). If none left → high uncertainty or skip
    let uncertainty = String(inf.uncertainty || "medium").toLowerCase();
    if (!["low", "medium", "high"].includes(uncertainty)) uncertainty = "medium";
    if (!basedClaims.length && !basedExt.length) {
      if (continueWithoutExternalSources && claimIds.size === 0) {
        // no basis at all
        continue;
      }
      if (!basedClaims.length && !continueWithoutExternalSources) {
        continue;
      }
      // allow claim-less only when no external and we have claims? if no refs, mark high or skip
      uncertainty = "high";
      if (!basedClaims.length) continue;
    }
    inferences.push({
      inferenceId: newId("inf"),
      text,
      basedOnSubjectClaimIds: basedClaims,
      basedOnExternalResultRefs: basedExt,
      uncertainty,
      caveat: truncate(inf.caveat || "", 240) || undefined,
      evidenceInsufficient: basedClaims.length + basedExt.length === 0,
    });
  }

  // Re-validate: if model listed externalFindings with unknown refs, ignore
  const externalFindingsNotes = [];
  for (const f of Array.isArray(parsed && parsed.externalFindings) ? parsed.externalFindings : []) {
    if (!f || !f.resultRef) continue;
    if (!byResultRef.has(String(f.resultRef))) continue;
    externalFindingsNotes.push({
      resultRef: String(f.resultRef),
      note: truncate(f.note || "", 240),
    });
  }
  for (const e of externalColumn) {
    const note = externalFindingsNotes.find((n) => n.resultRef === e.resultRef);
    if (note) e.modelNote = note.note;
  }

  const finalText = truncate(
    (parsed && (parsed.finalDraft || parsed.result)) || "",
    MAX_FINAL_DRAFT_CHARS
  );

  return {
    subjectEvidence,
    externalEvidence: externalColumn,
    inferences,
    subjectSummary: truncate((parsed && parsed.subjectSummary) || "", MAX_SUBJECT_SUMMARY_CHARS),
    finalDraftText: finalText,
    parseOk: !!(finalText || inferences.length || subjectEvidence.length),
  };
}

function healRunningResults(results, nowIso) {
  const now = nowIso || new Date().toISOString();
  let changed = false;
  const next = (results || []).map((r) => {
    if (!r || r.status !== RESULT_STATUS.running) return r;
    changed = true;
    return {
      ...r,
      status: RESULT_STATUS.interrupted,
      completedAt: r.completedAt || now,
      error: {
        code: "interrupted",
        message: "应用退出时成果生成未完成，已标记为中断。",
      },
    };
  });
  return { changed, results: next };
}

function isResultCurrent(task, result) {
  if (!task || !result || result.status !== RESULT_STATUS.succeeded) return false;
  if (!task.subjectContext || task.subjectContext.confirmationState !== "confirmed") return false;
  const intentGoal = String((task.taskIntent && task.taskIntent.goal) || task.goal || "").trim();
  const snapGoal = String(
    (task.subjectContext.rankingMeta && task.subjectContext.rankingMeta.goal) || ""
  ).trim();
  if (!strictEqualNonEmpty(intentGoal, snapGoal)) return false;
  const refGoal = String(
    (result.taskIntentRef && result.taskIntentRef.goal) ||
      (result.inputSnapshot && result.inputSnapshot.goal) ||
      ""
  ).trim();
  if (!strictEqualNonEmpty(refGoal, intentGoal)) return false;
  const refVer = String(
    (result.subjectContextRef && result.subjectContextRef.version) || ""
  ).trim();
  const curVer = currentSubjectVersion(task.subjectContext);
  if (!strictEqualNonEmpty(refVer, curVer)) return false;
  return true;
}

function latestCurrentResult(task) {
  const list = Array.isArray(task && task.results) ? task.results : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (isResultCurrent(task, list[i])) return list[i];
  }
  return null;
}

/**
 * Generate a research expression result using injected callModel (tests) or production callModel.
 */
async function generateResearchExpressionResult(deps) {
  const {
    userData,
    taskId,
    store,
    skills,
    callModel,
    continueWithoutExternalSources,
    now,
    forceFake,
  } = deps || {};

  if (typeof callModel !== "function") {
    return { ok: false, code: "model_unavailable", message: "模型调用未接线。" };
  }
  if (!store || typeof store.getTask !== "function" || typeof store.saveTask !== "function") {
    return { ok: false, code: "store_unavailable", message: "任务存储不可用。" };
  }

  const got = store.getTask(userData, taskId, { heal: false });
  if (!got || !got.ok) {
    return {
      ok: false,
      code: (got && got.code) || "task_not_found",
      message: (got && got.message) || "找不到该任务。",
    };
  }

  let task = got.task;
  const pre = assertGeneratePreconditions(task, {
    continueWithoutExternalSources: !!continueWithoutExternalSources,
  });
  if (!pre.ok) return pre;

  const healedInv = require("./research-run").healRunningInvocations(task.invocations);
  const healedRes = healRunningResults(task.results);
  if (healedInv.changed || healedRes.changed) {
    const savedHeal = await store.saveTask(userData, {
      ...task,
      invocations: healedInv.changed ? healedInv.invocations : task.invocations,
      results: healedRes.changed ? healedRes.results : task.results || [],
    });
    task = savedHeal.task;
  }

  if (skills && typeof skills.ensurePresetResearchSkills === "function") {
    skills.ensurePresetResearchSkills(userData);
  }
  let skill =
    skills && typeof skills.getSkill === "function"
      ? skills.getSkill(userData, ALLOWED_SKILL_ID)
      : null;
  if (!skill) {
    try {
      const { PRESET_RESEARCH_SKILLS } = require("../skills/research-presets");
      skill = PRESET_RESEARCH_SKILLS.find((s) => s.id === ALLOWED_SKILL_ID) || null;
    } catch {
      skill = null;
    }
  }
  if (!skill) {
    return { ok: false, code: "skill_not_found", message: "无法加载通用调研 Skill。" };
  }

  const claims = confirmedClaimsFromContext(task.subjectContext);
  const external = pre.external;
  const startedAt = (now && now()) || new Date().toISOString();
  const resultId = newId("res");
  const messages = buildGenerationMessages({
    intent: pre.intent,
    skill,
    claims,
    externalEvidence: external.externalEvidence,
    continueWithoutExternalSources: !!continueWithoutExternalSources || !external.hasReliableSources,
  });

  const runningResult = {
    resultId,
    taskId: task.taskId,
    kind: RESULT_KIND,
    status: RESULT_STATUS.running,
    taskIntentRef: {
      goal: pre.intent.goal,
      role: pre.intent.role,
      expectedOutcome: pre.intent.expectedOutcome,
    },
    subjectContextRef: {
      subjectId: task.subjectContext.subjectId,
      version: task.subjectContext.version || task.subjectContext.subjectVersion,
      confirmationState: task.subjectContext.confirmationState,
    },
    skillInvocationRef: pre.skillInvocation.invocationId,
    toolInvocationRefs: external.toolInvocation ? [external.toolInvocation.invocationId] : [],
    inputSnapshot: {
      goal: pre.intent.goal,
      claimIds: claims.map((c) => c.claimId),
      resultRefs: external.externalEvidence.map((e) => e.resultRef),
      continueWithoutExternalSources: !!continueWithoutExternalSources || !external.hasReliableSources,
      skillId: ALLOWED_SKILL_ID,
      systemHintInjected: !!(skill.systemHint && String(skill.systemHint).trim()),
      stepsInjected: Array.isArray(skill.steps) ? skill.steps.slice() : [],
      truncated: {
        claims: claims.length,
        external: external.externalEvidence.length,
      },
      usedFake: !!forceFake,
    },
    sections: {
      subjectEvidence: buildSubjectEvidenceSection(claims),
      externalEvidence: external.externalEvidence.slice(),
      inferences: [],
      finalDraft: {
        initialText: "",
        currentText: "",
        generatedAt: null,
        editedAt: null,
        revision: 0,
      },
    },
    modelInvocation: {
      startedAt,
      completedAt: null,
      provider: "pending",
      model: null,
      usedFake: !!forceFake,
    },
    createdAt: startedAt,
    completedAt: null,
    error: null,
    ownerDecision: OWNER_DECISION.pending,
    currentRevision: 0,
    revisions: [],
    externalEmptyReason: external.hasReliableSources ? null : external.emptyReason,
    isCurrent: true,
  };

  const priorResults = Array.isArray(task.results) ? task.results.slice() : [];
  let runningTask = {
    ...task,
    status: "result_running",
    results: priorResults.concat([runningResult]),
  };
  const savedRunning = await store.saveTask(userData, runningTask);
  runningTask = savedRunning.task;

  let raw = "";
  let modelMeta = { provider: "unknown", model: null, usedFake: !!forceFake };
  try {
    const out = await callModel(messages, {
      temperature: 0.3,
      forceFake: !!forceFake,
    });
    if (out && typeof out === "object" && out.content != null) {
      raw = String(out.content || "");
      modelMeta.provider = out.provider || modelMeta.provider;
      modelMeta.model = out.model || null;
      modelMeta.usedFake = !!out.usedFake || !!forceFake;
    } else {
      raw = String(out || "");
    }
  } catch (err) {
    const completedAt = (now && now()) || new Date().toISOString();
    const latest = store.getTask(userData, task.taskId);
    const base = latest && latest.ok ? latest.task : runningTask;
    const results = Array.isArray(base.results) ? base.results.slice() : [];
    const idx = results.findIndex((r) => r && r.resultId === resultId);
    const failed = {
      ...(idx >= 0 ? results[idx] : runningResult),
      status: RESULT_STATUS.failed,
      completedAt,
      error: { code: "model_failed", message: safeErrorSummary(err) },
      modelInvocation: {
        ...(runningResult.modelInvocation || {}),
        completedAt,
        provider: modelMeta.provider,
        model: modelMeta.model,
        usedFake: modelMeta.usedFake,
      },
      isCurrent: false,
    };
    if (idx >= 0) results[idx] = failed;
    else results.push(failed);
    const saved = await store.saveTask(userData, {
      ...base,
      status: "result_failed",
      results,
      invocations: base.invocations,
      selectedSkillId: base.selectedSkillId,
      subjectContext: base.subjectContext,
    });
    return {
      ok: false,
      code: "model_failed",
      message: failed.error.message,
      task: saved.task,
      result: failed,
    };
  }

  const parsed = extractJsonObject(raw);
  const completedAt = (now && now()) || new Date().toISOString();
  if (!parsed) {
    const latest = store.getTask(userData, task.taskId);
    const base = latest && latest.ok ? latest.task : runningTask;
    const results = Array.isArray(base.results) ? base.results.slice() : [];
    const idx = results.findIndex((r) => r && r.resultId === resultId);
    const failed = {
      ...(idx >= 0 ? results[idx] : runningResult),
      status: RESULT_STATUS.failed,
      completedAt,
      error: { code: "parse_failed", message: "模型输出无法解析为结构化成果。" },
      modelInvocation: {
        ...(runningResult.modelInvocation || {}),
        completedAt,
        provider: modelMeta.provider,
        model: modelMeta.model,
        usedFake: modelMeta.usedFake,
      },
      isCurrent: false,
    };
    if (idx >= 0) results[idx] = failed;
    else results.push(failed);
    const saved = await store.saveTask(userData, {
      ...base,
      status: "result_failed",
      results,
      invocations: base.invocations,
      selectedSkillId: base.selectedSkillId,
      subjectContext: base.subjectContext,
    });
    return {
      ok: false,
      code: "parse_failed",
      message: failed.error.message,
      task: saved.task,
      result: failed,
    };
  }

  const sections = materializeResultSections({
    parsed,
    claims,
    externalEvidence: external.externalEvidence,
    subjectContext: task.subjectContext,
    continueWithoutExternalSources: !!continueWithoutExternalSources || !external.hasReliableSources,
  });

  if (!sections.finalDraftText) {
    const latest = store.getTask(userData, task.taskId);
    const base = latest && latest.ok ? latest.task : runningTask;
    const results = Array.isArray(base.results) ? base.results.slice() : [];
    const idx = results.findIndex((r) => r && r.resultId === resultId);
    const failed = {
      ...(idx >= 0 ? results[idx] : runningResult),
      status: RESULT_STATUS.failed,
      completedAt,
      error: { code: "empty_draft", message: "模型未提供可用的成果正文。" },
      sections: {
        subjectEvidence: sections.subjectEvidence,
        externalEvidence: sections.externalEvidence,
        inferences: sections.inferences,
        finalDraft: {
          initialText: "",
          currentText: "",
          generatedAt: completedAt,
          editedAt: null,
          revision: 0,
        },
      },
      modelInvocation: {
        ...(runningResult.modelInvocation || {}),
        completedAt,
        provider: modelMeta.provider,
        model: modelMeta.model,
        usedFake: modelMeta.usedFake,
      },
      isCurrent: false,
    };
    if (idx >= 0) results[idx] = failed;
    else results.push(failed);
    const saved = await store.saveTask(userData, {
      ...base,
      status: "result_failed",
      results,
      invocations: base.invocations,
      selectedSkillId: base.selectedSkillId,
    });
    return {
      ok: false,
      code: "empty_draft",
      message: failed.error.message,
      task: saved.task,
      result: failed,
    };
  }

  const revision0 = {
    revisionId: newId("rev"),
    revision: 0,
    text: sections.finalDraftText,
    source: "model",
    createdAt: completedAt,
  };

  const succeeded = {
    ...runningResult,
    status: RESULT_STATUS.succeeded,
    completedAt,
    error: null,
    sections: {
      subjectEvidence: sections.subjectEvidence,
      externalEvidence: sections.externalEvidence,
      inferences: sections.inferences,
      subjectSummary: sections.subjectSummary,
      subjectSummaryNote: "模型整理，供参考；系统实际采用以确认快照为准。",
      finalDraft: {
        initialText: sections.finalDraftText,
        currentText: sections.finalDraftText,
        generatedAt: completedAt,
        editedAt: null,
        revision: 0,
      },
    },
    modelInvocation: {
      startedAt,
      completedAt,
      provider: modelMeta.provider,
      model: modelMeta.model,
      usedFake: modelMeta.usedFake,
    },
    ownerDecision: OWNER_DECISION.pending,
    currentRevision: 0,
    revisions: [revision0],
    isCurrent: true,
  };

  const latest = store.getTask(userData, task.taskId);
  const base = latest && latest.ok ? latest.task : runningTask;
  const results = Array.isArray(base.results) ? base.results.slice() : [];
  const idx = results.findIndex((r) => r && r.resultId === resultId);
  // Mark older succeeded results as not current for UI, keep history
  for (let i = 0; i < results.length; i += 1) {
    if (results[i] && results[i].resultId !== resultId && results[i].status === RESULT_STATUS.succeeded) {
      results[i] = { ...results[i], isCurrent: false };
    }
  }
  if (idx >= 0) results[idx] = succeeded;
  else results.push(succeeded);

  const saved = await store.saveTask(userData, {
    ...base,
    status: "result_succeeded",
    results,
    invocations: base.invocations,
    selectedSkillId: base.selectedSkillId,
    subjectContext: base.subjectContext,
    // legacy mirror for older UI
    existingUserPositions: sections.subjectEvidence.map((c) => c.text).join("\n"),
    digitalMeInferences: sections.inferences.map((i) => i.text).join("\n"),
    result: sections.finalDraftText,
  });

  return {
    ok: true,
    task: saved.task,
    result: succeeded,
    message: "已生成研究与表达成果（四栏证据已保存）。",
  };
}

async function saveResultDraftFromRenderer(store, userData, payload) {
  const taskId = payload && payload.taskId;
  const resultId = payload && payload.resultId;
  const expectedRevision =
    payload && payload.expectedRevision != null ? Number(payload.expectedRevision) : null;
  const currentText = truncate(payload && payload.currentText, MAX_FINAL_DRAFT_CHARS);

  if (!taskId || !resultId) {
    return { ok: false, code: "invalid_payload", message: "缺少任务或成果标识。" };
  }
  if (expectedRevision == null || Number.isNaN(expectedRevision)) {
    return { ok: false, code: "revision_required", message: "缺少期望修订版本。" };
  }

  const got = store.getTask(userData, taskId);
  if (!got.ok) return got;
  const task = got.task;
  const results = Array.isArray(task.results) ? task.results.slice() : [];
  const idx = results.findIndex((r) => r && r.resultId === String(resultId));
  if (idx < 0) {
    return { ok: false, code: "result_not_found", message: "找不到该成果。" };
  }
  const result = results[idx];
  if (result.status !== RESULT_STATUS.succeeded) {
    return { ok: false, code: "result_not_editable", message: "仅成功生成的成果可编辑。" };
  }
  if (!isResultCurrent(task, result)) {
    return {
      ok: false,
      code: "result_stale",
      message: "该成果不适用于当前目标或本人上下文，请重新生成。",
    };
  }
  if (Number(result.currentRevision) !== Number(expectedRevision)) {
    return {
      ok: false,
      code: "stale_revision",
      message: "成果已被更新，请重新打开后再保存。",
      currentRevision: result.currentRevision,
    };
  }

  const editedAt = new Date().toISOString();
  const nextRev = Number(result.currentRevision) + 1;
  let revisions = Array.isArray(result.revisions) ? result.revisions.slice() : [];
  revisions.push({
    revisionId: newId("rev"),
    revision: nextRev,
    text: currentText,
    source: "owner_edit",
    createdAt: editedAt,
  });
  if (revisions.length > MAX_REVISIONS) {
    // Keep first (model) + newest
    const first = revisions[0];
    revisions = [first].concat(revisions.slice(-(MAX_REVISIONS - 1)));
  }

  const updated = {
    ...result,
    sections: {
      ...result.sections,
      finalDraft: {
        ...(result.sections && result.sections.finalDraft),
        initialText:
          (result.sections && result.sections.finalDraft && result.sections.finalDraft.initialText) ||
          "",
        currentText,
        editedAt,
        revision: nextRev,
        generatedAt:
          (result.sections && result.sections.finalDraft && result.sections.finalDraft.generatedAt) ||
          result.completedAt,
      },
    },
    currentRevision: nextRev,
    revisions,
  };
  results[idx] = updated;

  const inv = require("./experience-proposal").invalidateOpenProposalsForResult(
    task.proposals,
    result.resultId,
    "成果正文已更新，未应用的学习建议已失效。"
  );

  const saved = await store.saveTask(userData, {
    ...task,
    results,
    proposals: inv.proposals,
    invocations: task.invocations,
    selectedSkillId: task.selectedSkillId,
    subjectContext: task.subjectContext,
    result: currentText,
  });
  return { ok: true, task: saved.task, result: updated };
}

async function decideResultFromRenderer(store, userData, payload) {
  const taskId = payload && payload.taskId;
  const resultId = payload && payload.resultId;
  const decision = payload && payload.decision;
  const expectedRevision =
    payload && payload.expectedRevision != null ? Number(payload.expectedRevision) : null;

  if (!taskId || !resultId) {
    return { ok: false, code: "invalid_payload", message: "缺少任务或成果标识。" };
  }
  if (decision !== OWNER_DECISION.adopted && decision !== OWNER_DECISION.rejected) {
    return { ok: false, code: "invalid_decision", message: "处置只能是采用或否定。" };
  }
  if (expectedRevision == null || Number.isNaN(expectedRevision)) {
    return { ok: false, code: "revision_required", message: "缺少期望修订版本。" };
  }

  const got = store.getTask(userData, taskId);
  if (!got.ok) return got;
  const task = got.task;
  const results = Array.isArray(task.results) ? task.results.slice() : [];
  const idx = results.findIndex((r) => r && r.resultId === String(resultId));
  if (idx < 0) {
    return { ok: false, code: "result_not_found", message: "找不到该成果。" };
  }
  const result = results[idx];
  if (result.status !== RESULT_STATUS.succeeded) {
    return { ok: false, code: "result_not_decidable", message: "仅成功成果可处置。" };
  }
  if (!isResultCurrent(task, result)) {
    return {
      ok: false,
      code: "result_stale",
      message: "该成果不适用于当前目标或本人上下文，不能采用或否定为当前结果。",
    };
  }
  if (Number(result.currentRevision) !== Number(expectedRevision)) {
    return {
      ok: false,
      code: "stale_revision",
      message: "成果已被更新，请重新打开后再处置。",
      currentRevision: result.currentRevision,
    };
  }

  const updated = {
    ...result,
    ownerDecision: decision,
    decidedAt: new Date().toISOString(),
  };
  results[idx] = updated;

  let proposals = Array.isArray(task.proposals) ? task.proposals : [];
  if (decision !== OWNER_DECISION.adopted) {
    const inv = require("./experience-proposal").invalidateOpenProposalsForResult(
      proposals,
      result.resultId,
      "成果已不再处于采用状态，未应用的学习建议已失效。"
    );
    proposals = inv.proposals;
  }

  const saved = await store.saveTask(userData, {
    ...task,
    results,
    proposals,
    invocations: task.invocations,
    selectedSkillId: task.selectedSkillId,
    subjectContext: task.subjectContext,
  });
  return {
    ok: true,
    task: saved.task,
    result: updated,
    message: decision === OWNER_DECISION.adopted ? "已采用本成果（未写入主体资料包）。" : "已否定本成果（记录已保留）。",
  };
}

module.exports = {
  RESULT_KIND,
  RESULT_STATUS,
  OWNER_DECISION,
  MAX_REVISIONS,
  MAX_EXTERNAL_IN_PROMPT,
  confirmedClaimsFromContext,
  projectExternalEvidenceFromTask,
  findMatchingSkillInvocation,
  findMatchingToolInvocation,
  isMatchingSkillInvocation,
  isMatchingToolInvocation,
  isAllowedResearchToolInvocation,
  currentSubjectVersion,
  assertGeneratePreconditions,
  buildGenerationMessages,
  extractJsonObject,
  materializeResultSections,
  healRunningResults,
  isResultCurrent,
  latestCurrentResult,
  generateResearchExpressionResult,
  saveResultDraftFromRenderer,
  decideResultFromRenderer,
  isResearchResultCurrent,
};

"use strict";

/**
 * VL1 block 2: real Skill selection + read-only external research for act-behalf tasks.
 * Does not write Package, call feedback:apply, or generate final research prose.
 */

const crypto = require("node:crypto");
const { assertTaskIntentMinimal } = require("./task-intent");

const ALLOWED_SKILL_ID = "psk_preset_general_research";
const TOOL_CAPABILITY_ID = "research.webSearch";
const PERMISSION_SCOPE = Object.freeze(["readonly_external_research"]);

const MAX_QUERIES = 2;
const MAX_SOURCES_TOTAL = 8;
const MAX_SOURCES_PER_QUERY = 8;
const MAX_QUERY_CHARS = 160;
const MAX_CLAIM_HINTS = 3;
const MAX_HINT_CHARS = 36;
const MAX_ERROR_CHARS = 240;

const INVOCATION_STATUS = Object.freeze({
  pending: "pending",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  interrupted: "interrupted",
});

function newInvocationId(prefix) {
  return (
    String(prefix || "inv") +
    "_" +
    Date.now().toString(36) +
    "_" +
    crypto.randomBytes(3).toString("hex")
  );
}

function newSourceId() {
  return "src_" + Date.now().toString(36) + "_" + crypto.randomBytes(3).toString("hex");
}

function truncate(text, max) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function safeErrorSummary(err) {
  const msg =
    (err && err.message && String(err.message)) ||
    (typeof err === "string" ? err : "外部调研失败。");
  // Never echo secrets / env-looking tokens
  const scrubbed = msg
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[已隐藏]")
    .replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]");
  return truncate(scrubbed, MAX_ERROR_CHARS);
}

function normalizeUrlKey(url) {
  try {
    const u = new URL(String(url || "").trim());
    u.hash = "";
    let path = u.pathname || "";
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    u.pathname = path;
    return u.toString().toLowerCase();
  } catch {
    return String(url || "")
      .trim()
      .toLowerCase()
      .replace(/\/+$/, "");
  }
}

function hostnameOf(url) {
  try {
    return new URL(String(url || "")).hostname || "";
  } catch {
    return "";
  }
}

/**
 * Bounded query assembly from Task Intent + confirmed Subject Context.
 * Never includes full Package or full claim bodies.
 */
function buildResearchQueries(taskIntent, subjectContext) {
  const goal = String((taskIntent && taskIntent.goal) || "").trim();
  const outcome = String((taskIntent && taskIntent.expectedOutcome) || "").trim();
  const constraints = Array.isArray(taskIntent && taskIntent.constraints)
    ? taskIntent.constraints.map((c) => String(c || "").trim()).filter(Boolean).slice(0, 3)
    : [];

  const hints = [];
  for (const c of (subjectContext && subjectContext.claims) || []) {
    if (hints.length >= MAX_CLAIM_HINTS) break;
    const label = String((c && c.label) || "").trim();
    if (label) hints.push(truncate(label, MAX_HINT_CHARS));
  }

  const queries = [];
  const primary = truncate([goal, outcome].filter(Boolean).join(" ").trim() || goal, MAX_QUERY_CHARS);
  if (primary) queries.push(primary);

  const secondaryBits = [];
  if (constraints.length) secondaryBits.push(constraints.join("；"));
  else if (hints.length) secondaryBits.push(hints.join("；"));
  if (secondaryBits.length) {
    const secondary = truncate([goal, ...secondaryBits].join(" ").trim(), MAX_QUERY_CHARS);
    if (secondary && secondary !== primary) queries.push(secondary);
  }

  return queries.slice(0, MAX_QUERIES);
}

function buildDisclosedContext(taskIntent, subjectContext, queries) {
  const claims = (subjectContext && subjectContext.claims) || [];
  return {
    mode: "query_level",
    goal: String((taskIntent && taskIntent.goal) || "").trim(),
    goalSummary: truncate(taskIntent && taskIntent.goal, 80),
    subjectId: subjectContext && subjectContext.subjectId,
    subjectVersion: subjectContext && (subjectContext.version || subjectContext.subjectVersion),
    subjectContextConfirmedAt: subjectContext && subjectContext.confirmedAt,
    claimIds: claims.slice(0, 8).map((c) => c.id),
    claimCount: claims.length,
    queries: (queries || []).slice(),
    note: "仅向外部检索披露查询词级别信息；未发送主体资料包全文。",
  };
}

function assertResearchPreconditions(task, skillId) {
  if (!task || !task.taskId) {
    return { ok: false, code: "task_not_found", message: "找不到该任务。" };
  }
  const intent = {
    ...(task.taskIntent || {}),
    taskId: task.taskId,
    goal: (task.taskIntent && task.taskIntent.goal) || task.goal || task.request || "",
  };
  const intentCheck = assertTaskIntentMinimal(intent);
  if (!intentCheck.ok) {
    return {
      ok: false,
      code: "intent_incomplete",
      message: "任务意图字段不完整：" + intentCheck.missing.join(", "),
      missing: intentCheck.missing,
    };
  }

  const sc = task.subjectContext;
  if (!sc || sc.confirmationState !== "confirmed") {
    return {
      ok: false,
      code: "context_not_confirmed",
      message: "请先确认与当前目标对应的本人上下文快照。",
    };
  }

  const intentGoal = String(intent.goal || "").trim();
  const snapGoal = String((sc.rankingMeta && sc.rankingMeta.goal) || "").trim();
  if (!snapGoal || snapGoal !== intentGoal) {
    return {
      ok: false,
      code: "context_stale_for_goal",
      message: "已确认快照与当前目标不一致，请重新生成并确认本人上下文。",
    };
  }

  const sid = String(skillId || ALLOWED_SKILL_ID).trim();
  if (sid !== ALLOWED_SKILL_ID) {
    return {
      ok: false,
      code: "skill_not_allowed",
      message: "本阶段仅允许使用「通用调研」Skill。",
      skillId: sid,
    };
  }

  return { ok: true, intent, skillId: sid };
}

function normalizeDiscoveredSource(raw, { query, provider, discoveredAt } = {}) {
  const url = String((raw && (raw.url || raw.link)) || "").trim();
  if (!url) return null;
  const title = truncate((raw && (raw.title || raw.name)) || url, 200) || url;
  const snippet = truncate((raw && (raw.snippet || raw.description || raw.summary)) || "", 400);
  const prov = String((raw && raw.provider) || provider || "unknown");
  return {
    sourceId: newSourceId(),
    title,
    url,
    snippet,
    summary: snippet,
    provider: prov,
    query: String(query || ""),
    discoveredAt: discoveredAt || new Date().toISOString(),
    retrievalStatus: "retrieved",
    hostname: hostnameOf(url),
    provenance: {
      kind: "external_search",
      capabilityId: TOOL_CAPABILITY_ID,
      provider: prov,
    },
    sourceRef: {
      source: "external_web",
      locator: url,
      provider: prov,
    },
  };
}

function dedupeAndCapSources(sources, maxTotal) {
  const out = [];
  const seen = new Set();
  for (const s of sources || []) {
    if (!s || !s.url) continue;
    const key = normalizeUrlKey(s.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= maxTotal) break;
  }
  return out;
}

function healRunningInvocations(invocations, nowIso) {
  const now = nowIso || new Date().toISOString();
  let changed = false;
  const next = (invocations || []).map((inv) => {
    if (!inv || inv.status !== INVOCATION_STATUS.running) return inv;
    changed = true;
    return {
      ...inv,
      status: INVOCATION_STATUS.interrupted,
      completedAt: inv.completedAt || now,
      error: {
        code: "interrupted",
        message: "应用退出时调用未完成，已标记为中断。",
      },
    };
  });
  return { changed, invocations: next };
}

function createSkillInvocation({ task, skill, intent, disclosedContext, startedAt }) {
  return {
    invocationId: newInvocationId("inv_skill"),
    taskId: task.taskId,
    capabilityId: skill.id,
    skillId: skill.id,
    capabilityVersion: skill.updatedAt || skill.createdAt || null,
    kind: "skill",
    provider: "digitalme.personal_skills",
    input: {
      goal: intent.goal,
      role: intent.role,
      expectedOutcome: intent.expectedOutcome,
      constraints: intent.constraints,
      steps: Array.isArray(skill.steps) ? skill.steps.slice() : [],
      systemHintPresent: !!(skill.systemHint && String(skill.systemHint).trim()),
    },
    inputs: {
      goal: intent.goal,
      skillTitle: skill.title,
    },
    disclosedContext,
    subjectContextVersion: disclosedContext.subjectVersion || null,
    permissionScope: PERMISSION_SCOPE.slice(),
    permissions: PERMISSION_SCOPE.slice(),
    startedAt,
    completedAt: startedAt,
    status: INVOCATION_STATUS.succeeded,
    error: null,
    resultSummary: {
      skillTitle: skill.title,
      steps: Array.isArray(skill.steps) ? skill.steps.slice() : [],
      recommendedExtensions: Array.isArray(skill.recommendedExtensions)
        ? skill.recommendedExtensions.slice()
        : [],
      note: "已加载通用调研 Skill；本块仅执行只读外部调研，不生成最终研究成果。",
    },
    sourceRefs: [],
    discoveredSources: [],
    resultRefs: [],
  };
}

function createToolInvocationShell({ task, intent, disclosedContext, queries, startedAt }) {
  return {
    invocationId: newInvocationId("inv_tool"),
    taskId: task.taskId,
    capabilityId: TOOL_CAPABILITY_ID,
    skillId: ALLOWED_SKILL_ID,
    capabilityVersion: null,
    kind: "tool",
    provider: "pending",
    input: {
      queries: queries.slice(),
      maxSources: MAX_SOURCES_TOTAL,
      permissionScope: PERMISSION_SCOPE.slice(),
    },
    inputs: {
      queries: queries.slice(),
    },
    disclosedContext,
    subjectContextVersion: disclosedContext.subjectVersion || null,
    permissionScope: PERMISSION_SCOPE.slice(),
    permissions: PERMISSION_SCOPE.slice(),
    startedAt,
    completedAt: null,
    status: INVOCATION_STATUS.running,
    error: null,
    resultSummary: null,
    sourceRefs: [],
    discoveredSources: [],
    resultRefs: [],
  };
}

/**
 * Execute block-2 research against a loaded task.
 * deps.searchWeb(em, query) must be the real researchWebSearch.searchWeb in production.
 */
async function runReadonlyExternalResearch(deps) {
  const {
    userData,
    taskId,
    skillId: requestedSkillId,
    store,
    skills,
    searchWeb,
    getExtensionManager,
    now,
  } = deps || {};

  if (typeof searchWeb !== "function") {
    return {
      ok: false,
      code: "search_unavailable",
      message: "外部调研能力未接线。",
    };
  }
  if (!store || typeof store.getTask !== "function" || typeof store.saveTask !== "function") {
    return { ok: false, code: "store_unavailable", message: "任务存储不可用。" };
  }

  const got = store.getTask(userData, taskId);
  if (!got || !got.ok) {
    return {
      ok: false,
      code: (got && got.code) || "task_not_found",
      message: (got && got.message) || "找不到该任务。",
    };
  }

  let task = got.task;
  const healed = healRunningInvocations(task.invocations);
  if (healed.changed) {
    const savedHeal = await store.saveTask(userData, { ...task, invocations: healed.invocations });
    task = savedHeal.task;
  }

  const pre = assertResearchPreconditions(task, requestedSkillId || ALLOWED_SKILL_ID);
  if (!pre.ok) return pre;

  if (skills && typeof skills.ensurePresetResearchSkills === "function") {
    skills.ensurePresetResearchSkills(userData);
  }

  let skill =
    skills && typeof skills.getSkill === "function"
      ? skills.getSkill(userData, pre.skillId)
      : null;
  if (!skill) {
    // Fallback to in-module preset definition without trusting renderer
    try {
      const { PRESET_RESEARCH_SKILLS } = require("../skills/research-presets");
      skill = PRESET_RESEARCH_SKILLS.find((s) => s.id === pre.skillId) || null;
    } catch {
      skill = null;
    }
  }
  if (!skill || skill.id !== ALLOWED_SKILL_ID) {
    return {
      ok: false,
      code: "skill_not_found",
      message: "无法加载通用调研 Skill，已阻断执行。",
    };
  }

  const startedAt = (now && now()) || new Date().toISOString();
  const queries = buildResearchQueries(pre.intent, task.subjectContext);
  if (!queries.length) {
    return { ok: false, code: "empty_goal", message: "请先填写研究与表达目标。" };
  }
  const disclosedContext = buildDisclosedContext(pre.intent, task.subjectContext, queries);

  const skillInv = createSkillInvocation({
    task,
    skill,
    intent: pre.intent,
    disclosedContext,
    startedAt,
  });
  const toolInv = createToolInvocationShell({
    task,
    intent: pre.intent,
    disclosedContext,
    queries,
    startedAt,
  });

  const priorInvocations = Array.isArray(task.invocations) ? task.invocations.slice() : [];
  // Append only — never overwrite history
  let runningTask = {
    ...task,
    selectedSkillId: ALLOWED_SKILL_ID,
    status: "research_running",
    invocations: priorInvocations.concat([skillInv, toolInv]),
  };
  const savedRunning = await store.saveTask(userData, runningTask);
  runningTask = savedRunning.task;

  let em = null;
  if (typeof getExtensionManager === "function") {
    try {
      em = await getExtensionManager();
    } catch {
      em = null;
    }
  }

  const collected = [];
  let providerUsed = "unknown";
  let lastErr = null;
  const usedFake = !!(deps && deps.forceFake === true);

  try {
    for (const q of queries) {
      const { provider, results } = await searchWeb(em, q);
      providerUsed = provider || providerUsed;
      const discoveredAt = (now && now()) || new Date().toISOString();
      for (const hit of (results || []).slice(0, MAX_SOURCES_PER_QUERY)) {
        const norm = normalizeDiscoveredSource(hit, {
          query: q,
          provider: hit.provider || provider,
          discoveredAt,
        });
        if (norm) collected.push(norm);
      }
    }
  } catch (err) {
    lastErr = err;
  }

  const sources = dedupeAndCapSources(collected, MAX_SOURCES_TOTAL);
  const completedAt = (now && now()) || new Date().toISOString();

  // Re-load to avoid clobbering concurrent fields; still append-safe by invocationId
  const latest = store.getTask(userData, task.taskId);
  const base = latest && latest.ok ? latest.task : runningTask;
  const invocations = Array.isArray(base.invocations) ? base.invocations.slice() : [];
  const toolIdx = invocations.findIndex((x) => x && x.invocationId === toolInv.invocationId);
  const skillIdx = invocations.findIndex((x) => x && x.invocationId === skillInv.invocationId);

  if (lastErr || !sources.length) {
    const failedTool = {
      ...(toolIdx >= 0 ? invocations[toolIdx] : toolInv),
      provider: providerUsed,
      status: INVOCATION_STATUS.failed,
      completedAt,
      error: {
        code: lastErr ? "research_failed" : "no_sources",
        message: lastErr
          ? safeErrorSummary(lastErr)
          : "未找到可用的外部来源。请调整目标后重试。",
      },
      resultSummary: {
        queryCount: queries.length,
        sourceCount: 0,
        provider: providerUsed,
        usedFake,
      },
      discoveredSources: [],
      resultRefs: [],
      sourceRefs: [],
    };
    if (toolIdx >= 0) invocations[toolIdx] = failedTool;
    else invocations.push(failedTool);

    if (skillIdx >= 0) {
      // skill load itself succeeded; keep succeeded
    }

    const saved = await store.saveTask(userData, {
      ...base,
      selectedSkillId: ALLOWED_SKILL_ID,
      status: "research_failed",
      invocations,
      // Never merge external sources into subjectContext
      subjectContext: base.subjectContext,
    });

    return {
      ok: false,
      code: failedTool.error.code,
      message: failedTool.error.message,
      task: saved.task,
      skillInvocation: skillIdx >= 0 ? invocations[skillIdx] : skillInv,
      toolInvocation: failedTool,
      discoveredSources: [],
    };
  }

  const resultRefs = sources.map((s) => ({
    title: s.title,
    url: s.url,
    snippet: s.snippet,
    provider: s.provider,
  }));

  const succeededTool = {
    ...(toolIdx >= 0 ? invocations[toolIdx] : toolInv),
    provider: providerUsed,
    status: INVOCATION_STATUS.succeeded,
    completedAt,
    error: null,
    resultSummary: {
      queryCount: queries.length,
      sourceCount: sources.length,
      provider: providerUsed,
      usedFake: false,
      note: "外部来源仅为任务证据候选，不得自动视为本人事实。",
    },
    discoveredSources: sources,
    resultRefs,
    sourceRefs: sources.map((s) => s.sourceRef),
  };
  if (toolIdx >= 0) invocations[toolIdx] = succeededTool;
  else invocations.push(succeededTool);

  const saved = await store.saveTask(userData, {
    ...base,
    selectedSkillId: ALLOWED_SKILL_ID,
    status: "research_succeeded",
    invocations,
    subjectContext: base.subjectContext,
  });

  return {
    ok: true,
    task: saved.task,
    skillInvocation: skillIdx >= 0 ? invocations[skillIdx] : skillInv,
    toolInvocation: succeededTool,
    discoveredSources: sources,
    message: `已完成只读外部调研，取得 ${sources.length} 条来源（尚未生成最终研究成果）。`,
  };
}

function isResearchResultCurrent(task) {
  if (!task || !task.subjectContext || task.subjectContext.confirmationState !== "confirmed") {
    return false;
  }
  const intentGoal = String(
    (task.taskIntent && task.taskIntent.goal) || task.goal || ""
  ).trim();
  const snapGoal = String(
    (task.subjectContext.rankingMeta && task.subjectContext.rankingMeta.goal) || ""
  ).trim();
  if (!intentGoal || intentGoal !== snapGoal) return false;
  const invs = task.invocations || [];
  const lastTool = [...invs].reverse().find((i) => i && i.kind === "tool");
  if (!lastTool || lastTool.status !== INVOCATION_STATUS.succeeded) return false;
  const invGoal = String(
    (lastTool.disclosedContext &&
      (lastTool.disclosedContext.goal || lastTool.disclosedContext.goalSummary)) ||
      ""
  ).trim();
  if (invGoal && invGoal !== intentGoal && invGoal !== truncate(intentGoal, 80)) {
    return false;
  }
  return true;
}

module.exports = {
  ALLOWED_SKILL_ID,
  TOOL_CAPABILITY_ID,
  PERMISSION_SCOPE,
  MAX_QUERIES,
  MAX_SOURCES_TOTAL,
  MAX_SOURCES_PER_QUERY,
  MAX_QUERY_CHARS,
  INVOCATION_STATUS,
  buildResearchQueries,
  buildDisclosedContext,
  assertResearchPreconditions,
  normalizeDiscoveredSource,
  dedupeAndCapSources,
  healRunningInvocations,
  normalizeUrlKey,
  safeErrorSummary,
  runReadonlyExternalResearch,
  isResearchResultCurrent,
  createSkillInvocation,
  createToolInvocationShell,
};

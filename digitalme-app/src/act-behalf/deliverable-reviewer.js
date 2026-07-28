"use strict";

/**
 * TASK-QUALITY-LOOP-01 — Deliverable quality Reviewer.
 *
 * Two layers:
 *  1. deterministic checks (always run; no model required);
 *  2. optional model reviewer via the existing "review" model route.
 *
 * Output is a structured ReviewResult. Scores are internal only and
 * must not be surfaced in the default UI.
 */

const { validatePlaceholderContent } = require("./placeholder-validation");
const { TASK_MODES } = require("./outcome-criteria");
const { groundingReview, GROUNDING_RULE_IDS } = require("./grounding-review");

const ISSUE_BLOCKING = "blocking";
const ISSUE_WARNING = "warning";

const FAR_FUTURE_RE =
  /(区块链|联邦学习|去中心化|稳定币|代币|web3|元宇宙|脑机接口|智能合约|DAO)/i;
const FAR_FUTURE_EXCLUDE_RE = /(不作为|不得|并非|不是|不进入|尚未|未实现|禁止|排除|不考虑|暂不)/;
const FAR_FUTURE_MARKED_SECTION_RE = /^#{1,6}\s*.*(远期|未来|后续方向|展望)/;

const PROJECT_FACT_CONFLICT_RE = Object.freeze([
  {
    id: "video_audio_falsely_supported",
    re: /已(支持|实现|完成)(视频|音频|影音)(内容)?(的)?(真实)?生成/,
    message: "声称已支持视频/音频生成，与当前项目事实冲突（本轮不实现真实生成）。",
  },
  {
    id: "external_collaboration_falsely_done",
    re: /已(完成|实现|支持)(公网|外部|多人|跨主体)(协作|网络)/,
    message: "声称外部协作网络已完成，与当前项目事实冲突。",
  },
  {
    id: "market_settlement_falsely_done",
    re: /已(上线|完成|实现)(能力市场|结算|计费|支付)/,
    message: "声称能力市场/结算已完成，与当前项目事实冲突（未启动）。",
  },
]);

const EMPTY_RHETORIC_RE =
  /(持续优化|不断提升|全面赋能|打造生态|闭环生态|深度融合|全方位升级)/g;

const EXPLORATION_COLLAPSE_RE =
  /(立即(实施|开发|落地)|本季度(交付|实施)|当前迭代(内)?(完成|落地)|下期迭代直接开发)/;

function lineOf(text, index) {
  return String(text).slice(0, index).split("\n").length;
}

function makeIssue({ ruleId, message, text, index, severity, source }) {
  const body = String(text || "");
  const i = Number.isInteger(index) ? index : 0;
  return {
    issueType: severity === ISSUE_BLOCKING ? ISSUE_BLOCKING : ISSUE_WARNING,
    ruleId: String(ruleId || "review_issue"),
    message: String(message || ""),
    matchedText: body.slice(i, i + 60),
    lineNumber: lineOf(body, i),
    contextSnippet: body.slice(Math.max(0, i - 20), i + 40).replace(/\s+/g, " ").trim(),
    severity: severity || ISSUE_BLOCKING,
    source: source || "deterministic",
  };
}

function headingPresent(body, keyword) {
  const re = new RegExp(`^#{1,6}\\s*[^\\n]*${keyword}`, "m");
  return re.test(body);
}

function tokenPresent(body, keyword) {
  return String(body).includes(keyword);
}

/**
 * Deterministic review layer. Returns { blockingIssues, qualityIssues, suggestedRevisions }.
 */
function deterministicReview(content, { criteria, kind, goal, isDigitalMeProject } = {}) {
  const body = String(content || "");
  const blockingIssues = [];
  const qualityIssues = [];
  const suggestedRevisions = [];
  const c = criteria || {};
  const taskMode = c.taskMode || TASK_MODES.CURRENT_IMPLEMENTATION;

  // 1. Placeholder residue (re-check; generation gate normally catches first).
  const ph = validatePlaceholderContent(body);
  for (const issue of ph.blockingIssues) {
    blockingIssues.push({
      ...issue,
      issueType: ISSUE_BLOCKING,
      category: "placeholder",
      message: "仍含未填写内容：" + String(issue.matchedText || issue.ruleId).slice(0, 40),
      source: "deterministic",
    });
  }
  if (ph.blockingIssues.length) {
    suggestedRevisions.push("将所有未填写字段与模板项替换为与当前任务相关的真实内容。");
  }

  // 2. Required sections / markers.
  const sections = Array.isArray(c.requiredSections) ? c.requiredSections : [];
  const isMarkdownKind = kind === "document" || kind === "webpage" || !kind;
  const missing = [];
  for (const sec of sections) {
    const present =
      taskMode === TASK_MODES.CURRENT_IMPLEMENTATION && PRD_LIKE.test(String(goal || "")) && isMarkdownKind
        ? headingPresent(body, sec)
        : tokenPresent(body, sec);
    if (!present) missing.push(sec);
  }
  for (const sec of missing) {
    blockingIssues.push(
      makeIssue({
        ruleId: "missing_required_section",
        message: `缺少关键内容「${sec}」。`,
        text: body,
        index: 0,
        severity: ISSUE_BLOCKING,
      })
    );
  }
  if (missing.length) {
    suggestedRevisions.push(`补齐缺失的关键内容：${missing.join("、")}。`);
  }

  // 3. Goal alignment (deterministic, lenient): at least one significant goal token present.
  const goalTokens = extractGoalTokens(goal);
  if (goalTokens.length && !goalTokens.some((t) => body.includes(t))) {
    blockingIssues.push(
      makeIssue({
        ruleId: "goal_misaligned",
        message: "正文未体现任务目标的核心对象，可能偏离了用户目标。",
        text: body,
        index: 0,
        severity: ISSUE_BLOCKING,
      })
    );
    suggestedRevisions.push("围绕用户目标重写正文，确保核心对象在文中明确出现。");
  }

  // 4. Far-future dominance in current implementation mode.
  if (
    taskMode === TASK_MODES.CURRENT_IMPLEMENTATION &&
    c.implementationAlignment &&
    c.implementationAlignment.requireCurrentImplementationBasis
  ) {
    const ratio = farFutureRatio(body);
    const max = Number(c.implementationAlignment.farFutureMaxRatio) || 0.15;
    if (ratio > max) {
      blockingIssues.push(
        makeIssue({
          ruleId: "far_future_dominant",
          message:
            "远期设想（区块链/联邦学习等）占据成果主体；当前实施型成果须以现有架构与已确认主线为基础。",
          text: body,
          index: body.search(FAR_FUTURE_RE) >= 0 ? body.search(FAR_FUTURE_RE) : 0,
          severity: ISSUE_BLOCKING,
        })
      );
      suggestedRevisions.push(
        "将远期技术内容压缩为明确标记的后续方向小节，主体改为当前可实施设计。"
      );
    }
  }

  // 5. Exploration collapse: exploration-mode outcome shrunk into an implementation plan.
  if (taskMode === TASK_MODES.SOLUTION_EXPLORATION) {
    const m = EXPLORATION_COLLAPSE_RE.exec(body);
    if (m) {
      blockingIssues.push(
        makeIssue({
          ruleId: "exploration_collapsed",
          message: "方案探索型成果被错误收缩成当前实施计划，应保留路线比较与远期区分。",
          text: body,
          index: m.index,
          severity: ISSUE_BLOCKING,
        })
      );
      suggestedRevisions.push("恢复多路线比较结构，明确区分当前基础与远期方案。");
    }
  }

  // 6. Unsupported project facts (Digital Me context only).
  if (isDigitalMeProject) {
    for (const p of PROJECT_FACT_CONFLICT_RE) {
      const m = p.re.exec(body);
      if (m) {
        blockingIssues.push(
          makeIssue({
            ruleId: "project_fact_conflict",
            message: p.message,
            text: body,
            index: m.index,
            severity: ISSUE_BLOCKING,
          })
        );
        suggestedRevisions.push("修正与当前项目事实冲突的表述，或改为明确标记的后续方向。");
      }
    }
  }

  // 7. Empty rhetoric (non-blocking).
  const rhetoricHits = body.match(EMPTY_RHETORIC_RE);
  if (rhetoricHits && rhetoricHits.length >= 3) {
    qualityIssues.push(
      makeIssue({
        ruleId: "empty_rhetoric",
        message: "存在无法执行的空话套话，建议替换为具体内容。",
        text: body,
        index: body.search(EMPTY_RHETORIC_RE),
        severity: ISSUE_WARNING,
      })
    );
    suggestedRevisions.push("把空话套话替换为可执行、可验证的具体内容。");
  }

  return { blockingIssues, qualityIssues, suggestedRevisions };
}

const PRD_LIKE = /(PRD|产品需求文档|需求文档)/i;

function extractGoalTokens(goal) {
  const g = String(goal || "");
  const tokens = new Set();
  for (const m of g.matchAll(/[A-Za-z][A-Za-z0-9-]{2,}/g)) tokens.add(m[0]);
  for (const m of g.matchAll(/[一-鿿]{2,4}(?=(?:功能|系统|平台|文档|方案|规划))/g)) {
    const t = m[0];
    tokens.add(t);
    if (t.length >= 3) tokens.add(t.slice(-3));
    if (t.length >= 2) tokens.add(t.slice(-2));
  }
  return [...tokens].filter((t) => !/^(the|and|for|with)$/i.test(t)).slice(0, 8);
}

function farFutureRatio(body) {
  const lines = String(body)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (!lines.length) return 0;
  let inMarkedSection = false;
  let far = 0;
  for (const line of lines) {
    if (FAR_FUTURE_MARKED_SECTION_RE.test(line)) {
      inMarkedSection = true;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      inMarkedSection = false;
    }
    if (inMarkedSection) continue; // explicitly marked far-future section is allowed
    if (FAR_FUTURE_RE.test(line) && !FAR_FUTURE_EXCLUDE_RE.test(line)) far += 1;
  }
  return far / lines.length;
}

function computeScores({ blockingIssues, qualityIssues }) {
  const b = (ruleId) => blockingIssues.filter((i) => i.ruleId === ruleId).length;
  const placeholders = blockingIssues.filter((i) => i.category === "placeholder").length;
  const w = (ruleId) => qualityIssues.filter((i) => i.ruleId === ruleId).length;
  const clamp = (v) => Math.max(0, Math.min(1, Math.round(v * 100) / 100));
  return {
    goalAlignment: clamp(1 - 0.4 * b("goal_misaligned")),
    completeness: clamp(1 - 0.2 * b("missing_required_section") - 0.15 * placeholders),
    implementationReadiness: clamp(
      1 - 0.4 * b("far_future_dominant") - 0.4 * b("exploration_collapsed") - 0.1 * w("empty_rhetoric")
    ),
    projectConsistency: clamp(1 - 0.4 * b("project_fact_conflict")),
    evidenceQuality: clamp(0.85 - 0.1 * b("project_fact_conflict")),
    clarity: clamp(1 - 0.1 * w("empty_rhetoric") - 0.05 * placeholders),
  };
}

function parseModelReviewJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const stripped = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  return parsed;
}

function normalizeModelIssues(list, severity) {
  const out = [];
  for (const raw of Array.isArray(list) ? list.slice(0, 12) : []) {
    if (!raw) continue;
    const message = String(raw.message || raw.issue || raw.problem || "").trim();
    if (!message) continue;
    out.push({
      issueType: severity,
      ruleId: String(raw.ruleId || raw.type || "model_review_issue"),
      message,
      matchedText: String(raw.matchedText || "").slice(0, 60),
      lineNumber: Number.isInteger(raw.lineNumber) ? raw.lineNumber : 1,
      contextSnippet: String(raw.contextSnippet || "").slice(0, 80),
      severity,
      source: "model_reviewer",
    });
  }
  return out;
}

function buildModelReviewMessages({ content, criteria, goal, kind }) {
  const c = criteria || {};
  const criteriaLines = [
    `任务模式：${c.taskMode || "current_implementation"}`,
    c.requiredSections && c.requiredSections.length
      ? `应具备的关键内容：${c.requiredSections.join("、")}`
      : null,
    c.targetAudience ? `目标读者：${c.targetAudience}` : null,
    c.intendedUse ? `预期用途：${c.intendedUse}` : null,
    c.implementationAlignment && c.implementationAlignment.requireCurrentImplementationBasis
      ? "当前实施模式：必须以当前仓库与现有架构为基础；远期内容仅可作为明确标记的后续方向。"
      : null,
  ]
    .filter(Boolean)
    .join("\n");
  return [
    {
      role: "system",
      content:
        "你是成果质量审查员。只输出 JSON：" +
        '{"status":"pass"|"fail","blockingIssues":[{"message":"...","lineNumber":1}],"qualityIssues":[{"message":"..."}],"suggestedRevisions":["..."],"scores":{"goalAlignment":0.0,"completeness":0.0,"implementationReadiness":0.0,"projectConsistency":0.0,"evidenceQuality":0.0,"clarity":0.0}}' +
        "。检查：是否回答用户目标、是否完整、是否矛盾、是否与项目当前事实冲突、远期设想是否挤占主体、是否有空话、是否有占位内容、是否可直接交付实施。" +
        "没有问题时 blockingIssues 为空数组、status 为 pass。不要输出 JSON 以外的任何内容。",
    },
    {
      role: "user",
      content: [
        `用户目标：${String(goal || "").slice(0, 2000)}`,
        `成果类型：${kind || "document"}`,
        criteriaLines,
        "",
        "待审查成果正文：",
        String(content || "").slice(0, 20000),
      ].join("\n"),
    },
  ];
}

/**
 * Full review: deterministic layer + optional model reviewer.
 * Model failures degrade gracefully to deterministic-only results.
 */
async function reviewDeliverableContent({
  content,
  kind,
  criteria,
  goal,
  isDigitalMeProject,
  callModel,
  snapshot,
  authorityMap,
} = {}) {
  const det = deterministicReview(content, { criteria, kind, goal, isDigitalMeProject });
  let blockingIssues = det.blockingIssues.slice();
  let qualityIssues = det.qualityIssues.slice();
  let suggestedRevisions = det.suggestedRevisions.slice();
  let modelScores = null;
  let reviewerDegraded = false;
  let modelReviewUsed = false;

  // TASK-QUALITY-LOOP-01.1: deterministic GroundingReview for
  // current-implementation outcomes about the Digital Me project itself.
  // Runs regardless of model availability (never skipped when degraded).
  let grounding = null;
  if (
    criteria &&
    criteria.taskMode === TASK_MODES.CURRENT_IMPLEMENTATION &&
    isDigitalMeProject &&
    snapshot &&
    authorityMap
  ) {
    const g = groundingReview(content, { goal, snapshot, authorityMap });
    grounding = g.grounding;
    blockingIssues = blockingIssues.concat(g.blockingIssues);
    qualityIssues = qualityIssues.concat(g.qualityIssues);
    suggestedRevisions = suggestedRevisions.concat(g.suggestedRevisions);
  }

  if (typeof callModel === "function") {
    modelReviewUsed = true;
    try {
      const raw = await callModel(buildModelReviewMessages({ content, criteria, goal, kind }), {
        taskType: "review",
        temperature: 0.1,
      });
      const parsed = parseModelReviewJson(raw);
      if (parsed) {
        blockingIssues = blockingIssues.concat(normalizeModelIssues(parsed.blockingIssues, ISSUE_BLOCKING));
        qualityIssues = qualityIssues.concat(normalizeModelIssues(parsed.qualityIssues, ISSUE_WARNING));
        for (const s of Array.isArray(parsed.suggestedRevisions) ? parsed.suggestedRevisions.slice(0, 8) : []) {
          const t = String(s || "").trim();
          if (t) suggestedRevisions.push(t);
        }
        if (parsed.scores && typeof parsed.scores === "object") modelScores = parsed.scores;
      } else {
        reviewerDegraded = true;
      }
    } catch {
      reviewerDegraded = true;
    }
  }

  const detScores = computeScores({ blockingIssues, qualityIssues });
  const scores = { ...detScores };
  if (modelScores) {
    for (const k of Object.keys(scores)) {
      const v = Number(modelScores[k]);
      if (Number.isFinite(v)) scores[k] = Math.round(((scores[k] + Math.max(0, Math.min(1, v))) / 2) * 100) / 100;
    }
  }

  const status = blockingIssues.length ? "fail" : "pass";
  return {
    schemaVersion: 1,
    status,
    blockingIssues,
    qualityIssues,
    suggestedRevisions,
    scores,
    taskMode: (criteria && criteria.taskMode) || TASK_MODES.CURRENT_IMPLEMENTATION,
    criteriaDigest: (criteria && criteria.criteriaDigest) || null,
    grounding: grounding || undefined,
    reviewerDegraded,
    modelReviewUsed,
    modelRoute: modelReviewUsed ? { taskType: "review" } : null,
    createdAt: new Date().toISOString(),
  };
}

/** Map a ReviewResult into repair issues consumable by the repair prompt builders. */
function toRepairIssues(result) {
  return (result && result.blockingIssues ? result.blockingIssues : []).map((i) => ({
    issueType: ISSUE_BLOCKING,
    ruleId: i.ruleId || "review_issue",
    message: i.message || "质量未达标",
    matchedText: String(i.matchedText || i.message || "").slice(0, 60),
    lineNumber: i.lineNumber || 1,
    contextSnippet: String(i.contextSnippet || "").slice(0, 80),
    severity: "high",
    source: i.source || "reviewer",
  }));
}

/** Plain-language summaries (no internal jargon) for user-facing failure states. */
function userFacingReviewSummary(result) {
  const first = result && result.blockingIssues && result.blockingIssues[0];
  const short = first ? String(first.message || "").slice(0, 50) : "质量未达到可直接使用的标准";
  return `成果还没有达到可直接使用的质量：${short}`;
}

function userFacingReviewFailure(result) {
  const issues = (result && result.blockingIssues) || [];
  const first = issues[0];
  const short = first ? String(first.message || "").slice(0, 50) : "质量未达到可直接使用的标准";
  const hasGrounding = issues.some(
    (i) => i && (i.source === "grounding" || GROUNDING_RULE_IDS.includes(i.ruleId))
  );
  if (hasGrounding) {
    return `成果与当前项目状态存在冲突（${short}），系统暂时无法可靠完成。请补充或更新相关项目资料后重试。`;
  }
  return `经过自动完善仍未达到可直接使用的质量：${short}。你可以重试，或补充更明确的要求。`;
}

module.exports = {
  ISSUE_BLOCKING,
  ISSUE_WARNING,
  deterministicReview,
  reviewDeliverableContent,
  toRepairIssues,
  userFacingReviewSummary,
  userFacingReviewFailure,
  farFutureRatio,
  buildModelReviewMessages,
  parseModelReviewJson,
};

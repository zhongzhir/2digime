"use strict";

/**
 * Subject Context candidate assembly with goal-based ranking.
 * Fixed-ratio truncation is only a degradation seed when ranking yields nothing.
 */

const crypto = require("node:crypto");
const { buildSelectedSelfContext, truncateText } = require("./select-self-context");

const MAX_CANDIDATES = 14;
const MAX_CLAIM_CHARS = 480;
const TYPE_WEIGHT = Object.freeze({
  boundary: 1.35,
  framework: 1.25,
  memory: 1.2,
  persona: 1.1,
  style: 1.0,
  life: 0.95,
  identity: 1.05,
  preference: 1.0,
  other: 0.9,
});

const SOURCE_PATH = Object.freeze({
  persona: "persona.md",
  style: "style-guide.md",
  frameworks: "decision-frameworks.json",
  memory: "memory/long-term-memory.jsonl",
  life: "life/",
  boundaries: "policies/boundaries.json",
  identity: "identity.json",
  preferences: "preferences.json",
  user_supplement: "user_supplement",
});

function tokenize(text) {
  const tokens = [];
  const s = String(text || "").toLowerCase();
  const asciiRe = /[a-z0-9]+/g;
  let m;
  while ((m = asciiRe.exec(s)) !== null) {
    if (m[0].length >= 2) tokens.push(m[0]);
  }
  const cjkRe = /[\u4e00-\u9fff]+/g;
  while ((m = cjkRe.exec(s)) !== null) {
    const run = m[0];
    if (run.length === 1) tokens.push(run);
    else {
      for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2));
      if (run.length >= 3) {
        for (let i = 0; i < run.length - 2; i += 1) tokens.push(run.slice(i, i + 3));
      }
    }
  }
  return tokens;
}

function newClaimId(prefix) {
  return (
    String(prefix || "clm") +
    "_" +
    Date.now().toString(36) +
    "_" +
    crypto.randomBytes(2).toString("hex")
  );
}

function resolveSubjectId(pkg) {
  const m = (pkg && pkg.manifest) || {};
  if (m.subjectId) return String(m.subjectId);
  if (m.packageId) return String(m.packageId);
  if (m.ownerId) return "owner:" + String(m.ownerId);
  if (m.ownerDisplayName) return "local:" + String(m.ownerDisplayName);
  if (pkg && pkg.dir) {
    const base = String(pkg.dir).replace(/\\/g, "/").split("/").filter(Boolean).pop();
    return "local:" + (base || "package");
  }
  return "local:unknown";
}

function resolveSubjectVersion(pkg) {
  const m = (pkg && pkg.manifest) || {};
  if (typeof m.revision === "number" && Number.isFinite(m.revision)) {
    return "rev:" + String(m.revision);
  }
  if (m.version) return String(m.version);
  return "unknown";
}

function kindForSource(source) {
  if (source === "boundaries") return "boundary";
  if (source === "frameworks") return "framework";
  if (source === "memory") return "memory";
  if (source === "persona") return "persona";
  if (source === "style") return "style";
  if (source === "life") return "life";
  if (source === "identity") return "identity";
  if (source === "preferences") return "preference";
  if (source === "user_supplement") return "other";
  return "other";
}

function splitChunks(text, maxLen) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  const parts = raw
    .split(/\n{2,}|(?<=[。！？；])\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 8);
  if (!parts.length) return [truncateText(raw, maxLen)];
  const out = [];
  for (const p of parts) {
    if (p.length <= maxLen) out.push(p);
    else out.push(truncateText(p, maxLen));
    if (out.length >= 40) break;
  }
  return out;
}

function memoryLineChunks(raw) {
  const lines = String(raw || "").split("\n");
  const chunks = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      const content = String(o.content || o.text || "").trim();
      if (!content) continue;
      const theme = o.theme ? "[" + o.theme + "] " : "";
      chunks.push(truncateText(theme + content, MAX_CLAIM_CHARS));
    } catch {
      if (t.length >= 8) chunks.push(truncateText(t, MAX_CLAIM_CHARS));
    }
    if (chunks.length >= 40) break;
  }
  return chunks;
}

function collectRawCandidates(pkg) {
  const list = [];
  const push = (source, label, text, locator) => {
    const body = String(text || "").trim();
    if (!body) return;
    list.push({
      source,
      label,
      text: truncateText(body, MAX_CLAIM_CHARS),
      locator: locator || null,
      path: SOURCE_PATH[source] || source,
    });
  };

  for (const [i, chunk] of splitChunks(pkg && pkg.persona, MAX_CLAIM_CHARS).entries()) {
    push("persona", "人格与自我描述", chunk, "para:" + i);
  }
  for (const [i, chunk] of splitChunks(pkg && pkg.styleGuide, MAX_CLAIM_CHARS).entries()) {
    push("style", "表达风格", chunk, "para:" + i);
  }
  for (const [i, chunk] of splitChunks(pkg && pkg.lifeSummary, MAX_CLAIM_CHARS).entries()) {
    push("life", "人生与经历摘要", chunk, "para:" + i);
  }
  for (const [i, chunk] of splitChunks(pkg && pkg.boundariesSummary, MAX_CLAIM_CHARS).entries()) {
    push("boundaries", "边界与禁忌", chunk, "para:" + i);
  }
  for (const [i, chunk] of splitChunks(pkg && pkg.decisionFrameworks, MAX_CLAIM_CHARS).entries()) {
    push("frameworks", "判断框架", chunk, "para:" + i);
  }
  for (const [i, chunk] of memoryLineChunks(pkg && pkg.longTermMemory).entries()) {
    push("memory", "长期记忆", chunk, "line:" + i);
  }
  if (pkg && pkg.identitySummary) {
    for (const [i, chunk] of splitChunks(pkg.identitySummary, MAX_CLAIM_CHARS).entries()) {
      push("identity", "身份要点", chunk, "para:" + i);
    }
  }
  if (pkg && pkg.preferences) {
    for (const [i, chunk] of splitChunks(pkg.preferences, MAX_CLAIM_CHARS).entries()) {
      push("preferences", "偏好", chunk, "para:" + i);
    }
  }
  return list;
}

function scoreCandidate(cand, goalTokens) {
  if (!goalTokens.length) return 0;
  const textTokens = new Set(tokenize(cand.text + " " + cand.label));
  let hit = 0;
  for (const t of goalTokens) {
    if (textTokens.has(t)) hit += 1;
  }
  const kind = kindForSource(cand.source);
  const weight = TYPE_WEIGHT[kind] || 1;
  return hit * weight;
}

function toClaim(cand, score, confirmationState) {
  const sourceRef = {
    source: cand.path || SOURCE_PATH[cand.source] || cand.source,
    locator: cand.locator || undefined,
  };
  return {
    id: newClaimId("clm"),
    kind: kindForSource(cand.source),
    label: cand.label,
    text: cand.text,
    sourceRefs: [sourceRef],
    confidence: score > 2 ? "medium" : score > 0 ? "low" : "unknown",
    confirmationState: confirmationState || "proposed",
    score: typeof score === "number" ? score : 0,
  };
}

function buildFallbackClaims(pkg) {
  const seed = buildSelectedSelfContext(pkg || {});
  return (seed.items || []).map((it) =>
    toClaim(
      {
        source: it.source,
        label: it.label,
        text: it.text,
        locator: "fallback-share",
        path: SOURCE_PATH[it.source] || it.source,
      },
      0,
      "proposed"
    )
  );
}

function deriveProhibitedUses(pkg) {
  const text = String((pkg && pkg.boundariesSummary) || "").trim();
  if (!text) return ["不得把未确认推测写成本人事实", "不得对外发送或代表本人行动（本闭环）"];
  const lines = text
    .split(/\n|；|;/)
    .map((l) => l.replace(/^[-*•\d.\s]+/, "").trim())
    .filter((l) => l.length >= 4 && l.length <= 120);
  const uniq = [];
  for (const l of lines) {
    if (!uniq.includes(l)) uniq.push(l);
    if (uniq.length >= 8) break;
  }
  if (!uniq.length) {
    return ["不得把未确认推测写成本人事实", "不得对外发送或代表本人行动（本闭环）"];
  }
  return uniq;
}

/**
 * @param {object} pkg
 * @param {{ goal?: string, maxCandidates?: number }} [opts]
 */
function assembleSubjectContextCandidates(pkg, opts = {}) {
  const goal = String(opts.goal || "").trim();
  const max = typeof opts.maxCandidates === "number" ? opts.maxCandidates : MAX_CANDIDATES;
  const goalTokens = tokenize(goal);
  const raw = collectRawCandidates(pkg);
  const packagePaths = [...new Set(raw.map((r) => r.path))];

  let ranked = raw
    .map((cand) => ({ cand, score: scoreCandidate(cand, goalTokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.cand.source.localeCompare(b.cand.source));

  let degraded = false;
  let method = "goal_token_overlap";
  if (!ranked.length) {
    degraded = true;
    method = goal ? "fixed_ratio_fallback_after_empty_rank" : "fixed_ratio_fallback_no_goal";
    const fallback = buildFallbackClaims(pkg);
    const claims = fallback.slice(0, max);
    return wrapAssembly(pkg, claims, {
      method,
      degraded: true,
      goal,
      packagePaths: packagePaths.length
        ? packagePaths
        : fallback.map((c) => (c.sourceRefs[0] && c.sourceRefs[0].source) || "unknown"),
      displayedCount: claims.length,
      note: goal
        ? "未能按目标匹配到明显相关条目，已改用有界初始摘录作为候选种子。请确认、删除或补充后再确认本次本人上下文。这不是任务相关自动选择的完成态。"
        : "请先填写研究与表达目标以进行相关性排序。当前显示的是有界初始摘录种子，须由你确认后才可作为本次快照。",
    });
  }

  const claims = ranked.slice(0, max).map((x) => toClaim(x.cand, x.score, "proposed"));
  return wrapAssembly(pkg, claims, {
    method,
    degraded,
    goal,
    packagePaths,
    displayedCount: claims.length,
    note:
      "以下为按本次目标排序的本人信息候选（非全部私人资料）。请删除不需要的条目，必要时补充，然后确认。未确认内容不会进入最终快照。",
  });
}

function wrapAssembly(pkg, claims, meta) {
  const subjectId = resolveSubjectId(pkg);
  const version = resolveSubjectVersion(pkg);
  const sourceRefs = [];
  const seen = new Set();
  for (const c of claims) {
    for (const ref of c.sourceRefs || []) {
      const key = (ref.source || "") + "|" + (ref.locator || "");
      if (seen.has(key)) continue;
      seen.add(key);
      sourceRefs.push({ source: ref.source, locator: ref.locator });
    }
  }
  return {
    ok: true,
    packageExists: !!(pkg && pkg.exists),
    subjectContextDraft: {
      subjectId,
      version,
      subjectVersion: version,
      claims,
      sourceRefs,
      confidence: claims.some((c) => c.confidence === "medium")
        ? "medium"
        : claims.length
          ? "low"
          : "unknown",
      confirmationState: "proposed",
      scope: meta.goal
        ? "仅用于本次研究与表达目标：「" + meta.goal.slice(0, 80) + (meta.goal.length > 80 ? "…" : "") + "」"
        : "待填写目标后限定范围",
      prohibitedUses: deriveProhibitedUses(pkg),
      rankingMeta: {
        method: meta.method,
        degraded: !!meta.degraded,
        goal: meta.goal || "",
        packagePaths: meta.packagePaths || [],
        displayedCount: meta.displayedCount || claims.length,
      },
    },
    note: meta.note,
    // legacy projection for older UI/tests
    selectedSelfContext: {
      items: claims.map((c) => ({
        source: (c.sourceRefs[0] && c.sourceRefs[0].source) || "unknown",
        label: c.label,
        text: c.text,
      })),
      combinedText: claims.map((c) => "### " + c.label + "\n" + c.text).join("\n\n"),
      userEdited: false,
      rankingDegraded: !!meta.degraded,
    },
  };
}

function makeUserSupplementClaim(text) {
  const body = String(text || "").trim();
  if (!body) return null;
  return {
    id: newClaimId("usr"),
    kind: "other",
    label: "本次补充的本人信息",
    text: truncateText(body, MAX_CLAIM_CHARS),
    sourceRefs: [{ source: "user_supplement", locator: "task_input" }],
    confidence: "high",
    confirmationState: "user_edited",
    score: 0,
  };
}

/**
 * Build confirmed Subject Context snapshot from proposed claims + user actions.
 * Does not mutate Package.
 */
function confirmSubjectContextSnapshot(draft, { keepClaimIds, supplements, scope, prohibitedUses } = {}) {
  const base = draft && typeof draft === "object" ? draft : {};
  const keep = new Set((keepClaimIds || []).map(String));
  const kept = (base.claims || []).filter((c) => keep.has(String(c.id)));
  const confirmedClaims = kept.map((c) => ({
    ...c,
    confirmationState: c.confirmationState === "user_edited" ? "user_edited" : "confirmed",
    // strip ranking score from durable snapshot optional — keep for audit
  }));

  const extra = [];
  for (const s of supplements || []) {
    const cl = makeUserSupplementClaim(s);
    if (cl) {
      cl.confirmationState = "confirmed";
      extra.push(cl);
    }
  }

  const claims = confirmedClaims.concat(extra);
  const sourceRefs = [];
  const seen = new Set();
  for (const c of claims) {
    for (const ref of c.sourceRefs || []) {
      const key = (ref.source || "") + "|" + (ref.locator || "");
      if (seen.has(key)) continue;
      seen.add(key);
      sourceRefs.push({ source: ref.source, locator: ref.locator });
    }
  }

  return {
    subjectId: String(base.subjectId || "local:unknown"),
    version: String(base.version || base.subjectVersion || "unknown"),
    subjectVersion: String(base.subjectVersion || base.version || "unknown"),
    claims,
    sourceRefs,
    confidence: claims.length ? "medium" : "unknown",
    confirmationState: "confirmed",
    scope: String(scope || base.scope || "本次任务已确认的本人信息快照"),
    prohibitedUses: Array.isArray(prohibitedUses)
      ? prohibitedUses.map(String)
      : Array.isArray(base.prohibitedUses)
        ? base.prohibitedUses.slice()
        : [],
    rankingMeta: base.rankingMeta || null,
    confirmedAt: new Date().toISOString(),
  };
}

function aggregateSourceRefs(subjectContext) {
  return (subjectContext && subjectContext.sourceRefs) || [];
}

function assertNoModelContentAsConfirmedFact(claims) {
  // Soft guard: claims from model_inference source must not be confirmed.
  for (const c of claims || []) {
    const src = (c.sourceRefs && c.sourceRefs[0] && c.sourceRefs[0].source) || "";
    if (
      (src === "model_inference" || src === "digitalme_inference") &&
      (c.confirmationState === "confirmed" || c.confirmationState === "user_edited")
    ) {
      return { ok: false, message: "模型推测不得确认为本人事实。" };
    }
  }
  return { ok: true };
}

module.exports = {
  MAX_CANDIDATES,
  SOURCE_PATH,
  tokenize,
  resolveSubjectId,
  resolveSubjectVersion,
  assembleSubjectContextCandidates,
  confirmSubjectContextSnapshot,
  makeUserSupplementClaim,
  buildFallbackClaims,
  aggregateSourceRefs,
  assertNoModelContentAsConfirmedFact,
  scoreCandidate,
  collectRawCandidates,
};

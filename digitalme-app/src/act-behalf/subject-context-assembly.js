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

/** Markdown / plain headings — never emitted as standalone claims. */
function isHeadingLine(line) {
  const t = String(line || "").trim();
  if (!t) return false;
  if (/^#{1,6}\s+\S/.test(t)) return true;
  // Bare section titles used in life summaries (no #) are still headings when alone.
  return false;
}

function headingLabel(line) {
  return String(line || "")
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .trim();
}

/** List markers: -, *, •, or numbered 1. / 1) */
function matchListItem(line) {
  const t = String(line || "").trim();
  const m = t.match(/^([-*•]|\d+[.)])\s+(\S[\s\S]*)$/);
  if (!m) return null;
  return m[2].trim();
}

/**
 * Paragraph / sentence chunks for non-list prose (existing contract).
 * Does not split on single newlines alone.
 */
function splitParagraphChunks(text, maxLen) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  const parts = raw
    .split(/\n{2,}|(?<=[。！？；])\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 8);
  if (!parts.length) {
    const one = truncateText(raw, maxLen);
    return one ? [one] : [];
  }
  const out = [];
  for (const p of parts) {
    if (p.length <= maxLen) out.push(p);
    else out.push(truncateText(p, maxLen));
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * List-aware document units for candidate assembly.
 * - Each non-empty list bullet / numbered item → one unit (kind: "list")
 * - Headings update section context only; never become claims
 * - Non-list prose keeps paragraph/sentence granularity (kind: "para")
 *
 * @returns {{ text: string, sectionTitle: string|null, kind: "list"|"para" }[]}
 */
function splitDocumentUnits(text, maxLen) {
  const raw = String(text || "").replace(/\r\n/g, "\n");
  if (!raw.trim()) return [];
  const lines = raw.split("\n");
  /** @type {{ text: string, sectionTitle: string|null, kind: "list"|"para" }[]} */
  const units = [];
  let sectionTitle = null;
  /** @type {string[]} */
  let paraBuf = [];

  function flushPara() {
    if (!paraBuf.length) return;
    const block = paraBuf.join("\n").trim();
    paraBuf = [];
    if (!block) return;
    // Skip if the whole block is only a heading-like leftover.
    if (isHeadingLine(block) && !matchListItem(block)) return;
    for (const chunk of splitParagraphChunks(block, maxLen)) {
      if (!chunk || chunk.length < 8) continue;
      units.push({ text: chunk, sectionTitle, kind: "para" });
      if (units.length >= 40) return;
    }
  }

  for (const line of lines) {
    if (units.length >= 40) break;
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      continue;
    }
    if (/^#{1,6}\s+\S/.test(trimmed)) {
      flushPara();
      sectionTitle = headingLabel(trimmed) || sectionTitle;
      continue;
    }
    const listBody = matchListItem(trimmed);
    if (listBody != null) {
      flushPara();
      if (listBody.length >= 8) {
        units.push({
          text: truncateText(listBody, maxLen),
          sectionTitle,
          kind: "list",
        });
      }
      continue;
    }
    paraBuf.push(trimmed);
  }
  flushPara();
  return units;
}

/** @deprecated name kept for callers; now list-aware via splitDocumentUnits. */
function splitChunks(text, maxLen) {
  return splitDocumentUnits(text, maxLen).map((u) => u.text);
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
  const pushUnit = (source, defaultLabel, unit, locator) => {
    const body = String(unit && unit.text ? unit.text : "").trim();
    if (!body) return;
    list.push({
      source,
      label: (unit && unit.sectionTitle) || defaultLabel,
      text: truncateText(body, MAX_CLAIM_CHARS),
      locator: locator || null,
      path: SOURCE_PATH[source] || source,
      unitKind: unit && unit.kind ? unit.kind : "para",
    });
  };

  const pushFromText = (source, defaultLabel, text) => {
    const units = splitDocumentUnits(text, MAX_CLAIM_CHARS);
    let listIdx = 0;
    let paraIdx = 0;
    for (const unit of units) {
      if (unit.kind === "list") {
        pushUnit(source, defaultLabel, unit, "item:" + listIdx);
        listIdx += 1;
      } else {
        pushUnit(source, defaultLabel, unit, "para:" + paraIdx);
        paraIdx += 1;
      }
      if (list.length >= 80) break;
    }
  };

  pushFromText("persona", "人格与自我描述", pkg && pkg.persona);
  pushFromText("style", "表达风格", pkg && pkg.styleGuide);
  pushFromText("life", "人生与经历摘要", pkg && pkg.lifeSummary);
  pushFromText("boundaries", "边界与禁忌", pkg && pkg.boundariesSummary);
  pushFromText("frameworks", "判断框架", pkg && pkg.decisionFrameworks);
  for (const [i, chunk] of memoryLineChunks(pkg && pkg.longTermMemory).entries()) {
    pushUnit(
      "memory",
      "长期记忆",
      { text: chunk, sectionTitle: null, kind: "para" },
      "line:" + i
    );
  }
  if (pkg && pkg.identitySummary) {
    pushFromText("identity", "身份要点", pkg.identitySummary);
  }
  if (pkg && pkg.preferences) {
    pushFromText("preferences", "偏好", pkg.preferences);
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
  const claims = [];
  for (const it of seed.items || []) {
    const units = splitDocumentUnits(it.text, MAX_CLAIM_CHARS);
    if (!units.length) {
      const body = truncateText(it.text, MAX_CLAIM_CHARS);
      if (!body) continue;
      claims.push(
        toClaim(
          {
            source: it.source,
            label: it.label,
            text: body,
            locator: "fallback-share",
            path: SOURCE_PATH[it.source] || it.source,
          },
          0,
          "proposed"
        )
      );
      continue;
    }
    let listIdx = 0;
    let paraIdx = 0;
    for (const unit of units) {
      const locator =
        unit.kind === "list"
          ? "fallback-share/item:" + listIdx++
          : "fallback-share/para:" + paraIdx++;
      claims.push(
        toClaim(
          {
            source: it.source,
            label: unit.sectionTitle || it.label,
            text: unit.text,
            locator,
            path: SOURCE_PATH[it.source] || it.source,
          },
          0,
          "proposed"
        )
      );
    }
  }
  return claims;
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
 * Build confirmed Subject Context snapshot from authoritative candidates + user actions.
 * scope / prohibitedUses / subject metadata always come from the authoritative draft —
 * never from renderer-supplied overrides. Does not mutate Package.
 */
function confirmSubjectContextSnapshot(draft, { keepClaimIds, supplements } = {}) {
  const base = draft && typeof draft === "object" ? draft : {};
  const keep = new Set((keepClaimIds || []).map(String));
  const kept = (base.claims || []).filter((c) => keep.has(String(c.id)));
  const confirmedClaims = kept.map((c) => ({
    ...c,
    confirmationState: c.confirmationState === "user_edited" ? "user_edited" : "confirmed",
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
    scope: String(base.scope || "本次任务已确认的本人信息快照"),
    prohibitedUses: Array.isArray(base.prohibitedUses) ? base.prohibitedUses.slice() : [],
    rankingMeta: base.rankingMeta || null,
    confirmedAt: new Date().toISOString(),
  };
}

function aggregateSourceRefs(subjectContext) {
  return (subjectContext && subjectContext.sourceRefs) || [];
}

const INFERENCE_SOURCES = new Set(["model_inference", "digitalme_inference"]);

function allowedPackageSources() {
  return new Set(
    Object.values(SOURCE_PATH).filter((s) => s && s !== "user_supplement")
  );
}

/**
 * Package candidates may only cite known Package source paths.
 * Checks every sourceRef on each claim (not only the first).
 */
function assertAllowedPackageClaimSources(claims) {
  const allowed = allowedPackageSources();
  for (const c of claims || []) {
    const refs = Array.isArray(c.sourceRefs) ? c.sourceRefs : [];
    if (!refs.length) {
      return {
        ok: false,
        code: "missing_source_refs",
        message: "候选条目缺少来源，无法确认。",
      };
    }
    for (const ref of refs) {
      const src = ref && ref.source != null ? String(ref.source) : "";
      if (INFERENCE_SOURCES.has(src)) {
        return {
          ok: false,
          code: "invalid_confirmation",
          message: "模型推测不得确认为本人事实。",
        };
      }
      if (src === "user_supplement") {
        return {
          ok: false,
          code: "invalid_package_source",
          message: "Package 候选不得使用用户补充来源标记。",
        };
      }
      if (!allowed.has(src)) {
        return {
          ok: false,
          code: "invalid_package_source",
          message: "候选来源不在本块允许的已知来源集合中。",
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Soft guard: any inference source among all sourceRefs must not be confirmed.
 */
function assertNoModelContentAsConfirmedFact(claims) {
  for (const c of claims || []) {
    const state = c && c.confirmationState;
    if (state !== "confirmed" && state !== "user_edited") continue;
    for (const ref of c.sourceRefs || []) {
      const src = ref && ref.source != null ? String(ref.source) : "";
      if (INFERENCE_SOURCES.has(src)) {
        return { ok: false, message: "模型推测不得确认为本人事实。" };
      }
    }
  }
  return { ok: true };
}

/**
 * Main-process confirm path: only keepClaimIds + supplement texts are user actions.
 * Claim bodies / sourceRefs / subject metadata come solely from authoritativeDraft.
 */
function confirmSubjectContextWithUserActions(authoritativeDraft, options = {}) {
  const draft =
    authoritativeDraft && typeof authoritativeDraft === "object" ? authoritativeDraft : null;
  if (!draft || !Array.isArray(draft.claims)) {
    return {
      ok: false,
      code: "candidates_missing",
      message: "请先按当前目标生成候选本人信息。",
    };
  }

  const submittedGoal = String(options.goal || "").trim();
  if (!submittedGoal) {
    return { ok: false, code: "empty_goal", message: "请先填写研究与表达目标。" };
  }
  const draftGoal = String((draft.rankingMeta && draft.rankingMeta.goal) || "").trim();
  if (draftGoal !== submittedGoal) {
    return {
      ok: false,
      code: "context_stale_for_goal",
      message: "目标已变更，请重新生成候选后再确认。",
    };
  }

  if (!Array.isArray(options.keepClaimIds)) {
    return {
      ok: false,
      code: "keep_claim_ids_required",
      message: "缺少保留条目列表。",
    };
  }

  const authById = new Map(draft.claims.map((c) => [String(c.id), c]));
  const keepClaimIds = options.keepClaimIds.map(String);
  const unknownClaimIds = keepClaimIds.filter((id) => !authById.has(id));
  if (unknownClaimIds.length) {
    return {
      ok: false,
      code: "unknown_claim_ids",
      unknownClaimIds,
      message: "部分保留条目无效，请重新生成候选后再确认。",
    };
  }

  const kept = keepClaimIds.map((id) => authById.get(id));
  const pkgCheck = assertAllowedPackageClaimSources(kept);
  if (!pkgCheck.ok) return pkgCheck;

  const supplements = [];
  if (Array.isArray(options.supplements)) {
    for (const s of options.supplements) supplements.push(s);
  }
  if (options.supplementText) supplements.push(options.supplementText);

  // Rebuild draft view that only exposes authoritative claim objects for kept IDs.
  const authoritativeForConfirm = {
    ...draft,
    claims: draft.claims.slice(),
  };
  const confirmed = confirmSubjectContextSnapshot(authoritativeForConfirm, {
    keepClaimIds,
    supplements,
  });

  const guard = assertNoModelContentAsConfirmedFact(confirmed.claims);
  if (!guard.ok) {
    return { ok: false, code: "invalid_confirmation", message: guard.message };
  }

  for (const c of confirmed.claims || []) {
    const refs = Array.isArray(c.sourceRefs) ? c.sourceRefs : [];
    const isSupplement = refs.some((r) => r && r.source === "user_supplement");
    if (isSupplement) {
      for (const r of refs) {
        if (!r || r.source !== "user_supplement") {
          return {
            ok: false,
            code: "invalid_supplement_source",
            message: "用户补充只能使用系统生成的补充来源标记。",
          };
        }
      }
    } else {
      const check = assertAllowedPackageClaimSources([c]);
      if (!check.ok) return check;
    }
  }

  const deletedClaimIds = draft.claims
    .map((c) => c.id)
    .filter((id) => !keepClaimIds.includes(String(id)));

  return { ok: true, confirmed, deletedClaimIds, keepClaimIds };
}

/**
 * When Owner changes goal on a draft save after confirmation, invalidate the
 * confirmed snapshot for the new goal without deleting prior audit data.
 */
function applyGoalChangeToStoredTask(existing, newGoal) {
  const goal = String(newGoal || "").trim();
  const out = {
    subjectContext: existing && existing.subjectContext ? existing.subjectContext : null,
    priorSubjectContext:
      existing && existing.priorSubjectContext ? existing.priorSubjectContext : null,
    subjectContextCandidates:
      existing && existing.subjectContextCandidates ? existing.subjectContextCandidates : null,
    status: existing && existing.status ? String(existing.status) : "draft",
    invalidatedConfirmed: false,
    clearedCandidates: false,
  };

  if (
    out.subjectContext &&
    out.subjectContext.confirmationState === "confirmed"
  ) {
    const snapGoal = String(
      (out.subjectContext.rankingMeta && out.subjectContext.rankingMeta.goal) ||
        (existing && existing.taskIntent && existing.taskIntent.goal) ||
        (existing && existing.goal) ||
        ""
    ).trim();
    if (snapGoal !== goal) {
      out.priorSubjectContext = out.subjectContext;
      out.subjectContext = null;
      out.invalidatedConfirmed = true;
      if (out.status === "context_confirmed") out.status = "draft";
    }
  }

  if (out.subjectContextCandidates && out.subjectContextCandidates.rankingMeta) {
    const candGoal = String(out.subjectContextCandidates.rankingMeta.goal || "").trim();
    if (candGoal && candGoal !== goal) {
      out.subjectContextCandidates = null;
      out.clearedCandidates = true;
    }
  }

  return out;
}

/**
 * Auto-select top candidates based on goal relevance without user input.
 * Used for the default "express goal → get result" path.
 * Returns the same shape as assembleSubjectContextCandidates but with
 * sensitive/high-risk entries marked for potential confirmation.
 */
function autoSelectCandidates(pkg, opts) {
  const assembled = assembleSubjectContextCandidates(pkg, opts);
  const draft = assembled.subjectContextDraft;
  if (!draft || !Array.isArray(draft.claims) || draft.claims.length === 0) {
    return {
      ...assembled,
      autoSelectedClaims: [],
      autoSelectedCount: 0,
      sensitiveClaims: [],
      excludedByAutoSelect: [],
    };
  }

  const goal = String((opts && opts.goal) || "");
  const goalTokens = tokenize(goal);

  const scored = draft.claims.map((c, i) => {
    const cand = {
      source: (c.sourceRefs && c.sourceRefs[0] && c.sourceRefs[0].source) || "other",
      label: c.label,
      text: c.text,
    };
    const s = scoreCandidate(cand, goalTokens);
    return { claim: c, score: s, index: i };
  });
  scored.sort((a, b) => b.score - a.score);

  const MAX_AUTO = 7;
  const SENSITIVITY_THRESHOLD = 1.2;

  const regular = [];
  const sensitive = [];
  for (const item of scored) {
    if (
      item.score >= SENSITIVITY_THRESHOLD &&
      (item.claim.kind === "boundary" || item.claim.kind === "identity")
    ) {
      sensitive.push(item);
    } else {
      regular.push(item);
    }
  }

  const autoSelected = regular.slice(0, MAX_AUTO).map((sc) => sc.claim);
  const remainingSlots = Math.max(0, MAX_AUTO - autoSelected.length);
  const autoSensitive = sensitive.slice(0, remainingSlots).map((sc) => sc.claim);
  const autoSelectedAll = [...autoSelected, ...autoSensitive];

  const autoClaimIds = new Set(autoSelectedAll.map((c) => c.id));
  const excluded = scored.filter((sc) => !autoClaimIds.has(sc.claim.id));

  return {
    ...assembled,
    autoSelectedClaims: autoSelectedAll,
    autoSelectedCount: autoSelectedAll.length,
    sensitiveClaims: autoSensitive.map((c) => ({
      claimId: c.id,
      text: c.text,
      source: (c.sourceRefs && c.sourceRefs[0] && c.sourceRefs[0].source) || "unknown",
      reason: "sensitive_or_high_impact",
    })),
    excludedByAutoSelect: excluded.map((item) => ({
      claimId: item.claim.id,
      text: item.claim.text,
      source:
        (item.claim.sourceRefs && item.claim.sourceRefs[0] && item.claim.sourceRefs[0].source) ||
        "unknown",
      score: item.score,
    })),
  };
}

module.exports = {
  MAX_CANDIDATES,
  SOURCE_PATH,
  INFERENCE_SOURCES,
  tokenize,
  resolveSubjectId,
  resolveSubjectVersion,
  assembleSubjectContextCandidates,
  autoSelectCandidates,
  confirmSubjectContextSnapshot,
  confirmSubjectContextWithUserActions,
  applyGoalChangeToStoredTask,
  makeUserSupplementClaim,
  buildFallbackClaims,
  aggregateSourceRefs,
  assertNoModelContentAsConfirmedFact,
  assertAllowedPackageClaimSources,
  allowedPackageSources,
  scoreCandidate,
  collectRawCandidates,
  splitDocumentUnits,
  splitParagraphChunks,
  splitChunks,
};

"use strict";

/**
 * Section-scoped document revision helpers (product quality Channel B).
 * Preserve qualified sections; only replace sections tied to actionable issues.
 * Strip evaluator/revision internal instructions that must never enter final body.
 */

const META_GUIDANCE_RULE_IDS = new Set([
  "grounding_revision_guidance",
  "reviewer_grounding_revision_guidance",
]);

const CLAIM_DENIAL_RE =
  /(未上线|尚未(?:上线|实现|启动|验证|开放)?|未实现|未启动|未验证|未支持|不存在|并非|不是|不再|没有|无\b|不得|禁止|不引入|不做|仅作为|预留|候选方案|deferred)/i;

const INTERNAL_RESIDUE_RES = [
  /^[ \t]*修订方向[：:].+$/gm,
  /按「现有基础\s*[→\-—]\s*实际缺口[^」]*」[^\n]*/g,
  /^[ \t]*仅修复「[^」]+」[^\n]*/gm,
  /不要重写已经合格的章节[^\n]*/g,
  /不得仅删除错误句子[^\n]*/g,
  /^[ \t]*Detected issues?:[^\n]*/gim,
  /^[ \t]*suggestedRevisions?[：:][^\n]*/gim,
];

function isMetaGuidanceRuleId(ruleId) {
  const id = String(ruleId || "");
  if (META_GUIDANCE_RULE_IDS.has(id)) return true;
  return /grounding_revision_guidance$/.test(id);
}

function isDeniedOrAbsentClaimWindow(windowText) {
  return CLAIM_DENIAL_RE.test(String(windowText || ""));
}

function splitMarkdownSections(md) {
  const body = String(md || "");
  if (!body.trim()) return [];
  const parts = body.split(/(?=^#{1,6}\s+)/m).filter((p) => String(p).length);
  const sections = [];
  for (const part of parts) {
    const lines = part.split("\n");
    const first = lines[0] || "";
    const hm = /^(#{1,6})\s+(.*)$/.exec(first);
    const key = hm ? String(hm[2] || "").trim() : part.startsWith("#") ? "__heading__" : "__preamble__";
    sections.push({
      key,
      headingLine: hm ? first : null,
      level: hm ? hm[1].length : 0,
      text: part,
    });
  }
  return sections;
}

function joinMarkdownSections(sections) {
  return (sections || []).map((s) => s.text).join("").replace(/\n{3,}/g, "\n\n");
}

function lineToSectionIndex(sections, lineNumber) {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return -1;
  let line = 1;
  for (let i = 0; i < sections.length; i++) {
    const count = String(sections[i].text || "").split("\n").length;
    // last section may not end with newline; split still yields lines
    const end = line + Math.max(1, count) - 1;
    if (lineNumber >= line && lineNumber <= end) return i;
    line = end + 1;
  }
  return -1;
}

function sectionIndexForIssue(sections, issue) {
  const list = sections || [];
  if (!list.length) return -1;
  const lineNumber = Number(issue && issue.lineNumber);
  const byLine = lineToSectionIndex(list, lineNumber);
  if (byLine >= 0) return byLine;

  const needles = [];
  const matched = String((issue && (issue.matchedText || issue.contextSnippet)) || "").trim();
  if (matched.length >= 8) needles.push(matched.slice(0, 48));
  const msg = String((issue && issue.message) || "");
  const quoted = msg.match(/「([^」]{4,40})」/);
  if (quoted) needles.push(quoted[1]);

  for (let i = 0; i < list.length; i++) {
    const body = list[i].text || "";
    for (const n of needles) {
      if (n && body.includes(n)) return i;
    }
  }
  return -1;
}

/**
 * @returns {{ keys: string[], indices: number[], issuesBySection: Record<string, object[]> }}
 */
function locateEditableSections(md, issues) {
  const sections = splitMarkdownSections(md);
  const actionable = (issues || []).filter((i) => i && !isMetaGuidanceRuleId(i.ruleId || i.checkId));
  const indices = new Set();
  const issuesBySection = Object.create(null);

  for (const issue of actionable) {
    const idx = sectionIndexForIssue(sections, {
      ...issue,
      ruleId: issue.ruleId || issue.checkId,
    });
    if (idx < 0) continue;
    indices.add(idx);
    const key = sections[idx].key;
    if (!issuesBySection[key]) issuesBySection[key] = [];
    issuesBySection[key].push(issue);
  }

  // If issues exist but none mapped, prefer compressing the longest content sections
  // instead of rewriting the entire document (supports length / diffuse issues).
  if (actionable.length && indices.size === 0) {
    const ranked = sections
      .map((s, i) => ({ i, key: s.key, len: String(s.text || "").length, level: s.level }))
      .filter((s) => s.key !== "__preamble__")
      .sort((a, b) => b.len - a.len);
    const pick = ranked.slice(0, Math.min(2, Math.max(1, ranked.length)));
    for (const p of pick) indices.add(p.i);
  }

  const keys = [...indices].map((i) => sections[i].key);
  return { keys, indices: [...indices].sort((a, b) => a - b), issuesBySection, sections };
}

function normalizeHeadingKey(key) {
  return String(key || "")
    .replace(/^[一二三四五六七八九十\d]+[、.．]\s*/, "")
    .replace(/\s+/g, "")
    .trim();
}

function findRevisedSection(revSections, origKey) {
  const exact = revSections.find((s) => s.key === origKey);
  if (exact) return exact;
  const norm = normalizeHeadingKey(origKey);
  return revSections.find((s) => normalizeHeadingKey(s.key) === norm) || null;
}

/**
 * Force-preserve sections not in editableKeys from original.
 * Prevents model full-document rewrite from destroying qualified parts.
 */
function mergePreservingUneditedSections(originalMd, revisedMd, editableKeys) {
  const editable = new Set(editableKeys || []);
  const orig = splitMarkdownSections(originalMd);
  const rev = splitMarkdownSections(revisedMd);
  if (!orig.length) return String(revisedMd || originalMd || "");
  if (!editable.size) return String(originalMd || "");

  const merged = orig.map((section) => {
    if (!editable.has(section.key)) {
      return section;
    }
    const replacement = findRevisedSection(rev, section.key);
    if (!replacement || !String(replacement.text || "").trim()) return section;
    return { ...section, text: replacement.text };
  });
  return joinMarkdownSections(merged);
}

function stripInternalRevisionResidue(md) {
  let out = String(md || "");
  for (const re of INTERNAL_RESIDUE_RES) {
    out = out.replace(re, "");
  }
  // Drop orphan empty bullets left by residue removal.
  out = out.replace(/^[ \t]*[-*]\s*$/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return out;
}

function buildSectionScopedRepairAddon(editable) {
  const keys = (editable && editable.keys) || [];
  if (!keys.length) {
    return "若无法定位具体章节，仅做最小必要修改；已合格段落必须原样保留。";
  }
  return [
    "定向修订约束（必须遵守）：",
    `- 只修改这些章节：${keys.join("；")}`,
    "- 其余章节必须与原文逐字一致，禁止润色、压缩或重排未点名章节。",
    "- 不要输出修订说明、评估指令或「修订方向」类内部提示。",
    "- 输出完整 Markdown 文档。",
  ].join("\n");
}

function trimSectionText(sectionText, removeChars) {
  if (removeChars <= 0) return sectionText;
  const lines = String(sectionText || "").split("\n");
  if (lines.length <= 1) return sectionText;
  const heading = lines[0];
  let body = lines.slice(1).join("\n");
  // Prefer dropping trailing sentences / bullets.
  while (removeChars > 0 && body.trim().length > 40) {
    const next = body
      .replace(/\n[-*]\s+[^\n]+$/u, "")
      .replace(/[。！？][^。！？]*$/u, "")
      .replace(/\s+$/u, "");
    if (next.length >= body.length) {
      body = body.slice(0, Math.max(40, body.length - Math.min(80, removeChars)));
      break;
    }
    const freed = body.length - next.length;
    body = next;
    removeChars -= Math.max(1, freed);
  }
  return heading + "\n" + body.replace(/\n{3,}/g, "\n\n");
}

/**
 * Deterministic length control for goal-derived maxChars.
 * Only touches editable section keys (or longest sections if none given).
 */
function compressToMaxChars(md, maxChars, editableKeys) {
  const limit = Number(maxChars);
  if (!Number.isFinite(limit) || limit <= 0) return String(md || "");
  let current = String(md || "");
  const measure = (t) => t.replace(/\s+/g, " ").trim().length;
  if (measure(current) <= limit) return current;

  const sections = splitMarkdownSections(current);
  if (!sections.length) return current.slice(0, limit);

  const editable = new Set(editableKeys || []);
  const candidates = sections
    .map((s, i) => ({ i, key: s.key, len: String(s.text || "").length }))
    .filter((s) => (editable.size ? editable.has(s.key) : s.key !== "__preamble__"))
    .sort((a, b) => b.len - a.len);
  if (!candidates.length) return current;

  let guard = 0;
  while (measure(current) > limit && guard < 24) {
    guard += 1;
    const overflow = measure(current) - limit;
    const target = candidates[Math.min(candidates.length - 1, guard % candidates.length)];
    const secs = splitMarkdownSections(current);
    if (!secs[target.i]) break;
    const before = secs[target.i].text;
    let nextText = trimSectionText(before, Math.max(60, Math.ceil(overflow * 0.7)));
    if (nextText === before || measure(joinMarkdownSections(secs.map((s, i) => (i === target.i ? { ...s, text: nextText } : s)))) > limit) {
      const lines = String(before).split("\n");
      const heading = lines[0] || "";
      let body = lines.slice(1).join("\n");
      const cut = Math.max(20, body.length - Math.max(80, overflow + 20));
      body = body.slice(0, cut).replace(/\s+\S*$/u, "").trimEnd();
      nextText = heading + (body ? "\n" + body + "\n" : "\n");
    }
    secs[target.i] = { ...secs[target.i], text: nextText };
    current = joinMarkdownSections(secs);
  }
  return current;
}

module.exports = {
  META_GUIDANCE_RULE_IDS,
  isMetaGuidanceRuleId,
  isDeniedOrAbsentClaimWindow,
  splitMarkdownSections,
  joinMarkdownSections,
  locateEditableSections,
  mergePreservingUneditedSections,
  stripInternalRevisionResidue,
  buildSectionScopedRepairAddon,
  compressToMaxChars,
};

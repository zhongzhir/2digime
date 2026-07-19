"use strict";

/**
 * PAN-01R subject brief — strict read-only, limited, desensitized, fail-closed.
 * Never writes package files; never returns absolute paths or secrets.
 */

const fs = require("node:fs");
const path = require("node:path");
const { inspectPackageReadOnly } = require("../package-store/read-only");
const { readBoundariesReadOnly } = require("../subject-overview/read-package");

const CONTRACT_VERSION = "pan01r-brief-1";
const MAX_EVIDENCE = 6;
const MAX_SHORT = 120;

const KIND_LABELS = Object.freeze({
  verified_fact: "已核实事实",
  owner_assertion: "本人确认",
  inference: "系统推断",
  direction_clue: "发展线索",
  current_state: "当前状态",
  boundary: "系统/本人边界",
});

function stripControlChars(text) {
  return String(text || "").replace(/[\u0000-\u001F\u007F]/g, " ");
}

function redactSecretsAndPaths(text) {
  let s = String(text || "");
  s = s.replace(/[A-Za-z]:\\[^\s"'<>]+/g, "[路径已省略]");
  s = s.replace(/\/(?:Users|home|var|tmp|opt|etc)\/[^\s"'<>]+/g, "[路径已省略]");
  s = s.replace(/\b(?:sk-[A-Za-z0-9]{8,}|api[_-]?key\s*[:=]\s*\S+)/gi, "[已省略]");
  s = s.replace(/\bBearer\s+[A-Za-z0-9._\-]{8,}/gi, "[已省略]");
  return s;
}

function sanitizeShortText(text, max = MAX_SHORT) {
  let s = redactSecretsAndPaths(stripControlChars(text)).replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length > max) s = s.slice(0, Math.max(0, max - 1)) + "…";
  return s;
}

function isTaskRelatedCurrentState(text) {
  return /研究|判断|课题|方向|调研|框架/.test(String(text || ""));
}

function selectDefaultsForKind(kind, shortText) {
  if (kind === "verified_fact" || kind === "owner_assertion") return true;
  if (kind === "inference" || kind === "direction_clue") return false;
  if (kind === "current_state") return isTaskRelatedCurrentState(shortText);
  return false;
}

function isConfirmedOwnerAssertion(row) {
  if (!row || typeof row !== "object") return false;
  if (row.dataKind === "owner_assertion") return true;
  if (row.ownerConfirmed === true || row.confirmedBy === "owner") return true;
  if (
    row.confirmation &&
    row.confirmation.confirmed === true &&
    (row.confirmation.actor === "owner" || row.confirmation.confirmedBy === "owner")
  ) {
    return true;
  }
  return Array.isArray(row.sourceRefs) && row.sourceRefs.some((ref) => String(ref) === "feedback");
}

function readTextFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function tryReadJson(filePath) {
  const raw = readTextFile(filePath);
  return JSON.parse(raw);
}

function tryReadJsonl(filePath) {
  const raw = readTextFile(filePath);
  const rows = [];
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  for (const line of lines) {
    rows.push(JSON.parse(line));
  }
  return rows;
}

function extractMarkdownBullets(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(/^\s*[-*]\s+(\S.*)$/);
      return m ? m[1].trim() : null;
    })
    .filter(Boolean);
}

function extractFeedbackBullets(raw) {
  const heading = "## 用户反馈（风格纠正）";
  const start = String(raw || "").indexOf(heading);
  if (start < 0) return [];
  const rest = raw.slice(start + heading.length);
  const nextHeading = rest.search(/\n##\s+/);
  const section = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
  return extractMarkdownBullets(section);
}

function pushEvidence(list, item) {
  if (list.length >= MAX_EVIDENCE) return;
  const shortText = sanitizeShortText(item.shortText);
  if (!shortText) return;
  const kind = item.kind;
  const usable = item.usableInExperience !== false;
  list.push({
    id: item.id,
    shortText,
    kind,
    kindLabel: KIND_LABELS[kind] || kind,
    sourceLabel: sanitizeShortText(item.sourceLabel || "本机资料", 40),
    ownerConfirmed: !!item.ownerConfirmed,
    selectedByDefault: selectDefaultsForKind(kind, shortText),
    usableInExperience: usable,
  });
}

function markPartial(state, code) {
  state.partialRead = true;
  if (!state.warningCodes.includes(code)) state.warningCodes.push(code);
}

function collectFacts(pkgDir, evidence, state) {
  const mdPath = path.join(pkgDir, "identity-facts.md");
  const jsonPath = path.join(pkgDir, "identity.json");
  try {
    if (fs.existsSync(mdPath)) {
      const bullets = extractMarkdownBullets(readTextFile(mdPath));
      let i = 0;
      for (const b of bullets) {
        i += 1;
        pushEvidence(evidence, {
          id: `ev_fact_${i}`,
          shortText: b,
          kind: "verified_fact",
          sourceLabel: "身份事实清单",
          ownerConfirmed: true,
        });
      }
      return;
    }
  } catch {
    markPartial(state, "partial_subject_unread");
  }
  try {
    if (!fs.existsSync(jsonPath)) return;
    const data = tryReadJson(jsonPath);
    const claims = Array.isArray(data && data.identityClaims) ? data.identityClaims : [];
    let i = 0;
    for (const claim of claims) {
      i += 1;
      const text =
        typeof claim === "string"
          ? claim
          : claim && (claim.text || claim.claim || claim.summary || claim.content);
      pushEvidence(evidence, {
        id: `ev_fact_${i}`,
        shortText: text,
        kind: "verified_fact",
        sourceLabel: "身份事实",
        ownerConfirmed: true,
      });
    }
  } catch {
    markPartial(state, "partial_subject_unread");
  }
}

function collectOwnerAssertions(pkgDir, evidence, state) {
  const stylePath = path.join(pkgDir, "style-guide.md");
  try {
    if (fs.existsSync(stylePath)) {
      const bullets = extractFeedbackBullets(readTextFile(stylePath));
      let i = 0;
      for (const b of bullets) {
        i += 1;
        pushEvidence(evidence, {
          id: `ev_assert_style_${i}`,
          shortText: b,
          kind: "owner_assertion",
          sourceLabel: "风格纠正",
          ownerConfirmed: true,
        });
      }
    }
  } catch {
    markPartial(state, "partial_subject_unread");
  }

  const memPath = path.join(pkgDir, "memory", "long-term-memory.jsonl");
  try {
    if (!fs.existsSync(memPath)) return;
    const rows = tryReadJsonl(memPath);
    let i = 0;
    for (const row of rows) {
      if (!isConfirmedOwnerAssertion(row)) continue;
      i += 1;
      const text = row.content || row.text || row.summary || "";
      pushEvidence(evidence, {
        id: `ev_assert_mem_${i}`,
        shortText: text,
        kind: "owner_assertion",
        sourceLabel: "已确认长期记忆",
        ownerConfirmed: true,
      });
    }
  } catch {
    markPartial(state, "partial_subject_unread");
  }
}

function collectInferences(pkgDir, evidence, state) {
  const filePath = path.join(pkgDir, "life", "inferences.jsonl");
  try {
    if (!fs.existsSync(filePath)) return;
    const rows = tryReadJsonl(filePath);
    let i = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      if (String(row.status || "") === "rejected") continue;
      i += 1;
      const text = row.statement || row.content || row.text || row.summary || "";
      pushEvidence(evidence, {
        id: `ev_inf_${i}`,
        shortText: text,
        kind: "inference",
        sourceLabel: "系统推断",
        ownerConfirmed: false,
      });
    }
  } catch {
    markPartial(state, "partial_subject_unread");
  }
}

function collectDirectionClues(pkgDir, evidence, state) {
  const files = [
    ["life", "mind_hooks.json", "观念线索", "hooks"],
    ["life", "interests.json", "兴趣方向", "interests"],
    ["life", "capability_signals.json", "能力信号", "signals"],
  ];
  let i = 0;
  for (const [dir, name, label, keyHint] of files) {
    const filePath = path.join(pkgDir, dir, name);
    try {
      if (!fs.existsSync(filePath)) continue;
      const data = tryReadJson(filePath);
      let items = [];
      if (Array.isArray(data)) items = data;
      else if (data && typeof data === "object") {
        if (Array.isArray(data.items)) items = data.items;
        else if (Array.isArray(data[keyHint])) items = data[keyHint];
        else if (Array.isArray(data.hooks)) items = data.hooks;
        else if (Array.isArray(data.interests)) items = data.interests;
        else if (Array.isArray(data.signals)) items = data.signals;
      }
      for (const item of items) {
        i += 1;
        const text =
          typeof item === "string"
            ? item
            : item && (item.text || item.title || item.summary || item.content || item.label);
        pushEvidence(evidence, {
          id: `ev_dir_${i}`,
          shortText: text,
          kind: "direction_clue",
          sourceLabel: label,
          ownerConfirmed: false,
        });
      }
    } catch {
      markPartial(state, "partial_subject_unread");
    }
  }
}

function collectCurrentState(pkgDir, evidence, state) {
  const eventsPath = path.join(pkgDir, "life", "events.jsonl");
  try {
    if (fs.existsSync(eventsPath)) {
      const rows = tryReadJsonl(eventsPath);
      let i = 0;
      for (const row of rows.slice(0, 3)) {
        i += 1;
        const text = row && (row.title || row.summary || row.content || row.text);
        pushEvidence(evidence, {
          id: `ev_state_evt_${i}`,
          shortText: text,
          kind: "current_state",
          sourceLabel: "人生事件",
          ownerConfirmed: false,
        });
      }
    }
  } catch {
    markPartial(state, "partial_subject_unread");
  }

  const rolesPath = path.join(pkgDir, "life", "roles.json");
  try {
    if (!fs.existsSync(rolesPath)) return;
    const data = tryReadJson(rolesPath);
    const roles = Array.isArray(data)
      ? data
      : data && Array.isArray(data.roles)
        ? data.roles
        : data && Array.isArray(data.items)
          ? data.items
          : [];
    let i = 0;
    for (const role of roles.slice(0, 2)) {
      i += 1;
      const text =
        typeof role === "string"
          ? role
          : role && (role.title || role.name || role.label || role.summary);
      pushEvidence(evidence, {
        id: `ev_state_role_${i}`,
        shortText: text,
        kind: "current_state",
        sourceLabel: "角色",
        ownerConfirmed: false,
      });
    }
  } catch {
    markPartial(state, "partial_subject_unread");
  }
}

function collectBoundaries(pkgDir, boundaries, state) {
  try {
    const read = readBoundariesReadOnly(pkgDir);
    if (!read.parseOk) {
      markPartial(state, "partial_subject_unread");
      return;
    }
    let i = 0;
    for (const item of read.items || []) {
      if (!item || item.enabled === false) continue;
      i += 1;
      const text = item.text || item.rule || item.summary || item.title || "";
      const shortText = sanitizeShortText(text);
      if (!shortText) continue;
      boundaries.push({
        id: `bd_${i}`,
        shortText,
        kind: "boundary",
        kindLabel: KIND_LABELS.boundary,
        sourceLabel: "边界规则",
        ownerConfirmed: !!item.ownerConfirmed,
        selectedByDefault: false,
        usableInExperience: true,
        enforced: true,
      });
    }
  } catch {
    markPartial(state, "partial_subject_unread");
  }
}

/**
 * Resolve evidence texts by IDs from package (main-process only).
 * Returns Map id -> { id, shortText, kind } for known usable evidence.
 */
function resolveEvidenceByIds(packageDir, evidenceIds) {
  const brief = buildSubjectBrief(packageDir);
  const boundaries = brief.boundaries || [];
  if (evidenceIds == null) {
    return {
      evidence: (brief.evidence || []).filter((e) => e.usableInExperience),
      boundaries,
      brief,
    };
  }
  const wanted = new Set(evidenceIds.map(String));
  const out = [];
  for (const ev of brief.evidence || []) {
    if (!wanted.has(ev.id)) continue;
    if (!ev.usableInExperience) continue;
    out.push({ id: ev.id, shortText: ev.shortText, kind: ev.kind, kindLabel: ev.kindLabel });
  }
  return { evidence: out, boundaries, brief };
}

function computePersonalized(evidence) {
  const usable = (evidence || []).filter((e) => e && e.usableInExperience);
  const factOrAssert = usable.filter(
    (e) => e.kind === "verified_fact" || e.kind === "owner_assertion"
  );
  if (factOrAssert.length >= 1) return true;
  if (usable.length >= 2 && factOrAssert.length >= 1) return true;
  return false;
}

/**
 * @param {string} packageDir
 * @param {{ maxEvidence?: number }} [options]
 */
function buildSubjectBrief(packageDir, options = {}) {
  const pkgDir = path.resolve(String(packageDir || ""));
  const state = {
    partialRead: false,
    warningCodes: [],
  };
  const evidence = [];
  const boundaries = [];

  let packageHealthy = false;
  try {
    const inspect = inspectPackageReadOnly(pkgDir);
    packageHealthy = !!(inspect.exists && inspect.healthy !== false && inspect.schemaVersion);
    if (!inspect.exists) {
      state.warningCodes.push("package_missing");
    } else if (inspect.healthy === false) {
      state.partialRead = true;
      state.warningCodes.push("package_unhealthy");
    }
  } catch {
    state.partialRead = true;
    state.warningCodes.push("partial_subject_unread");
  }

  collectFacts(pkgDir, evidence, state);
  collectOwnerAssertions(pkgDir, evidence, state);
  collectInferences(pkgDir, evidence, state);
  collectDirectionClues(pkgDir, evidence, state);
  collectCurrentState(pkgDir, evidence, state);
  collectBoundaries(pkgDir, boundaries, state);

  const maxEv = typeof options.maxEvidence === "number" ? options.maxEvidence : MAX_EVIDENCE;
  const limited = evidence.slice(0, maxEv);
  const personalizedAvailable = computePersonalized(limited);
  const previewMode = !personalizedAvailable;

  if (state.partialRead && !state.warningCodes.includes("partial_subject_unread")) {
    state.warningCodes.push("partial_subject_unread");
  }

  const warningMessage = state.partialRead ? "部分主体资料无法读取" : null;

  return {
    ok: true,
    contractVersion: CONTRACT_VERSION,
    packageHealthy,
    partialRead: state.partialRead,
    warningCodes: state.warningCodes.slice(),
    warningMessage,
    personalizedAvailable,
    evidence: limited,
    boundaries,
    previewMode,
  };
}

module.exports = {
  buildSubjectBrief,
  resolveEvidenceByIds,
  KIND_LABELS,
  selectDefaultsForKind,
  sanitizeShortText,
  MAX_EVIDENCE,
  CONTRACT_VERSION,
};

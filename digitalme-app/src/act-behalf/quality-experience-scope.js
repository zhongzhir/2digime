"use strict";

/**
 * Generic quality-experience scope helpers (no separate Store).
 * Applies across artifact kinds; article is only one validation path.
 */

const ARTIFACT_KIND_ALIASES = Object.freeze({
  document: "document",
  article: "document",
  md: "document",
  markdown: "document",
  software: "software",
  code: "software",
  image: "image",
  video: "video",
  audio: "podcast",
  podcast: "podcast",
  presentation: "presentation",
  slides: "presentation",
  spreadsheet: "spreadsheet",
  dataset: "spreadsheet",
  research_report: "research_report",
  research: "research_report",
  mixed_media: "mixed_media",
  other: "other",
});

const SCOPE_LEVELS = Object.freeze([
  "global",
  "domain",
  "artifact_kind",
  "task_type",
  "project",
  "runtime_or_tool",
]);

/** Declared application slots — not prompt-only; wiring may be gradual. */
const QUALITY_APPLICATIONS = Object.freeze([
  "generation_context",
  "task_planning",
  "capability_selection",
  "tool_selection",
  "generation_parameters",
  "automated_validation",
  "revision_strategy",
  "acceptance_criteria",
]);

function normalizeArtifactKind(kind) {
  const k = String(kind || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (!k) return null;
  return ARTIFACT_KIND_ALIASES[k] || k;
}

function emptyScope() {
  return {
    level: "artifact_kind",
    artifactKinds: [],
    taskTypes: [],
    projectId: null,
    domain: null,
    runtimeOrTool: null,
  };
}

/**
 * Default: narrowest reasonable — artifact_kind of the accepted deliverable.
 * Global only for clear cross-cutting boundaries (not expression prefs).
 */
function inferQualityScope(item, context) {
  const ctx = context || {};
  const kind = normalizeArtifactKind(
    ctx.artifactKind || ctx.kind || (item && item.artifactKind) || null
  );
  const learnKind = (item && item.learnKind) || (item && item.learnHint) || null;
  const text = String((item && (item.canonicalStatement || item.text)) || "");

  if (item && item.qualityScope && item.qualityScope.level) {
    return normalizeScopeRecord(item.qualityScope, kind);
  }

  if (learnKind === "boundary" || (item && item.learnHint === "boundary")) {
    if (/未完成|未验证|不得写成|不能写成|未经确认不得|禁止对外|不得泄露/.test(text)) {
      return normalizeScopeRecord(
        { level: "global", artifactKinds: [], taskTypes: [] },
        kind
      );
    }
  }

  if (learnKind === "current_fact" || (item && item.learnHint === "current_fact")) {
    return normalizeScopeRecord(
      {
        level: "project",
        projectId: ctx.projectId || null,
        artifactKinds: kind ? [kind] : [],
      },
      kind
    );
  }

  return normalizeScopeRecord(
    {
      level: "artifact_kind",
      artifactKinds: kind ? [kind] : [],
      taskTypes: ctx.taskType ? [String(ctx.taskType)] : [],
      projectId: null,
      domain: ctx.domain || null,
      runtimeOrTool: ctx.runtimeOrTool || null,
    },
    kind
  );
}

function normalizeScopeRecord(scope, fallbackKind) {
  const s = scope && typeof scope === "object" ? scope : {};
  let level = String(s.level || "artifact_kind");
  if (!SCOPE_LEVELS.includes(level)) level = "artifact_kind";
  const kinds = Array.isArray(s.artifactKinds)
    ? s.artifactKinds.map(normalizeArtifactKind).filter(Boolean)
    : [];
  if (level === "artifact_kind" && !kinds.length && fallbackKind) {
    kinds.push(fallbackKind);
  }
  const taskTypes = Array.isArray(s.taskTypes)
    ? s.taskTypes.map((t) => String(t || "").trim()).filter(Boolean)
    : [];
  return {
    level,
    artifactKinds: [...new Set(kinds)],
    taskTypes: [...new Set(taskTypes)],
    projectId: s.projectId != null ? String(s.projectId) : null,
    domain: s.domain != null ? String(s.domain) : null,
    runtimeOrTool: s.runtimeOrTool != null ? String(s.runtimeOrTool) : null,
  };
}

function defaultQualityApplications(learnKind) {
  if (learnKind === "boundary") {
    return [
      "generation_context",
      "acceptance_criteria",
      "automated_validation",
      "revision_strategy",
      "task_planning",
    ];
  }
  if (learnKind === "current_fact") {
    return [
      "generation_context",
      "task_planning",
      "capability_selection",
      "acceptance_criteria",
    ];
  }
  return [
    "generation_context",
    "revision_strategy",
    "generation_parameters",
    "acceptance_criteria",
  ];
}

/**
 * Merge scopes from multiple sources without silently widening to global.
 */
function mergeScopeRecords(existing, incoming) {
  const a = normalizeScopeRecord(existing);
  const b = normalizeScopeRecord(incoming);
  const broadness = {
    global: 5,
    domain: 4,
    artifact_kind: 3,
    task_type: 3,
    project: 3,
    runtime_or_tool: 3,
  };
  const aB = broadness[a.level] || 3;
  const bB = broadness[b.level] || 3;
  // Prefer narrower (lower broadness)
  const level = aB <= bB ? a.level : b.level;
  const artifactKinds = [...new Set([].concat(a.artifactKinds, b.artifactKinds))];
  const taskTypes = [...new Set([].concat(a.taskTypes, b.taskTypes))];
  return normalizeScopeRecord({
    level,
    artifactKinds: level === "global" ? [] : artifactKinds,
    taskTypes,
    projectId: a.projectId || b.projectId,
    domain: a.domain || b.domain,
    runtimeOrTool: a.runtimeOrTool || b.runtimeOrTool,
  });
}

function queryFromContext(query) {
  const q = query || {};
  return {
    artifactKind: normalizeArtifactKind(
      q.artifactKind || q.deliverableKind || q.kind || null
    ),
    taskType: q.taskType ? String(q.taskType) : null,
    projectId: q.projectId != null ? String(q.projectId) : null,
    domain: q.domain != null ? String(q.domain) : null,
    runtimeOrTool: q.runtimeOrTool != null ? String(q.runtimeOrTool) : null,
    application: q.application || q.qualityApplication || null,
  };
}

function qualityScopeMatches(scope, query) {
  const s = normalizeScopeRecord(scope);
  const q = queryFromContext(query);

  if (s.level === "global") return { match: true, reason: "global" };
  if (s.level === "domain") {
    if (!s.domain) return { match: false, reason: "domain_missing_on_record" };
    if (!q.domain || q.domain !== s.domain) return { match: false, reason: "domain_mismatch" };
    return { match: true, reason: "domain" };
  }
  if (s.level === "project") {
    if (!s.projectId) return { match: false, reason: "project_missing_on_record" };
    if (!q.projectId || q.projectId !== s.projectId) {
      return { match: false, reason: "project_mismatch" };
    }
    return { match: true, reason: "project" };
  }
  if (s.level === "task_type") {
    if (!s.taskTypes.length) return { match: false, reason: "task_type_missing_on_record" };
    if (!q.taskType || !s.taskTypes.includes(q.taskType)) {
      return { match: false, reason: "task_type_mismatch" };
    }
    return { match: true, reason: "task_type" };
  }
  if (s.level === "runtime_or_tool") {
    if (!s.runtimeOrTool) return { match: false, reason: "runtime_missing_on_record" };
    if (!q.runtimeOrTool || q.runtimeOrTool !== s.runtimeOrTool) {
      return { match: false, reason: "runtime_mismatch" };
    }
    return { match: true, reason: "runtime_or_tool" };
  }
  if (!s.artifactKinds.length) {
    return { match: false, reason: "artifact_kind_missing_on_record" };
  }
  if (!q.artifactKind) {
    return { match: false, reason: "query_artifact_kind_missing" };
  }
  if (!s.artifactKinds.includes(q.artifactKind)) {
    return { match: false, reason: "artifact_kind_mismatch" };
  }
  return { match: true, reason: "artifact_kind" };
}

function applicationAllowed(row, application) {
  if (!application) return true;
  const apps = Array.isArray(row.qualityApplications)
    ? row.qualityApplications
    : defaultQualityApplications(row.learnKind);
  return apps.includes(String(application));
}

/** Structured experience object — not limited to prompt text. */
function toQualityExperience(row) {
  const scope = normalizeScopeRecord(row.qualityScope || emptyScope());
  const learnKind = row.learnKind || null;
  return {
    schemaVersion: 1,
    experienceId: row.id || row.assetId || row.sourceLearnJobId || null,
    learnKind,
    canonicalStatement:
      row.canonicalStatement ||
      String(row.content || row.statement || row.text || "").replace(
        /^(表达与成果偏好|边界|结构偏好|标题偏好|开篇偏好|篇幅偏好)[：:]\s*/,
        ""
      ),
    statement: String(row.content || row.statement || row.text || ""),
    qualityScope: scope,
    qualityApplications: Array.isArray(row.qualityApplications)
      ? row.qualityApplications.slice()
      : defaultQualityApplications(learnKind),
    sourceTaskId: row.sourceTaskId || null,
    sourceVersionId: row.sourceVersionId || null,
    sourceLearnJobId: row.sourceLearnJobId || null,
    sourceType: row.sourceType || null,
    confidence: row.confidence || null,
    resolverEligible: row.resolverEligible !== false,
    revoked: !!(row.revoked || row.status === "revoked"),
  };
}

module.exports = {
  ARTIFACT_KIND_ALIASES,
  SCOPE_LEVELS,
  QUALITY_APPLICATIONS,
  normalizeArtifactKind,
  emptyScope,
  inferQualityScope,
  normalizeScopeRecord,
  defaultQualityApplications,
  mergeScopeRecords,
  queryFromContext,
  qualityScopeMatches,
  applicationAllowed,
  toQualityExperience,
};

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJson } = require("../package-store/fs-util");
const {
  inspectPackageReadOnly,
  listPackageVersionsReadOnly,
} = require("../package-store/read-only");
const {
  SUBJECT_OVERVIEW_CONTRACT_VERSION,
  DATA_KINDS,
  LAYER_META,
} = require("./constants");
const { countLayerData } = require("./counts");
const { assessRecoverabilityReadOnly } = require("./recoverability");
const { readBoundariesReadOnly, readCollaborationReadOnly } = require("./read-package");
const { buildCapabilityStatuses } = require("./capabilities");
const { buildPanoramaSection, summarizeInboxForOverview } = require("./panorama");

function pushWarning(warnings, code, message, extra) {
  if (!warnings.some((w) => w.code === code && w.message === message)) {
    warnings.push({ code, message, ...(extra && typeof extra === "object" ? extra : {}) });
  }
}

function readIdentityReadOnly(pkgDir, warnings) {
  const manifestPath = path.join(pkgDir, "manifest.json");
  const identityPath = path.join(pkgDir, "identity.json");
  let manifest = null;
  let identity = null;
  let manifestPresent = false;
  let identityPresent = false;
  let manifestParseOk = false;
  let identityParseOk = false;
  if (fs.existsSync(manifestPath)) {
    manifestPresent = true;
    try {
      manifest = readJson(manifestPath, null);
      if (manifest && typeof manifest === "object") {
        manifestParseOk = true;
      } else {
        manifest = null;
        pushWarning(warnings, "manifest_parse_error", "资料清单无法解析。");
      }
    } catch {
      manifest = null;
      pushWarning(warnings, "manifest_parse_error", "资料清单无法解析。");
    }
  }
  if (fs.existsSync(identityPath)) {
    identityPresent = true;
    try {
      identity = readJson(identityPath, null);
      if (identity && typeof identity === "object") {
        identityParseOk = true;
      } else {
        identity = null;
        pushWarning(warnings, "identity_parse_error", "身份资料无法解析。");
      }
    } catch {
      identity = null;
      pushWarning(warnings, "identity_parse_error", "身份资料无法解析。");
    }
  }
  return {
    manifest,
    identity,
    manifestPresent,
    identityPresent,
    manifestParseOk,
    identityParseOk,
  };
}

function resolvePrivacyStatus({ packageExists, manifest, manifestPresent, manifestParseOk, warnings }) {
  if (!packageExists) {
    return {
      privacyStatus: "unknown",
      privacyLabel: "隐私状态尚无法确认",
    };
  }
  if (manifestPresent && !manifestParseOk) {
    return {
      privacyStatus: "unknown",
      privacyLabel: "隐私状态尚无法确认",
    };
  }
  if (!manifest) {
    return {
      privacyStatus: "unknown",
      privacyLabel: "隐私状态尚无法确认",
    };
  }
  if (manifest.packageType && manifest.packageType !== "private") {
    pushWarning(warnings, "privacy_unknown", "资料隐私状态未知，不能确认为本机私有。");
    return {
      privacyStatus: "unknown",
      privacyLabel: "隐私状态尚无法确认",
    };
  }
  // Readable manifest with packageType private or omitted (legacy default-private).
  return {
    privacyStatus: "local_private",
    privacyLabel: "默认私有 · 未公开",
  };
}

function resolveIdentity(manifest, identity, warnings) {
  const digitalMeId =
    (manifest && manifest.digitalMeId) ||
    (identity && identity.digitalMeId) ||
    null;
  const displayName =
    (manifest && manifest.ownerDisplayName) ||
    (identity && identity.displayName) ||
    (manifest && manifest.name) ||
    null;
  const ownerDisplayName =
    (manifest && manifest.ownerDisplayName) ||
    (identity && identity.displayName) ||
    null;

  if (!displayName) {
    pushWarning(warnings, "display_name_unknown", "主体名称尚未建立，显示为未知。");
  }

  let ownershipStatus = "unknown";
  if (identity && identity.controlledBy === "self") ownershipStatus = "self";
  else if (manifest && manifest.packageType === "private") ownershipStatus = "self";
  else if (!identity && !manifest) ownershipStatus = "unknown";

  return {
    digitalMeId,
    displayName: displayName || null,
    ownerDisplayName: ownerDisplayName || null,
    ownershipStatus,
  };
}

function mapHealthStatus(inspect) {
  if (!inspect.exists) return "missing";
  if (inspect.schemaVersion === "0.2") return inspect.healthy ? "healthy" : "unhealthy";
  if (inspect.schemaVersion) return "limited";
  return "unversioned";
}

function buildLayers(pkgDir, warnings) {
  const counts = countLayerData(pkgDir, { warnings });
  return DATA_KINDS.map((kind) => {
    const meta = LAYER_META[kind];
    const c = counts[kind] || { count: null, countStatus: "unknown", provenance: "" };
    return {
      kind,
      userLabel: meta.userLabel,
      explanation: meta.explanation,
      visualClass: meta.visualClass,
      count: c.count,
      countStatus: c.countStatus,
      provenance: c.provenance || "",
      breakdown: Array.isArray(c.breakdown) ? c.breakdown : [],
    };
  });
}

function buildRecentChange(manifest, recover) {
  const updatedAt = manifest && manifest.updatedAt ? manifest.updatedAt : null;
  const revision =
    manifest && typeof manifest.revision === "number" ? manifest.revision : null;
  let summary = "最近变化：未知";
  if (updatedAt && revision != null) {
    summary = `当前为第 ${revision} 版，最近更新于 ${updatedAt.slice(0, 10)}。`;
  } else if (updatedAt) {
    summary = `最近更新于 ${updatedAt.slice(0, 10)}。`;
  } else if (revision != null) {
    summary = `当前为第 ${revision} 版。`;
  }
  if (!recover.recoverable) {
    summary += " 版本恢复暂不可用。";
  } else if (recover.previousRevision != null) {
    summary += ` 可恢复到第 ${recover.previousRevision} 版。`;
  }
  return {
    summary,
    updatedAt,
    revision,
    recoverabilityStatus: recover.statusCode,
    recoverable: recover.recoverable,
    previousRevision: recover.previousRevision,
    settingsEntry: "settings:package-versions",
  };
}

function buildBoundariesSection(boundaries, warnings) {
  const established = boundaries.exists && boundaries.parseOk && boundaries.enabledCount > 0;
  if (boundaries.exists && !boundaries.parseOk) {
    pushWarning(warnings, "boundaries_parse_error", "边界文件无法解析，边界状态未知。");
  } else if (!boundaries.exists) {
    pushWarning(warnings, "boundaries_missing", "尚未建立边界文件。");
  }
  const pendingWarnings = [];
  if (!established) pendingWarnings.push("边界尚未完整建立");
  return {
    exists: !!boundaries.exists,
    parseOk: boundaries.parseOk !== false,
    established,
    enabledCount: typeof boundaries.enabledCount === "number" ? boundaries.enabledCount : null,
    pendingWarnings,
    summary: established
      ? `已启用 ${boundaries.enabledCount} 条边界规则。`
      : !boundaries.exists
        ? "尚未建立边界文件。"
        : !boundaries.parseOk
          ? "边界文件无法解析，已启用边界尚无法确认。"
          : "边界尚未完整建立，请在「边界」页查看与补充。",
  };
}

function buildCollaborationSection(collab) {
  return {
    visibility: "private",
    visibilityLabel: "默认私有 · 未公开",
    cardStatus: collab.filesPresent ? "draft_files_only" : "not_established",
    cardStatusLabel: collab.filesPresent
      ? "协作文件仅为示例，尚未对用户开放"
      : "尚未建立",
    authorizationStatus: "none",
    authorizationLabel: "无自动对外授权",
    autoAuthorization: false,
  };
}

/**
 * Fail-closed: true only when source-index mentions intake-questionnaire.
 * Any missing file or read error → false.
 */
function detectIntakeEvidence(packageDir) {
  try {
    const indexPath = path.join(packageDir, "sources", "source-index.json");
    if (!fs.existsSync(indexPath)) return false;
    const raw = fs.readFileSync(indexPath, "utf8");
    return typeof raw === "string" && raw.includes("intake-questionnaire");
  } catch {
    return false;
  }
}

/**
 * Build SubjectOverview v1 (read-only; must not mutate package bytes).
 * @param {string} packageDir
 * @param {{ hasApiKey?: boolean, readyExtensionCount?: number, inboxSummary?: object }} [runtime]
 */
function buildSubjectOverviewV1(packageDir, runtime = {}) {
  const pkgDir = path.resolve(String(packageDir || ""));
  const warnings = [];
  const inspect = inspectPackageReadOnly(pkgDir);
  const versions = listPackageVersionsReadOnly(pkgDir);
  const recover = assessRecoverabilityReadOnly(pkgDir, inspect, versions);
  const identityRead = readIdentityReadOnly(pkgDir, warnings);
  const { manifest, identity } = identityRead;

  if (!inspect.exists) {
    pushWarning(warnings, "package_missing", "资料目录不存在或无法访问。");
  }
  for (const issue of inspect.issues || []) {
    pushWarning(warnings, issue.code || "inspect_issue", issue.message || String(issue.code));
  }
  if (recover.recoveryIssue) {
    pushWarning(warnings, recover.recoveryIssue.code, recover.statusMessage);
  }

  const boundaries = readBoundariesReadOnly(pkgDir);
  const collab = readCollaborationReadOnly(pkgDir);
  const layers = buildLayers(pkgDir, warnings);
  const capabilities = buildCapabilityStatuses(runtime);

  const { privacyStatus, privacyLabel } = resolvePrivacyStatus({
    packageExists: inspect.exists,
    manifest,
    manifestPresent: identityRead.manifestPresent,
    manifestParseOk: identityRead.manifestParseOk,
    warnings,
  });

  const healthStatus = mapHealthStatus(inspect);

  const base = {
    contractVersion: SUBJECT_OVERVIEW_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    identity: resolveIdentity(manifest, identity, warnings),
    package: {
      schemaVersion: inspect.schemaVersion,
      revision:
        typeof inspect.revision === "number"
          ? inspect.revision
          : manifest && typeof manifest.revision === "number"
            ? manifest.revision
            : null,
      updatedAt: (manifest && manifest.updatedAt) || inspect.updatedAt || null,
      healthStatus,
      recoverability: {
        statusCode: recover.statusCode,
        recoverable: recover.recoverable,
        message: recover.statusMessage,
        previousVersionId: recover.previousVersionId,
        previousRevision: recover.previousRevision,
      },
      locationLabel: "本机资料目录",
      privacyStatus,
      privacyLabel,
      subjectRead: {
        manifestPresent: identityRead.manifestPresent,
        manifestParseOk: identityRead.manifestParseOk,
        identityPresent: identityRead.identityPresent,
        identityParseOk: identityRead.identityParseOk,
      },
    },
    layers,
    recentChange: buildRecentChange(manifest, recover),
    capabilities,
    boundaries: buildBoundariesSection(boundaries, warnings),
    collaboration: buildCollaborationSection(collab),
    warnings,
  };

  const inboxSummary =
    runtime.inboxSummary && typeof runtime.inboxSummary === "object"
      ? runtime.inboxSummary
      : summarizeInboxForOverview(null);

  base.panorama = buildPanoramaSection(base, {
    packageExists: inspect.exists,
    inboxSummary,
    hasIntakeEvidence: detectIntakeEvidence(pkgDir),
  });
  return base;
}

module.exports = {
  buildSubjectOverviewV1,
  SUBJECT_OVERVIEW_CONTRACT_VERSION,
};

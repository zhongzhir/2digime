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
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = readJson(manifestPath, null);
    } catch {
      manifest = null;
      pushWarning(warnings, "manifest_parse_error", "资料清单无法解析。");
    }
  }
  if (fs.existsSync(identityPath)) {
    try {
      identity = readJson(identityPath, null);
    } catch {
      identity = null;
      pushWarning(warnings, "identity_parse_error", "身份资料无法解析。");
    }
  }
  return { manifest, identity };
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
    established,
    enabledCount: boundaries.enabledCount,
    pendingWarnings,
    summary: established
      ? `已启用 ${boundaries.enabledCount} 条边界规则。`
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
 * Build SubjectOverview v1 (read-only; must not mutate package bytes).
 * @param {string} packageDir
 * @param {{ hasApiKey?: boolean, readyExtensionCount?: number }} [runtime]
 */
function buildSubjectOverviewV1(packageDir, runtime = {}) {
  const pkgDir = path.resolve(String(packageDir || ""));
  const warnings = [];
  const inspect = inspectPackageReadOnly(pkgDir);
  const versions = listPackageVersionsReadOnly(pkgDir);
  const recover = assessRecoverabilityReadOnly(pkgDir, inspect, versions);
  const { manifest, identity } = readIdentityReadOnly(pkgDir, warnings);

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

  let privacyStatus = "local_private";
  if (manifest && manifest.packageType && manifest.packageType !== "private") {
    privacyStatus = "unknown";
    pushWarning(warnings, "privacy_unknown", "资料隐私状态未知，默认按本地私有处理。");
  }

  const healthStatus = mapHealthStatus(inspect);

  return {
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
      privacyLabel: "默认私有 · 未公开",
    },
    layers,
    recentChange: buildRecentChange(manifest, recover),
    capabilities,
    boundaries: buildBoundariesSection(boundaries, warnings),
    collaboration: buildCollaborationSection(collab),
    warnings,
  };
}

module.exports = {
  buildSubjectOverviewV1,
  SUBJECT_OVERVIEW_CONTRACT_VERSION,
};

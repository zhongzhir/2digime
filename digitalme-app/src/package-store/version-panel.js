"use strict";

/**
 * Build read-only version panel state for settings UI (listVersions IPC).
 * Runs recover() first; on failure returns fail-closed status without rollback targets.
 */

function mapRecoveryFailure(err) {
  const code = err && err.code ? String(err.code) : "recover_failed";
  if (code === "recover_ambiguous") {
    return {
      recoveryIssue: { code, category: "recover_ambiguous" },
      statusCode: "recover_ambiguous",
      statusMessage:
        "资料存在多个无法自动判断的版本，版本恢复已暂停。请稍后再试，不要手动删除资料目录内的文件。",
    };
  }
  if (code === "package_locked") {
    return {
      recoveryIssue: { code, category: "package_locked" },
      statusCode: "package_locked",
      statusMessage: "资料正在被其他操作使用，请稍后再刷新版本信息。",
    };
  }
  const category =
    code === "recover_failed" || code.startsWith("recover_") ? code : "recover_failed";
  return {
    recoveryIssue: { code, category },
    statusCode: "recover_unavailable",
    statusMessage: "版本恢复暂不可用。请稍后刷新；若问题持续，请检查资料是否完整。",
  };
}

function buildVersionPanelInfo(store) {
  try {
    store.recover();
  } catch (e) {
    const mapped = mapRecoveryFailure(e);
    const inspect = store.inspect();
    const versions = store.listVersions();
    const live = versions.find((v) => v.kind === "live") || null;
    const currentRevision =
      live && typeof live.revision === "number"
        ? live.revision
        : typeof inspect.revision === "number"
          ? inspect.revision
          : null;

    return {
      currentRevision,
      schemaVersion: inspect.schemaVersion,
      healthy: !!inspect.healthy,
      issues: inspect.issues || [],
      previousVersionId: null,
      previousRevision: null,
      versions,
      statusCode: mapped.statusCode,
      statusMessage: mapped.statusMessage,
      recoveryIssue: mapped.recoveryIssue,
      recoverable: false,
    };
  }

  const inspect = store.inspect();
  const versions = store.listVersions();
  const live = versions.find((v) => v.kind === "live") || null;
  const snapshots = versions
    .filter((v) => v.kind === "snapshot")
    .slice()
    .sort((a, b) => b.revision - a.revision);
  const currentRevision =
    live && typeof live.revision === "number"
      ? live.revision
      : typeof inspect.revision === "number"
        ? inspect.revision
        : null;
  const previous =
    snapshots.find((s) => currentRevision == null || s.revision < currentRevision) || null;

  let statusCode = "ok";
  let statusMessage = "";
  if (!inspect.exists) {
    statusCode = "package_missing";
    statusMessage = "当前资料目录不存在，无法管理版本。";
  } else if (inspect.schemaVersion !== "0.2" && inspect.schemaVersion != null) {
    statusCode = "schema_unsupported";
    statusMessage = "当前资料格式版本不受支持，暂无法使用版本恢复。";
  } else if (!inspect.schemaVersion || inspect.schemaVersion !== "0.2") {
    statusCode = "schema_v01";
    statusMessage =
      "当前资料尚未升级到可版本管理的格式。请先使用临时演示资料验收，或完成显式升级后再恢复。";
  } else if (!inspect.healthy) {
    statusCode = "unhealthy";
    statusMessage = "资料校验未通过，已暂停版本恢复。请先排除资料损坏或路径问题。";
  } else if (!previous) {
    statusCode = "no_snapshot";
    statusMessage = "尚无可恢复的历史版本。完成一次已确认的资料写入后，才会生成可恢复版本。";
  } else {
    statusMessage = "可将资料恢复到上一个已保存版本。恢复会生成新的版本号，不会删除历史版本。";
  }

  return {
    currentRevision,
    schemaVersion: inspect.schemaVersion,
    healthy: !!inspect.healthy,
    issues: inspect.issues || [],
    previousVersionId: previous ? previous.versionId : null,
    previousRevision: previous ? previous.revision : null,
    versions,
    statusCode,
    statusMessage,
    recoveryIssue: null,
    recoverable: statusCode === "ok",
  };
}

module.exports = { buildVersionPanelInfo, mapRecoveryFailure };

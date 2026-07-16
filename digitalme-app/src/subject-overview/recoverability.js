"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJson } = require("../package-store/fs-util");
const { readLatestJournal } = require("../package-store/journal");
const { storeRootFor } = require("../package-store/paths");

function isPidAlive(pid) {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e && e.code === "ESRCH") return false;
    if (e && e.code === "EPERM") return true;
    return false;
  }
}

/**
 * Read-only recoverability assessment — does not call recover() or acquire locks.
 * @param {string} packageDir
 * @param {object} inspect
 * @param {object[]} versions
 */
function assessRecoverabilityReadOnly(packageDir, inspect, versions) {
  const resolvedPackageDir = path.resolve(packageDir);
  const storeRoot = storeRootFor(resolvedPackageDir);
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

  const lock = readJson(path.join(storeRoot, "lock.json"), null);
  if (lock && isPidAlive(lock.pid)) {
    return {
      statusCode: "package_locked",
      recoverable: false,
      statusMessage: "资料正在被其他操作使用，请稍后再查看版本信息。",
      previousVersionId: null,
      previousRevision: null,
      recoveryIssue: { code: "package_locked", category: "package_locked" },
    };
  }

  const journal = readLatestJournal(storeRoot);
  const backupPath = path.join(storeRoot, "swap-backup");
  const liveExists = fs.existsSync(resolvedPackageDir);
  const backupExists = fs.existsSync(backupPath);
  if (!journal && liveExists && backupExists) {
    return {
      statusCode: "recover_ambiguous",
      recoverable: false,
      statusMessage: "资料存在多个无法自动判断的版本，版本恢复已暂停。",
      previousVersionId: null,
      previousRevision: null,
      recoveryIssue: { code: "recover_ambiguous", category: "recover_ambiguous" },
    };
  }

  if (journal) {
    return {
      statusCode: "recovery_pending",
      recoverable: false,
      statusMessage: "检测到未完成的资料写入。请前往设置中的「资料版本」刷新并处理。",
      previousVersionId: null,
      previousRevision: null,
      recoveryIssue: { code: "recovery_pending", category: "recovery_pending" },
    };
  }

  if (!inspect.exists) {
    return {
      statusCode: "package_missing",
      recoverable: false,
      statusMessage: "当前资料目录不存在。",
      previousVersionId: null,
      previousRevision: null,
      recoveryIssue: null,
    };
  }

  if (inspect.schemaVersion !== "0.2") {
    return {
      statusCode: inspect.schemaVersion ? "schema_unsupported" : "schema_v01",
      recoverable: false,
      statusMessage:
        inspect.schemaVersion && inspect.schemaVersion !== "0.2"
          ? "当前资料格式版本不受支持，暂无法使用版本恢复。"
          : "当前资料尚未升级到可版本管理的格式；首页可只读查看，恢复需先升级。",
      previousVersionId: null,
      previousRevision: null,
      recoveryIssue: null,
    };
  }

  if (!inspect.healthy) {
    return {
      statusCode: "unhealthy",
      recoverable: false,
      statusMessage: "资料校验未通过，已暂停版本恢复。",
      previousVersionId: null,
      previousRevision: null,
      recoveryIssue: { code: "unhealthy", category: "unhealthy" },
    };
  }

  if (!previous) {
    return {
      statusCode: "no_snapshot",
      recoverable: false,
      statusMessage: "尚无可恢复的历史版本。",
      previousVersionId: null,
      previousRevision: null,
      recoveryIssue: null,
    };
  }

  return {
    statusCode: "ok",
    recoverable: true,
    statusMessage: "可将资料恢复到上一个已保存版本。",
    previousVersionId: previous.versionId,
    previousRevision: previous.revision,
    recoveryIssue: null,
  };
}

module.exports = { assessRecoverabilityReadOnly };

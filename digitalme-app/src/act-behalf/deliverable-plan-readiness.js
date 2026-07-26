"use strict";

/**
 * DVL2-01 readiness: recomputable CurrentExecutionReadiness from a plan version.
 */

const { includedItems, nowIso } = require("./deliverable-plan-schema");

function recomputeExecutionReadiness(version, options) {
  const opts = options || {};
  const basedOnVersionId = version && version.versionId ? String(version.versionId) : "";
  const evaluatedAt = nowIso();
  if (!version) {
    return {
      schemaVersion: 1,
      basedOnVersionId,
      status: "unknown",
      executableItemIds: [],
      blockedItemIds: [],
      blockers: [{ code: "missing_version", message: "缺少计划版本。" }],
      evaluatedAt,
      cacheValid: false,
      userSummary: "无法评估执行条件。",
    };
  }

  const included = includedItems(version.items || []);
  if (included.length === 0) {
    return {
      schemaVersion: 1,
      basedOnVersionId,
      status: "not_executable",
      executableItemIds: [],
      blockedItemIds: [],
      blockers: [{ code: "empty_included", message: "没有可执行的预计交付项。" }],
      evaluatedAt,
      cacheValid: true,
      userSummary: "没有可执行的预计交付项。",
    };
  }

  const executableItemIds = [];
  const blockedItemIds = [];
  const blockers = [];

  for (const it of included) {
    const isAvailable =
      opts.treatUnavailableAsAvailable === true ? true : it.runtimeAvailability === "available";
    if (isAvailable) {
      executableItemIds.push(it.id);
    } else {
      blockedItemIds.push(it.id);
      const reason =
        it.contractSupport === "reserved_for_future" || it.contractSupport === "out_of_scope"
          ? "该类型当前版本暂不执行生成。"
          : "真实成果生成能力尚未实施。";
      blockers.push({ itemId: it.id, code: "runtime_unavailable", message: reason });
    }
  }

  const requiredBlocked = included.some(
    (it) => it.priority === "required" && blockedItemIds.includes(it.id)
  );
  let status = "executable";
  if (blockedItemIds.length === included.length || requiredBlocked) {
    status = "not_executable";
  } else if (blockedItemIds.length > 0) {
    status = "partially_executable";
  }

  if (status === "not_executable") {
    blockers.unshift({
      code: "generation_not_implemented",
      message: "成果计划已准备，但真实成果生成能力尚未实施。",
    });
  }

  return {
    schemaVersion: 1,
    basedOnVersionId,
    status,
    executableItemIds,
    blockedItemIds,
    blockers,
    evaluatedAt,
    cacheValid: true,
    userSummary:
      status === "not_executable"
        ? "成果计划已准备，但真实成果生成能力尚未实施。"
        : status === "partially_executable"
          ? "部分预计交付当前尚不可执行生成。"
          : "当前评估为可执行（以执行前重评为准）。",
  };
}

module.exports = {
  recomputeExecutionReadiness,
};

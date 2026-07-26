"use strict";

/**
 * DVL2-02 CurrentPreparationReadiness — recomputable; never mutates ExecutionSnapshot.
 */

const { nowIso } = require("./deliverable-package-schema");

function recomputeCurrentPreparationReadiness(pkg, deliverables) {
  const packageId = pkg && pkg.id ? String(pkg.id) : "";
  const items = Array.isArray(deliverables) ? deliverables : [];
  const included = items.filter((d) => d && d.planDisposition === "included");
  const blockers = [];
  let unavailableCount = 0;

  for (const d of included) {
    // Planning-time availability is not authoritative; treat current generation as blocked
    // until DVL2-03. Snapshot may list kinds but runtime is unavailable for all four.
    unavailableCount += 1;
    blockers.push({
      code: "runtime_unavailable",
      message: "真实成果生成能力尚未实施。",
    });
  }

  let status = "ready_for_future_generation";
  let capabilityReadiness = "ready";
  if (unavailableCount > 0 || included.length === 0) {
    status = included.length === 0 ? "blocked_by_consistency" : "waiting_for_capability";
    capabilityReadiness = "unavailable";
  }

  const blockerSummaries = [];
  const seen = new Set();
  for (const b of blockers) {
    const msg = String(b.message || "");
    if (!msg || seen.has(msg)) continue;
    seen.add(msg);
    blockerSummaries.push(msg);
  }
  if (status === "waiting_for_capability" && blockerSummaries.length === 0) {
    blockerSummaries.push("真实成果生成能力尚未实施。");
  }

  return {
    schemaVersion: 1,
    packageId,
    status,
    capabilityReadiness,
    authorizationReadiness: "satisfied",
    dependencyReadiness: "satisfied",
    consistencyReadiness: "ok",
    requiredUserActions: status === "waiting_for_capability" ? [] : [],
    blockerSummaries: blockerSummaries.slice(0, 5),
    evaluatedAt: nowIso(),
    userSummary:
      status === "waiting_for_capability"
        ? "成果包已准备；当前尚无法生成真实文件。"
        : included.length === 0
          ? "成果包缺少可执行的预计交付项。"
          : "成果包已准备。",
  };
}

module.exports = {
  recomputeCurrentPreparationReadiness,
};

"use strict";

/**
 * DVL2-02 DeliverablePackage schema helpers — no DeliverableVersion / ArtifactRef.
 */

const crypto = require("node:crypto");
const { includedItems } = require("./deliverable-plan-schema");
const { unwrapField } = require("./deliverable-context");

function unwrapProvenance(value) {
  return unwrapField(value);
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return prefix + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}

function digestPlanVersion(version) {
  const payload = {
    versionId: version && version.versionId,
    understanding: version && version.understanding,
    items: version && version.items,
    planningAvailabilitySnapshot: version && version.planningAvailabilitySnapshot,
  };
  return "sha256:" + crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function buildExecutionSnapshot({ task, plan, confirmedVersion, triggerSource }) {
  const items = Array.isArray(confirmedVersion && confirmedVersion.items)
    ? JSON.parse(JSON.stringify(confirmedVersion.items))
    : [];
  const understanding = confirmedVersion && confirmedVersion.understanding
    ? JSON.parse(JSON.stringify(confirmedVersion.understanding))
    : {};
  const deps = [];
  for (const it of items) {
    for (const dep of it.dependencies || []) {
      deps.push({ fromId: String(it.id), toId: String(dep) });
    }
  }
  return {
    schemaVersion: 1,
    taskId: String(task.taskId),
    planId: String(plan.planId),
    confirmedPlanVersionId: String(confirmedVersion.versionId),
    plannedDeliverables: items,
    dependencies: deps,
    planningAvailabilitySnapshot:
      confirmedVersion.planningAvailabilitySnapshot != null
        ? JSON.parse(JSON.stringify(confirmedVersion.planningAvailabilitySnapshot))
        : null,
    riskDeclarations: Array.isArray(confirmedVersion.risksAndAuthorization)
      ? JSON.parse(JSON.stringify(confirmedVersion.risksAndAuthorization))
      : [],
    inputSummary: {
      goal:
        unwrapProvenance(understanding && understanding.goal) ||
        unwrapProvenance(task && task.taskIntent && task.taskIntent.goal) ||
        unwrapProvenance(task && task.request) ||
        unwrapProvenance(task && task.goal) ||
        "",
      audience: unwrapProvenance(understanding && understanding.audience) || "",
      usage: unwrapProvenance(understanding && understanding.usage) || "",
      constraints: unwrapProvenance(understanding && understanding.constraints) || "",
      expectedQuality: unwrapProvenance(understanding && understanding.expectedQuality) || "",
      understandingSummary:
        unwrapProvenance(understanding && (understanding.summary || understanding.oneLineSummary)) ||
        (
          unwrapProvenance(task && task.taskIntent && task.taskIntent.goal) ||
          unwrapProvenance(task && task.goal) ||
          ""
        ).slice(0, 200),
    },
    understanding: understanding || {},
    sourcePlanDigest: digestPlanVersion(confirmedVersion),
    createdAt: nowIso(),
    triggerSource: triggerSource || "prepare_package_ipc",
  };
}

function mapPlannedToDeliverable(item, packageId, order) {
  return {
    schemaVersion: 1,
    id: newId("deliverable_"),
    packageId: String(packageId),
    sourcePlannedDeliverableId: String(item.id),
    kind: String(item.kind || "other"),
    format: item.format != null ? String(item.format) : undefined,
    title: String(item.title || "未命名成果"),
    purpose: item.purpose != null ? String(item.purpose) : undefined,
    order: Number.isInteger(order) ? order : 0,
    dependencies: Array.isArray(item.dependencies) ? item.dependencies.map(String) : [],
    planDisposition: "included",
    generationStatus: "planned",
    reviewStatus: "unreviewed",
    currentVersionId: null,
    versionIds: [],
    latestPreparationAttemptId: null,
    capabilityRequirements: item.capabilityRequirements != null ? item.capabilityRequirements : null,
    riskFlags: Array.isArray(item.riskFlags) ? item.riskFlags : [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function isValidPackageRecord(pkg) {
  return !!(
    pkg &&
    typeof pkg === "object" &&
    pkg.id &&
    pkg.taskId &&
    pkg.sourcePlanId &&
    pkg.sourcePlanVersionId &&
    pkg.executionSnapshot &&
    Array.isArray(pkg.deliverableIds)
  );
}

function isActivePackage(pkg) {
  if (!isValidPackageRecord(pkg)) return false;
  if (pkg.softDeletedAt) return false;
  if (pkg.archivedAt) return false;
  return true;
}

module.exports = {
  nowIso,
  newId,
  stableStringify,
  digestPlanVersion,
  buildExecutionSnapshot,
  mapPlannedToDeliverable,
  includedItems,
  isValidPackageRecord,
  isActivePackage,
};

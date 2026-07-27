"use strict";

/**
 * DVL2-02 prepareDeliverablePackage — main-authoritative; input only taskId.
 */

const packageStore = require("./deliverable-package-store");
const {
  nowIso,
  newId,
  buildExecutionSnapshot,
  mapPlannedToDeliverable,
  includedItems,
  isActivePackage,
} = require("./deliverable-package-schema");
const { recomputeCurrentPreparationReadiness } = require("./deliverable-package-readiness");
const actionIdentity = require("./action-identity");
const authorizationStore = require("./authorization-store");
const actBehalfStore = require("./task-store");
const planConsistency = require("./deliverable-plan-consistency");

function buildAttempt({
  taskId,
  sourcePlanVersionId,
  status,
  outcome,
  packageId,
  errorCode,
  errorSummary,
}) {
  const startedAt = nowIso();
  return {
    schemaVersion: 1,
    id: newId("pprep_"),
    packageId: packageId || null,
    taskId: String(taskId),
    sourcePlanVersionId: String(sourcePlanVersionId || ""),
    status,
    outcome: outcome || null,
    startedAt,
    finishedAt: status === "started" ? null : startedAt,
    errorCode: errorCode || null,
    errorSummary: errorSummary || null,
    createdPackageId: status === "succeeded" ? packageId || null : null,
    recoveryMetadata: {},
  };
}

/**
 * @param {string} userData
 * @param {{ taskId: string }} input
 * @param {{ getTask: Function, getPlan: Function, saveTaskExecution: Function }} deps
 */
async function prepareDeliverablePackage(userData, input, deps) {
  const taskId = input && input.taskId ? String(input.taskId) : "";
  if (!taskId) {
    return { ok: false, code: "missing_task_id", message: "缺少任务。" };
  }
  if (input && Object.keys(input).some((k) => k !== "taskId")) {
    return {
      ok: false,
      code: "invalid_prepare_input",
      message: "准备成果包只能传入任务标识。",
    };
  }

  const got = deps.getTask(userData, taskId);
  if (!got || !got.ok) {
    return { ok: false, code: "task_not_found", message: "找不到该任务。" };
  }
  const task = got.task;
  const planning = task.deliverablePlanning || {};
  const planId = planning.planId ? String(planning.planId) : "";
  const confirmedId = planning.activeConfirmedVersionId
    ? String(planning.activeConfirmedVersionId)
    : "";
  if (!planId || !confirmedId) {
    return {
      ok: false,
      code: "no_confirmed_plan",
      message: "请先确认成果计划，再准备成果包。",
    };
  }

  const planGot = deps.getPlan(userData, planId);
  if (!planGot || !planGot.ok || !planGot.plan) {
    return { ok: false, code: "plan_not_found", message: "未找到成果计划。" };
  }
  let plan = planGot.plan;
  let version = plan.versions && plan.versions[confirmedId];
  if (!version || version.status !== "confirmed") {
    return {
      ok: false,
      code: "confirmed_version_invalid",
      message: "当前确认的成果计划版本无效。",
    };
  }

  // IDCOLLAB-MIN-01: ensure identity snapshot + local authorization before package prep.
  // Covers confirm-via-legacy paths and older confirmed plans without formal fields.
  const needsIdentity =
    !version.identityContextSnapshot ||
    !authorizationStore.findActiveGrantForPlan(userData, taskId, confirmedId);
  if (needsIdentity) {
    const identityPrep = await actionIdentity.ensurePlanConfirmationIdentity(userData, {
      taskId,
      planVersionId: confirmedId,
      packageDir: (deps && deps.packageDir) || null,
      roleHint: null,
      confirmationRef: "prepare:backfill:" + String(confirmedId),
      untrusted: {},
    });
    if (!identityPrep.ok) {
      return {
        ok: false,
        code: identityPrep.code || "identity_prepare_failed",
        message: identityPrep.message || "无法建立行动授权。",
      };
    }
    const nextPlan = JSON.parse(JSON.stringify(plan));
    nextPlan.versions[confirmedId].identityContextSnapshot =
      identityPrep.identityContextSnapshot;
    nextPlan.versions[confirmedId].identityContextSource =
      identityPrep.identityContextSnapshot.identityContextSource;
    nextPlan.updatedAt = nowIso();
    const identityCache = actionIdentity.taskIdentityCacheFromSnapshot(
      identityPrep.identityContextSnapshot
    );
    const committed = await planConsistency.commitPlanThenTask({
      userData,
      planRecord: nextPlan,
      saveTaskPointers: async ({ deliverablePlanning }) => {
        const gotTask = actBehalfStore.getTask(userData, taskId, { heal: false });
        if (!gotTask.ok || !gotTask.task) {
          return { ok: false, code: "task_not_found" };
        }
        return actBehalfStore.saveTask(userData, {
          ...gotTask.task,
          deliverablePlanning,
          ...identityCache,
        });
      },
      auditEvent: { action: "identity_backfill_on_prepare", versionId: confirmedId },
      cas: {
        expectedRevision: planConsistency.revisionTokensFromPlan(plan),
      },
    });
    if (!committed.ok) {
      // If CAS races, reload and continue if identity now present.
      const reloaded = deps.getPlan(userData, planId);
      const reVersion =
        reloaded &&
        reloaded.ok &&
        reloaded.plan &&
        reloaded.plan.versions &&
        reloaded.plan.versions[confirmedId];
      if (
        !reVersion ||
        !reVersion.identityContextSnapshot ||
        !authorizationStore.findActiveGrantForPlan(userData, taskId, confirmedId)
      ) {
        return {
          ok: false,
          code: committed.code || "identity_backfill_failed",
          message: committed.message || "无法补齐行动身份与授权。",
        };
      }
      plan = reloaded.plan;
      version = reVersion;
    } else {
      plan = committed.plan || nextPlan;
      version = plan.versions[confirmedId];
    }
  }

  const store = packageStore.loadStore(userData);
  const activeMatches = packageStore
    .findActivePackageForConfirmed(userData, taskId, planId, confirmedId)
    .map((p) => store.packages[p.id] || p);

  if (activeMatches.length > 1) {
    return {
      ok: false,
      code: "duplicate_active_packages",
      message: "同一确认计划存在多个有效成果包，需人工处理。",
      failClosed: true,
    };
  }

  if (activeMatches.length === 1) {
    const existing = activeMatches[0];
    const attempt = buildAttempt({
      taskId,
      sourcePlanVersionId: confirmedId,
      status: "succeeded",
      outcome: "existing_package",
      packageId: existing.id,
    });
    try {
      await packageStore.appendPreparationAttempt(userData, attempt, store.revision);
    } catch (err) {
      if (err && err.code === "stale_store_revision") {
        // Retry once by reloading — still idempotent return of same package
        const store2 = packageStore.loadStore(userData);
        await packageStore.appendPreparationAttempt(userData, attempt, store2.revision);
      } else {
        throw err;
      }
    }
    let degraded = false;
    try {
      await deps.saveTaskExecution(userData, taskId, { activePackageId: existing.id });
    } catch (err) {
      degraded = true;
    }
    const deliverables = packageStore.getDeliverablesForPackage(userData, existing.id);
    const readiness = recomputeCurrentPreparationReadiness(existing, deliverables);
    return {
      ok: true,
      outcome: "existing_package",
      package: existing,
      deliverables,
      attempt,
      readiness,
      degraded_consistency: degraded || undefined,
      message: degraded
        ? "成果包已存在，但任务指针尚未同步。"
        : "已有对应成果包，已为你打开。",
    };
  }

  // archived / soft_deleted for same confirmed — do not silent create/restore
  const allSame = packageStore.findPackagesForConfirmed(userData, taskId, planId, confirmedId);
  const archivedOnly = allSame.filter((p) => p.archivedAt && !p.softDeletedAt);
  const softDeleted = allSame.filter((p) => p.softDeletedAt);
  if (archivedOnly.length && !allSame.some(isActivePackage)) {
    return {
      ok: false,
      code: "package_archived",
      message: "对应成果包已归档。如需继续，请显式恢复或重新建立成果包。",
    };
  }
  if (softDeleted.length && !allSame.some(isActivePackage)) {
    return {
      ok: false,
      code: "package_soft_deleted",
      message: "对应成果包已删除。如需继续，请显式恢复或重新建立成果包。",
    };
  }

  const packageId = newId("delivery_");
  const included = includedItems(version.items || []);
  const deliverables = included.map((it, idx) => mapPlannedToDeliverable(it, packageId, idx));
  // Remap dependency planned ids → deliverable ids where possible
  const bySource = new Map(deliverables.map((d) => [d.sourcePlannedDeliverableId, d.id]));
  for (const d of deliverables) {
    d.dependencies = (d.dependencies || [])
      .map((dep) => bySource.get(String(dep)) || String(dep))
      .filter(Boolean);
  }

  const snapshot = buildExecutionSnapshot({
    task,
    plan,
    confirmedVersion: version,
    triggerSource: "prepare_package_ipc",
  });

  const attempt = buildAttempt({
    taskId,
    sourcePlanVersionId: confirmedId,
    status: "succeeded",
    outcome: "created_new",
    packageId,
  });
  for (const d of deliverables) {
    d.latestPreparationAttemptId = attempt.id;
  }

  const pkg = {
    schemaVersion: 1,
    id: packageId,
    taskId,
    sourcePlanId: planId,
    sourcePlanVersionId: confirmedId,
    lifecycleStatus: "planned",
    completionStatus: "none",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deliverableIds: deliverables.map((d) => d.id),
    executionSnapshot: snapshot,
    reviewSummary: { acceptedCount: 0, rejectedCount: 0, unreviewedCount: deliverables.length },
    recovery: {},
    localStore: {
      storeKind: "deliverable_packages_json",
      relativeKey: packageId,
    },
    revision: 1,
    softDeletedAt: null,
    archivedAt: null,
    supersededByPackageId: null,
    sourcePlanSuperseded: false,
    // IDCOLLAB-MIN-01
    identityContextSnapshot: version.identityContextSnapshot
      ? JSON.parse(JSON.stringify(version.identityContextSnapshot))
      : null,
    identityContextSource: version.identityContextSource ||
      (version.identityContextSnapshot && version.identityContextSnapshot.identityContextSource) ||
      null,
    authorizationRefs:
      version.identityContextSnapshot && Array.isArray(version.identityContextSnapshot.authorizationRefs)
        ? JSON.parse(JSON.stringify(version.identityContextSnapshot.authorizationRefs))
        : [],
    initiatorSubjectId:
      (version.identityContextSnapshot && version.identityContextSnapshot.initiatorSubjectId) || null,
    ownerSubjectId:
      (version.identityContextSnapshot && version.identityContextSnapshot.ownerSubjectId) || null,
    representedSubjectId:
      (version.identityContextSnapshot && version.identityContextSnapshot.representedSubjectId) || null,
    actingSubjectId:
      (version.identityContextSnapshot && version.identityContextSnapshot.actingSubjectId) || null,
  };

  const revisionBefore = packageStore.loadStore(userData).revision;
  try {
    await packageStore.saveNewPackageBundle(userData, {
      package: pkg,
      deliverables,
      attempt,
      expectedRevision: revisionBefore,
    });
  } catch (err) {
    if (err && err.code === "duplicate_active_package") {
      // Lost race — return existing
      return prepareDeliverablePackage(userData, { taskId }, deps);
    }
    if (err && err.code === "stale_store_revision") {
      return prepareDeliverablePackage(userData, { taskId }, deps);
    }
    throw err;
  }

  let degraded = false;
  try {
    await deps.saveTaskExecution(userData, taskId, { activePackageId: packageId });
  } catch (err) {
    degraded = true;
  }

  const readiness = recomputeCurrentPreparationReadiness(pkg, deliverables);
  return {
    ok: true,
    outcome: "created_new",
    package: pkg,
    deliverables,
    attempt,
    readiness,
    degraded_consistency: degraded || undefined,
    message: degraded
      ? "成果包已准备，但任务指针尚未同步。"
      : readiness.userSummary || "成果包已准备；当前尚无法生成真实文件。",
  };
}

module.exports = {
  prepareDeliverablePackage,
  buildAttempt,
};

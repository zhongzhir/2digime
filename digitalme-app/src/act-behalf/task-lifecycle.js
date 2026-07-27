"use strict";

/**
 * TASK-UX-MIN-01: task archive / restore / soft-delete with plan sync and generation guard.
 */

const actBehalfStore = require("./task-store");
const deliverablePlanStore = require("./deliverable-plan-store");
const deliverablePlanConsistency = require("./deliverable-plan-consistency");
const packageStore = require("./deliverable-package-store");

const GENERATING_STATUSES = new Set(["queued", "generating", "repairing", "validating"]);

function isDeliverableGenerating(d) {
  if (!d || d.planDisposition === "removed") return false;
  return GENERATING_STATUSES.has(String(d.generationStatus || ""));
}

function isTaskGenerating(userData, taskId) {
  const got = actBehalfStore.getTask(userData, taskId, { heal: false });
  if (!got.ok) return { generating: false, reason: null };
  const exec = got.task.deliverableExecution || {};
  const packageId = exec.activePackageId;
  if (!packageId) return { generating: false, reason: null };
  const deliverables = packageStore.getDeliverablesForPackage(userData, packageId);
  const generating = deliverables.some(isDeliverableGenerating);
  if (generating) {
    return { generating: true, reason: "package_deliverable_generating" };
  }
  const store = packageStore.loadStore(userData);
  const attempts = Object.values(store.preparationAttempts || {}).filter(
    (a) => a && String(a.packageId) === String(packageId) && GENERATING_STATUSES.has(String(a.status || ""))
  );
  if (attempts.length) {
    return { generating: true, reason: "package_preparation_in_progress" };
  }
  return { generating: false, reason: null };
}

function generationBlockedResponse() {
  return {
    ok: false,
    code: "generation_in_progress",
    message: "任务正在生成，完成或停止后才能归档。",
  };
}

function deleteGenerationBlockedResponse() {
  return {
    ok: false,
    code: "generation_in_progress",
    message: "任务正在生成，完成或停止后才能删除。",
  };
}

async function syncPlanLifecycleIfPresent(userData, taskId, lifecycleStatus, taskPatch) {
  const got = actBehalfStore.getTask(userData, taskId, { heal: false });
  if (!got.ok) return got;
  const plans = deliverablePlanStore.findPlanByTaskId(userData, taskId);
  const ptr = got.task.deliverablePlanning || {};
  let plan = plans[0] || null;
  if (!plan && ptr.planId) {
    const byId = deliverablePlanStore.getPlan(userData, ptr.planId);
    if (byId.ok) plan = byId.plan;
  }
  if (!plan) {
    return actBehalfStore.saveTask(userData, {
      ...got.task,
      ...taskPatch,
    });
  }
  const expected = deliverablePlanConsistency.revisionTokensFromPlan(plan);
  const nextPlan = deliverablePlanConsistency.applyLifecycleToPlan(plan, lifecycleStatus);
  let planResult;
  try {
    planResult = await deliverablePlanStore.savePlanRecord(userData, nextPlan, {
      expectedRevision: expected,
    });
  } catch (err) {
    return {
      ok: false,
      code: (err && err.code) || "plan_store_write_failed",
      message: (err && err.message) || "无法更新成果计划生命周期。",
      current: err && err.current,
    };
  }
  try {
    const taskSaved = await actBehalfStore.saveTask(userData, {
      ...got.task,
      ...taskPatch,
      deliverablePlanning: deliverablePlanConsistency.pointersFromRecord(planResult.plan),
      audit: deliverablePlanConsistency.appendAudit(got.task, {
        action: "lifecycle_" + lifecycleStatus,
        planId: planResult.plan.planId,
      }),
    });
    return { ok: true, task: taskSaved.task, plan: planResult.plan };
  } catch (err) {
    return {
      ok: false,
      code: "degraded_consistency",
      message: "计划生命周期已写入，任务状态待同步。",
      plan: planResult.plan,
      needsReconcile: true,
    };
  }
}

async function archiveTaskLifecycle(userData, taskId) {
  const got = actBehalfStore.getTask(userData, taskId, { heal: false });
  if (!got.ok) return got;
  if (got.task.lifecycleStatus === "archived") {
    return { ok: true, task: got.task, already: true };
  }
  if (got.task.lifecycleStatus === "soft_deleted") {
    return { ok: false, code: "task_deleted", message: "该任务已删除。" };
  }
  const gen = isTaskGenerating(userData, taskId);
  if (gen.generating) return generationBlockedResponse();
  const now = new Date().toISOString();
  return syncPlanLifecycleIfPresent(userData, taskId, "archived", {
    lifecycleStatus: "archived",
    status: "archived",
    archivedAt: now,
    deletedAt: null,
    updatedAt: now,
  });
}

async function restoreTaskLifecycle(userData, taskId) {
  const got = actBehalfStore.getTask(userData, taskId, { heal: false });
  if (!got.ok) return got;
  if (got.task.lifecycleStatus !== "archived") {
    return { ok: false, code: "not_archived", message: "该任务不在已归档列表中。" };
  }
  const now = new Date().toISOString();
  return syncPlanLifecycleIfPresent(userData, taskId, "active", {
    lifecycleStatus: "active",
    status: got.task.status === "archived" ? "draft" : got.task.status || "draft",
    archivedAt: null,
    updatedAt: now,
  });
}

async function softDeleteTaskLifecycle(userData, taskId) {
  const got = actBehalfStore.getTask(userData, taskId, { heal: false });
  if (!got.ok) return got;
  if (got.task.lifecycleStatus === "soft_deleted") {
    return { ok: true, task: got.task, already: true };
  }
  const gen = isTaskGenerating(userData, taskId);
  if (gen.generating) return deleteGenerationBlockedResponse();
  const now = new Date().toISOString();
  return syncPlanLifecycleIfPresent(userData, taskId, "soft_deleted", {
    lifecycleStatus: "soft_deleted",
    status: "soft_deleted",
    deletedAt: now,
    updatedAt: now,
  });
}

async function renameTaskLifecycle(userData, taskId, title) {
  const trimmed = String(title || "").trim();
  if (!trimmed) {
    return { ok: false, code: "title_required", message: "请输入任务名称。" };
  }
  if (trimmed.length > 60) {
    return { ok: false, code: "title_too_long", message: "名称最多 60 字。" };
  }
  const got = actBehalfStore.getTask(userData, taskId, { heal: false });
  if (!got.ok) return got;
  if (got.task.lifecycleStatus === "soft_deleted") {
    return { ok: false, code: "task_deleted", message: "该任务已删除。" };
  }
  const now = new Date().toISOString();
  const task = {
    ...got.task,
    title: trimmed,
    updatedAt: now,
  };
  if (task.taskIntent && typeof task.taskIntent === "object") {
    task.taskIntent = { ...task.taskIntent, title: trimmed };
  }
  return actBehalfStore.saveTask(userData, task);
}

module.exports = {
  GENERATING_STATUSES,
  isDeliverableGenerating,
  isTaskGenerating,
  archiveTaskLifecycle,
  restoreTaskLifecycle,
  softDeleteTaskLifecycle,
  renameTaskLifecycle,
};

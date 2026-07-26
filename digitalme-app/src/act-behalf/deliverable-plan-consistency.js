"use strict";

/**
 * DVL2-01 Task/Plan consistency: write order helpers + reconciliation.
 * Single reconciliation authority for DVL2-01 (not duplicated in store).
 *
 * Return contract for reconcileTaskAndPlans:
 * - safePlanPatch: only deterministic pointer repairs safe to persist (or null)
 * - safeTaskPatch: only safe task pointer sync (or {})
 * - failClosed: when true, callers MUST NOT persist any patch by default
 * - conflicts / audits
 */

const planStore = require("./deliverable-plan-store");
const { assertPointersInvariant, nowIso } = require("./deliverable-plan-schema");

function emptyDeliverablePlanning() {
  return {
    planId: null,
    currentDraftVersionId: null,
    activeConfirmedVersionId: null,
  };
}

function pointersFromRecord(record) {
  if (!record) return emptyDeliverablePlanning();
  return {
    planId: record.planId || null,
    currentDraftVersionId: record.currentDraftVersionId || null,
    activeConfirmedVersionId: record.activeConfirmedVersionId || null,
  };
}

function appendAudit(task, event) {
  const audit = task && task.audit && typeof task.audit === "object" ? { ...task.audit } : {};
  const list = Array.isArray(audit.deliverablePlanEvents) ? audit.deliverablePlanEvents.slice() : [];
  list.push({ at: nowIso(), ...event });
  audit.deliverablePlanEvents = list.slice(-100);
  return audit;
}

function appendPlanningInvocation(task, event) {
  const audit = task && task.audit && typeof task.audit === "object" ? { ...task.audit } : {};
  const list = Array.isArray(audit.planningInvocations) ? audit.planningInvocations.slice() : [];
  list.push(event);
  audit.planningInvocations = list.slice(-100);
  return audit;
}

/**
 * Deterministic commit: Plan Store first, then Task Store via provided saver.
 * saver(taskPatch) must persist task and return { ok, task?, code?, message? }
 * cas: { expectAbsent?: boolean, expectedRevision?: object } — passed to Store CAS.
 */
async function commitPlanThenTask({ userData, planRecord, saveTaskPointers, auditEvent, cas }) {
  let planResult;
  try {
    planResult = await planStore.savePlanRecord(userData, planRecord, cas || {});
  } catch (err) {
    return {
      ok: false,
      code: (err && err.code) || "plan_store_write_failed",
      message: (err && err.message) || "无法保存成果计划。",
      consistency: "failed_before_task",
      current: err && err.current,
    };
  }

  let taskResult;
  try {
    taskResult = await saveTaskPointers({
      deliverablePlanning: pointersFromRecord(planResult.plan),
      auditEvent: auditEvent || null,
    });
  } catch (err) {
    return {
      ok: false,
      code: "degraded_consistency",
      message: "计划已写入，任务索引待同步。",
      consistency: "degraded_consistency",
      plan: planResult.plan,
      taskError: {
        code: (err && err.code) || "task_store_write_failed",
        message: (err && err.message) || "任务指针写入失败。",
      },
      needsReconcile: true,
    };
  }

  if (!taskResult || taskResult.ok === false) {
    return {
      ok: false,
      code: "degraded_consistency",
      message: "计划已写入，任务索引待同步。",
      consistency: "degraded_consistency",
      plan: planResult.plan,
      taskError: taskResult || { code: "task_store_write_failed" },
      needsReconcile: true,
    };
  }

  return {
    ok: true,
    consistency: "ok",
    plan: planResult.plan,
    task: taskResult.task,
  };
}

function emptyReconcileResult(overrides) {
  return {
    ok: true,
    failClosed: false,
    safePlanPatch: null,
    safeTaskPatch: {},
    casExpectedRevision: null,
    conflicts: [],
    audits: [],
    plans: [],
    deliverablePlanning: emptyDeliverablePlanning(),
    code: undefined,
    message: undefined,
    ...overrides,
  };
}

/**
 * Reconcile Task pointers with Plan records.
 * failClosed=true => callers MUST NOT persist patches (safe* remain empty/null).
 */
function reconcileTaskAndPlans({ task, plansForTask }) {
  const audits = [];
  const conflicts = [];
  const plans = (plansForTask || []).map((p) => planStore.cloneRecord(p));
  const prevPointers =
    task && task.deliverablePlanning
      ? {
          planId: task.deliverablePlanning.planId || null,
          currentDraftVersionId: task.deliverablePlanning.currentDraftVersionId || null,
          activeConfirmedVersionId: task.deliverablePlanning.activeConfirmedVersionId || null,
        }
      : emptyDeliverablePlanning();

  if (plans.length > 1) {
    audits.push({ action: "reconcile_conflict", detail: "multiple_plan_records" });
    conflicts.push({
      code: "multiple_plan_records",
      message: "同一任务存在多条成果计划，已停止自动确认与执行准备。",
    });
    return emptyReconcileResult({
      ok: false,
      failClosed: true,
      code: "multiple_plan_records",
      message: conflicts[0].message,
      conflicts,
      audits,
      plans,
      deliverablePlanning: prevPointers,
      safePlanPatch: null,
      safeTaskPatch: {},
    });
  }

  if (plans.length === 0) {
    const hasPtr =
      prevPointers.planId || prevPointers.currentDraftVersionId || prevPointers.activeConfirmedVersionId;
    if (hasPtr) {
      audits.push({ action: "reconcile_conflict", detail: "plan_missing_for_task_pointer" });
      conflicts.push({
        code: "plan_missing_for_task_pointer",
        message: "任务仍指向成果计划，但计划存档缺失。已停止自动清空指针与新建计划，请显式修复。",
      });
      return emptyReconcileResult({
        ok: false,
        failClosed: true,
        code: "plan_missing_for_task_pointer",
        message: conflicts[0].message,
        conflicts,
        audits,
        plans: [],
        deliverablePlanning: prevPointers,
        safePlanPatch: null,
        safeTaskPatch: {},
      });
    }
    return emptyReconcileResult({
      ok: true,
      failClosed: false,
      deliverablePlanning: emptyDeliverablePlanning(),
      audits,
      plans: [],
    });
  }

  const record = plans[0];
  const confirmedActive = Object.values(record.versions || {}).filter((v) => v && v.status === "confirmed");

  if (confirmedActive.length > 1) {
    audits.push({ action: "reconcile_conflict", detail: "multiple_active_confirmed" });
    conflicts.push({
      code: "multiple_active_confirmed",
      message: "存在多个有效确认版本冲突，已停止自动修复选择。",
    });
    return emptyReconcileResult({
      ok: false,
      failClosed: true,
      code: "multiple_active_confirmed",
      message: conflicts[0].message,
      conflicts,
      audits,
      plans: [record],
      deliverablePlanning: pointersFromRecord(record),
      safePlanPatch: null,
      safeTaskPatch: {},
    });
  }

  let mutated = false;
  const working = planStore.cloneRecord(record);

  if (working.currentDraftVersionId && !(working.versions && working.versions[working.currentDraftVersionId])) {
    audits.push({
      action: "clear_invalid_draft_pointer",
      planId: working.planId,
      versionId: working.currentDraftVersionId,
    });
    working.currentDraftVersionId = null;
    mutated = true;
  }

  if (
    working.activeConfirmedVersionId &&
    !(working.versions && working.versions[working.activeConfirmedVersionId])
  ) {
    audits.push({
      action: "clear_invalid_confirmed_pointer",
      planId: working.planId,
      versionId: working.activeConfirmedVersionId,
    });
    working.activeConfirmedVersionId = confirmedActive[0] ? confirmedActive[0].versionId : null;
    mutated = true;
  } else if (!working.activeConfirmedVersionId && confirmedActive.length === 1) {
    working.activeConfirmedVersionId = confirmedActive[0].versionId;
    audits.push({ action: "restore_confirmed_pointer", versionId: confirmedActive[0].versionId });
    mutated = true;
  }

  if (working.activeConfirmedVersionId) {
    const v = working.versions[working.activeConfirmedVersionId];
    if (v && v.status === "superseded") {
      audits.push({ action: "reconcile_conflict", detail: "active_is_superseded" });
      conflicts.push({
        code: "active_is_superseded",
        message: "有效确认指针指向已替代版本，已停止自动选择。",
      });
      return emptyReconcileResult({
        ok: false,
        failClosed: true,
        code: "active_is_superseded",
        message: conflicts[0].message,
        conflicts,
        audits,
        plans: [record],
        deliverablePlanning: pointersFromRecord(record),
        safePlanPatch: null,
        safeTaskPatch: {},
      });
    }
    if (v && v.status !== "confirmed") {
      audits.push({ action: "reconcile_conflict", detail: "confirmed_status_invalid" });
      conflicts.push({
        code: "confirmed_status_invalid",
        message: "有效确认版本状态不正确，已停止自动修复。",
      });
      return emptyReconcileResult({
        ok: false,
        failClosed: true,
        code: "confirmed_status_invalid",
        message: conflicts[0].message,
        conflicts,
        audits,
        plans: [record],
        deliverablePlanning: pointersFromRecord(record),
        safePlanPatch: null,
        safeTaskPatch: {},
      });
    }
  }

  const pointerCheck = assertPointersInvariant(working);
  if (!pointerCheck.ok) {
    const residual = (pointerCheck.errors || []).filter(
      (e) => e.code !== "draft_pointer_invalid" && e.code !== "confirmed_pointer_invalid"
    );
    if (residual.length || !mutated) {
      audits.push({ action: "reconcile_conflict", detail: "pointer_invariant_failed" });
      conflicts.push({
        code: "pointer_invariant_failed",
        message: "计划指针不变量不满足，已停止自动修复。",
        errors: pointerCheck.errors,
      });
      return emptyReconcileResult({
        ok: false,
        failClosed: true,
        code: "pointer_invariant_failed",
        message: conflicts[0].message,
        conflicts,
        audits,
        plans: [record],
        deliverablePlanning: pointersFromRecord(record),
        safePlanPatch: null,
        safeTaskPatch: {},
      });
    }
  }

  const nextPlanning = pointersFromRecord(working);
  let safeTaskPatch = {};
  if (
    prevPointers.planId !== nextPlanning.planId ||
    prevPointers.currentDraftVersionId !== nextPlanning.currentDraftVersionId ||
    prevPointers.activeConfirmedVersionId !== nextPlanning.activeConfirmedVersionId
  ) {
    audits.push({ action: "sync_task_pointers", planId: nextPlanning.planId });
    safeTaskPatch = { deliverablePlanning: nextPlanning };
  }

  // Lifecycle convergence: active < archived < soft_deleted; orphaned never auto-restored to active.
  const taskLife = normalizeLifecycle(task && task.lifecycleStatus);
  const planLife = normalizeLifecycle(working.lifecycleStatus);
  if (planLife === "orphaned") {
    audits.push({ action: "lifecycle_orphaned_preserved", planId: working.planId });
  } else if (taskLife !== "orphaned") {
    const target = stricterLifecycle(taskLife, planLife);
    if (target && target !== planLife) {
      working.lifecycleStatus = target;
      mutated = true;
      audits.push({
        action: "lifecycle_reconcile",
        planId: working.planId,
        from: planLife,
        to: target,
      });
    }
    if (target && target !== taskLife) {
      safeTaskPatch = {
        ...safeTaskPatch,
        lifecycleStatus: target,
        status: target,
      };
      audits.push({
        action: "lifecycle_reconcile_task",
        taskId: task && task.taskId,
        from: taskLife,
        to: target,
      });
    }
  }

  return emptyReconcileResult({
    ok: true,
    failClosed: false,
    safePlanPatch: mutated ? working : null,
    safeTaskPatch,
    casExpectedRevision: mutated ? revisionTokensFromPlan(record) : null,
    conflicts: [],
    audits,
    plans: [working],
    deliverablePlanning: nextPlanning,
  });
}

const LIFECYCLE_RANK = Object.freeze({ active: 0, archived: 1, soft_deleted: 2 });

function normalizeLifecycle(status) {
  const s = String(status || "active");
  if (s === "archived" || s === "soft_deleted" || s === "orphaned" || s === "active") return s;
  return "active";
}

/** Return the stricter of two non-orphaned lifecycles. */
function stricterLifecycle(a, b) {
  const la = normalizeLifecycle(a);
  const lb = normalizeLifecycle(b);
  if (la === "orphaned" || lb === "orphaned") return null;
  const ra = LIFECYCLE_RANK[la] != null ? LIFECYCLE_RANK[la] : 0;
  const rb = LIFECYCLE_RANK[lb] != null ? LIFECYCLE_RANK[lb] : 0;
  return ra >= rb ? la : lb;
}

function markPlansOrphaned(plans) {
  return (plans || []).map((p) => {
    const next = planStore.cloneRecord(p);
    next.lifecycleStatus = "orphaned";
    next.updatedAt = nowIso();
    return next;
  });
}

function pickDisplayVersion(record) {
  if (!record) return null;
  if (record.currentDraftVersionId && record.versions && record.versions[record.currentDraftVersionId]) {
    return record.versions[record.currentDraftVersionId];
  }
  if (record.activeConfirmedVersionId && record.versions && record.versions[record.activeConfirmedVersionId]) {
    return record.versions[record.activeConfirmedVersionId];
  }
  return null;
}

function supportStatusLabel(item) {
  if (!item) return "当前不可执行";
  if (item.contractSupport === "reserved_for_future") return "当前版本暂不支持（预留）";
  if (item.contractSupport === "out_of_scope") return "当前不在产品范围内";
  if (item.runtimeAvailability !== "available") return "当前不可执行生成";
  return "当前可执行";
}

function applyLifecycleToPlan(record, lifecycleStatus) {
  const next = planStore.cloneRecord(record);
  next.lifecycleStatus = lifecycleStatus;
  // updatedAt is owned by Plan Store write path (CAS compares pre-write revision).
  return next;
}

function isInactiveLifecycle(status) {
  return status === "archived" || status === "soft_deleted";
}

function revisionTokensFromPlan(plan) {
  if (!plan) {
    return {
      expectedPlanUpdatedAt: null,
      expectedCurrentDraftVersionId: null,
      expectedActiveConfirmedVersionId: null,
    };
  }
  return {
    expectedPlanUpdatedAt: plan.updatedAt || null,
    expectedCurrentDraftVersionId: plan.currentDraftVersionId || null,
    expectedActiveConfirmedVersionId: plan.activeConfirmedVersionId || null,
  };
}

function assertRevisionMatch(currentPlan, expected) {
  if (!currentPlan) {
    return { ok: true };
  }
  if (!expected || typeof expected !== "object") {
    return {
      ok: false,
      code: "stale_plan_state",
      message: "成果计划已变化，请重新加载后再试。",
    };
  }
  const cur = revisionTokensFromPlan(currentPlan);
  if (
    String(expected.expectedPlanUpdatedAt || "") !== String(cur.expectedPlanUpdatedAt || "") ||
    String(expected.expectedCurrentDraftVersionId || "") !== String(cur.expectedCurrentDraftVersionId || "") ||
    String(expected.expectedActiveConfirmedVersionId || "") !==
      String(cur.expectedActiveConfirmedVersionId || "")
  ) {
    return {
      ok: false,
      code: "stale_plan_state",
      message: "成果计划已变化，请重新加载后再试。",
      current: cur,
    };
  }
  return { ok: true, current: cur };
}

module.exports = {
  emptyDeliverablePlanning,
  pointersFromRecord,
  appendAudit,
  appendPlanningInvocation,
  commitPlanThenTask,
  reconcileTaskAndPlans,
  markPlansOrphaned,
  pickDisplayVersion,
  supportStatusLabel,
  applyLifecycleToPlan,
  isInactiveLifecycle,
  revisionTokensFromPlan,
  assertRevisionMatch,
  normalizeLifecycle,
  stricterLifecycle,
  LIFECYCLE_RANK,
};

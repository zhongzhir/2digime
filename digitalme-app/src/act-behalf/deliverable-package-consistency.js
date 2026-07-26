"use strict";

/**
 * DVL2-02 package/task pointer reconciliation — never auto-deletes user packages.
 */

const { isActivePackage } = require("./deliverable-package-schema");

function reconcileTaskAndPackages({ task, packages, deliverablesByPackage }) {
  const events = [];
  const tid = task && task.taskId ? String(task.taskId) : "";
  const planning = (task && task.deliverablePlanning) || {};
  const execution = (task && task.deliverableExecution) || {};
  let activePackageId = execution.activePackageId ? String(execution.activePackageId) : null;
  const confirmedId = planning.activeConfirmedVersionId
    ? String(planning.activeConfirmedVersionId)
    : null;
  const planId = planning.planId ? String(planning.planId) : null;
  const list = Array.isArray(packages) ? packages.filter((p) => p && String(p.taskId) === tid) : [];

  // Dual active packages for same confirmed → fail-closed
  if (confirmedId && planId) {
    const activeForConfirmed = list.filter(
      (p) =>
        isActivePackage(p) &&
        String(p.sourcePlanId) === planId &&
        String(p.sourcePlanVersionId) === confirmedId
    );
    if (activeForConfirmed.length > 1) {
      return {
        ok: false,
        code: "duplicate_active_packages",
        message: "同一确认计划存在多个有效成果包，需人工处理。",
        deliverableExecution: { activePackageId: null },
        events: [{ code: "fail_closed_dual_active_packages", count: activeForConfirmed.length }],
        failClosed: true,
      };
    }
  }

  if (activePackageId) {
    const pointed = list.find((p) => String(p.id) === activePackageId);
    if (!pointed) {
      events.push({ code: "clear_missing_package_pointer", packageId: activePackageId });
      activePackageId = null;
    } else if (
      confirmedId &&
      String(pointed.sourcePlanVersionId) !== confirmedId
    ) {
      events.push({
        code: "clear_stale_package_pointer",
        packageId: pointed.id,
        sourcePlanVersionId: pointed.sourcePlanVersionId,
        activeConfirmedVersionId: confirmedId,
      });
      activePackageId = null;
    } else if (!isActivePackage(pointed)) {
      events.push({ code: "clear_inactive_package_pointer", packageId: pointed.id });
      activePackageId = null;
    } else {
      const dels = (deliverablesByPackage && deliverablesByPackage[pointed.id]) || [];
      const missing = (pointed.deliverableIds || []).some(
        (id) => !dels.find((d) => String(d.id) === String(id))
      );
      if (missing || (pointed.deliverableIds || []).length === 0) {
        return {
          ok: false,
          code: "package_deliverables_incomplete",
          message: "成果包数据不完整，已改为只读保护。",
          deliverableExecution: { activePackageId },
          events: [{ code: "isolate_incomplete_package", packageId: pointed.id }],
          readonly: true,
        };
      }
    }
  }

  if (!activePackageId && confirmedId && planId) {
    const candidates = list.filter(
      (p) =>
        isActivePackage(p) &&
        String(p.sourcePlanId) === planId &&
        String(p.sourcePlanVersionId) === confirmedId
    );
    if (candidates.length === 1) {
      activePackageId = String(candidates[0].id);
      events.push({ code: "restore_active_package_pointer", packageId: activePackageId });
    }
  }

  return {
    ok: true,
    deliverableExecution: { activePackageId },
    events,
  };
}

module.exports = {
  reconcileTaskAndPackages,
};

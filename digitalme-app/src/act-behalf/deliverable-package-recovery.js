"use strict";

/**
 * DVL2-02 startup / degraded recovery helpers.
 */

const packageStore = require("./deliverable-package-store");
const { reconcileTaskAndPackages } = require("./deliverable-package-consistency");

function buildDeliverablesByPackage(userData, packages) {
  const map = {};
  for (const pkg of packages || []) {
    map[pkg.id] = packageStore.getDeliverablesForPackage(userData, pkg.id);
  }
  return map;
}

function reconcileTaskPackages(userData, task) {
  const packages = packageStore.listPackagesForTask(userData, task.taskId);
  const deliverablesByPackage = buildDeliverablesByPackage(userData, packages);
  return reconcileTaskAndPackages({ task, packages, deliverablesByPackage });
}

module.exports = {
  reconcileTaskPackages,
  buildDeliverablesByPackage,
};

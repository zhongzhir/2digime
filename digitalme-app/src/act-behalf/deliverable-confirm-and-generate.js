"use strict";

/**
 * User-intent orchestration: confirm plan → prepare/reuse package → generate.
 * Keeps existing package/CAS/generation as internal steps.
 */

const deliverablePlanConsistency = require("./deliverable-plan-consistency");
const deliverablePlanner = require("./deliverable-planner");
const { validateDependencyGraph } = require("./deliverable-plan-schema");
const { prepareDeliverablePackage } = require("./deliverable-package-prepare");
const deliverableGeneration = require("./deliverable-generation");
const packageStore = require("./deliverable-package-store");
const actionIdentity = require("./action-identity");
const authorizationStore = require("./authorization-store");

function contentKey(understanding, items) {
  const u = understanding || {};
  const goal =
    (u.goal && (u.goal.value || u.goal)) ||
    u.summary ||
    u.oneLineSummary ||
    "";
  const normalizedItems = (items || [])
    .map((it, i) => ({
      id: String(it.id || ""),
      kind: String(it.kind || ""),
      title: String(it.title || ""),
      purpose: String(it.purpose || ""),
      format: String(it.format || ""),
      priority: String(it.priority || ""),
      order: Number(it.order != null ? it.order : i),
      dependencies: Array.isArray(it.dependencies)
        ? it.dependencies.map(String).slice().sort()
        : [],
      planDisposition: String(it.planDisposition || "included"),
    }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return JSON.stringify({
    goal: String(goal),
    audience: String((u.audience && (u.audience.value || u.audience)) || ""),
    usage: String((u.usage && (u.usage.value || u.usage)) || ""),
    items: normalizedItems,
  });
}

function versionContentKey(version) {
  if (!version) return "";
  return contentKey(version.understanding, version.items);
}

/**
 * @param {object} ctx
 */
async function confirmPlanAndGenerate(ctx) {
  const {
    userData,
    taskId,
    understanding,
    items,
    callModel,
    imageMode,
    packageDir,
  } = ctx;

  if (!taskId) {
    return { ok: false, code: "task_required", message: "缺少任务。" };
  }

  const loaded = await ctx.loadPlanForTaskOrFail(userData, taskId);
  if (!loaded.ok) return loaded.reconcile || loaded;
  if (!loaded.plan) {
    return { ok: false, code: "plan_not_found", message: "请先形成预计交付。" };
  }
  if (
    loaded.task &&
    loaded.task.deliverablePlanning &&
    loaded.task.deliverablePlanning.materialsStale
  ) {
    return {
      ok: false,
      code: "plan_materials_stale",
      message: "参考材料已变化，请重新形成预计交付后再生成。",
      materialsStale: true,
    };
  }

  let plan = loaded.plan;
  let expected = ctx.extractRevisionExpected({ ...(ctx.revisionExpected || {}) });

  const confirmedId = plan.activeConfirmedVersionId;
  const confirmedVer = confirmedId ? plan.versions[confirmedId] : null;
  const draftId = plan.currentDraftVersionId;
  const draftVer = draftId ? plan.versions[draftId] : null;

  const hasEdits = !!(understanding || items);
  if (hasEdits) {
    if (items) {
      const graph = validateDependencyGraph(items);
      if (!graph.ok) {
        return {
          ok: false,
          code: "graph_invalid",
          message: "预计交付依赖关系无效，请先修正。",
          errors: graph.errors,
        };
      }
    }

    const proposedKey = contentKey(
      understanding || (draftVer || confirmedVer || {}).understanding,
      items || (draftVer || confirmedVer || {}).items
    );
    const confirmedKey = versionContentKey(confirmedVer);
    const draftKey = versionContentKey(draftVer);

    const matchesConfirmed = confirmedVer && proposedKey === confirmedKey;
    const matchesDraft = draftVer && proposedKey === draftKey;

    if (matchesConfirmed && !draftVer) {
      // Reuse identical confirmed version; no new PlanVersion.
    } else if (matchesConfirmed && draftVer) {
      // Drop redundant draft; keep confirmed.
      const fresh = await ctx.assertFreshPlan(userData, plan.planId, expected);
      if (!fresh.ok) return fresh;
      const cancelled = deliverablePlanner.cancelDraft(fresh.plan);
      if (cancelled.ok) {
        const committedCancel = await deliverablePlanConsistency.commitPlanThenTask({
          userData,
          planRecord: cancelled.plan,
          saveTaskPointers: (args) => ctx.saveTaskPlanPointers(userData, taskId, args),
          auditEvent: { action: "plan_cancel_redundant_draft_before_generate" },
          cas: {
            expectedRevision:
              expected || deliverablePlanConsistency.revisionTokensFromPlan(fresh.plan),
          },
        });
        if (!committedCancel.ok) {
          return {
            ok: false,
            code: committedCancel.code || "plan_save_failed",
            message: committedCancel.message || "无法整理当前成果要求。",
          };
        }
        plan = committedCancel.plan || cancelled.plan;
        expected = deliverablePlanConsistency.revisionTokensFromPlan(plan);
      }
    } else if (!matchesDraft) {
      const fresh = await ctx.assertFreshPlan(userData, plan.planId, expected);
      if (!fresh.ok) return fresh;
      const edited = deliverablePlanner.saveDraftEdits(fresh.plan, {
        understanding,
        items,
      });
      if (!edited.ok) return edited;
      const committedDraft = await deliverablePlanConsistency.commitPlanThenTask({
        userData,
        planRecord: edited.plan,
        saveTaskPointers: (args) => ctx.saveTaskPlanPointers(userData, taskId, args),
        auditEvent: { action: "plan_save_draft_before_generate" },
        cas: {
          expectedRevision:
            expected || deliverablePlanConsistency.revisionTokensFromPlan(fresh.plan),
        },
      });
      if (!committedDraft.ok) {
        return {
          ok: false,
          code: committedDraft.code || "plan_save_failed",
          message: committedDraft.message || "无法保存当前成果要求。",
        };
      }
      plan = committedDraft.plan || edited.plan;
      expected = deliverablePlanConsistency.revisionTokensFromPlan(plan);
    }
  }

  // Confirm draft if present
  let confirmedPlan = plan;
  if (plan.currentDraftVersionId) {
    const fresh = await ctx.assertFreshPlan(userData, plan.planId, expected);
    if (!fresh.ok) return fresh;
    const draftId = fresh.plan.currentDraftVersionId;
    const draftVer = draftId && fresh.plan.versions[draftId];
    const identityPrep = await actionIdentity.ensurePlanConfirmationIdentity(userData, {
      taskId,
      planVersionId: draftVer ? draftVer.versionId : draftId,
      packageDir: packageDir || null,
      roleHint: null,
      confirmationRef: "confirm:plan_and_generate:" + String(draftId || ""),
      untrusted: { understanding, items },
    });
    if (!identityPrep.ok) {
      return {
        ok: false,
        code: identityPrep.code || "identity_prepare_failed",
        message: identityPrep.message || "无法建立行动授权。",
      };
    }
    const confirmed = deliverablePlanner.confirmDraft(fresh.plan, {
      identityContextSnapshot: identityPrep.identityContextSnapshot,
    });
    if (!confirmed.ok) return confirmed;
    const identityCache = actionIdentity.taskIdentityCacheFromSnapshot(
      identityPrep.identityContextSnapshot
    );
    const committed = await deliverablePlanConsistency.commitPlanThenTask({
      userData,
      planRecord: confirmed.plan,
      saveTaskPointers: (args) =>
        ctx.saveTaskPlanPointers(userData, taskId, {
          ...args,
          extraPatch: {
            status: "plan_confirmed",
            deliverableExecution: { activePackageId: null },
            ...identityCache,
          },
        }),
      auditEvent: {
        action: "plan_confirm_and_generate",
        versionId: confirmed.version.versionId,
        identityContextId: identityPrep.identityContextSnapshot.identityContextId,
        authorizationId: identityPrep.authorization.authorizationId,
      },
      cas: {
        expectedRevision:
          expected || deliverablePlanConsistency.revisionTokensFromPlan(fresh.plan),
      },
    });
    if (!committed.ok) {
      return {
        ok: false,
        code: committed.code || "plan_confirm_failed",
        message: committed.message || "无法确认成果计划。",
      };
    }
    confirmedPlan = committed.plan || confirmed.plan;
  } else if (!plan.activeConfirmedVersionId) {
    return {
      ok: false,
      code: "no_plan_to_generate",
      message: "请先形成预计交付，再生成成果。",
    };
  } else {
    // Already confirmed: ensure identity + authorization exist (idempotent).
    const confirmedId = plan.activeConfirmedVersionId;
    const confirmedVer = plan.versions[confirmedId];
    if (!confirmedVer || !confirmedVer.identityContextSnapshot) {
      const identityPrep = await actionIdentity.ensurePlanConfirmationIdentity(userData, {
        taskId,
        planVersionId: confirmedId,
        packageDir: packageDir || null,
        roleHint: null,
        confirmationRef: "confirm:existing:" + String(confirmedId),
        untrusted: {},
      });
      const nextPlan = JSON.parse(JSON.stringify(plan));
      if (nextPlan.versions[confirmedId]) {
        nextPlan.versions[confirmedId].identityContextSnapshot =
          identityPrep.identityContextSnapshot;
        nextPlan.versions[confirmedId].identityContextSource =
          identityPrep.identityContextSnapshot.identityContextSource;
      }
      const identityCache = actionIdentity.taskIdentityCacheFromSnapshot(
        identityPrep.identityContextSnapshot
      );
      const committed = await deliverablePlanConsistency.commitPlanThenTask({
        userData,
        planRecord: nextPlan,
        saveTaskPointers: (args) =>
          ctx.saveTaskPlanPointers(userData, taskId, {
            ...args,
            extraPatch: identityCache,
          }),
        auditEvent: {
          action: "identity_backfill_on_generate",
          versionId: confirmedId,
        },
        cas: {
          expectedRevision: deliverablePlanConsistency.revisionTokensFromPlan(plan),
        },
      });
      if (committed.ok) confirmedPlan = committed.plan || nextPlan;
    }
  }

  // Fail-closed: authorization must still be granted before prepare/generate.
  const activeConfirmedId = confirmedPlan.activeConfirmedVersionId;
  const activeGrant = authorizationStore.findActiveGrantForPlan(
    userData,
    taskId,
    activeConfirmedId
  );
  if (!activeGrant) {
    return {
      ok: false,
      code: "authorization_revoked",
      message: "本次授权已撤销或无效，不能继续生成成果。",
      plan: confirmedPlan,
    };
  }
  const authGate = authorizationStore.assertAuthorizationAllows(userData, {
    authorizationId: activeGrant.authorizationId,
    taskId,
    planVersionId: activeConfirmedId,
    actionType: "local_artifact_write",
  });
  if (!authGate.ok) {
    return {
      ok: false,
      code: authGate.code,
      message: authGate.message,
      plan: confirmedPlan,
    };
  }

  if (typeof ctx.reconcilePackagesForTask === "function") {
    await ctx.reconcilePackagesForTask(userData, taskId);
  }
  const prepared = await prepareDeliverablePackage(
    userData,
    { taskId },
    {
      getTask: ctx.getTask,
      getPlan: ctx.getPlan,
      saveTaskExecution: ctx.saveTaskExecution,
    }
  );
  if (!prepared.ok) {
    return {
      ok: false,
      code: prepared.code || "prepare_failed",
      message: prepared.message || "无法开始生成。",
      plan: confirmedPlan,
    };
  }

  const packageId = prepared.package && prepared.package.id;
  if (!packageId) {
    return { ok: false, code: "package_missing", message: "无法开始生成。" };
  }

  const generated = await deliverableGeneration.generateDeliverablePackage(
    userData,
    { packageId },
    { callModel, imageMode, packageDir: packageDir || null }
  );

  const view = packageStore.getPackageView(userData, packageId);
  const planView = ctx.buildDeliverablePlanView(
    confirmedPlan,
    (await ctx.getTask(userData, taskId)).task || null,
    { status: "ok" }
  );

  return {
    ok: !!generated.ok,
    code: generated.ok ? undefined : generated.code,
    message: generated.message || (generated.ok ? "成果已生成。" : "生成未完成。"),
    taskId,
    packageId,
    prepareOutcome: prepared.outcome,
    package: view.package || prepared.package,
    deliverables: view.deliverables || prepared.deliverables || [],
    versions: view.versions || {},
    artifacts: view.artifacts || {},
    generation: generated,
    planView,
    revision: planView.revision,
  };
}

module.exports = {
  confirmPlanAndGenerate,
  contentKey,
};

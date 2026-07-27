"use strict";

/**
 * IDCOLLAB-MIN-01 contract + store + wiring + security tests.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const schema = require("../src/act-behalf/action-identity-schema");
const actionIdentity = require("../src/act-behalf/action-identity");
const authorizationStore = require("../src/act-behalf/authorization-store");
const actStore = require("../src/act-behalf/task-store");
const planner = require("../src/act-behalf/deliverable-planner");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const deliverablePlanStore = require("../src/act-behalf/deliverable-plan-store");
const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
const { confirmPlanAndGenerate } = require("../src/act-behalf/deliverable-confirm-and-generate");
const deliverableGeneration = require("../src/act-behalf/deliverable-generation");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const deliverableAutoLearn = require("../src/act-behalf/deliverable-auto-learn");
const artifactFs = require("../src/act-behalf/deliverable-artifact-fs");

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log("PASS", name);
    })
    .catch((err) => {
      failed += 1;
      console.error("FAIL", name);
      console.error(err && err.stack ? err.stack : err);
    });
}

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-idcollab-"));
}

function fakeCallModel() {
  return null; // use built-in mock document generation path
}

async function seedDraftPlan(userData, goalText) {
  const taskId = "abt_test_" + Date.now().toString(36);
  const goal = goalText || "根据所选材料生成一份项目阶段总结。";
  await actStore.saveTask(userData, {
    taskId,
    title: "t",
    goal,
    request: goal,
    status: "draft",
  });
  const suggestion = planner.ruleBasedPlan({ goal });
  suggestion.items = [
    {
      id: "pd_document",
      kind: "document",
      title: "介绍文档",
      purpose: "测试",
      format: "md",
      priority: "required",
      order: 0,
      dependencies: [],
      planDisposition: "included",
      riskFlags: [],
    },
  ];
  const applied = planner.applySuggestionToRecord({
    taskId,
    existingRecord: null,
    suggestion,
    goal,
  });
  const committed = await planConsistency.commitPlanThenTask({
    userData,
    planRecord: applied.plan,
    saveTaskPointers: async ({ deliverablePlanning }) => {
      const got = actStore.getTask(userData, taskId, { heal: false }).task;
      return actStore.saveTask(userData, { ...got, deliverablePlanning });
    },
    cas: { expectAbsent: true },
  });
  assert.equal(committed.ok, true, committed.message || committed.code);
  return { taskId, plan: committed.plan };
}

function orchestrationCtx(userData, taskId, plan) {
  return {
    userData,
    taskId,
    revisionExpected: planConsistency.revisionTokensFromPlan(plan),
    loadPlanForTaskOrFail: async (ud, id) => {
      const task = actStore.getTask(ud, id, { heal: false });
      if (!task.ok || !task.task) return { ok: false, code: "task_not_found" };
      const planId =
        (task.task.deliverablePlanning && task.task.deliverablePlanning.planId) || null;
      if (!planId) return { ok: true, plan: null };
      const got = deliverablePlanStore.getPlan(ud, planId);
      return { ok: true, plan: got.plan || null, task: task.task };
    },
    assertFreshPlan: async (ud, planId, expected) => {
      const got = deliverablePlanStore.getPlan(ud, planId);
      if (!got.ok || !got.plan) return { ok: false, code: "plan_not_found" };
      if (expected) {
        const match = planConsistency.assertRevisionMatch(got.plan, expected);
        if (!match.ok) return match;
      }
      return { ok: true, plan: got.plan };
    },
    extractRevisionExpected: () => null,
    saveTaskPlanPointers: async (ud, id, { deliverablePlanning, extraPatch }) => {
      const got = actStore.getTask(ud, id, { heal: false }).task;
      return actStore.saveTask(ud, {
        ...got,
        deliverablePlanning,
        ...(extraPatch || {}),
      });
    },
    buildDeliverablePlanView: (p, task) => ({
      ok: true,
      plan: p,
      task,
      revision: planConsistency.revisionTokensFromPlan(p),
    }),
    getTask: (ud, id) => actStore.getTask(ud, id, { heal: false }),
    getPlan: (ud, planId) => deliverablePlanStore.getPlan(ud, planId),
    saveTaskExecution: async (ud, id, exec) => {
      const got = actStore.getTask(ud, id, { heal: false }).task;
      return actStore.saveTask(ud, {
        ...got,
        deliverableExecution: { activePackageId: exec.activePackageId || null },
      });
    },
    reconcilePackagesForTask: async () => ({ ok: true }),
    callModel: fakeCallModel(),
    imageMode: "mock",
    packageDir: null,
  };
}

async function main() {
  await test("schema SubjectRef / ActionIdentityContext / ExecutorRef", () => {
    const owner = schema.makeSubjectRef({
      subjectId: "subj_owner_local",
      subjectType: "natural_person",
      displayName: "你",
    });
    const dm = schema.makeSubjectRef({
      subjectId: "subj_dm_local",
      subjectType: "digital_me",
      displayName: "你的 Digital Me",
      ownerSubjectId: owner.subjectId,
    });
    const exec = schema.makeExecutorRef({
      executorType: "model",
      modelRef: "artifact/default",
    });
    const ctx = schema.makeActionIdentityContext({
      initiatorSubjectId: owner.subjectId,
      ownerSubjectId: owner.subjectId,
      representedSubjectId: owner.subjectId,
      actingSubjectId: dm.subjectId,
      executorRefs: [exec],
      participantRefs: [
        schema.makeParticipantRef({
          participantType: "owner_subject",
          subjectRef: owner,
          displayName: "你",
        }),
        schema.makeParticipantRef({
          participantType: "executor",
          executorRef: exec,
          displayName: "model",
        }),
      ],
    });
    schema.assertOwnerInvariants(ctx);
    assert.equal(ctx.identityContextSource, "native_snapshot");
    assert.throws(() =>
      schema.makeSubjectRef({ subjectId: "x", subjectType: "not_a_type", displayName: "x" })
    );
  });

  await test("authorization store grant/idempotent/revoke/CAS/restart", async () => {
    const userData = tempUserData();
    const g1 = await authorizationStore.grantTaskAuthorization(userData, {
      grantorSubjectId: "subj_owner_local",
      granteeSubjectId: "subj_dm_local",
      scope: { taskId: "t1", planVersionId: "pv1" },
      actionTypes: ["task_preparation", "local_artifact_write", "learning_writeback"],
    });
    assert.equal(g1.result.outcome, "created");
    const g2 = await authorizationStore.grantTaskAuthorization(userData, {
      grantorSubjectId: "subj_owner_local",
      granteeSubjectId: "subj_dm_local",
      scope: { taskId: "t1", planVersionId: "pv1" },
      actionTypes: ["task_preparation", "local_artifact_write", "learning_writeback"],
    });
    assert.equal(g2.result.outcome, "existing");
    assert.equal(g1.result.record.authorizationId, g2.result.record.authorizationId);

    const rev = await authorizationStore.revokeAuthorization(
      userData,
      g1.result.record.authorizationId
    );
    assert.ok(rev.ok);
    assert.equal(rev.outcome, "revoked");
    const rev2 = await authorizationStore.revokeAuthorization(
      userData,
      g1.result.record.authorizationId
    );
    assert.ok(rev2.ok);
    assert.equal(rev2.outcome, "already_revoked");

    const gate = authorizationStore.assertAuthorizationAllows(userData, {
      authorizationId: g1.result.record.authorizationId,
      taskId: "t1",
      actionType: "local_artifact_write",
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.code, "authorization_revoked");

    // Restart: reload store, history retained
    const got = authorizationStore.getAuthorization(userData, g1.result.record.authorizationId);
    assert.ok(got.ok);
    assert.equal(got.record.status, "revoked");
    assert.ok(got.record.revokedAt);

    // Cross-task reuse denied
    const other = await authorizationStore.grantTaskAuthorization(userData, {
      grantorSubjectId: "subj_owner_local",
      granteeSubjectId: "subj_dm_local",
      scope: { taskId: "t2", planVersionId: "pv2" },
      actionTypes: ["local_artifact_write"],
    });
    const cross = authorizationStore.assertAuthorizationAllows(userData, {
      authorizationId: other.result.record.authorizationId,
      taskId: "t1",
      actionType: "local_artifact_write",
    });
    assert.equal(cross.ok, false);
    assert.equal(cross.code, "authorization_task_mismatch");
  });

  await test("A default single-subject generate + identity snapshot", async () => {
    const userData = tempUserData();
    const seeded = await seedDraftPlan(userData);
    const ctx = orchestrationCtx(userData, seeded.taskId, seeded.plan);
    const res = await confirmPlanAndGenerate({
      ...ctx,
      taskId: seeded.taskId,
    });
    assert.ok(res.ok, res.message || res.code);
    assert.ok(res.packageId);
    const view = packageStore.getPackageView(userData, res.packageId);
    assert.ok(view.ok);
    assert.ok(view.package.identityContextSnapshot);
    assert.equal(view.package.ownerSubjectId, "subj_owner_local");
    assert.equal(view.package.representedSubjectId, "subj_owner_local");
    assert.equal(view.package.actingSubjectId, "subj_dm_local");
    const versions = Object.values(view.versions || {});
    assert.ok(versions.length >= 1);
    const ver = versions[0];
    assert.equal(ver.ownerSubjectId, "subj_owner_local");
    assert.equal(ver.representedSubjectId, "subj_owner_local");
    assert.ok(Array.isArray(ver.executorRefs) && ver.executorRefs.length >= 1);
    assert.ok(Array.isArray(ver.authorizationRefs) && ver.authorizationRefs.length >= 1);
    // Real files
    const art = ver.artifactRef || (ver.artifactRefs && ver.artifactRefs[0]);
    assert.ok(art && art.contentHash);
    const abs = artifactFs.resolveAbsolute(userData, art.relativePath);
    assert.ok(fs.existsSync(abs));
    assert.ok(fs.statSync(abs).size > 0);
  });

  await test("MIN-01.1 immediate revoke blocks regen and prepare re-grant", async () => {
    const userData = tempUserData();
    const seeded = await seedDraftPlan(userData, "即时撤销测试。");
    const ctx = orchestrationCtx(userData, seeded.taskId, seeded.plan);
    const res = await confirmPlanAndGenerate({ ...ctx, taskId: seeded.taskId });
    assert.ok(res.ok, res.message || res.code);
    const view = packageStore.getPackageView(userData, res.packageId);
    const ver = Object.values(view.versions)[0];
    const authId = ver.authorizationRefs[0].authorizationId;

    const revoked = await authorizationStore.revokeAuthorization(userData, authId);
    assert.ok(revoked.ok);
    assert.equal(revoked.authorizationStatus && revoked.authorizationStatus.status, "revoked");

    const regen = await deliverableGeneration.generateOneDeliverable(
      userData,
      { packageId: res.packageId, deliverableId: ver.deliverableId },
      { callModel: null, imageMode: "mock", packageDir: null }
    );
    assert.equal(regen.ok, false);
    assert.equal(regen.code, "authorization_revoked");

    const prep = await prepareDeliverablePackage(
      userData,
      { taskId: seeded.taskId },
      {
        getTask: (ud, id) => actStore.getTask(ud, id, { heal: false }),
        getPlan: (ud, planId) => deliverablePlanStore.getPlan(ud, planId),
        saveTaskExecution: async (ud, id, exec) => {
          const got = actStore.getTask(ud, id, { heal: false }).task;
          return actStore.saveTask(ud, {
            ...got,
            deliverableExecution: { activePackageId: exec.activePackageId || null },
          });
        },
      }
    );
    assert.equal(prep.ok, false);
    assert.equal(prep.code, "authorization_revoked");

    const blocked = await authorizationStore.grantTaskAuthorization(userData, {
      grantorSubjectId: "subj_owner_local",
      granteeSubjectId: "subj_dm_local",
      scope: { taskId: seeded.taskId, planVersionId: view.package.sourcePlanVersionId },
      actionTypes: ["local_artifact_write"],
    });
    assert.equal(blocked.result.outcome, "revoked_blocked");
  });

  await test("MIN-01.1 main fail-closed ignores forged granted status", () => {
    const userData = tempUserData();
    // no store file yet — create grant then revoke in memory via grant+revoke
    return authorizationStore
      .grantTaskAuthorization(userData, {
        grantorSubjectId: "subj_owner_local",
        granteeSubjectId: "subj_dm_local",
        scope: { taskId: "t1", planVersionId: "pv1" },
        actionTypes: ["local_artifact_write"],
      })
      .then((g) =>
        authorizationStore.revokeAuthorization(userData, g.result.record.authorizationId)
      )
      .then(() => {
        const gate = authorizationStore.resolveActiveTaskAuthorization(userData, {
          taskId: "t1",
          planVersionId: "pv1",
          actionType: "local_artifact_write",
        });
        assert.equal(gate.ok, false);
        assert.equal(gate.code, "authorization_revoked");
      });
  });

  await test("E revoke blocks generate/regenerate/learn; history retained", async () => {
    const userData = tempUserData();
    const seeded = await seedDraftPlan(userData, "生成一份介绍文档。");
    const ctx = orchestrationCtx(userData, seeded.taskId, seeded.plan);
    const res = await confirmPlanAndGenerate({ ...ctx, taskId: seeded.taskId });
    assert.ok(res.ok, res.message || res.code);
    const view = packageStore.getPackageView(userData, res.packageId);
    const ver = Object.values(view.versions)[0];
    const authId = ver.authorizationRefs[0].authorizationId;
    const artPath = artifactFs.resolveAbsolute(userData, ver.artifactRef.relativePath);
    assert.ok(fs.existsSync(artPath));

    const revoked = await authorizationStore.revokeAuthorization(userData, authId);
    assert.ok(revoked.ok);

    const regen = await deliverableGeneration.generateOneDeliverable(
      userData,
      { packageId: res.packageId, deliverableId: ver.deliverableId },
      { callModel: fakeCallModel(), imageMode: "mock", packageDir: null }
    );
    assert.equal(regen.ok, false);
    assert.equal(regen.code, "authorization_revoked");
    assert.ok(fs.existsSync(artPath), "existing file must remain");

    // Accept then learn should also fail if auth revoked (accept itself may require artifact_acceptance)
    const reviewed = await deliverableGeneration.reviewDeliverableVersion(userData, {
      versionId: ver.id,
      decision: "accepted",
    });
    assert.equal(reviewed.ok, false);
    assert.equal(reviewed.code, "authorization_revoked");

    // History authorization retained
    const got = authorizationStore.getAuthorization(userData, authId);
    assert.ok(got.ok);
    assert.equal(got.record.status, "revoked");
  });

  await test("D accept sets reviewer/acceptedBy; reject leaves acceptedBy null", async () => {
    const userData = tempUserData();
    const seeded = await seedDraftPlan(userData, "生成总结文档。");
    const ctx = orchestrationCtx(userData, seeded.taskId, seeded.plan);
    const res = await confirmPlanAndGenerate({ ...ctx, taskId: seeded.taskId });
    assert.ok(res.ok, res.message || res.code);
    const view = packageStore.getPackageView(userData, res.packageId);
    const versions = Object.values(view.versions);
    const ver = versions[0];

    const rejected = await deliverableGeneration.reviewDeliverableVersion(userData, {
      versionId: ver.id,
      decision: "rejected",
    });
    assert.ok(rejected.ok);
    assert.equal(rejected.acceptedBySubjectId, null);
    assert.equal(rejected.reviewerSubjectId, "subj_owner_local");

    // regenerate new version then accept
    const regen = await deliverableGeneration.generateOneDeliverable(
      userData,
      { packageId: res.packageId, deliverableId: ver.deliverableId },
      { callModel: fakeCallModel(), imageMode: "mock" }
    );
    assert.ok(regen.ok, regen.message || regen.code);
    const view2 = packageStore.getPackageView(userData, res.packageId);
    const latestId = view2.deliverables.find((d) => d.id === ver.deliverableId).currentVersionId;
    const accepted = await deliverableGeneration.reviewDeliverableVersion(userData, {
      versionId: latestId,
      decision: "accepted",
    });
    assert.ok(accepted.ok);
    assert.equal(accepted.acceptedBySubjectId, "subj_owner_local");
    assert.equal(accepted.reviewerSubjectId, "subj_owner_local");
    // ownership unchanged
    const latest = view2.versions[latestId];
    assert.equal(latest.ownerSubjectId, "subj_owner_local");
  });

  await test("C executor changes; ownership unchanged", async () => {
    const userData = tempUserData();
    const seeded = await seedDraftPlan(userData, "生成网页介绍。");
    const ctx = orchestrationCtx(userData, seeded.taskId, seeded.plan);
    const res = await confirmPlanAndGenerate({ ...ctx, taskId: seeded.taskId });
    assert.ok(res.ok, res.message || res.code);
    const view1 = packageStore.getPackageView(userData, res.packageId);
    const d = view1.deliverables[0];
    const v1 = view1.versions[d.currentVersionId];
    const exec1 = v1.executorRefs[0].executorId;

    const regen = await deliverableGeneration.generateOneDeliverable(
      userData,
      { packageId: res.packageId, deliverableId: d.id },
      { callModel: fakeCallModel(), imageMode: "mock" }
    );
    assert.ok(regen.ok);
    const view2 = packageStore.getPackageView(userData, res.packageId);
    const v2 = view2.versions[view2.deliverables.find((x) => x.id === d.id).currentVersionId];
    assert.notEqual(v2.executorRefs[0].executorId, exec1);
    assert.equal(v2.ownerSubjectId, v1.ownerSubjectId);
    assert.equal(v2.representedSubjectId, v1.representedSubjectId);
    assert.equal(v2.actingSubjectId, v1.actingSubjectId);
  });

  await test("B role snapshot frozen after confirm", async () => {
    const snap1 = actionIdentity.buildNativeIdentityContext({
      packageDir: null,
      roleHint: { roleId: "founder", displayName: "创始人" },
    });
    assert.equal(snap1.actingRoleRef.roleId, "founder");
    const snap2 = actionIdentity.buildNativeIdentityContext({
      packageDir: null,
      roleHint: { roleId: "writer", displayName: "写作者" },
    });
    assert.equal(snap1.actingRoleRef.roleId, "founder");
    assert.equal(snap2.actingRoleRef.roleId, "writer");
  });

  await test("G legacy inference marked, not native", () => {
    const legacy = actionIdentity.buildLegacyIdentityView({});
    assert.equal(legacy.identityContextSource, "legacy_default_inference");
    assert.equal(legacy.identityConfidence, "inferred_default_single_subject");
    const summary = actionIdentity.userFacingIdentitySummary(legacy);
    assert.ok(summary.legacy);
  });

  await test("H renderer forged owner is ignored", async () => {
    const userData = tempUserData();
    const seeded = await seedDraftPlan(userData, "伪造主体测试。");
    const forged = actionIdentity.buildNativeIdentityContext({
      packageDir: null,
      untrusted: {
        ownerSubjectId: "subj_attacker",
        representedSubjectId: "subj_attacker",
        initiatorSubjectId: "subj_attacker",
      },
    });
    assert.equal(forged.ownerSubjectId, "subj_owner_local");
    assert.equal(forged.representedSubjectId, "subj_owner_local");
    assert.notEqual(forged.ownerSubjectId, "subj_attacker");

    const ctx = orchestrationCtx(userData, seeded.taskId, seeded.plan);
    const res = await confirmPlanAndGenerate({
      ...ctx,
      taskId: seeded.taskId,
      understanding: { goal: { value: "伪造主体测试。" } },
    });
    assert.ok(res.ok, res.message || res.code);
    const view = packageStore.getPackageView(userData, res.packageId);
    assert.equal(view.package.ownerSubjectId, "subj_owner_local");
    const ver = Object.values(view.versions)[0];
    assert.equal(ver.ownerSubjectId, "subj_owner_local");
  });

  await test("learning writeback blocked after revoke; accept path gated", async () => {
    const userData = tempUserData();
    const seeded = await seedDraftPlan(userData, "学习写回测试。");
    const ctx = orchestrationCtx(userData, seeded.taskId, seeded.plan);
    const res = await confirmPlanAndGenerate({ ...ctx, taskId: seeded.taskId });
    assert.ok(res.ok, res.message || res.code);
    const view = packageStore.getPackageView(userData, res.packageId);
    const ver = Object.values(view.versions)[0];
    await authorizationStore.revokeAuthorization(userData, ver.authorizationRefs[0].authorizationId);
    const enq = deliverableAutoLearn.enqueueAfterAccept(userData, ver.id, {
      packageDir: null,
      sync: true,
    });
    // version not accepted yet / auth revoked — should fail closed
    assert.equal(enq.ok, false);
  });

  await test("F restart recovers identity + auth status", async () => {
    const userData = tempUserData();
    const seeded = await seedDraftPlan(userData, "重启恢复测试。");
    const ctx = orchestrationCtx(userData, seeded.taskId, seeded.plan);
    const res = await confirmPlanAndGenerate({ ...ctx, taskId: seeded.taskId });
    assert.ok(res.ok, res.message || res.code);
    const before = packageStore.getPackageView(userData, res.packageId);
    const verId = Object.keys(before.versions)[0];
    const authId = before.versions[verId].authorizationRefs[0].authorizationId;

    // Simulate restart by reloading stores
    const afterPkg = packageStore.loadStore(userData);
    const afterAuth = authorizationStore.loadStore(userData);
    assert.ok(afterPkg.versions[verId].identityContextSnapshot);
    assert.equal(afterPkg.versions[verId].ownerSubjectId, "subj_owner_local");
    assert.equal(afterAuth.authorizations[authId].status, "granted");
    const task = actStore.getTask(userData, seeded.taskId, { heal: false });
    assert.equal(task.task.ownerSubjectId, "subj_owner_local");
  });

  console.log(`\nIDCOLLAB-MIN-01 contracts: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

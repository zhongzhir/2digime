"use strict";

/**
 * IDCOLLAB-MIN-01 — Action Identity helpers.
 * Builds immutable ActionIdentityContext snapshots from Owner defaults.
 * Renderer-supplied owner/representedSubject values are ignored.
 */

const path = require("node:path");
const {
  DEFAULT_RESPONSIBILITY_BOUNDARY,
  makeSubjectRef,
  makeParticipantRef,
  makeExecutorRef,
  makeActionIdentityContext,
  makeAuthorizationRef,
  assertOwnerInvariants,
  clone,
  newId,
  nowIso,
} = require("./action-identity-schema");
const authorizationStore = require("./authorization-store");

const STABLE_OWNER_SUBJECT_ID = "subj_owner_local";
const STABLE_DM_SUBJECT_ID = "subj_dm_local";

function resolveDid(packageDir) {
  if (!packageDir) return null;
  try {
    const identity = require("../identity").loadOrCreateIdentity(packageDir);
    return identity && identity.did ? String(identity.did) : null;
  } catch {
    return null;
  }
}

function resolveActingRole(packageDir, roleHint) {
  if (roleHint && typeof roleHint === "object" && roleHint.roleId) {
    return {
      roleId: String(roleHint.roleId),
      displayName: String(roleHint.displayName || roleHint.roleLabel || roleHint.roleId),
    };
  }
  if (!packageDir) {
    return { roleId: "default_self", displayName: "默认本人模式" };
  }
  try {
    const roleView = require("../identity/role-view");
    const role = roleView.getCurrentRole(packageDir);
    if (role && role.id) {
      return { roleId: String(role.id), displayName: String(role.label || role.id) };
    }
  } catch {
    /* ignore */
  }
  return { roleId: "default_self", displayName: "默认本人模式" };
}

/**
 * Build authoritative single-subject defaults.
 * Any renderer-provided owner/representedSubject is ignored.
 */
function buildDefaultSubjects(packageDir) {
  const did = resolveDid(packageDir);
  const identityRef = did ? { kind: "did_dme", refId: did } : null;
  const owner = makeSubjectRef({
    subjectId: STABLE_OWNER_SUBJECT_ID,
    subjectType: "natural_person",
    displayName: "你",
    identityRef,
    ownerSubjectId: STABLE_OWNER_SUBJECT_ID,
    localOnly: true,
  });
  const digitalMe = makeSubjectRef({
    subjectId: STABLE_DM_SUBJECT_ID,
    subjectType: "digital_me",
    displayName: "你的 Digital Me",
    identityRef,
    ownerSubjectId: STABLE_OWNER_SUBJECT_ID,
    localOnly: true,
  });
  return { owner, digitalMe };
}

function buildParticipantRefs({ owner, digitalMe, actingRole, executorRefs }) {
  const participants = [
    makeParticipantRef({
      participantId: newId("part_"),
      participantType: "initiator_subject",
      subjectRef: owner,
      displayName: owner.displayName,
      role: null,
      participationScope: ["initiate"],
      responsibilityScope: ["owner_decision_required"],
    }),
    makeParticipantRef({
      participantId: newId("part_"),
      participantType: "owner_subject",
      subjectRef: owner,
      displayName: owner.displayName,
      role: null,
      participationScope: ["own"],
      responsibilityScope: ["owner_decision_required"],
    }),
    makeParticipantRef({
      participantId: newId("part_"),
      participantType: "represented_subject",
      subjectRef: owner,
      displayName: owner.displayName,
      role: actingRole && actingRole.roleId,
      participationScope: ["represent"],
      responsibilityScope: ["owner_decision_required"],
    }),
    makeParticipantRef({
      participantId: newId("part_"),
      participantType: "acting_subject",
      subjectRef: digitalMe,
      displayName: digitalMe.displayName,
      role: actingRole && actingRole.roleId,
      participationScope: ["plan", "generate", "review_prepare"],
      responsibilityScope: ["digital_me_preparation_only"],
    }),
  ];
  for (const ex of executorRefs || []) {
    participants.push(
      makeParticipantRef({
        participantId: newId("part_"),
        participantType: "executor",
        executorRef: ex,
        displayName: ex.modelRef || ex.toolRef || ex.skillRef || ex.executorType,
        participationScope: ["execute"],
        responsibilityScope: ["executor_technical_execution"],
      })
    );
  }
  return participants;
}

function makeDefaultModelExecutor(extra) {
  return makeExecutorRef({
    executorId: newId("exec_"),
    executorType: "model",
    provider: "local_route",
    capabilityRef: "artifact_generation",
    modelRef: (extra && extra.modelRef) || "artifact/default",
    runtimeRef: "main_process",
    version: (extra && extra.version) || "route_v1",
    locality: "local",
  });
}

/**
 * Create immutable ActionIdentityContext at planConfirmed.
 * Ignores any untrusted renderer identity fields in `untrusted`.
 */
function buildNativeIdentityContext({
  packageDir,
  roleHint,
  executorRefs,
  authorizationRefs,
  untrusted,
}) {
  // Security: ignore renderer-supplied owner / representedSubject.
  void untrusted;
  const { owner, digitalMe } = buildDefaultSubjects(packageDir);
  const actingRole = resolveActingRole(packageDir, roleHint);
  const execs =
    Array.isArray(executorRefs) && executorRefs.length
      ? executorRefs.map(clone)
      : [];
  const ctx = makeActionIdentityContext({
    identityContextSource: "native_snapshot",
    initiatorSubjectId: owner.subjectId,
    ownerSubjectId: owner.subjectId,
    representedSubjectId: owner.subjectId,
    actingSubjectId: digitalMe.subjectId,
    actingRoleRef: actingRole,
    participantRefs: buildParticipantRefs({
      owner,
      digitalMe,
      actingRole,
      executorRefs: execs,
    }),
    executorRefs: execs,
    authorizationRefs: Array.isArray(authorizationRefs) ? authorizationRefs.map(clone) : [],
    responsibilityBoundary: DEFAULT_RESPONSIBILITY_BOUNDARY.slice(),
  });
  assertOwnerInvariants(ctx);
  return ctx;
}

function buildLegacyIdentityView(opts) {
  const packageDir = opts && opts.packageDir;
  const { owner, digitalMe } = buildDefaultSubjects(packageDir);
  const actingRole = resolveActingRole(packageDir, opts && opts.roleHint);
  const ctx = makeActionIdentityContext({
    identityContextSource: "legacy_default_inference",
    identityConfidence: "inferred_default_single_subject",
    initiatorSubjectId: owner.subjectId,
    ownerSubjectId: owner.subjectId,
    representedSubjectId: owner.subjectId,
    actingSubjectId: digitalMe.subjectId,
    actingRoleRef: actingRole,
    participantRefs: buildParticipantRefs({
      owner,
      digitalMe,
      actingRole,
      executorRefs: [],
    }),
    executorRefs: [],
    authorizationRefs: [],
    responsibilityBoundary: DEFAULT_RESPONSIBILITY_BOUNDARY.slice(),
  });
  assertOwnerInvariants(ctx);
  return ctx;
}

/**
 * Ensure plan confirmed path has authorization + identity snapshot.
 */
async function ensurePlanConfirmationIdentity(userData, {
  taskId,
  planVersionId,
  packageDir,
  roleHint,
  confirmationRef,
  untrusted,
}) {
  const grant = await authorizationStore.grantTaskAuthorization(userData, {
    grantorSubjectId: STABLE_OWNER_SUBJECT_ID,
    granteeSubjectId: STABLE_DM_SUBJECT_ID,
    scope: {
      taskId,
      planVersionId,
      materialRefs: [],
      outputRoot: "userData/deliverable-artifacts",
      oneTime: false,
    },
    resourceRefs: ["task:" + String(taskId), "planVersion:" + String(planVersionId)],
    actionTypes: [
      "task_preparation",
      "source_read",
      "model_processing",
      "local_artifact_write",
      "artifact_acceptance",
      "learning_writeback",
    ],
    confirmationRef: confirmationRef || "confirm:plan:" + String(planVersionId),
    status: "granted",
  });
  const record = grant.result.record;
  const authRef = authorizationStore.toAuthorizationRef(record);
  const identityContextSnapshot = buildNativeIdentityContext({
    packageDir,
    roleHint,
    authorizationRefs: [authRef],
    untrusted,
  });
  return {
    ok: true,
    authorization: record,
    authorizationRef: authRef,
    identityContextSnapshot,
    outcome: grant.result.outcome,
  };
}

function attachExecutorToSnapshot(snapshot, executorRef) {
  const next = clone(snapshot || {});
  next.executorRefs = Array.isArray(next.executorRefs) ? next.executorRefs.slice() : [];
  next.executorRefs.push(clone(executorRef));
  const owner = makeSubjectRef({
    subjectId: next.ownerSubjectId,
    subjectType: "natural_person",
    displayName: "你",
    ownerSubjectId: next.ownerSubjectId,
  });
  const digitalMe = makeSubjectRef({
    subjectId: next.actingSubjectId,
    subjectType: "digital_me",
    displayName: "你的 Digital Me",
    ownerSubjectId: next.ownerSubjectId,
  });
  next.participantRefs = buildParticipantRefs({
    owner,
    digitalMe,
    actingRole: next.actingRoleRef,
    executorRefs: next.executorRefs,
  });
  next.createdAt = next.createdAt || nowIso();
  assertOwnerInvariants(next);
  return next;
}

function taskIdentityCacheFromSnapshot(snapshot) {
  if (!snapshot) {
    return {
      identityContextRef: null,
      initiatorSubjectId: null,
      ownerSubjectId: null,
      representedSubjectId: null,
    };
  }
  return {
    identityContextRef: snapshot.identityContextId || null,
    initiatorSubjectId: snapshot.initiatorSubjectId || null,
    ownerSubjectId: snapshot.ownerSubjectId || null,
    representedSubjectId: snapshot.representedSubjectId || null,
  };
}

function resolveIdentityForVersion(version, packageDir) {
  if (version && version.identityContextSnapshot) {
    return clone(version.identityContextSnapshot);
  }
  if (version && version.provenance && version.provenance.identityContextSnapshot) {
    return clone(version.provenance.identityContextSnapshot);
  }
  return buildLegacyIdentityView({ packageDir });
}

function userFacingIdentitySummary(snapshot) {
  const role =
    snapshot && snapshot.actingRoleRef && snapshot.actingRoleRef.displayName
      ? snapshot.actingRoleRef.displayName
      : "默认本人模式";
  const exec =
    snapshot &&
    Array.isArray(snapshot.executorRefs) &&
    snapshot.executorRefs[0] &&
    (snapshot.executorRefs[0].modelRef || snapshot.executorRefs[0].executorType);
  return {
    headline: "由你的 Digital Me 代表你生成",
    ownership: "成果归你所有",
    confirmation: "最终由你确认",
    roleLabel: role,
    executorLabel: exec ? "执行能力：当前模型与文档工具" : "执行能力：当前可用能力",
    identityContextSource: snapshot && snapshot.identityContextSource,
    legacy:
      snapshot && snapshot.identityContextSource === "legacy_default_inference"
        ? "此记录按兼容默认推断展示，不是原始完整授权落盘。"
        : null,
  };
}

function authorizationSummary(record) {
  if (!record) {
    return { statusLabel: "无授权记录", canRevoke: false };
  }
  const eff = authorizationStore.deriveEffectiveStatus(record);
  const labels = {
    granted: "已授权（本地成果生成与学习）",
    revoked: "已撤销",
    expired: "已过期",
    proposed: "待授权",
    consumed: "已使用完毕",
    denied: "未获准",
  };
  return {
    authorizationId: record.authorizationId,
    status: eff,
    statusLabel: labels[eff] || eff,
    canRevoke: eff === "granted",
    scopeSummary: "仅限本任务与已确认计划版本",
  };
}

module.exports = {
  STABLE_OWNER_SUBJECT_ID,
  STABLE_DM_SUBJECT_ID,
  buildDefaultSubjects,
  buildNativeIdentityContext,
  buildLegacyIdentityView,
  ensurePlanConfirmationIdentity,
  attachExecutorToSnapshot,
  taskIdentityCacheFromSnapshot,
  resolveIdentityForVersion,
  userFacingIdentitySummary,
  authorizationSummary,
  makeDefaultModelExecutor,
  resolveActingRole,
};

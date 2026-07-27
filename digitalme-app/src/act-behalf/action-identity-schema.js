"use strict";

/**
 * IDCOLLAB-MIN-01 — Action Identity & Authorization schemas.
 * Spec: digitalme_phase1_task_IDCOLLAB-MIN-01_action_identity_and_authorization_v0.1.md
 */

const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;

const SUBJECT_TYPES = Object.freeze([
  "natural_person",
  "digital_me",
  "role",
  "organization",
  "external_agent",
  "system",
]);

const PARTICIPANT_TYPES = Object.freeze([
  "initiator_subject",
  "owner_subject",
  "represented_subject",
  "acting_subject",
  "reviewer_subject",
  "acceptor_subject",
  "executor",
  "tool",
  "skill",
  "system_guard",
]);

const EXECUTOR_TYPES = Object.freeze([
  "model",
  "skill",
  "tool",
  "local_runtime",
  "coding_agent",
  "human",
  "composite_executor",
]);

const ACTION_TYPES = Object.freeze([
  "task_preparation",
  "source_read",
  "model_processing",
  "local_artifact_write",
  "artifact_acceptance",
  "learning_writeback",
  "external_send",
  "publish",
  "payment",
  "contract",
  "data_share",
]);

const LOCAL_ACTION_TYPES = Object.freeze([
  "task_preparation",
  "source_read",
  "model_processing",
  "local_artifact_write",
  "artifact_acceptance",
  "learning_writeback",
]);

const AUTH_STATUSES = Object.freeze([
  "proposed",
  "granted",
  "revoked",
  "expired",
  "consumed",
  "denied",
]);

const DEFAULT_RESPONSIBILITY_BOUNDARY = Object.freeze([
  "owner_decision_required",
  "digital_me_preparation_only",
  "executor_technical_execution",
  "no_external_commitment",
  "no_payment",
  "no_publication",
]);

const IDENTITY_SOURCES = Object.freeze([
  "native_snapshot",
  "legacy_default_inference",
]);

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return (
    String(prefix || "id_") +
    Date.now().toString(36) +
    "_" +
    crypto.randomBytes(4).toString("hex")
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeSubjectRef({
  subjectId,
  subjectType,
  displayName,
  identityRef,
  ownerSubjectId,
  localOnly,
}) {
  const type = String(subjectType || "");
  if (!SUBJECT_TYPES.includes(type)) {
    const e = new Error("subjectType 无效。");
    e.code = "invalid_subject_type";
    throw e;
  }
  return {
    subjectId: String(subjectId || ""),
    subjectType: type,
    displayName: String(displayName || ""),
    identityRef: identityRef && typeof identityRef === "object" ? clone(identityRef) : null,
    ownerSubjectId: ownerSubjectId ? String(ownerSubjectId) : String(subjectId || ""),
    localOnly: localOnly !== false,
  };
}

function makeParticipantRef({
  participantId,
  participantType,
  subjectRef,
  executorRef,
  displayName,
  role,
  participationScope,
  responsibilityScope,
}) {
  const type = String(participantType || "");
  if (!PARTICIPANT_TYPES.includes(type)) {
    const e = new Error("participantType 无效。");
    e.code = "invalid_participant_type";
    throw e;
  }
  const isExecutorish = type === "executor" || type === "tool" || type === "skill";
  if (isExecutorish && !executorRef) {
    const e = new Error("执行参与者必须包含 executorRef。");
    e.code = "executor_ref_required";
    throw e;
  }
  if (!isExecutorish && !subjectRef) {
    const e = new Error("主体参与者必须包含 subjectRef。");
    e.code = "subject_ref_required";
    throw e;
  }
  return {
    participantId: String(participantId || newId("part_")),
    participantType: type,
    subjectRef: subjectRef ? clone(subjectRef) : null,
    executorRef: executorRef ? clone(executorRef) : null,
    displayName: String(displayName || ""),
    role: role != null ? String(role) : null,
    participationScope: Array.isArray(participationScope) ? participationScope.map(String) : [],
    responsibilityScope: Array.isArray(responsibilityScope)
      ? responsibilityScope.map(String)
      : [],
  };
}

function makeExecutorRef({
  executorId,
  executorType,
  provider,
  capabilityRef,
  modelRef,
  skillRef,
  toolRef,
  runtimeRef,
  version,
  locality,
}) {
  const type = String(executorType || "");
  if (!EXECUTOR_TYPES.includes(type)) {
    const e = new Error("executorType 无效。");
    e.code = "invalid_executor_type";
    throw e;
  }
  return {
    executorId: String(executorId || newId("exec_")),
    executorType: type,
    provider: provider != null ? String(provider) : null,
    capabilityRef: capabilityRef != null ? String(capabilityRef) : null,
    modelRef: modelRef != null ? String(modelRef) : null,
    skillRef: skillRef != null ? String(skillRef) : null,
    toolRef: toolRef != null ? String(toolRef) : null,
    runtimeRef: runtimeRef != null ? String(runtimeRef) : "main_process",
    version: version != null ? String(version) : null,
    locality: locality != null ? String(locality) : "local",
  };
}

function makeAuthorizationRef({
  authorizationId,
  authorizationType,
  grantorSubjectId,
  granteeSubjectId,
  scope,
  resourceRefs,
  actionTypes,
  issuedAt,
  expiresAt,
  revokedAt,
  status,
  confirmationRef,
  policyRef,
}) {
  const statusValue = String(status || "granted");
  if (!AUTH_STATUSES.includes(statusValue)) {
    const e = new Error("authorization status 无效。");
    e.code = "invalid_auth_status";
    throw e;
  }
  const actions = Array.isArray(actionTypes) ? actionTypes.map(String) : [];
  for (const a of actions) {
    if (!ACTION_TYPES.includes(a)) {
      const e = new Error("actionType 无效：" + a);
      e.code = "invalid_action_type";
      throw e;
    }
  }
  return {
    authorizationId: String(authorizationId || ""),
    authorizationType: authorizationType ? String(authorizationType) : null,
    grantorSubjectId: String(grantorSubjectId || ""),
    granteeSubjectId: String(granteeSubjectId || ""),
    scope: scope && typeof scope === "object" ? clone(scope) : {},
    resourceRefs: Array.isArray(resourceRefs) ? resourceRefs.map(String) : [],
    actionTypes: actions,
    issuedAt: issuedAt ? String(issuedAt) : nowIso(),
    expiresAt: expiresAt ? String(expiresAt) : null,
    revokedAt: revokedAt ? String(revokedAt) : null,
    status: statusValue,
    confirmationRef: confirmationRef != null ? String(confirmationRef) : null,
    policyRef: policyRef != null ? String(policyRef) : null,
  };
}

function makeActionIdentityContext({
  identityContextId,
  identityContextSource,
  initiatorSubjectId,
  ownerSubjectId,
  representedSubjectId,
  actingSubjectId,
  actingRoleRef,
  participantRefs,
  executorRefs,
  authorizationRefs,
  responsibilityBoundary,
  createdAt,
  schemaVersion,
  identityConfidence,
}) {
  const source = String(identityContextSource || "native_snapshot");
  if (!IDENTITY_SOURCES.includes(source)) {
    const e = new Error("identityContextSource 无效。");
    e.code = "invalid_identity_source";
    throw e;
  }
  const owner = String(ownerSubjectId || "");
  const represented = String(representedSubjectId || "");
  const initiator = String(initiatorSubjectId || "");
  const acting = String(actingSubjectId || "");
  if (!owner || !represented || !initiator || !acting) {
    const e = new Error("ActionIdentityContext 缺少必填主体字段。");
    e.code = "identity_context_incomplete";
    throw e;
  }
  return {
    schemaVersion: Number(schemaVersion || SCHEMA_VERSION),
    identityContextId: String(identityContextId || newId("aic_")),
    identityContextSource: source,
    identityConfidence: identityConfidence != null ? String(identityConfidence) : null,
    initiatorSubjectId: initiator,
    ownerSubjectId: owner,
    representedSubjectId: represented,
    actingSubjectId: acting,
    actingRoleRef: actingRoleRef && typeof actingRoleRef === "object" ? clone(actingRoleRef) : null,
    participantRefs: Array.isArray(participantRefs) ? participantRefs.map(clone) : [],
    executorRefs: Array.isArray(executorRefs) ? executorRefs.map(clone) : [],
    authorizationRefs: Array.isArray(authorizationRefs) ? authorizationRefs.map(clone) : [],
    responsibilityBoundary: Array.isArray(responsibilityBoundary)
      ? responsibilityBoundary.map(String)
      : DEFAULT_RESPONSIBILITY_BOUNDARY.slice(),
    createdAt: createdAt ? String(createdAt) : nowIso(),
  };
}

function freezeSnapshot(ctx) {
  return Object.freeze(clone(ctx));
}

function assertOwnerInvariants(ctx) {
  if (!ctx || typeof ctx !== "object") {
    const e = new Error("缺少身份上下文。");
    e.code = "identity_context_required";
    throw e;
  }
  // Executor must never appear as owner/represented/acting subject ids in subject slots.
  for (const ex of ctx.executorRefs || []) {
    if (!ex || !ex.executorId) continue;
    if (
      ex.executorId === ctx.ownerSubjectId ||
      ex.executorId === ctx.representedSubjectId ||
      ex.executorId === ctx.actingSubjectId
    ) {
      const e = new Error("执行体不得成为主体归属字段。");
      e.code = "executor_subject_collision";
      throw e;
    }
  }
  return true;
}

module.exports = {
  SCHEMA_VERSION,
  SUBJECT_TYPES,
  PARTICIPANT_TYPES,
  EXECUTOR_TYPES,
  ACTION_TYPES,
  LOCAL_ACTION_TYPES,
  AUTH_STATUSES,
  DEFAULT_RESPONSIBILITY_BOUNDARY,
  IDENTITY_SOURCES,
  nowIso,
  newId,
  clone,
  makeSubjectRef,
  makeParticipantRef,
  makeExecutorRef,
  makeAuthorizationRef,
  makeActionIdentityContext,
  freezeSnapshot,
  assertOwnerInvariants,
};

"use strict";

/**
 * LEARN-LOOP-FIX-01: ProjectContextSet + ProjectKnowledgeClaim schemas.
 */

const CLAIM_TYPES = Object.freeze([
  "current_fact",
  "confirmed_decision",
  "current_status",
  "work_principle",
  "proposal",
  "historical_exploration",
  "rejected_direction",
  "future_direction",
  "external_inference",
]);

const AUTHORITY_LEVELS = Object.freeze([
  "owner_confirmed",
  "frozen_spec",
  "accepted_runtime_state",
  "current_project_record",
  "historical_record",
  "accepted_artifact",
  "external_inference",
  "model_generated",
]);

const AUTHORITY_RANK = Object.freeze({
  owner_confirmed: 100,
  frozen_spec: 90,
  accepted_runtime_state: 85,
  current_project_record: 80,
  accepted_artifact: 70,
  historical_record: 40,
  external_inference: 20,
  model_generated: 10,
});

const CONFIRMATION_STATUSES = Object.freeze([
  "owner_confirmed",
  "auto_adopted",
  "reinforced",
  "frozen",
  "accepted",
  "candidate",
  "pending_conflict",
  "rejected",
  "superseded",
]);

const PROJECT_IDS = Object.freeze({
  DIGITAL_ME: "project_digital_me",
});

const SCHEMA_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function newProjectContextId() {
  return "pctx_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function newClaimId() {
  return "pkc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

module.exports = {
  SCHEMA_VERSION,
  CLAIM_TYPES,
  AUTHORITY_LEVELS,
  AUTHORITY_RANK,
  CONFIRMATION_STATUSES,
  PROJECT_IDS,
  nowIso,
  newProjectContextId,
  newClaimId,
};

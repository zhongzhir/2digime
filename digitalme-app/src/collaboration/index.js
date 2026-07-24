"use strict";

/**
 * Collaboration — 主体协作闭环：邀请、授权、执行、交付、反馈。
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadOrCreateIdentity } = require("../identity");

function collaborationStorePath(packageDir) {
  return path.join(packageDir, "collaborations.json");
}

function loadCollaborationStore(packageDir) {
  const storePath = collaborationStorePath(packageDir);
  if (fs.existsSync(storePath)) {
    try {
      const raw = fs.readFileSync(storePath, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data.collaborations)) {
        return data;
      }
    } catch (err) {
      console.warn("[collaboration] failed to load collaborations.json:", err.message);
    }
  }
  return { collaborations: [], updatedAt: new Date().toISOString() };
}

function saveCollaborationStore(packageDir, store) {
  const storePath = collaborationStorePath(packageDir);
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  return store;
}

/**
 * Create a new collaboration.
 * @param {string} packageDir
 * @param {object} opts - { title, goal, role, collaboratorType, collaboratorName, scope, validDays }
 * @returns {object} { ok, collaboration }
 */
function createCollaboration(packageDir, opts = {}) {
  const title = String((opts && opts.title) || "").trim();
  const goal = String((opts && opts.goal) || "").trim();
  if (!title || !goal) {
    return { ok: false, message: "请填写协作标题和目标。" };
  }

  const identity = loadOrCreateIdentity(packageDir);
  const now = new Date();
  const validDays = typeof opts.validDays === "number" && opts.validDays > 0 ? opts.validDays : 30;
  const validUntil = new Date(now.getTime() + validDays * 86400000);

  const collaboration = {
    id: "collab_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex"),
    title,
    goal,
    role: String((opts && opts.role) || "founder").trim(),
    status: "invited", // invited -> active -> delivered -> completed / revoked
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    validUntil: validUntil.toISOString(),
    // 主体身份
    subject: {
      did: identity.did,
      role: String((opts && opts.role) || "founder").trim(),
    },
    // 协作方
    collaborator: {
      type: String((opts && opts.collaboratorType) || "agent").trim(), // agent / digitalme
      name: String((opts && opts.collaboratorName) || "外部协作方").trim(),
      capabilities: Array.isArray(opts && opts.collaboratorCapabilities) ? opts.collaboratorCapabilities : [],
    },
    // 授权范围
    authorization: {
      scope: String((opts && opts.scope) || "full").trim(),
      validDays,
      validUntil: validUntil.toISOString(),
      revoked: false,
      revokedAt: null,
    },
    // 协作过程
    interactions: [],
    // 交付物
    deliverables: [],
    // 反馈
    feedback: [],
  };

  const store = loadCollaborationStore(packageDir);
  store.collaborations.push(collaboration);
  saveCollaborationStore(packageDir, store);

  return { ok: true, collaboration };
}

/**
 * Add an interaction to a collaboration.
 * @param {string} packageDir
 * @param {string} collaborationId
 * @param {object} interaction - { type, content, actor }
 * @returns {object} { ok, collaboration }
 */
function addInteraction(packageDir, collaborationId, interaction) {
  const store = loadCollaborationStore(packageDir);
  const collab = store.collaborations.find((c) => c.id === collaborationId);
  if (!collab) {
    return { ok: false, message: "协作不存在。" };
  }

  collab.interactions.push({
    timestamp: new Date().toISOString(),
    type: String((interaction && interaction.type) || "message").trim(), // message / question / answer / delivery / confirmation
    actor: String((interaction && interaction.actor) || "subject").trim(), // subject / collaborator
    content: String((interaction && interaction.content) || "").trim(),
  });
  collab.updatedAt = new Date().toISOString();
  saveCollaborationStore(packageDir, store);

  return { ok: true, collaboration: collab };
}

/**
 * Add a deliverable to a collaboration.
 * @param {string} packageDir
 * @param {string} collaborationId
 * @param {object} deliverable - { title, content, sources, approvedBy }
 * @returns {object} { ok, collaboration }
 */
function addDeliverable(packageDir, collaborationId, deliverable) {
  const store = loadCollaborationStore(packageDir);
  const collab = store.collaborations.find((c) => c.id === collaborationId);
  if (!collab) {
    return { ok: false, message: "协作不存在。" };
  }

  collab.deliverables.push({
    timestamp: new Date().toISOString(),
    title: String((deliverable && deliverable.title) || "未命名交付物").trim(),
    content: String((deliverable && deliverable.content) || "").trim(),
    sources: Array.isArray(deliverable && deliverable.sources) ? deliverable.sources : [],
    approvedBy: String((deliverable && deliverable.approvedBy) || "pending").trim(), // pending / subject / collaborator
    approvedAt: deliverable && deliverable.approvedAt ? deliverable.approvedAt : null,
  });
  collab.status = "delivered";
  collab.updatedAt = new Date().toISOString();
  saveCollaborationStore(packageDir, store);

  return { ok: true, collaboration: collab };
}

/**
 * Approve a deliverable.
 * @param {string} packageDir
 * @param {string} collaborationId
 * @param {number} deliverableIndex
 * @param {string} approvedBy
 * @returns {object} { ok, collaboration }
 */
function approveDeliverable(packageDir, collaborationId, deliverableIndex, approvedBy) {
  const store = loadCollaborationStore(packageDir);
  const collab = store.collaborations.find((c) => c.id === collaborationId);
  if (!collab) {
    return { ok: false, message: "协作不存在。" };
  }
  const del = collab.deliverables[deliverableIndex];
  if (!del) {
    return { ok: false, message: "交付物不存在。" };
  }

  del.approvedBy = String(approvedBy || "subject").trim();
  del.approvedAt = new Date().toISOString();
  collab.updatedAt = new Date().toISOString();
  saveCollaborationStore(packageDir, store);

  return { ok: true, collaboration: collab };
}

/**
 * Add feedback to a collaboration.
 * @param {string} packageDir
 * @param {string} collaborationId
 * @param {object} feedback - { rating, comment, writeBack }
 * @returns {object} { ok, collaboration }
 */
function addFeedback(packageDir, collaborationId, feedback) {
  const store = loadCollaborationStore(packageDir);
  const collab = store.collaborations.find((c) => c.id === collaborationId);
  if (!collab) {
    return { ok: false, message: "协作不存在。" };
  }

  collab.feedback.push({
    timestamp: new Date().toISOString(),
    rating: typeof (feedback && feedback.rating) === "number" ? feedback.rating : null,
    comment: String((feedback && feedback.comment) || "").trim(),
    writeBack: Array.isArray(feedback && feedback.writeBack) ? feedback.writeBack : [],
    confirmed: false,
  });
  collab.updatedAt = new Date().toISOString();
  saveCollaborationStore(packageDir, store);

  return { ok: true, collaboration: collab };
}

/**
 * Confirm feedback write-back.
 * @param {string} packageDir
 * @param {string} collaborationId
 * @param {number} feedbackIndex
 * @returns {object} { ok, collaboration }
 */
function confirmFeedbackWriteBack(packageDir, collaborationId, feedbackIndex) {
  const store = loadCollaborationStore(packageDir);
  const collab = store.collaborations.find((c) => c.id === collaborationId);
  if (!collab) {
    return { ok: false, message: "协作不存在。" };
  }
  const fb = collab.feedback[feedbackIndex];
  if (!fb) {
    return { ok: false, message: "反馈不存在。" };
  }

  fb.confirmed = true;
  fb.confirmedAt = new Date().toISOString();
  collab.status = "completed";
  collab.updatedAt = new Date().toISOString();
  saveCollaborationStore(packageDir, store);

  return { ok: true, collaboration: collab };
}

/**
 * Revoke a collaboration.
 * @param {string} packageDir
 * @param {string} collaborationId
 * @returns {object} { ok, collaboration }
 */
function revokeCollaboration(packageDir, collaborationId) {
  const store = loadCollaborationStore(packageDir);
  const collab = store.collaborations.find((c) => c.id === collaborationId);
  if (!collab) {
    return { ok: false, message: "协作不存在。" };
  }

  collab.status = "revoked";
  collab.authorization.revoked = true;
  collab.authorization.revokedAt = new Date().toISOString();
  collab.updatedAt = new Date().toISOString();
  saveCollaborationStore(packageDir, store);

  return { ok: true, collaboration: collab };
}

/**
 * List all collaborations.
 * @param {string} packageDir
 * @returns {object} { ok, collaborations }
 */
function listCollaborations(packageDir) {
  const store = loadCollaborationStore(packageDir);
  return { ok: true, collaborations: store.collaborations };
}

module.exports = {
  createCollaboration,
  addInteraction,
  addDeliverable,
  approveDeliverable,
  addFeedback,
  confirmFeedbackWriteBack,
  revokeCollaboration,
  listCollaborations,
  loadCollaborationStore,
  saveCollaborationStore,
};

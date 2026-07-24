"use strict";

/**
 * Collaboration Exchange — invite/accept/sync collaborations between accounts via files.
 */

const fs = require("node:fs");
const path = require("node:path");
const { loadOrCreateIdentity } = require("../identity");
const { loadCollaborationStore, saveCollaborationStore } = require("./index");

/**
 * Export a collaboration invite to a file.
 * @param {string} packageDir - source account package dir
 * @param {string} collaborationId - collaboration ID
 * @param {string} outputPath - output file path
 * @returns {{ ok: boolean, message?: string, filePath?: string }}
 */
function exportInvite(packageDir, collaborationId, outputPath) {
  const store = loadCollaborationStore(packageDir);
  const collab = store.collaborations.find((c) => c.id === collaborationId);
  if (!collab) return { ok: false, message: "协作不存在。" };

  const identity = loadOrCreateIdentity(packageDir);

  const invite = {
    version: 1,
    type: "collaboration_invite",
    exportedAt: new Date().toISOString(),
    from: {
      did: identity.did,
      publicKey: identity.publicKey,
      role: collab.subject && collab.subject.role,
    },
    collaboration: {
      id: collab.id,
      title: collab.title,
      goal: collab.goal,
      role: collab.role,
      status: "invited",
      validUntil: collab.validUntil,
      authorization: collab.authorization,
    },
  };

  const resolved = path.resolve(outputPath);
  fs.writeFileSync(resolved, JSON.stringify(invite, null, 2), "utf8");
  return { ok: true, filePath: resolved };
}

/**
 * Import and accept a collaboration invite from a file.
 * @param {string} packageDir - target account package dir
 * @param {string} inputPath - invite file path
 * @returns {{ ok: boolean, message?: string, collaboration?: object }}
 */
function importInvite(packageDir, inputPath) {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    return { ok: false, message: "邀请文件不存在：" + resolved };
  }

  let invite;
  try {
    invite = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (err) {
    return { ok: false, message: "邀请文件格式无效：" + err.message };
  }

  if (!invite.from || !invite.collaboration) {
    return { ok: false, message: "邀请文件缺少必要字段。" };
  }

  // Check expiration
  if (invite.collaboration.validUntil && new Date(invite.collaboration.validUntil) < new Date()) {
    return { ok: false, message: "邀请已过期。" };
  }

  const identity = loadOrCreateIdentity(packageDir);
  const store = loadCollaborationStore(packageDir);

  // Check if already imported
  const existing = store.collaborations.find((c) => c.id === invite.collaboration.id);
  if (existing) {
    return { ok: false, message: "该协作已导入。" };
  }

  const now = new Date().toISOString();
  const collab = {
    id: invite.collaboration.id,
    title: invite.collaboration.title,
    goal: invite.collaboration.goal,
    role: invite.collaboration.role,
    status: "accepted", // accepted by this account
    createdAt: invite.collaboration.createdAt || now,
    updatedAt: now,
    validUntil: invite.collaboration.validUntil,
    subject: {
      did: identity.did,
      role: invite.collaboration.role,
    },
    collaborator: {
      type: "digitalme",
      name: invite.from.did,
      did: invite.from.did,
      publicKey: invite.from.publicKey,
      role: invite.from.role,
    },
    authorization: invite.collaboration.authorization || {
      scope: "full",
      validDays: 30,
      validUntil: invite.collaboration.validUntil,
      revoked: false,
      revokedAt: null,
    },
    interactions: [],
    deliverables: [],
    feedback: [],
    // Cross-account tracking
    remote: {
      fromDid: invite.from.did,
      fromPublicKey: invite.from.publicKey,
      acceptedAt: now,
    },
  };

  store.collaborations.push(collab);
  saveCollaborationStore(packageDir, store);

  return { ok: true, collaboration: collab };
}

/**
 * Export collaboration update (interactions, deliverables, feedback) to a file for syncing.
 * @param {string} packageDir - source account package dir
 * @param {string} collaborationId - collaboration ID
 * @param {string} outputPath - output file path
 * @returns {{ ok: boolean, message?: string, filePath?: string }}
 */
function exportUpdate(packageDir, collaborationId, outputPath) {
  const store = loadCollaborationStore(packageDir);
  const collab = store.collaborations.find((c) => c.id === collaborationId);
  if (!collab) return { ok: false, message: "协作不存在。" };

  const identity = loadOrCreateIdentity(packageDir);

  const update = {
    version: 1,
    type: "collaboration_update",
    exportedAt: new Date().toISOString(),
    from: {
      did: identity.did,
      publicKey: identity.publicKey,
    },
    collaborationId: collab.id,
    status: collab.status,
    interactions: collab.interactions,
    deliverables: collab.deliverables,
    feedback: collab.feedback,
  };

  const resolved = path.resolve(outputPath);
  fs.writeFileSync(resolved, JSON.stringify(update, null, 2), "utf8");
  return { ok: true, filePath: resolved };
}

/**
 * Import collaboration update from a file (merge into local collaboration).
 * @param {string} packageDir - target account package dir
 * @param {string} inputPath - update file path
 * @returns {{ ok: boolean, message?: string, collaboration?: object }}
 */
function importUpdate(packageDir, inputPath) {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    return { ok: false, message: "更新文件不存在：" + resolved };
  }

  let update;
  try {
    update = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (err) {
    return { ok: false, message: "更新文件格式无效：" + err.message };
  }

  const store = loadCollaborationStore(packageDir);
  const collab = store.collaborations.find((c) => c.id === update.collaborationId);
  if (!collab) {
    return { ok: false, message: "协作不存在，请先导入邀请。" };
  }

  // Merge interactions (append new ones)
  const existingTimestamps = new Set((collab.interactions || []).map((i) => i.timestamp));
  for (const interaction of (update.interactions || [])) {
    if (!existingTimestamps.has(interaction.timestamp)) {
      collab.interactions.push(interaction);
    }
  }

  // Merge deliverables (append new ones)
  const existingDelTimestamps = new Set((collab.deliverables || []).map((d) => d.timestamp));
  for (const del of (update.deliverables || [])) {
    if (!existingDelTimestamps.has(del.timestamp)) {
      collab.deliverables.push(del);
    }
  }

  // Merge feedback (append new ones)
  const existingFbTimestamps = new Set((collab.feedback || []).map((f) => f.timestamp));
  for (const fb of (update.feedback || [])) {
    if (!existingFbTimestamps.has(fb.timestamp)) {
      collab.feedback.push(fb);
    }
  }

  // Update status if the remote side has progressed
  if (update.status && update.status !== collab.status) {
    const statusOrder = ["invited", "accepted", "active", "delivered", "completed", "revoked"];
    const currentIdx = statusOrder.indexOf(collab.status);
    const remoteIdx = statusOrder.indexOf(update.status);
    if (remoteIdx > currentIdx) {
      collab.status = update.status;
    }
  }

  collab.updatedAt = new Date().toISOString();
  saveCollaborationStore(packageDir, store);

  return { ok: true, collaboration: collab };
}

module.exports = {
  exportInvite,
  importInvite,
  exportUpdate,
  importUpdate,
};

"use strict";

/**
 * Credential Flow — 凭据出示、审计日志、撤销管理。
 */

const fs = require("node:fs");
const path = require("node:path");
const { issueCredential, verifyCredential } = require("./vc");
const { loadOrCreateIdentity } = require("./index");

function credentialStorePath(packageDir) {
  return path.join(packageDir, "credentials.json");
}

function loadCredentialStore(packageDir) {
  const storePath = credentialStorePath(packageDir);
  if (fs.existsSync(storePath)) {
    try {
      const raw = fs.readFileSync(storePath, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data.credentials)) {
        return data;
      }
    } catch (err) {
      console.warn("[credential-flow] failed to load credentials.json:", err.message);
    }
  }
  return { credentials: [], auditLog: [], updatedAt: new Date().toISOString() };
}

function saveCredentialStore(packageDir, store) {
  const storePath = credentialStorePath(packageDir);
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  return store;
}

function addAuditEntry(store, action, credentialId, details) {
  store.auditLog.push({
    timestamp: new Date().toISOString(),
    action,
    credentialId,
    details: details || {},
  });
}

/**
 * Generate and present a credential.
 * @param {string} packageDir
 * @param {object} pkg - package data
 * @param {object} opts - { audience, validDays, scope }
 * @returns {object} { ok, credential, message }
 */
function presentCredential(packageDir, pkg, opts = {}) {
  const audience = String((opts && opts.audience) || "").trim();
  if (!audience) {
    return { ok: false, message: "请指定出示对象。" };
  }

  const validDays = typeof opts.validDays === "number" && opts.validDays > 0 ? opts.validDays : 30;
  const scope = String((opts && opts.scope) || "full").trim();

  // Build subject from package data based on scope
  const items = [];
  if (scope === "full" || scope === "identity") {
    if (pkg.persona && String(pkg.persona).trim()) {
      items.push({ category: "identity", label: "本人描述", value: String(pkg.persona).trim().slice(0, 300) });
    }
  }
  if (scope === "full" || scope === "experience") {
    if (pkg.lifeSummary && String(pkg.lifeSummary).trim()) {
      items.push({ category: "experience", label: "经历与角色", value: String(pkg.lifeSummary).trim().slice(0, 400) });
    }
  }
  if (scope === "full" || scope === "framework") {
    if (pkg.decisionFrameworks && String(pkg.decisionFrameworks).trim()) {
      items.push({ category: "framework", label: "专业判断框架", value: "已建立结构化判断框架" });
    }
  }
  if (scope === "full" || scope === "style") {
    if (pkg.styleGuide && String(pkg.styleGuide).trim()) {
      items.push({ category: "style", label: "表达风格", value: "已形成稳定表达风格" });
    }
  }

  if (items.length === 0) {
    return { ok: false, message: "没有足够的信息生成凭据。" };
  }

  const subject = {
    claims: items,
    scope,
    generatedAt: new Date().toISOString(),
  };

  const vc = issueCredential(packageDir, subject, { validDays, audience });
  const identity = loadOrCreateIdentity(packageDir);

  const store = loadCredentialStore(packageDir);
  const credentialRecord = {
    id: "cred_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
    vc,
    audience,
    scope,
    presentedAt: new Date().toISOString(),
    validUntil: vc.expirationDate,
    revoked: false,
    revokedAt: null,
  };
  store.credentials.push(credentialRecord);
  addAuditEntry(store, "present", credentialRecord.id, { audience, scope, validDays });
  saveCredentialStore(packageDir, store);

  return { ok: true, credential: credentialRecord };
}

/**
 * Revoke a credential.
 * @param {string} packageDir
 * @param {string} credentialId
 * @returns {object} { ok, message }
 */
function revokeCredential(packageDir, credentialId) {
  const store = loadCredentialStore(packageDir);
  const cred = store.credentials.find((c) => c.id === credentialId);
  if (!cred) {
    return { ok: false, message: "凭据不存在。" };
  }
  if (cred.revoked) {
    return { ok: false, message: "凭据已撤销。" };
  }

  cred.revoked = true;
  cred.revokedAt = new Date().toISOString();
  addAuditEntry(store, "revoke", credentialId, { audience: cred.audience });
  saveCredentialStore(packageDir, store);

  return { ok: true, message: "凭据已撤销。" };
}

/**
 * Verify a credential (check if valid and not revoked).
 * @param {string} packageDir
 * @param {string} credentialId
 * @returns {object} { ok, valid, reason, credential }
 */
function verifyCredentialStatus(packageDir, credentialId) {
  const store = loadCredentialStore(packageDir);
  const cred = store.credentials.find((c) => c.id === credentialId);
  if (!cred) {
    return { ok: false, valid: false, reason: "not_found" };
  }
  if (cred.revoked) {
    return { ok: true, valid: false, reason: "revoked", credential: cred };
  }

  // Check expiration
  if (cred.validUntil && new Date(cred.validUntil) < new Date()) {
    return { ok: true, valid: false, reason: "expired", credential: cred };
  }

  // Verify VC signature
  const verifyResult = verifyCredential(packageDir, cred.vc);
  if (!verifyResult.valid) {
    return { ok: true, valid: false, reason: verifyResult.reason, credential: cred };
  }

  return { ok: true, valid: true, credential: cred };
}

/**
 * List all credentials.
 * @param {string} packageDir
 * @returns {object} { ok, credentials }
 */
function listCredentials(packageDir) {
  const store = loadCredentialStore(packageDir);
  return { ok: true, credentials: store.credentials, auditLog: store.auditLog };
}

module.exports = {
  presentCredential,
  revokeCredential,
  verifyCredentialStatus,
  listCredentials,
  loadCredentialStore,
};

"use strict";

/**
 * Credential Exchange — export/import credentials between Digital Me accounts.
 */

const fs = require("node:fs");
const path = require("node:path");
const { loadOrCreateIdentity } = require("./index");
const { verifyCredentialWithPublicKey } = require("./vc");
const { loadCredentialStore } = require("./credential-flow");

/**
 * Export a credential to a JSON file (includes issuer public key for cross-account verification).
 * @param {string} packageDir - source account package dir
 * @param {string} credentialId - credential ID to export
 * @param {string} outputPath - output file path
 * @returns {{ ok: boolean, message?: string, filePath?: string }}
 */
function exportCredential(packageDir, credentialId, outputPath) {
  const store = loadCredentialStore(packageDir);
  const cred = store.credentials.find((c) => c.id === credentialId);
  if (!cred) return { ok: false, message: "凭据不存在。" };
  if (cred.revoked) return { ok: false, message: "凭据已撤销，不能导出。" };

  const identity = loadOrCreateIdentity(packageDir);

  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    issuer: {
      did: identity.did,
      publicKey: identity.publicKey, // Full SPKI PEM for cross-account verification
    },
    credential: cred.vc,
    scope: cred.scope,
    audience: cred.audience,
    presentedAt: cred.presentedAt,
    validUntil: cred.validUntil,
  };

  const resolved = path.resolve(outputPath);
  fs.writeFileSync(resolved, JSON.stringify(exportData, null, 2), "utf8");
  return { ok: true, filePath: resolved };
}

/**
 * Import and verify a credential from a JSON file (cross-account).
 * @param {string} targetPackageDir - target account package dir (where to store the imported credential)
 * @param {string} inputPath - credential file path
 * @returns {{ ok: boolean, message?: string, valid?: boolean, reason?: string, credential?: object }}
 */
function importCredential(targetPackageDir, inputPath) {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    return { ok: false, message: "凭据文件不存在：" + resolved };
  }

  let exportData;
  try {
    exportData = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (err) {
    return { ok: false, message: "凭据文件格式无效：" + err.message };
  }

  if (!exportData.issuer || !exportData.issuer.publicKey || !exportData.credential) {
    return { ok: false, message: "凭据文件缺少必要字段（issuer.publicKey 或 credential）。" };
  }

  // Verify the credential using the issuer's public key from the export file
  // (does not depend on the local identity)
  const verifyResult = verifyCredentialWithPublicKey(exportData.credential, exportData.issuer.publicKey);
  if (!verifyResult.valid) {
    return { ok: true, valid: false, reason: verifyResult.reason, issuer: exportData.issuer.did };
  }

  // Check expiration
  if (exportData.validUntil && new Date(exportData.validUntil) < new Date()) {
    return { ok: true, valid: false, reason: "expired", issuer: exportData.issuer.did };
  }

  // Store the imported credential in the target account
  const store = loadCredentialStore(targetPackageDir);
  const imported = {
    id: "imported_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8),
    vc: exportData.credential,
    issuer: exportData.issuer.did,
    issuerPublicKey: exportData.issuer.publicKey,
    scope: exportData.scope,
    audience: exportData.audience,
    presentedAt: exportData.presentedAt,
    validUntil: exportData.validUntil,
    importedAt: new Date().toISOString(),
    revoked: false,
  };
  store.credentials.push(imported);
  // credential-flow does not export saveCredentialStore; write the store directly
  // using the same path/format as credential-flow's credentialStorePath.
  const storePath = path.join(targetPackageDir, "credentials.json");
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");

  return { ok: true, valid: true, credential: imported, issuer: exportData.issuer.did };
}

module.exports = { exportCredential, importCredential };

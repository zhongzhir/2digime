"use strict";

/**
 * Digital Me Identity — DID generation, key management, signing.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Generate a new Ed25519 key pair and DID.
 * @returns {{ did: string, publicKey: string, privateKey: string }}
 */
function generateIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const publicKeyBase64 = publicKey
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");
  const did = "did:dme:" + Buffer.from(publicKeyBase64).toString("base64url").slice(0, 32);
  return { did, publicKey, privateKey };
}

/**
 * Load or create identity from Package directory.
 * @param {string} packageDir
 * @returns {{ did: string, publicKey: string, createdAt: string, updatedAt: string }}
 */
function loadOrCreateIdentity(packageDir) {
  const identityPath = path.join(packageDir, "identity.json");
  if (fs.existsSync(identityPath)) {
    try {
      const raw = fs.readFileSync(identityPath, "utf8");
      const identity = JSON.parse(raw);
      if (identity.did && identity.publicKey) {
        return {
          did: identity.did,
          publicKey: identity.publicKey,
          createdAt: identity.createdAt || new Date().toISOString(),
          updatedAt: identity.updatedAt || new Date().toISOString(),
        };
      }
    } catch (err) {
      console.warn("[identity] failed to load identity.json:", err.message);
    }
  }

  // Create new identity
  const { did, publicKey, privateKey } = generateIdentity();
  const now = new Date().toISOString();
  const identity = {
    did,
    publicKey,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2), "utf8");

  // Store private key separately (not in identity.json for security)
  const privateKeyPath = path.join(packageDir, ".identity-private-key.pem");
  fs.writeFileSync(privateKeyPath, privateKey, "utf8");

  return { did, publicKey, createdAt: now, updatedAt: now };
}

/**
 * Sign data with identity private key.
 * Note: Ed25519 is a one-shot pure EdDSA algorithm — Node requires the
 * `null` digest form (`crypto.sign(null, data, key)`); streaming
 * `createSign("SHA256")` is unsupported for Ed25519 keys.
 * @param {string} packageDir
 * @param {string} data
 * @returns {string} base64 signature
 */
function signWithIdentity(packageDir, data) {
  const privateKeyPath = path.join(packageDir, ".identity-private-key.pem");
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error("Identity private key not found");
  }
  const privateKey = fs.readFileSync(privateKeyPath, "utf8");
  return crypto.sign(null, Buffer.from(String(data), "utf8"), privateKey).toString("base64");
}

/**
 * Verify signature with identity public key.
 * @param {string} packageDir
 * @param {string} data
 * @param {string} signature
 * @returns {boolean}
 */
function verifyWithIdentity(packageDir, data, signature) {
  const identity = loadOrCreateIdentity(packageDir);
  try {
    return crypto.verify(
      null,
      Buffer.from(String(data), "utf8"),
      identity.publicKey,
      Buffer.from(String(signature), "base64")
    );
  } catch {
    // Malformed signature (e.g. bad base64 / wrong length) → treat as invalid.
    return false;
  }
}

module.exports = {
  generateIdentity,
  loadOrCreateIdentity,
  signWithIdentity,
  verifyWithIdentity,
};

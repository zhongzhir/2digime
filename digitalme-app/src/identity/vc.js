"use strict";

/**
 * Verifiable Credentials — W3C VC 2.0 format with Ed25519 signature.
 */

const crypto = require("node:crypto");
const { loadOrCreateIdentity, signWithIdentity, verifyWithIdentity } = require("./index");

const VC_CONTEXT = "https://www.w3.org/ns/credentials/v2";
const VC_TYPE = "VerifiableCredential";
const DM_CREDENTIAL_TYPE = "DigitalMeCredential";

/**
 * Issue a Verifiable Credential.
 * @param {string} packageDir
 * @param {object} subject - credential subject (claims)
 * @param {object} opts - { validDays, audience }
 * @returns {object} VC
 */
function issueCredential(packageDir, subject, opts = {}) {
  const identity = loadOrCreateIdentity(packageDir);
  const now = new Date();
  const validDays = typeof opts.validDays === "number" && opts.validDays > 0 ? opts.validDays : 30;
  const validUntil = new Date(now.getTime() + validDays * 86400000);

  const credentialSubject = {
    id: identity.did,
    ...subject,
  };

  const vc = {
    "@context": [VC_CONTEXT],
    type: [VC_TYPE, DM_CREDENTIAL_TYPE],
    issuer: identity.did,
    issuanceDate: now.toISOString(),
    expirationDate: validUntil.toISOString(),
    credentialSubject,
  };

  // Add audience if provided
  if (opts.audience) {
    vc.audience = String(opts.audience).trim();
  }

  // Sign the credential
  const dataToSign = JSON.stringify(vc);
  const signature = signWithIdentity(packageDir, dataToSign);

  vc.proof = {
    type: "Ed25519Signature2020",
    created: now.toISOString(),
    verificationMethod: identity.did + "#key-1",
    proofPurpose: "assertionMethod",
    proofValue: signature,
  };

  return vc;
}

/**
 * Verify a Verifiable Credential.
 * @param {string} packageDir
 * @param {object} vc
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyCredential(packageDir, vc) {
  if (!vc || typeof vc !== "object") {
    return { valid: false, reason: "invalid_format" };
  }

  // Check required fields
  if (!vc["@context"] || !vc.type || !vc.issuer || !vc.issuanceDate || !vc.credentialSubject || !vc.proof) {
    return { valid: false, reason: "missing_required_fields" };
  }

  // Check expiration
  if (vc.expirationDate) {
    const exp = new Date(vc.expirationDate);
    if (exp < new Date()) {
      return { valid: false, reason: "expired" };
    }
  }

  // Verify signature
  const proof = vc.proof;
  const vcWithoutProof = { ...vc };
  delete vcWithoutProof.proof;
  const dataToVerify = JSON.stringify(vcWithoutProof);

  try {
    const valid = verifyWithIdentity(packageDir, dataToVerify, proof.proofValue);
    if (!valid) {
      return { valid: false, reason: "invalid_signature" };
    }
  } catch (err) {
    return { valid: false, reason: "verification_error", error: err.message };
  }

  return { valid: true };
}

/**
 * Verify a VC using the public key embedded in the credential file (cross-account).
 * Does NOT require the local identity — uses the issuer's public key from the export.
 * @param {object} vc - the Verifiable Credential
 * @param {string} issuerPublicKeyPem - the issuer's SPKI PEM public key
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyCredentialWithPublicKey(vc, issuerPublicKeyPem) {
  if (!vc || typeof vc !== "object") {
    return { valid: false, reason: "invalid_format" };
  }
  if (!issuerPublicKeyPem || typeof issuerPublicKeyPem !== "string") {
    return { valid: false, reason: "missing_public_key" };
  }

  // Check required fields
  if (!vc["@context"] || !vc.type || !vc.issuer || !vc.issuanceDate || !vc.credentialSubject || !vc.proof) {
    return { valid: false, reason: "missing_required_fields" };
  }

  // Check expiration
  if (vc.expirationDate) {
    const exp = new Date(vc.expirationDate);
    if (exp < new Date()) {
      return { valid: false, reason: "expired" };
    }
  }

  // Verify signature with the provided public key (no local identity needed)
  const proof = vc.proof;
  const vcWithoutProof = { ...vc };
  delete vcWithoutProof.proof;
  const dataToVerify = JSON.stringify(vcWithoutProof);

  try {
    const valid = crypto.verify(
      null,
      Buffer.from(dataToVerify, "utf8"),
      issuerPublicKeyPem,
      Buffer.from(String(proof.proofValue), "base64")
    );
    if (!valid) {
      return { valid: false, reason: "invalid_signature" };
    }
  } catch (err) {
    return { valid: false, reason: "verification_error", error: err.message };
  }

  return { valid: true };
}

/**
 * Create a presentation from a VC.
 * @param {object} vc
 * @param {object} opts - { audience, challenge }
 * @returns {object} Verifiable Presentation
 */
function createPresentation(vc, opts = {}) {
  const presentation = {
    "@context": [VC_CONTEXT],
    type: ["VerifiablePresentation"],
    verifiableCredential: [vc],
  };

  if (opts.audience) {
    presentation.audience = String(opts.audience).trim();
  }
  if (opts.challenge) {
    presentation.proof = {
      type: "Ed25519Signature2020",
      created: new Date().toISOString(),
      challenge: String(opts.challenge),
    };
  }

  return presentation;
}

module.exports = {
  VC_CONTEXT,
  VC_TYPE,
  DM_CREDENTIAL_TYPE,
  issueCredential,
  verifyCredential,
  verifyCredentialWithPublicKey,
  createPresentation,
};

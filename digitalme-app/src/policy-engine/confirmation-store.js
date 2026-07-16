"use strict";

const crypto = require("node:crypto");

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** @type {Map<string, object>} */
const tokens = new Map();

function clearAllForTests() {
  tokens.clear();
}

function issueToken(fields) {
  const tokenId = crypto.randomBytes(16).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(tokenId, "utf8").digest("hex");
  const correlationId = "cnf_" + crypto.randomBytes(8).toString("hex");
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();
  const row = {
    tokenId,
    tokenHash,
    correlationId,
    requestDigest: fields.requestDigest,
    actor: fields.actor,
    action: fields.action,
    destination: fields.destination,
    dataScopes: [...fields.dataScopes].sort(),
    cwd: fields.cwd || "",
    senderId: String(fields.senderId || ""),
    taskDigest: fields.taskDigest,
    decisionId: fields.decisionId,
    executorConfigFingerprint: String(fields.executorConfigFingerprint || ""),
    expiresAt,
    consumed: false,
    revoked: false,
    issuedAt: new Date().toISOString(),
  };
  tokens.set(tokenId, row);
  return { tokenId, tokenHash, correlationId, expiresAt };
}

/**
 * @returns {{ ok: true, token: object } | { ok: false, reason: string }}
 */
function consumeToken(tokenId, expected) {
  const id = String(tokenId || "").trim();
  if (!id) return { ok: false, reason: "missing_token" };
  const row = tokens.get(id);
  if (!row) return { ok: false, reason: "unknown_token" };
  if (row.revoked) return { ok: false, reason: "token_revoked" };
  if (row.consumed) return { ok: false, reason: "token_replayed" };
  if (Date.now() > Date.parse(row.expiresAt)) return { ok: false, reason: "token_expired" };

  const checks = [
    ["requestDigest", expected.requestDigest],
    ["actor", expected.actor],
    ["action", expected.action],
    ["destination", expected.destination],
    ["taskDigest", expected.taskDigest],
    ["senderId", expected.senderId],
    ["cwd", expected.cwd || ""],
    ["decisionId", expected.decisionId],
    ["executorConfigFingerprint", expected.executorConfigFingerprint],
  ];
  for (const [key, value] of checks) {
    if (String(row[key]) !== String(value)) return { ok: false, reason: "token_binding_mismatch" };
  }

  const expectedScopes = [...(expected.dataScopes || [])].sort().join("\0");
  const rowScopes = [...row.dataScopes].sort().join("\0");
  if (expectedScopes !== rowScopes) return { ok: false, reason: "token_scope_mismatch" };

  row.consumed = true;
  row.consumedAt = new Date().toISOString();
  return { ok: true, token: { ...row } };
}

function peekToken(tokenId) {
  return tokens.get(String(tokenId || "").trim()) || null;
}

function revokeToken(tokenId, meta = {}) {
  const id = String(tokenId || "").trim();
  if (!id) return { ok: false, reason: "missing_token" };
  const row = tokens.get(id);
  if (!row) return { ok: false, reason: "unknown_token" };
  if (row.consumed) return { ok: false, reason: "token_replayed" };
  row.revoked = true;
  row.revokedAt = new Date().toISOString();
  row.revokeReason = String(meta.reason || "canceled");
  return { ok: true, token: { ...row } };
}

module.exports = {
  DEFAULT_TTL_MS,
  clearAllForTests,
  issueToken,
  consumeToken,
  peekToken,
  revokeToken,
};

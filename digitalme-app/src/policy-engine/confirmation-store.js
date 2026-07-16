"use strict";

const crypto = require("node:crypto");

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** @type {Map<string, object>} */
const tokens = new Map();

function clearAllForTests() {
  tokens.clear();
}

function issueToken(fields, { ttlMs } = {}) {
  const tokenId = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + (Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_TTL_MS)).toISOString();
  const row = {
    tokenId,
    requestDigest: fields.requestDigest,
    actor: fields.actor,
    action: fields.action,
    destination: fields.destination,
    dataScopes: [...fields.dataScopes].sort(),
    cwd: fields.cwd || "",
    senderId: String(fields.senderId || ""),
    taskDigest: fields.taskDigest,
    decisionId: fields.decisionId,
    expiresAt,
    consumed: false,
    issuedAt: new Date().toISOString(),
  };
  tokens.set(tokenId, row);
  return { tokenId, expiresAt };
}

/**
 * @returns {{ ok: true, token: object } | { ok: false, reason: string }}
 */
function consumeToken(tokenId, expected) {
  const id = String(tokenId || "").trim();
  if (!id) return { ok: false, reason: "missing_token" };
  const row = tokens.get(id);
  if (!row) return { ok: false, reason: "unknown_token" };
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

module.exports = {
  DEFAULT_TTL_MS,
  clearAllForTests,
  issueToken,
  consumeToken,
  peekToken,
};

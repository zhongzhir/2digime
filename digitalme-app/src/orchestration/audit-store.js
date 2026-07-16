"use strict";

const fs = require("node:fs");
const path = require("node:path");

function storePath(userData) {
  return path.join(userData, "l0-audit-ledger.json");
}

function empty() {
  return { version: 1, entries: [] };
}

function read(userData) {
  try {
    const p = storePath(userData);
    if (!fs.existsSync(p)) return empty();
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!raw || !Array.isArray(raw.entries)) return empty();
    return { version: raw.version || 1, entries: raw.entries };
  } catch {
    return empty();
  }
}

function write(userData, store) {
  fs.writeFileSync(storePath(userData), JSON.stringify(store, null, 2), "utf8");
}

/**
 * @param {string} userData
 * @param {{ scene?: string, action?: string, auth?: string, summary?: string, capabilities?: string[], executor?: string, outcome?: string }} entry
 */
function append(userData, entry) {
  const store = read(userData);
  const row = {
    id: "aud_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1000),
    at: new Date().toISOString(),
    scene: entry.scene || "unknown",
    action: entry.action || "delegate",
    auth: entry.auth || "read",
    executor: entry.executor || "builtin",
    summary: String(entry.summary || "").slice(0, 240),
    capabilities: Array.isArray(entry.capabilities) ? entry.capabilities.slice(0, 20) : [],
    outcome: String(entry.outcome || "").slice(0, 120),
  };
  store.entries.push(row);
  store.entries = store.entries.slice(-200);
  write(userData, store);
  return row;
}

function list(userData, { scene, limit } = {}) {
  let rows = read(userData).entries.slice().reverse();
  if (scene) rows = rows.filter((r) => r.scene === scene);
  const n = Math.min(Math.max(Number(limit) || 40, 1), 200);
  return rows.slice(0, n);
}

function clear(userData) {
  write(userData, empty());
  return { ok: true };
}

module.exports = { append, list, clear, storePath };

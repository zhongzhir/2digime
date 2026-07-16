"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { GENESIS_HASH, buildEntryHash } = require("./hash");

const AUDIT_DIR_NAME = "decision-audit";

function auditRoot(userData) {
  return path.join(userData, AUDIT_DIR_NAME);
}

function metaPath(userData) {
  return path.join(auditRoot(userData), "meta.json");
}

function ledgerPath(userData, generation) {
  return path.join(auditRoot(userData), `gen-${generation}.jsonl`);
}

function ensureDir(userData) {
  const root = auditRoot(userData);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function defaultMeta() {
  return {
    version: 1,
    currentGeneration: 1,
    lastSequence: 0,
    lastHash: GENESIS_HASH,
  };
}

function readMeta(userData) {
  ensureDir(userData);
  const p = metaPath(userData);
  if (!fs.existsSync(p)) {
    const meta = defaultMeta();
    fs.writeFileSync(p, JSON.stringify(meta, null, 2), "utf8");
    return meta;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      version: raw.version || 1,
      currentGeneration: Number(raw.currentGeneration) || 1,
      lastSequence: Number(raw.lastSequence) || 0,
      lastHash: String(raw.lastHash || GENESIS_HASH),
    };
  } catch {
    return defaultMeta();
  }
}

function writeMeta(userData, meta) {
  ensureDir(userData);
  fs.writeFileSync(metaPath(userData), JSON.stringify(meta, null, 2), "utf8");
}

function sanitizeOutcome(outcome) {
  if (!outcome || typeof outcome !== "object") return null;
  const row = {
    status: String(outcome.status || "").slice(0, 40),
  };
  if (outcome.exitCode != null) row.exitCode = Number(outcome.exitCode);
  if (outcome.outputLength != null) row.outputLength = Number(outcome.outputLength);
  if (outcome.outputSha256) row.outputSha256 = String(outcome.outputSha256).slice(0, 64);
  if (outcome.auditIncomplete) row.auditIncomplete = true;
  return row;
}

function sanitizeApproval(approval) {
  if (!approval) return null;
  const row = {};
  if (approval.tokenId) row.tokenId = String(approval.tokenId).slice(0, 64);
  if (approval.confirmedAt) row.confirmedAt = String(approval.confirmedAt);
  return Object.keys(row).length ? row : null;
}

function buildBaseEntry(meta, fields) {
  return {
    generation: meta.currentGeneration,
    sequence: meta.lastSequence + 1,
    at: new Date().toISOString(),
    event: String(fields.event || "unknown"),
    decisionId: String(fields.decisionId || ""),
    policyVersion: String(fields.policyVersion || ""),
    requestDigest: String(fields.requestDigest || ""),
    actor: String(fields.actor || ""),
    purpose: String(fields.purpose || ""),
    action: String(fields.action || ""),
    dataScopes: Array.isArray(fields.dataScopes) ? [...fields.dataScopes].sort() : [],
    destination: String(fields.destination || ""),
    approval: sanitizeApproval(fields.approval),
    outcome: sanitizeOutcome(fields.outcome),
    previousHash: meta.lastHash,
  };
}

function appendEntry(userData, fields) {
  ensureDir(userData);
  const meta = readMeta(userData);
  const base = buildBaseEntry(meta, fields);
  const entryHash = buildEntryHash(meta.lastHash, base);
  const entry = { ...base, entryHash };
  const line = JSON.stringify(entry) + "\n";
  const lp = ledgerPath(userData, meta.currentGeneration);
  fs.appendFileSync(lp, line, "utf8");
  meta.lastSequence = entry.sequence;
  meta.lastHash = entryHash;
  writeMeta(userData, meta);
  return entry;
}

function readGenerationLines(userData, generation) {
  const p = ledgerPath(userData, generation);
  if (!fs.existsSync(p)) return { lines: [], trailingPartial: null };
  const raw = fs.readFileSync(p, "utf8");
  if (!raw) return { lines: [], trailingPartial: null };
  const parts = raw.split("\n");
  let trailingPartial = null;
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  else if (parts.length) {
    const last = parts[parts.length - 1];
    try {
      JSON.parse(last);
    } catch {
      trailingPartial = last;
      parts.pop();
    }
  }
  const lines = [];
  for (const line of parts) {
    if (!line.trim()) continue;
    lines.push(line);
  }
  return { lines, trailingPartial };
}

function parseEntriesFromLines(lines) {
  const entries = [];
  for (const line of lines) {
    entries.push(JSON.parse(line));
  }
  return entries;
}

function verifyGeneration(userData, generation) {
  const { lines, trailingPartial } = readGenerationLines(userData, generation);
  let previousHash = GENESIS_HASH;
  let expectedSequence = 0;
  const issues = [];

  for (let i = 0; i < lines.length; i++) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      issues.push({ type: "parse_error", line: i + 1 });
      return { healthy: false, issues, entries: [], trailingPartial };
    }
    expectedSequence += 1;
    if (entry.sequence !== expectedSequence) {
      issues.push({ type: "sequence_gap", expected: expectedSequence, got: entry.sequence, line: i + 1 });
    }
    if (entry.previousHash !== previousHash) {
      issues.push({ type: "hash_chain_break", line: i + 1 });
    }
    const expectedEntryHash = buildEntryHash(previousHash, entry);
    if (entry.entryHash !== expectedEntryHash) {
      issues.push({ type: "entry_hash_mismatch", line: i + 1 });
    }
    previousHash = entry.entryHash;
  }

  if (trailingPartial) {
    issues.push({ type: "trailing_partial_line" });
  }

  const entries = parseEntriesFromLines(lines);
  return {
    healthy: issues.length === 0,
    issues,
    entries,
    trailingPartial,
    lastHash: previousHash,
    lastSequence: expectedSequence,
  };
}

function verify(userData) {
  const meta = readMeta(userData);
  const generations = [];
  let healthy = true;
  const issues = [];

  for (let g = 1; g <= meta.currentGeneration; g++) {
    const result = verifyGeneration(userData, g);
    generations.push({ generation: g, ...result });
    if (!result.healthy) healthy = false;
    issues.push(...result.issues.map((x) => ({ ...x, generation: g })));
  }

  const current = generations[generations.length - 1];
  if (current && current.lastSequence !== meta.lastSequence) {
    healthy = false;
    issues.push({ type: "meta_sequence_mismatch", generation: meta.currentGeneration });
  }
  if (current && current.lastHash !== meta.lastHash) {
    healthy = false;
    issues.push({ type: "meta_hash_mismatch", generation: meta.currentGeneration });
  }

  return {
    healthy,
    meta,
    generations,
    issues,
  };
}

function list(userData, { limit, generation } = {}) {
  const meta = readMeta(userData);
  const gen = generation != null ? Number(generation) : meta.currentGeneration;
  const result = verifyGeneration(userData, gen);
  let rows = result.entries.slice();
  const n = Math.min(Math.max(Number(limit) || 40, 1), 500);
  return {
    generation: gen,
    healthy: result.healthy,
    issues: result.issues,
    entries: rows.slice(-n).reverse(),
    meta,
  };
}

function rotate(userData) {
  const meta = readMeta(userData);
  const nextGen = meta.currentGeneration + 1;
  const rotateMeta = {
    version: meta.version,
    currentGeneration: nextGen,
    lastSequence: 0,
    lastHash: GENESIS_HASH,
  };
  writeMeta(userData, rotateMeta);
  const entry = appendEntry(userData, {
    event: "generation_rotated",
    decisionId: "rot_" + Date.now().toString(36),
    policyVersion: "p1-04-v1",
    requestDigest: "",
    actor: "owner:settings",
    purpose: "audit_maintenance",
    action: "rotate_generation",
    dataScopes: [],
    destination: "local_ledger",
    approval: null,
    outcome: { status: "rotated", fromGeneration: meta.currentGeneration, toGeneration: nextGen },
  });
  return { ok: true, previousGeneration: meta.currentGeneration, currentGeneration: nextGen, entry };
}

function digestOutput(output) {
  const text = String(output || "");
  return {
    outputLength: text.length,
    outputSha256: crypto.createHash("sha256").update(text, "utf8").digest("hex"),
  };
}

module.exports = {
  AUDIT_DIR_NAME,
  auditRoot,
  appendEntry,
  list,
  verify,
  verifyGeneration,
  rotate,
  readMeta,
  digestOutput,
  GENESIS_HASH,
};

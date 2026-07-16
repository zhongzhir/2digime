"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { GENESIS_HASH, buildEntryHash } = require("./hash");

const AUDIT_DIR_NAME = "decision-audit";
const META_VERSION = 2;

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

function fsyncPath(targetPath) {
  const fd = fs.openSync(targetPath, "r");
  try {
    fs.fsyncSync(fd);
  } catch (err) {
    if (!(err && (err.code === "EPERM" || err.code === "EINVAL" || err.code === "UNKNOWN"))) {
      throw err;
    }
  } finally {
    fs.closeSync(fd);
  }
}

function defaultMeta() {
  return {
    version: META_VERSION,
    currentGeneration: 1,
    lastSequence: 0,
    lastHash: GENESIS_HASH,
    generationCount: 1,
  };
}

function parseMeta(userData) {
  ensureDir(userData);
  const p = metaPath(userData);
  if (!fs.existsSync(p)) {
    return { ok: false, reason: "meta_missing", path: p };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    const meta = {
      version: Number(raw.version) || META_VERSION,
      currentGeneration: Number(raw.currentGeneration),
      lastSequence: Number(raw.lastSequence),
      lastHash: String(raw.lastHash || ""),
      generationCount: Number(raw.generationCount) || Number(raw.currentGeneration),
    };
    if (
      !Number.isInteger(meta.currentGeneration) ||
      meta.currentGeneration < 1 ||
      !Number.isInteger(meta.lastSequence) ||
      meta.lastSequence < 0 ||
      !/^[0-9a-f]{64}$/i.test(meta.lastHash)
    ) {
      return { ok: false, reason: "meta_invalid", path: p };
    }
    return { ok: true, meta, path: p };
  } catch {
    return { ok: false, reason: "meta_corrupt", path: p };
  }
}

function writeMetaAtomic(userData, meta) {
  const root = ensureDir(userData);
  const target = metaPath(userData);
  const temp = target + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(meta, null, 2), "utf8");
  fsyncPath(temp);
  fs.renameSync(temp, target);
  try {
    fsyncPath(root);
  } catch {
    /* directory fsync unsupported on some Windows setups */
  }
}

function sanitizeOutcome(outcome) {
  if (!outcome || typeof outcome !== "object") return null;
  const row = {
    status: String(outcome.status || "").slice(0, 48),
  };
  if (Array.isArray(outcome.reasonCodes) && outcome.reasonCodes.length) {
    row.reasonCodes = outcome.reasonCodes.map((item) => String(item)).slice(0, 12);
  }
  if (outcome.exitCode != null) row.exitCode = Number(outcome.exitCode);
  if (outcome.outputLength != null) row.outputLength = Number(outcome.outputLength);
  if (outcome.outputSha256) row.outputSha256 = String(outcome.outputSha256).slice(0, 64);
  if (outcome.expiresAt) row.expiresAt = String(outcome.expiresAt);
  if (outcome.fromGeneration != null) row.fromGeneration = Number(outcome.fromGeneration);
  if (outcome.toGeneration != null) row.toGeneration = Number(outcome.toGeneration);
  if (outcome.previousGenerationLastHash) {
    row.previousGenerationLastHash = String(outcome.previousGenerationLastHash).slice(0, 64);
  }
  if (outcome.auditIncomplete) row.auditIncomplete = true;
  return row;
}

function sanitizeApproval(approval) {
  if (!approval || typeof approval !== "object") return null;
  const row = {};
  if (approval.confirmationId) row.confirmationId = String(approval.confirmationId).slice(0, 64);
  if (approval.confirmedAt) row.confirmedAt = String(approval.confirmedAt);
  if (approval.canceledAt) row.canceledAt = String(approval.canceledAt);
  if (approval.parentDecisionId) row.parentDecisionId = String(approval.parentDecisionId).slice(0, 64);
  return Object.keys(row).length ? row : null;
}

function listGenerationNumbers(userData) {
  const root = ensureDir(userData);
  const out = [];
  for (const name of fs.readdirSync(root)) {
    const match = /^gen-(\d+)\.jsonl$/u.exec(name);
    if (match) out.push(Number(match[1]));
  }
  out.sort((a, b) => a - b);
  return out;
}

function readGenerationLines(userData, generation) {
  const p = ledgerPath(userData, generation);
  if (!fs.existsSync(p)) return { exists: false, path: p, lines: [], trailingPartial: null };
  const raw = fs.readFileSync(p, "utf8");
  if (!raw) return { exists: true, path: p, lines: [], trailingPartial: null };
  const parts = raw.split("\n");
  let trailingPartial = null;
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  else if (parts.length) {
    trailingPartial = parts.pop();
  }
  const lines = [];
  for (const line of parts) {
    if (line.trim()) lines.push(line);
  }
  return { exists: true, path: p, lines, trailingPartial };
}

function verifyGeneration(userData, generation) {
  const { exists, lines, trailingPartial, path: filePath } = readGenerationLines(userData, generation);
  if (!exists) {
    return {
      generation,
      filePath,
      healthy: false,
      exists: false,
      issues: [{ type: "ledger_missing", generation }],
      entries: [],
      trailingPartial: null,
      lastHash: GENESIS_HASH,
      lastSequence: 0,
    };
  }
  let previousHash = GENESIS_HASH;
  let expectedSequence = 0;
  const issues = [];
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      issues.push({ type: "parse_error", line: i + 1, generation });
      return {
        generation,
        filePath,
        healthy: false,
        exists: true,
        issues,
        entries: [],
        trailingPartial,
        lastHash: previousHash,
        lastSequence: expectedSequence,
      };
    }
    expectedSequence += 1;
    if (entry.generation !== generation) {
      issues.push({ type: "generation_mismatch", line: i + 1, generation, got: entry.generation });
    }
    if (entry.sequence !== expectedSequence) {
      issues.push({ type: "sequence_gap", expected: expectedSequence, got: entry.sequence, line: i + 1, generation });
    }
    if (entry.previousHash !== previousHash) {
      issues.push({ type: "hash_chain_break", line: i + 1, generation });
    }
    const expectedEntryHash = buildEntryHash(previousHash, entry);
    if (entry.entryHash !== expectedEntryHash) {
      issues.push({ type: "entry_hash_mismatch", line: i + 1, generation });
    }
    previousHash = entry.entryHash;
    entries.push(entry);
  }
  if (trailingPartial != null) {
    issues.push({ type: "trailing_partial_line", generation });
  }
  return {
    generation,
    filePath,
    healthy: issues.length === 0,
    exists: true,
    issues,
    entries,
    trailingPartial,
    lastHash: previousHash,
    lastSequence: expectedSequence,
  };
}

function buildLedgerFact(userData) {
  const generationsPresent = listGenerationNumbers(userData);
  if (!generationsPresent.length) {
    return {
      healthy: true,
      issues: [],
      generations: [],
      currentGeneration: 1,
      lastSequence: 0,
      lastHash: GENESIS_HASH,
      generationCount: 1,
      source: "empty",
    };
  }
  const issues = [];
  const generations = [];
  for (let i = 0; i < generationsPresent.length; i++) {
    const expected = i + 1;
    if (generationsPresent[i] !== expected) {
      issues.push({ type: "generation_gap", expected, got: generationsPresent[i] });
    }
  }
  for (const generation of generationsPresent) {
    const result = verifyGeneration(userData, generation);
    generations.push(result);
    if (!result.healthy) issues.push(...result.issues);
  }
  const current = generations[generations.length - 1];
  return {
    healthy: issues.length === 0,
    issues,
    generations,
    currentGeneration: current ? current.generation : 1,
    lastSequence: current ? current.lastSequence : 0,
    lastHash: current ? current.lastHash : GENESIS_HASH,
    generationCount: generations.length || 1,
    source: "ledger",
  };
}

function canRecoverUniquely(metaResult, ledgerFact) {
  if (!ledgerFact.healthy) return false;
  if (!metaResult.ok) return ledgerFact.source === "ledger" || ledgerFact.source === "empty";
  const meta = metaResult.meta;
  return (
    meta.currentGeneration !== ledgerFact.currentGeneration ||
    meta.lastSequence !== ledgerFact.lastSequence ||
    meta.lastHash !== ledgerFact.lastHash ||
    meta.generationCount !== ledgerFact.generationCount
  );
}

function resolveState(userData, options = {}) {
  ensureDir(userData);
  const metaResult = parseMeta(userData);
  const ledgerFact = buildLedgerFact(userData);
  const issues = [...ledgerFact.issues];
  if (!metaResult.ok) issues.push({ type: metaResult.reason });
  if (metaResult.ok) {
    const meta = metaResult.meta;
    if (meta.currentGeneration !== ledgerFact.currentGeneration) {
      issues.push({
        type: "meta_generation_mismatch",
        expected: ledgerFact.currentGeneration,
        got: meta.currentGeneration,
      });
    }
    if (meta.lastSequence !== ledgerFact.lastSequence) {
      issues.push({ type: "meta_sequence_mismatch", expected: ledgerFact.lastSequence, got: meta.lastSequence });
    }
    if (meta.lastHash !== ledgerFact.lastHash) {
      issues.push({ type: "meta_hash_mismatch", expected: ledgerFact.lastHash, got: meta.lastHash });
    }
  }

  const shouldInit = options.allowInitialize && !metaResult.ok && ledgerFact.source === "empty";
  if (shouldInit) {
    const meta = defaultMeta();
    writeMetaAtomic(userData, meta);
    return { ok: true, recovered: true, state: meta, verify: verify(userData) };
  }

  if (issues.length === 0 && metaResult.ok) {
    return { ok: true, recovered: false, state: metaResult.meta, verify: verify(userData) };
  }

  if (options.allowRecover && canRecoverUniquely(metaResult, ledgerFact)) {
    const recovered = {
      version: META_VERSION,
      currentGeneration: ledgerFact.currentGeneration,
      lastSequence: ledgerFact.lastSequence,
      lastHash: ledgerFact.lastHash,
      generationCount: ledgerFact.generationCount,
    };
    writeMetaAtomic(userData, recovered);
    return { ok: true, recovered: true, state: recovered, verify: verify(userData) };
  }

  return { ok: false, recovered: false, issues, verify: verify(userData) };
}

function buildBaseEntry(state, generation, fields) {
  return {
    generation,
    sequence: state.lastSequence + 1,
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
    previousHash: state.lastHash,
  };
}

function appendEntry(userData, fields, options = {}) {
  const resolved = resolveState(userData, { allowInitialize: true, allowRecover: true });
  if (!resolved.ok || !resolved.verify.healthy) {
    const err = new Error("决策记录完整性异常，已阻止高风险执行。");
    err.code = "audit_unhealthy";
    err.auditVerify = resolved.verify;
    throw err;
  }
  const generation = options.generation || resolved.state.currentGeneration;
  const state =
    generation === resolved.state.currentGeneration
      ? resolved.state
      : { version: META_VERSION, currentGeneration: generation, lastSequence: 0, lastHash: GENESIS_HASH };
  const entry = { ...buildBaseEntry(state, generation, fields) };
  entry.entryHash = buildEntryHash(state.lastHash, entry);
  const lp = ledgerPath(userData, generation);
  ensureDir(userData);
  const fd = fs.openSync(lp, "a");
  try {
    fs.writeSync(fd, JSON.stringify(entry) + "\n", undefined, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const nextMeta = {
    version: META_VERSION,
    currentGeneration: generation,
    lastSequence: entry.sequence,
    lastHash: entry.entryHash,
    generationCount: Math.max(resolved.state.generationCount || 1, generation),
  };
  writeMetaAtomic(userData, nextMeta);
  return entry;
}

function verify(userData) {
  ensureDir(userData);
  const metaResult = parseMeta(userData);
  const ledgerFact = buildLedgerFact(userData);
  const issues = [...ledgerFact.issues];
  let healthy = ledgerFact.healthy;
  let meta = null;
  if (!metaResult.ok) {
    healthy = false;
    issues.push({ type: metaResult.reason });
  } else {
    meta = metaResult.meta;
    if (meta.currentGeneration !== ledgerFact.currentGeneration) {
      healthy = false;
      issues.push({ type: "meta_generation_mismatch" });
    }
    if (meta.lastSequence !== ledgerFact.lastSequence) {
      healthy = false;
      issues.push({ type: "meta_sequence_mismatch" });
    }
    if (meta.lastHash !== ledgerFact.lastHash) {
      healthy = false;
      issues.push({ type: "meta_hash_mismatch" });
    }
    if (meta.generationCount !== ledgerFact.generationCount) {
      healthy = false;
      issues.push({ type: "meta_generation_count_mismatch" });
    }
  }
  return {
    healthy,
    meta,
    generations: ledgerFact.generations,
    issues,
    availableGenerations: ledgerFact.generations.map((item) => item.generation),
  };
}

function list(userData, { limit, generation } = {}) {
  const full = verify(userData);
  const available = full.availableGenerations;
  const gen = generation != null ? Number(generation) : full.meta ? full.meta.currentGeneration : available[available.length - 1] || 1;
  const selected = full.generations.find((item) => item.generation === gen) || verifyGeneration(userData, gen);
  const n = Math.min(Math.max(Number(limit) || 40, 1), 500);
  return {
    generation: gen,
    healthy: selected.healthy,
    globalHealthy: full.healthy,
    issues: selected.issues,
    globalIssues: full.issues,
    availableGenerations: available,
    currentGeneration: full.meta ? full.meta.currentGeneration : gen,
    entries: selected.entries.slice(-n).reverse(),
    generations: full.generations.map((item) => ({
      generation: item.generation,
      healthy: item.healthy,
      issues: item.issues,
      entryCount: item.entries.length,
    })),
    note: "本机 hash chain 仅用于可检测篡改，不是签名或不可删除存证。",
  };
}

function rotate(userData, fields = {}) {
  const resolved = resolveState(userData, { allowInitialize: true, allowRecover: true });
  if (!resolved.ok || !resolved.verify.healthy) {
    const err = new Error("决策记录完整性异常，无法开启新代次。");
    err.code = "audit_unhealthy";
    err.auditVerify = resolved.verify;
    throw err;
  }
  const previousGeneration = resolved.state.currentGeneration;
  const nextGeneration = previousGeneration + 1;
  const entry = appendEntry(
    userData,
    {
      event: "generation_rotated",
      decisionId: String(fields.decisionId || `rot_${Date.now().toString(36)}`),
      policyVersion: String(fields.policyVersion || "p1-04-v1"),
      requestDigest: "",
      actor: String(fields.actor || "owner:settings"),
      purpose: "audit_maintenance",
      action: "rotate_generation",
      dataScopes: [],
      destination: "local_ledger",
      approval: sanitizeApproval(fields.approval),
      outcome: {
        status: "rotated",
        fromGeneration: previousGeneration,
        toGeneration: nextGeneration,
        previousGenerationLastHash: resolved.state.lastHash,
      },
    },
    { generation: nextGeneration }
  );
  return {
    ok: true,
    previousGeneration,
    currentGeneration: nextGeneration,
    entry,
    verify: verify(userData),
  };
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
  digestOutput,
  ledgerPath,
  list,
  metaPath,
  parseMeta,
  readGenerationLines,
  resolveState,
  rotate,
  verify,
  verifyGeneration,
  writeMetaAtomic,
  GENESIS_HASH,
};

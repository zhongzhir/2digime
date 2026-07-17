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

function isPristineEmptyMeta(meta) {
  return (
    meta &&
    meta.currentGeneration === 1 &&
    meta.lastSequence === 0 &&
    meta.lastHash === GENESIS_HASH &&
    (meta.generationCount == null || meta.generationCount === 1)
  );
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
  if (outcome.statusCode) row.statusCode = String(outcome.statusCode).slice(0, 64);
  if (outcome.spawned === false) row.spawned = false;
  if (outcome.spawned === true) row.spawned = true;
  if (outcome.exitCode != null) row.exitCode = Number(outcome.exitCode);
  if (outcome.outputLength != null) row.outputLength = Number(outcome.outputLength);
  if (outcome.outputSha256) row.outputSha256 = String(outcome.outputSha256).slice(0, 64);
  if (outcome.outputDigestKind) {
    row.outputDigestKind = String(outcome.outputDigestKind).slice(0, 32);
  }
  if (outcome.retainedLength != null) row.retainedLength = Number(outcome.retainedLength);
  if (outcome.retainedSha256) row.retainedSha256 = String(outcome.retainedSha256).slice(0, 64);
  if (outcome.totalBytes != null) row.totalBytes = Number(outcome.totalBytes);
  if (outcome.retainedBytes != null) row.retainedBytes = Number(outcome.retainedBytes);
  if (outcome.stdoutLen != null) row.stdoutLen = Number(outcome.stdoutLen);
  if (outcome.stderrLen != null) row.stderrLen = Number(outcome.stderrLen);
  if (outcome.truncated) row.truncated = true;
  if (outcome.timedOut) row.timedOut = true;
  if (outcome.cancelled) row.cancelled = true;
  if (outcome.orphanRisk) row.orphanRisk = true;
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
      issues.push({
        type: "sequence_gap",
        expected: expectedSequence,
        got: entry.sequence,
        line: i + 1,
        generation,
      });
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

function verifyGenerationLinks(generations) {
  const issues = [];
  for (let i = 1; i < generations.length; i++) {
    const prev = generations[i - 1];
    const curr = generations[i];
    if (!curr || !curr.exists) continue;
    if (!curr.entries.length) {
      issues.push({ type: "missing_generation_rotated", generation: curr.generation });
      continue;
    }
    const first = curr.entries[0];
    if (first.event !== "generation_rotated") {
      issues.push({ type: "missing_generation_rotated", generation: curr.generation });
      continue;
    }
    const outcome = first.outcome || {};
    if (Number(outcome.fromGeneration) !== prev.generation) {
      issues.push({
        type: "generation_link_from_mismatch",
        generation: curr.generation,
        expected: prev.generation,
        got: outcome.fromGeneration,
      });
    }
    if (Number(outcome.toGeneration) !== curr.generation) {
      issues.push({
        type: "generation_link_to_mismatch",
        generation: curr.generation,
        expected: curr.generation,
        got: outcome.toGeneration,
      });
    }
    if (String(outcome.previousGenerationLastHash || "") !== String(prev.lastHash)) {
      issues.push({
        type: "generation_link_hash_mismatch",
        generation: curr.generation,
        expected: prev.lastHash,
        got: outcome.previousGenerationLastHash || "",
      });
    }
  }
  return issues;
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
  issues.push(...verifyGenerationLinks(generations));
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

function prefixHashAt(generationResult, sequence) {
  if (sequence === 0) return GENESIS_HASH;
  if (!generationResult || !generationResult.entries || generationResult.entries.length < sequence) {
    return null;
  }
  return generationResult.entries[sequence - 1].entryHash;
}

/**
 * Decide whether meta may be uniquely advanced to the verified ledger tip.
 * Recovery is forward-only: never roll generation or sequence backward.
 */
function assessRecovery(metaResult, ledgerFact) {
  if (!ledgerFact.healthy) {
    return { recoverable: false, reason: "ledger_unhealthy" };
  }

  // Missing or corrupt meta: recover to ledger tip only when ledger exists.
  // Empty ledger + missing meta is handled as initialize, not recover.
  // Empty ledger + corrupt meta is unhealthy (cannot prove first-create vs deletion).
  if (!metaResult.ok) {
    if (ledgerFact.source === "empty") {
      return {
        recoverable: false,
        reason: metaResult.reason === "meta_missing" ? "needs_initialize" : "meta_corrupt_empty",
      };
    }
    return {
      recoverable: true,
      reason: "meta_unreadable_ledger_tip",
      target: {
        version: META_VERSION,
        currentGeneration: ledgerFact.currentGeneration,
        lastSequence: ledgerFact.lastSequence,
        lastHash: ledgerFact.lastHash,
        generationCount: ledgerFact.generationCount,
      },
    };
  }

  const meta = metaResult.meta;

  // Meta claims history but every ledger disappeared.
  if (ledgerFact.source === "empty") {
    if (isPristineEmptyMeta(meta)) {
      return { recoverable: false, reason: "already_consistent_empty" };
    }
    return { recoverable: false, reason: "ledgers_deleted" };
  }

  const genMap = new Map(ledgerFact.generations.map((g) => [g.generation, g]));

  // Exact tip match (generationCount may lag after older meta writes).
  if (
    meta.currentGeneration === ledgerFact.currentGeneration &&
    meta.lastSequence === ledgerFact.lastSequence &&
    meta.lastHash === ledgerFact.lastHash
  ) {
    if ((meta.generationCount || meta.currentGeneration) === ledgerFact.generationCount) {
      return { recoverable: false, reason: "already_consistent" };
    }
    return {
      recoverable: true,
      reason: "generation_count_lag",
      target: {
        version: META_VERSION,
        currentGeneration: ledgerFact.currentGeneration,
        lastSequence: ledgerFact.lastSequence,
        lastHash: ledgerFact.lastHash,
        generationCount: ledgerFact.generationCount,
      },
    };
  }

  // Meta points past existing ledger tip → truncation / deletion.
  if (meta.currentGeneration > ledgerFact.currentGeneration) {
    return { recoverable: false, reason: "meta_ahead_generation" };
  }

  const metaGen = genMap.get(meta.currentGeneration);
  if (!metaGen || !metaGen.healthy) {
    return { recoverable: false, reason: "meta_generation_missing" };
  }

  if (meta.lastSequence > metaGen.lastSequence) {
    return { recoverable: false, reason: "meta_ahead_sequence" };
  }

  const expectedPrefixHash = prefixHashAt(metaGen, meta.lastSequence);
  if (expectedPrefixHash == null || expectedPrefixHash !== meta.lastHash) {
    return { recoverable: false, reason: "meta_hash_prefix_mismatch" };
  }

  // Same generation: ledger ahead of a verified meta prefix.
  if (meta.currentGeneration === ledgerFact.currentGeneration) {
    if (meta.lastSequence < ledgerFact.lastSequence) {
      return {
        recoverable: true,
        reason: "ledger_ahead_same_generation",
        target: {
          version: META_VERSION,
          currentGeneration: ledgerFact.currentGeneration,
          lastSequence: ledgerFact.lastSequence,
          lastHash: ledgerFact.lastHash,
          generationCount: ledgerFact.generationCount,
        },
      };
    }
    // same sequence already handled by hash check above
    return { recoverable: false, reason: "meta_hash_mismatch" };
  }

  // Rotate crash: meta still at gen N tip; gen N+1..tip exist and link correctly.
  if (meta.currentGeneration < ledgerFact.currentGeneration) {
    if (meta.lastSequence !== metaGen.lastSequence || meta.lastHash !== metaGen.lastHash) {
      return { recoverable: false, reason: "meta_not_at_generation_tip" };
    }
    // Links already validated in buildLedgerFact when healthy.
    return {
      recoverable: true,
      reason: "ledger_ahead_after_rotate",
      target: {
        version: META_VERSION,
        currentGeneration: ledgerFact.currentGeneration,
        lastSequence: ledgerFact.lastSequence,
        lastHash: ledgerFact.lastHash,
        generationCount: ledgerFact.generationCount,
      },
    };
  }

  return { recoverable: false, reason: "unrecoverable" };
}

function resolveState(userData, options = {}) {
  ensureDir(userData);
  const metaResult = parseMeta(userData);
  const ledgerFact = buildLedgerFact(userData);
  const assessment = assessRecovery(metaResult, ledgerFact);
  const issues = [...ledgerFact.issues];

  if (!metaResult.ok) issues.push({ type: metaResult.reason });
  if (assessment.reason === "ledgers_deleted") issues.push({ type: "ledgers_deleted" });
  if (assessment.reason === "meta_ahead_generation") issues.push({ type: "meta_ahead_generation" });
  if (assessment.reason === "meta_ahead_sequence") issues.push({ type: "meta_ahead_sequence" });
  if (assessment.reason === "meta_hash_prefix_mismatch" || assessment.reason === "meta_hash_mismatch") {
    issues.push({ type: "meta_hash_mismatch" });
  }
  if (assessment.reason === "meta_corrupt_empty") issues.push({ type: "meta_corrupt_empty" });

  if (options.allowInitialize && assessment.reason === "needs_initialize") {
    const meta = defaultMeta();
    writeMetaAtomic(userData, meta);
    return { ok: true, recovered: true, state: meta, verify: verify(userData), assessment };
  }

  if (metaResult.ok && assessment.reason === "already_consistent") {
    return { ok: true, recovered: false, state: metaResult.meta, verify: verify(userData), assessment };
  }
  if (metaResult.ok && assessment.reason === "already_consistent_empty") {
    return { ok: true, recovered: false, state: metaResult.meta, verify: verify(userData), assessment };
  }

  if (options.allowRecover && assessment.recoverable && assessment.target) {
    writeMetaAtomic(userData, assessment.target);
    return {
      ok: true,
      recovered: true,
      state: assessment.target,
      verify: verify(userData),
      assessment,
    };
  }

  return {
    ok: false,
    recovered: false,
    issues,
    assessment,
    verify: verify(userData),
  };
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
    toolId: String(fields.toolId || ""),
    definitionVersion: String(fields.definitionVersion || ""),
    planDigest: String(fields.planDigest || ""),
    envKeyNames: Array.isArray(fields.envKeyNames)
      ? fields.envKeyNames.map((k) => String(k)).filter(Boolean).sort()
      : [],
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
  if (generation < resolved.state.currentGeneration) {
    const err = new Error("决策记录完整性异常，已阻止高风险执行。");
    err.code = "audit_unhealthy";
    throw err;
  }
  const state =
    generation === resolved.state.currentGeneration
      ? resolved.state
      : {
          version: META_VERSION,
          currentGeneration: generation,
          lastSequence: 0,
          lastHash: GENESIS_HASH,
        };
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
  const assessment = assessRecovery(metaResult, ledgerFact);
  const issues = [...ledgerFact.issues];
  let healthy = ledgerFact.healthy;
  let meta = null;

  if (!metaResult.ok) {
    healthy = false;
    issues.push({ type: metaResult.reason });
  } else {
    meta = metaResult.meta;
  }

  if (assessment.reason === "already_consistent" || assessment.reason === "already_consistent_empty") {
    return {
      healthy: healthy && metaResult.ok,
      meta,
      generations: ledgerFact.generations,
      issues,
      availableGenerations: ledgerFact.generations.map((item) => item.generation),
      assessment,
    };
  }

  if (
    assessment.reason === "ledger_ahead_same_generation" ||
    assessment.reason === "ledger_ahead_after_rotate" ||
    assessment.reason === "meta_unreadable_ledger_tip" ||
    assessment.reason === "generation_count_lag"
  ) {
    // Recoverable lag is not healthy until meta is repaired.
    healthy = false;
    issues.push({ type: "meta_lagging", reason: assessment.reason });
  } else if (assessment.reason === "needs_initialize") {
    healthy = false;
    issues.push({ type: "meta_missing" });
  } else if (assessment.reason !== "already_consistent") {
    healthy = false;
    if (assessment.reason) issues.push({ type: assessment.reason });
  }

  return {
    healthy,
    meta,
    generations: ledgerFact.generations,
    issues,
    availableGenerations: ledgerFact.generations.map((item) => item.generation),
    assessment,
  };
}

function list(userData, { limit, generation } = {}) {
  const full = verify(userData);
  const available = full.availableGenerations;
  const gen =
    generation != null
      ? Number(generation)
      : full.meta
        ? full.meta.currentGeneration
        : available[available.length - 1] || 1;
  const selected =
    full.generations.find((item) => item.generation === gen) || verifyGeneration(userData, gen);
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
    outputDigestKind: "legacy_retained_or_full",
  };
}

/**
 * Prefer executor-provided stream metrics. Never label a truncated retained prefix as the full digest.
 */
function digestExecutionOutput(result) {
  if (!result || typeof result !== "object") {
    return digestOutput("");
  }
  const truncated = !!result.truncated;
  const fullSha = String(result.fullOutputSha256 || "");
  const retainedSha = String(result.retainedSha256 || "");
  const totalBytes = Number(result.totalBytes) || 0;
  const retainedBytes = Number(result.retainedBytes) || 0;
  if (fullSha) {
    return {
      outputLength: totalBytes,
      outputSha256: fullSha,
      outputDigestKind: truncated ? "full_stream" : "full",
      retainedLength: retainedBytes,
      retainedSha256: retainedSha || undefined,
      truncated,
    };
  }
  // Fallback: hashing retained text only — must not claim "full" when truncated.
  const legacy = digestOutput(result.output || "");
  return {
    outputLength: truncated ? totalBytes || legacy.outputLength : legacy.outputLength,
    outputSha256: legacy.outputSha256,
    outputDigestKind: truncated ? "retained_prefix" : "full",
    retainedLength: retainedBytes || legacy.outputLength,
    retainedSha256: retainedSha || legacy.outputSha256,
    truncated,
  };
}

module.exports = {
  AUDIT_DIR_NAME,
  auditRoot,
  appendEntry,
  assessRecovery,
  digestOutput,
  digestExecutionOutput,
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

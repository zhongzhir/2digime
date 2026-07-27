"use strict";

/**
 * CRT-MVP SubjectContextAssembler
 * Read-only: distillMe + long-term memory → SubjectAssembly (budgeted).
 * CRT-MVP-02: optional contextClass/policy from Subject Context Engine.
 * Layers schema is forward-compatible; MVP activates identity/knowledge/experience/memory (+ preference when present).
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const distillMe = require("../distill-me");
const { readManifest } = require("../package-store");
const { classifyMemoryAsset } = require("./project-knowledge-retrieval");

const LAYER_KEYS = Object.freeze([
  "identity",
  "preference",
  "knowledge",
  "experience",
  "judgment",
  "skill",
  "memory",
  "artifactHistory",
]);

const MVP_ACTIVE_LAYERS = Object.freeze([
  "identity",
  "preference",
  "knowledge",
  "experience",
  "memory",
]);

function nowIso() {
  return new Date().toISOString();
}

function newAssemblyId() {
  return "asm_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
}

function sha256Text(text) {
  return "sha256:" + crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function emptyLayers() {
  const layers = {};
  for (const k of LAYER_KEYS) layers[k] = [];
  return layers;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^\u4e00-\u9fff\w]+/)
    .filter((t) => t.length >= 2)
    .slice(0, 80);
}

function scoreAsset(asset, queryTokens, priorityLayers) {
  const hay = tokenize(asset.statement).concat(tokenize(asset.layer));
  let overlap = 0;
  const set = new Set(hay);
  for (const t of queryTokens) {
    if (set.has(t)) overlap += 1;
  }
  let confBoost = 0;
  const c = String(asset.confidence || "").toLowerCase();
  if (c === "high") confBoost = 3;
  else if (c === "medium") confBoost = 1.5;
  else if (c === "low" || asset.activationState === "active_low_confidence") confBoost = 0.5;
  const layerBoost =
    asset.layer === "identity" ? 4 : asset.layer === "judgment" ? 3 : asset.layer === "memory" ? 1 : 2;
  const pri = Array.isArray(priorityLayers) ? priorityLayers : [];
  const priBoost = pri.includes(asset.layer) ? 2 : 0;
  // Judgment candidates rank lower than active experience/knowledge.
  const candidatePenalty =
    asset.logicalState === "judgment_candidate" ||
    asset.learnKind === "new_judgment" ||
    asset.learnKind === "decision_pattern"
      ? -1.5
      : 0;
  const recency = asset.updatedAt ? 1 : 0;
  return overlap * 3 + confBoost + layerBoost + priBoost + candidatePenalty + recency;
}

function packageIdentity(packageDir) {
  if (!packageDir || !fs.existsSync(packageDir)) {
    return { packageId: null, packageVersion: null };
  }
  try {
    const m = readManifest(packageDir) || {};
    return {
      packageId: String(m.packageId || m.digitalMeId || m.subjectId || m.name || "local-package"),
      packageVersion: String(m.packageVersion || m.version || m.revision || "unknown"),
    };
  } catch {
    return { packageId: null, packageVersion: null };
  }
}

/**
 * Load distill items: confirmed|edited → active; proposed → active_low (auto-absorb, no trainer UX).
 */
function loadDistillAssets(packageDir) {
  if (!packageDir || !fs.existsSync(packageDir)) return [];
  let data;
  try {
    data = distillMe.read(packageDir);
  } catch {
    return [];
  }
  const items = Array.isArray(data.items) ? data.items : [];
  const out = [];
  for (const item of items) {
    if (!item || !item.statement) continue;
    const st = String(item.status || "");
    let activationState = null;
    if (st === "confirmed" || st === "edited") activationState = "active";
    else if (st === "proposed") activationState = "active_low_confidence";
    else continue;
    const cat = String(item.category || "fact");
    const layer =
      cat === "identity"
        ? "identity"
        : cat === "experience"
          ? "experience"
          : cat === "preference"
            ? "preference"
            : "knowledge";
    out.push({
      assetId: String(item.id),
      layer,
      statement: String(item.statement).trim(),
      confidence: item.confidence || (activationState === "active" ? "medium" : "low"),
      activationState,
      logicalState: activationState === "active" ? "active" : "active_low",
      learnKind: null,
      source: "distill_me",
      updatedAt: item.updatedAt || item.confirmedAt || item.createdAt || null,
      contentHash: sha256Text(item.statement),
    });
  }
  return out;
}

/**
 * Read memory jsonl — includes active_low_confidence rows from auto-learn.
 */
function loadMemoryAssets(packageDir, maxScan) {
  if (!packageDir) return [];
  const p = path.join(packageDir, "memory", "long-term-memory.jsonl");
  if (!fs.existsSync(p)) return [];
  const limit = Number(maxScan) > 0 ? Number(maxScan) : 200;
  try {
    const lines = fs.readFileSync(p, "utf8").split(/\n+/).filter(Boolean);
    const slice = lines.slice(-limit);
    const out = [];
    for (let i = 0; i < slice.length; i += 1) {
      let row;
      try {
        row = JSON.parse(slice[i]);
      } catch {
        continue;
      }
      if (!row) continue;
      const status = String(row.status || row.activationState || "active").toLowerCase();
      if (status === "deprecated" || status === "revoked" || status === "deleted") continue;
      if (String(row.logicalState || "") === "session_only") continue;
      const statement = String(row.content || row.statement || row.text || "").trim();
      if (!statement || statement.length < 4) continue;
      const assetId =
        row.id ||
        row.assetId ||
        "mem_" + sha256Text(statement + "|" + (row.createdAt || i)).slice(7, 23);
      const memGovernance = classifyMemoryAsset({ assetId, statement });
      if (memGovernance.excluded) continue;
      const learnKind = row.learnKind ? String(row.learnKind) : null;
      const logicalState =
        row.logicalState ||
        (learnKind === "new_judgment" || learnKind === "decision_pattern"
          ? "judgment_candidate"
          : row.activationState ||
            (String(row.confidence || "").toLowerCase() === "low"
              ? "active_low_confidence"
              : "active"));
      const activationState =
        row.activationState ||
        (logicalState === "judgment_candidate"
          ? "active_low_confidence"
          : String(row.confidence || "").toLowerCase() === "low"
            ? "active_low_confidence"
            : "active");
      const id =
        assetId;
      out.push({
        assetId: String(id),
        layer: "memory",
        statement,
        confidence: row.confidence || "low",
        activationState,
        logicalState,
        learnKind,
        source: "long_term_memory",
        memoryType: row.type || "semantic",
        ownership: row.ownership || "subject_owned",
        updatedAt: row.updatedAt || row.createdAt || null,
        contentHash: sha256Text(statement),
        usageCount: Number(row.usageCount || row.reinforcement || 0) || 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function defaultLimits(limits, policy) {
  const topK = (policy && policy.layerTopK) || {};
  return {
    subjectCharsLimit:
      (limits && limits.subjectCharsLimit) ||
      (policy && policy.maxSubjectChars) ||
      8000,
    maxIdentity: (limits && limits.maxIdentity) || topK.identity || 12,
    maxPreference: (limits && limits.maxPreference) || topK.preference || 6,
    maxKnowledge: (limits && limits.maxKnowledge) || topK.knowledge || 10,
    maxExperience: (limits && limits.maxExperience) || topK.experience || 8,
    maxJudgment: (limits && limits.maxJudgment) || topK.judgment || 0,
    maxMemory: (limits && limits.maxMemory) || topK.memory || 8,
    memoryScan: (limits && limits.memoryScan) || 200,
  };
}

function selectTop(assets, maxN, queryTokens, priorityLayers) {
  return assets
    .map((a) => ({
      ...a,
      _score: scoreAsset(a, queryTokens, priorityLayers) + (a.usageCount || 0) * 0.25,
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, Math.max(0, maxN));
}

function renderAndBudget(selectedByLayer, subjectCharsLimit, enabledLayers) {
  const parts = [];
  const refs = [];
  const excludedSample = [];
  let used = 0;
  let truncated = false;

  const order = ["identity", "preference", "knowledge", "experience", "judgment", "memory"];
  const enabled = Array.isArray(enabledLayers) ? enabledLayers : order;
  for (const layer of order) {
    if (!enabled.includes(layer)) continue;
    const list = selectedByLayer[layer] || [];
    if (!list.length) continue;
    const header = `【${layer}】\n`;
    let layerOpened = false;
    for (const asset of list) {
      const line = `- ${asset.statement}\n`;
      const cost = (layerOpened ? 0 : header.length) + line.length;
      if (used + cost > subjectCharsLimit) {
        truncated = true;
        excludedSample.push({
          assetId: asset.assetId,
          reason: "token_budget_exhausted",
          layer,
        });
        asset.included = false;
        continue;
      }
      if (!layerOpened) {
        parts.push(header);
        used += header.length;
        layerOpened = true;
      }
      parts.push(line);
      used += line.length;
      asset.included = true;
      refs.push({
        assetId: asset.assetId,
        layer: asset.layer,
        source: asset.source,
        contentHash: asset.contentHash,
        included: true,
        activationState: asset.activationState || null,
        confidence: asset.confidence || null,
        learnKind: asset.learnKind || null,
        logicalState: asset.logicalState || null,
        statement: asset.statement,
      });
    }
  }

  return {
    renderedText: parts.join("").trim(),
    refs,
    excludedSample: excludedSample.slice(0, 40),
    used,
    truncated,
  };
}

function emptyAssemblyShell({
  assemblyId,
  packageId,
  packageVersion,
  queryKeyDigest,
  emptyReason,
  limits,
  contextClass,
}) {
  return {
    schemaVersion: 1,
    assemblyId,
    assembledAt: nowIso(),
    packageId,
    packageVersion,
    queryKeyDigest,
    emptyReason,
    contextClass: contextClass || null,
    layers: emptyLayers(),
    renderedText: "",
    budget: {
      subjectCharsLimit: limits.subjectCharsLimit,
      subjectCharsUsed: 0,
      truncated: false,
    },
    policy: { excludedCount: 0, excludedSample: [], skippedByContext: [] },
    refs: [],
  };
}

/**
 * @param {{ packageDir?: string|null, query?: object, limits?: object, policy?: object, contextClass?: string }} input
 * @returns {object} SubjectAssembly
 */
function assembleSubjectContext(input) {
  const packageDir = input && input.packageDir ? String(input.packageDir) : null;
  const query = (input && input.query) || {};
  const policy = (input && input.policy) || null;
  const contextClass =
    (input && input.contextClass) || (policy && policy.contextClass) || null;
  const limits = defaultLimits(input && input.limits, policy);
  const enabledLayers =
    (policy && Array.isArray(policy.enabledLayers) && policy.enabledLayers) ||
    MVP_ACTIVE_LAYERS.slice();
  const priorityLayers = (policy && policy.priorityLayers) || ["identity", "knowledge"];
  const { packageId, packageVersion } = packageIdentity(packageDir);
  const assemblyId = newAssemblyId();
  const layers = emptyLayers();

  const queryBlob = [
    query.goal,
    query.audience,
    query.usage,
    query.constraints,
    query.deliverableKind,
    query.deliverableTitle,
    query.deliverablePurpose,
    ...(Array.isArray(query.attachmentKeywords) ? query.attachmentKeywords : []),
  ]
    .filter(Boolean)
    .join(" ");
  const queryTokens = tokenize(queryBlob);
  const queryKeyDigest = sha256Text(
    JSON.stringify({
      goal: query.goal || "",
      audience: query.audience || "",
      kind: query.deliverableKind || "",
      title: query.deliverableTitle || "",
      contextClass: contextClass || "",
    })
  );

  if (!packageDir || !fs.existsSync(packageDir)) {
    return emptyAssemblyShell({
      assemblyId,
      packageId: null,
      packageVersion: null,
      queryKeyDigest,
      emptyReason: "no_package",
      limits,
      contextClass,
    });
  }

  const distillAssets = loadDistillAssets(packageDir);
  const memoryAssets = loadMemoryAssets(packageDir, limits.memoryScan);
  const catalog = distillAssets.concat(memoryAssets).filter((a) => enabledLayers.includes(a.layer));

  if (!catalog.length) {
    return emptyAssemblyShell({
      assemblyId,
      packageId,
      packageVersion,
      queryKeyDigest,
      emptyReason: "no_active_assets",
      limits,
      contextClass,
    });
  }

  const byLayer = {
    identity: selectTop(
      catalog.filter((a) => a.layer === "identity"),
      limits.maxIdentity,
      queryTokens,
      priorityLayers
    ),
    preference: selectTop(
      catalog.filter((a) => a.layer === "preference"),
      limits.maxPreference,
      queryTokens,
      priorityLayers
    ),
    knowledge: selectTop(
      catalog.filter((a) => a.layer === "knowledge"),
      limits.maxKnowledge,
      queryTokens,
      priorityLayers
    ),
    experience: selectTop(
      catalog.filter((a) => a.layer === "experience"),
      limits.maxExperience,
      queryTokens,
      priorityLayers
    ),
    judgment: selectTop(
      catalog.filter((a) => a.layer === "judgment"),
      limits.maxJudgment,
      queryTokens,
      priorityLayers
    ),
    memory: selectTop(
      catalog.filter((a) => a.layer === "memory"),
      limits.maxMemory,
      queryTokens,
      priorityLayers
    ),
  };

  const budgeted = renderAndBudget(byLayer, limits.subjectCharsLimit, enabledLayers);

  let renderedText = budgeted.renderedText;
  const projectPrefix =
    input && input.projectRenderedText ? String(input.projectRenderedText).trim() : "";
  if (projectPrefix) {
    const combined = projectPrefix + (renderedText ? "\n\n" + renderedText : "");
    if (combined.length <= limits.subjectCharsLimit) {
      renderedText = combined;
      budgeted.used = combined.length;
    } else {
      renderedText = projectPrefix.slice(0, limits.subjectCharsLimit);
      budgeted.used = renderedText.length;
      budgeted.truncated = true;
    }
  }

  for (const layer of LAYER_KEYS) {
    if (!MVP_ACTIVE_LAYERS.includes(layer) && layer !== "judgment") {
      layers[layer] = [];
      continue;
    }
    if (!enabledLayers.includes(layer)) {
      layers[layer] = [];
      continue;
    }
    const selected = byLayer[layer] || [];
    layers[layer] = selected.map((a) => ({
      assetId: a.assetId,
      layer: a.layer,
      statement: a.statement,
      confidence: a.confidence,
      activationState: a.activationState || null,
      logicalState: a.logicalState || null,
      learnKind: a.learnKind || null,
      source: a.source,
      included: !!a.included,
      truncated: false,
      contentHash: a.contentHash,
    }));
  }

  const skippedLayers = LAYER_KEYS.filter((l) => !enabledLayers.includes(l));
  const excludedFromSelect = catalog.length - budgeted.refs.length;
  const emptyReason =
    budgeted.refs.length === 0
      ? limits.subjectCharsLimit <= 0
        ? "budget_zero"
        : "no_active_assets"
      : null;

  return {
    schemaVersion: 1,
    assemblyId,
    assembledAt: nowIso(),
    packageId,
    packageVersion,
    queryKeyDigest,
    emptyReason,
    contextClass,
    layers,
    renderedText: renderedText,
    budget: {
      subjectCharsLimit: limits.subjectCharsLimit,
      subjectCharsUsed: budgeted.used,
      truncated: budgeted.truncated,
    },
    policy: {
      excludedCount: Math.max(0, excludedFromSelect),
      excludedSample: budgeted.excludedSample,
      skippedByContext: skippedLayers.map((layer) => ({ layer, reason: "disabled_by_policy" })),
      enabledLayers,
      contextClass,
    },
    refs: budgeted.refs,
  };
}

module.exports = {
  assembleSubjectContext,
  loadDistillAssets,
  loadMemoryAssets,
  LAYER_KEYS,
  MVP_ACTIVE_LAYERS,
  emptyLayers,
  sha256Text,
};

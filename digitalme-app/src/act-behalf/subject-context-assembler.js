"use strict";

/**
 * CRT-MVP SubjectContextAssembler
 * Read-only: distillMe + long-term memory → SubjectAssembly (budgeted).
 * Layers schema is forward-compatible; MVP activates identity/knowledge/experience/memory.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const distillMe = require("../distill-me");
const { readManifest } = require("../package-store");

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

const MVP_ACTIVE_LAYERS = Object.freeze(["identity", "knowledge", "experience", "memory"]);

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

function scoreAsset(asset, queryTokens) {
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
  const recency = asset.updatedAt ? Math.min(2, 1) : 0;
  return overlap * 3 + confBoost + layerBoost + recency;
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
      cat === "identity" ? "identity" : cat === "experience" ? "experience" : "knowledge";
    out.push({
      assetId: String(item.id),
      layer,
      statement: String(item.statement).trim(),
      confidence: item.confidence || (activationState === "active" ? "medium" : "low"),
      activationState,
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
      const statement = String(row.content || row.statement || row.text || "").trim();
      if (!statement || statement.length < 4) continue;
      const activationState =
        row.activationState ||
        (String(row.confidence || "").toLowerCase() === "low"
          ? "active_low_confidence"
          : "active");
      const id =
        row.id ||
        row.assetId ||
        "mem_" + sha256Text(statement + "|" + (row.createdAt || i)).slice(7, 23);
      out.push({
        assetId: String(id),
        layer: "memory",
        statement,
        confidence: row.confidence || "low",
        activationState,
        source: "long_term_memory",
        memoryType: row.type || "semantic",
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

function defaultLimits(limits) {
  return {
    subjectCharsLimit: (limits && limits.subjectCharsLimit) || 8000,
    maxIdentity: (limits && limits.maxIdentity) || 12,
    maxKnowledge: (limits && limits.maxKnowledge) || 10,
    maxExperience: (limits && limits.maxExperience) || 8,
    maxMemory: (limits && limits.maxMemory) || 8,
    memoryScan: (limits && limits.memoryScan) || 200,
  };
}

function selectTop(assets, maxN, queryTokens) {
  return assets
    .map((a) => ({ ...a, _score: scoreAsset(a, queryTokens) + (a.usageCount || 0) * 0.25 }))
    .sort((a, b) => b._score - a._score)
    .slice(0, Math.max(0, maxN));
}

function renderAndBudget(selectedByLayer, subjectCharsLimit) {
  const parts = [];
  const refs = [];
  const excludedSample = [];
  let used = 0;
  let truncated = false;

  const order = ["identity", "knowledge", "experience", "memory"];
  for (const layer of order) {
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

/**
 * @param {{ packageDir?: string|null, query?: object, limits?: object }} input
 * @returns {object} SubjectAssembly
 */
function assembleSubjectContext(input) {
  const packageDir = input && input.packageDir ? String(input.packageDir) : null;
  const query = (input && input.query) || {};
  const limits = defaultLimits(input && input.limits);
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
    })
  );

  if (!packageDir || !fs.existsSync(packageDir)) {
    return {
      schemaVersion: 1,
      assemblyId,
      assembledAt: nowIso(),
      packageId: null,
      packageVersion: null,
      queryKeyDigest,
      emptyReason: "no_package",
      layers,
      renderedText: "",
      budget: {
        subjectCharsLimit: limits.subjectCharsLimit,
        subjectCharsUsed: 0,
        truncated: false,
      },
      policy: { excludedCount: 0, excludedSample: [] },
      refs: [],
    };
  }

  const distillAssets = loadDistillAssets(packageDir);
  const memoryAssets = loadMemoryAssets(packageDir, limits.memoryScan);
  const catalog = distillAssets.concat(memoryAssets);

  if (!catalog.length) {
    return {
      schemaVersion: 1,
      assemblyId,
      assembledAt: nowIso(),
      packageId,
      packageVersion,
      queryKeyDigest,
      emptyReason: "no_active_assets",
      layers,
      renderedText: "",
      budget: {
        subjectCharsLimit: limits.subjectCharsLimit,
        subjectCharsUsed: 0,
        truncated: false,
      },
      policy: { excludedCount: 0, excludedSample: [] },
      refs: [],
    };
  }

  const byLayer = {
    identity: selectTop(
      catalog.filter((a) => a.layer === "identity"),
      limits.maxIdentity,
      queryTokens
    ),
    knowledge: selectTop(
      catalog.filter((a) => a.layer === "knowledge"),
      limits.maxKnowledge,
      queryTokens
    ),
    experience: selectTop(
      catalog.filter((a) => a.layer === "experience"),
      limits.maxExperience,
      queryTokens
    ),
    memory: selectTop(
      catalog.filter((a) => a.layer === "memory"),
      limits.maxMemory,
      queryTokens
    ),
  };

  const budgeted = renderAndBudget(byLayer, limits.subjectCharsLimit);

  // Populate layers: MVP-active layers get views; others stay [].
  for (const layer of LAYER_KEYS) {
    if (!MVP_ACTIVE_LAYERS.includes(layer)) {
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
      source: a.source,
      included: !!a.included,
      truncated: false,
      contentHash: a.contentHash,
    }));
  }

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
    layers,
    renderedText: budgeted.renderedText,
    budget: {
      subjectCharsLimit: limits.subjectCharsLimit,
      subjectCharsUsed: budgeted.used,
      truncated: budgeted.truncated,
    },
    policy: {
      excludedCount: Math.max(0, excludedFromSelect),
      excludedSample: budgeted.excludedSample,
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

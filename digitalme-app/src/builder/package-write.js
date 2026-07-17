"use strict";

/**
 * Builder persona writes via PackageStore (P1-06).
 * Preview creates a candidate change set (package bytes unchanged).
 * Commit requires main-process confirmation + non-expired changeSetId.
 *
 * Identity / Life writes are out of scope — remain on life.writeLifeBack.
 */

const fs = require("node:fs");
const path = require("node:path");
const { PackageStore, readManifest, storeRootFor } = require("../package-store");

function hasReplacementChar(value) {
  if (value == null) return false;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value).includes("\uFFFD");
    } catch {
      return false;
    }
  }
  return String(value).includes("\uFFFD");
}

const ACTOR = "owner:builder";
const DATA_KINDS = Object.freeze(["inference"]);
const CHANGESET_TTL_MS = 15 * 60 * 1000;
const MAX_MEMORIES_PER_SET = 40;

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function isoNow() {
  return new Date().toISOString();
}

function openStore(packageDir, storeHooks) {
  return new PackageStore({
    packageDir,
    hooks: storeHooks || {},
    ownerId: ACTOR,
  });
}

function readText(pkgDir, rel) {
  const abs = path.join(pkgDir, rel);
  if (!fs.existsSync(abs)) return "";
  return fs.readFileSync(abs, "utf8");
}

function readJson(pkgDir, rel, fallback) {
  const abs = path.join(pkgDir, rel);
  if (!fs.existsSync(abs)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return fallback;
  }
}

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildSourceMeta(input) {
  const filePath = String((input && input.filePath) || "");
  const title = String((input && input.title) || path.basename(filePath) || "素材");
  const base = path.basename(filePath || title || "source");
  const id =
    (input && input.id) ||
    "src_" + base.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40) + "_" + Date.now().toString(36);
  return {
    id,
    type: (input && input.type) || "document",
    title,
    author: (input && input.author) || "",
    createdAt: (input && input.createdAt) || isoNow(),
    location: filePath || (input && input.location) || "",
    sensitivity: "private",
    usedFor: ["style-guide", "persona", "decision-frameworks", "long-term-memory"],
    materialKind: "persona",
  };
}

function countAgg(agg) {
  if (!agg || typeof agg !== "object") return 0;
  return (
    (agg.styleObservations || []).length +
    (agg.personaNotes || []).length +
    (agg.decisionFrameworks || []).length +
    (agg.memories || []).length
  );
}

/**
 * Map distill aggregate → PackageStore ops. Computes write_text payloads from
 * current package bytes so commit conflicts if those files change meanwhile.
 */
function aggToOps(packageDir, agg, sourceMeta) {
  const ops = [];
  const sourceId = sourceMeta.id;
  const sourceTitle = sourceMeta.title || sourceId;
  const now = isoNow();

  // sources/source-index.json
  const indexRel = "sources/source-index.json";
  const indexData = readJson(packageDir, indexRel, { sources: [] });
  if (!Array.isArray(indexData.sources)) indexData.sources = [];
  if (!indexData.sources.some((s) => s && s.id === sourceId)) {
    indexData.sources.push({ ...sourceMeta });
    ops.push({
      type: "write_text",
      path: indexRel,
      content: JSON.stringify(indexData, null, 2) + "\n",
    });
  }

  // memories → append_jsonl
  const memories = (agg.memories || []).filter(
    (m) => m && m.content && !hasReplacementChar(m.content)
  );
  if (memories.length > MAX_MEMORIES_PER_SET) {
    throw err("too_many_memories", "单次可写入记忆过多，请减少勾选后重试。");
  }
  for (const m of memories) {
    ops.push({
      type: "append_jsonl",
      path: "memory/long-term-memory.jsonl",
      row: {
        type: "long_term",
        content: m.content,
        confidence: m.confidence || "medium",
        sensitivity: "private",
        sourceRefs: [sourceId],
        expiresAt: null,
        theme: m.theme || "构建蒸馏",
      },
    });
  }

  // decision-frameworks.json → write_text merge
  const frameworks = (agg.decisionFrameworks || []).filter(
    (f) => f && f.name && !hasReplacementChar(f)
  );
  if (frameworks.length) {
    const fwRel = "decision-frameworks.json";
    const data = readJson(packageDir, fwRel, { frameworks: [] });
    if (!Array.isArray(data.frameworks)) data.frameworks = [];
    const existingNames = new Set(data.frameworks.map((f) => norm(f.name)));
    let added = 0;
    for (const f of frameworks) {
      if (existingNames.has(norm(f.name))) continue;
      data.frameworks.push({
        id: "framework_" + Date.now() + "_" + added,
        name: f.name,
        domain: f.domain || "general",
        principles: f.principles || [],
        positiveSignals: f.positiveSignals || [],
        negativeSignals: f.negativeSignals || [],
        typicalQuestions: f.typicalQuestions || [],
        sourceRefs: [sourceId],
      });
      existingNames.add(norm(f.name));
      added += 1;
    }
    if (added > 0) {
      ops.push({
        type: "write_text",
        path: fwRel,
        content: JSON.stringify(data, null, 2) + "\n",
      });
    }
  }

  function appendObservationBlock(rel, observations) {
    const clean = (observations || []).filter(
      (o) => typeof o === "string" && o.trim() && !hasReplacementChar(o)
    );
    if (!clean.length) return;
    const block =
      `\n\n## 增量蒸馏观察：${sourceTitle}\n` +
      `> 来源：${sourceId} · 蒸馏时间：${now}\n` +
      `> 数据类别：inference（模型提取，须经确认后写入）\n\n` +
      clean.map((o) => "- " + o).join("\n") +
      "\n";
    const before = readText(packageDir, rel);
    const prefix = before && !before.endsWith("\n") ? before + "\n" : before;
    ops.push({
      type: "write_text",
      path: rel,
      content: prefix + block,
    });
  }

  appendObservationBlock("style-guide.md", agg.styleObservations);
  appendObservationBlock("persona.md", agg.personaNotes);

  if (!ops.length) {
    throw err("empty_write", "没有可写入的观念条目。");
  }
  return ops;
}

function summarizeCounts(agg) {
  return {
    memories: (agg.memories || []).filter((m) => m && m.content && !hasReplacementChar(m.content))
      .length,
    frameworks: (agg.decisionFrameworks || []).filter((f) => f && f.name && !hasReplacementChar(f))
      .length,
    styleObservations: (agg.styleObservations || []).filter(
      (o) => typeof o === "string" && o.trim() && !hasReplacementChar(o)
    ).length,
    personaNotes: (agg.personaNotes || []).filter(
      (o) => typeof o === "string" && o.trim() && !hasReplacementChar(o)
    ).length,
  };
}

/**
 * Create candidate change set. Does not modify package bytes.
 */
function previewPersonaWrite(packageDir, payload, storeHooks) {
  const body = payload || {};
  const agg = body.agg || {};
  if (!countAgg(agg)) {
    throw err("empty_write", "没有可写入的观念条目。");
  }
  const sourceMeta = buildSourceMeta(body.sourceMeta || body);
  const counts = summarizeCounts(agg);
  const ops = aggToOps(packageDir, agg, sourceMeta);
  const sourceRefs = [sourceMeta.id];
  if (sourceMeta.location) sourceRefs.push(String(sourceMeta.location).slice(0, 500));

  const store = openStore(packageDir, storeHooks);
  store.recover();

  const reason =
    String(body.reason || "").trim() ||
    `构建写入：${sourceMeta.title}（记忆 ${counts.memories} / 框架 ${counts.frameworks} / 风格 ${counts.styleObservations} / 人格 ${counts.personaNotes}）`;

  const cs = store.createChangeSet({
    actor: ACTOR,
    reason: reason.slice(0, 2000),
    sourceRefs,
    dataKinds: [...DATA_KINDS],
    ops,
  });

  const expiresAt = new Date(Date.now() + CHANGESET_TTL_MS).toISOString();
  // Persist expiry + builder meta on the candidate record for commit checks / UI.
  const csPath = path.join(storeRootFor(packageDir), "changesets", cs.id + ".json");
  const saved = JSON.parse(fs.readFileSync(csPath, "utf8"));
  saved.expiresAt = expiresAt;
  saved.builderMeta = {
    sourceMeta,
    counts,
    materialKind: "persona",
  };
  fs.writeFileSync(csPath, JSON.stringify(saved, null, 2), "utf8");

  const storePreview = store.preview(cs.id);

  return {
    materialKind: "persona",
    changeSetId: cs.id,
    baseRevision: cs.baseRevision,
    baseRootSha256: cs.baseRootSha256,
    beforeHashes: cs.beforeHashes,
    expiresAt,
    actor: ACTOR,
    reason: cs.reason,
    dataKinds: [...DATA_KINDS],
    sourceRefs,
    sourceMeta,
    counts,
    affectedPaths: cs.affectedPaths,
    storePreview,
    // Counts kept for UI compatibility with legacy writeBack result shape (preview only).
    memories: counts.memories,
    frameworks: counts.frameworks,
    styleObservations: counts.styleObservations,
    personaNotes: counts.personaNotes,
  };
}

function loadCandidate(packageDir, changeSetId) {
  const csPath = path.join(storeRootFor(packageDir), "changesets", changeSetId + ".json");
  if (!fs.existsSync(csPath)) {
    throw err("changeset_not_found", "变更集不存在或已失效，请重新预览后再确认。");
  }
  return JSON.parse(fs.readFileSync(csPath, "utf8"));
}

/**
 * Commit a previously previewed Builder change set.
 * Renderer may only pass changeSetId + confirmation — never raw paths/ops.
 */
function commitPersonaWrite(packageDir, payload, storeHooks) {
  const body = payload || {};
  const changeSetId = typeof body.changeSetId === "string" ? body.changeSetId.trim() : "";
  if (!changeSetId) {
    throw err("changeset_required", "请先预览并确认后再写入；不能直接提交未经预览的写入计划。");
  }

  const confirmed =
    body.confirmed === true || (body.confirmation && body.confirmation.confirmed === true);
  if (!confirmed) {
    throw err("confirmation_required", "需要明确确认后才能写入。");
  }

  const cs = loadCandidate(packageDir, changeSetId);
  if (cs.actor && cs.actor !== ACTOR) {
    throw err("changeset_actor_mismatch", "变更集来源不匹配，已拒绝写入。");
  }
  if (cs.expiresAt) {
    const exp = Date.parse(cs.expiresAt);
    if (Number.isFinite(exp) && Date.now() > exp) {
      throw err("changeset_expired", "预览已过期，请重新预览后再确认写入。");
    }
  }

  const store = openStore(packageDir, storeHooks);
  store.recover();

  const committed = store.commit(changeSetId, { confirmed: true });
  const manifest = readManifest(packageDir);
  const counts =
    (cs.builderMeta && cs.builderMeta.counts) || {
      memories: 0,
      frameworks: 0,
      styleObservations: 0,
      personaNotes: 0,
    };

  return {
    ok: true,
    materialKind: "persona",
    changeSetId: committed.changeSetId,
    revision: committed.revision,
    rollbackVersion: committed.rollbackVersion,
    affectedPaths: committed.affectedPaths || cs.affectedPaths || [],
    rootSha256: committed.rootSha256,
    baseRevision: cs.baseRevision,
    actor: ACTOR,
    reason: cs.reason,
    dataKinds: cs.dataKinds || [...DATA_KINDS],
    sourceRefs: cs.sourceRefs || [],
    sourceMeta: (cs.builderMeta && cs.builderMeta.sourceMeta) || null,
    updatedAt: (manifest && manifest.updatedAt) || isoNow(),
    memories: counts.memories,
    frameworks: counts.frameworks,
    styleObservations: counts.styleObservations,
    personaNotes: counts.personaNotes,
  };
}

/**
 * Legacy direct write — blocked. Callers must use preview + commit.
 */
function writeBack() {
  throw err(
    "builder_direct_write_blocked",
    "Builder 不得再直接写入 Package；请经 PackageStore 预览并确认后提交。"
  );
}

module.exports = {
  ACTOR,
  DATA_KINDS,
  CHANGESET_TTL_MS,
  buildSourceMeta,
  aggToOps,
  countAgg,
  previewPersonaWrite,
  commitPersonaWrite,
  writeBack,
  summarizeCounts,
};

"use strict";

// Lightweight local RAG retriever over the Digital Me Package "raw" corpus.
//
// Why lexical (not embeddings) for v0.1:
//   - Local-first & platform-neutral: no embedding API/model dependency, works offline.
//   - Zero install, instant. Good enough as a first retrieval layer.
//   - Upgrade path: swap scoreDoc() for cosine over embeddings later; index shape is compatible.
//
// Corpus = memory/raw-memory.jsonl (914 memories) + decision-frameworks-raw.json (170 frameworks).
// The consolidated "core layer" is always injected elsewhere; retrieval adds depth on demand.

const fs = require("node:fs");
const path = require("node:path");

const _cache = new Map(); // pkgDir -> { sig, index }

// Tokenize Chinese + ASCII: CJK char bigrams + lowercased ascii words.
function tokenize(text) {
  const tokens = [];
  const s = String(text || "").toLowerCase();
  // ascii words / numbers
  const asciiRe = /[a-z0-9]+/g;
  let m;
  while ((m = asciiRe.exec(s)) !== null) tokens.push(m[0]);
  // CJK runs -> char bigrams (and singletons for short runs)
  const cjkRe = /[\u4e00-\u9fff]+/g;
  while ((m = cjkRe.exec(s)) !== null) {
    const run = m[0];
    if (run.length === 1) {
      tokens.push(run);
    } else {
      for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}

function fileSig(p) {
  try {
    const st = fs.statSync(p);
    return st.mtimeMs + ":" + st.size;
  } catch {
    return "0";
  }
}

function loadDocs(pkgDir) {
  const docs = [];

  // Raw memories
  const memPath = path.join(pkgDir, "memory", "raw-memory.jsonl");
  const memRaw = safeRead(memPath);
  if (memRaw) {
    for (const line of memRaw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t);
        const text = (o.theme ? "[" + o.theme + "] " : "") + (o.content || "");
        if (text.trim() && !text.includes("\uFFFD")) docs.push({ id: o.id || "mem", type: "memory", text });
      } catch {}
    }
  }

  // Raw frameworks
  const fwPath = path.join(pkgDir, "decision-frameworks-raw.json");
  const fwRaw = safeRead(fwPath);
  if (fwRaw) {
    try {
      const fw = JSON.parse(fwRaw);
      for (const f of fw.frameworks || []) {
        const parts = [f.name, f.domain]
          .concat(f.principles || [], f.positiveSignals || [], f.negativeSignals || [], f.typicalQuestions || [])
          .filter(Boolean);
        const text = parts.join("；");
        if (text.trim() && !text.includes("\uFFFD")) docs.push({ id: f.id || "framework", type: "framework", name: f.name, text });
      }
    } catch {}
  }

  // Life events — callable person facts
  const evPath = path.join(pkgDir, "life", "events.jsonl");
  const evRaw = safeRead(evPath);
  if (evRaw) {
    for (const line of evRaw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t);
        const text = [o.when, o.what, o.org, (o.roleLabels || []).join(" "), o.outcome].filter(Boolean).join(" ");
        if (text.trim()) docs.push({ id: o.id || "evt", type: "life_event", text });
      } catch {}
    }
  }

  const infPath = path.join(pkgDir, "life", "inferences.jsonl");
  const infRaw = safeRead(infPath);
  if (infRaw) {
    for (const line of infRaw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t);
        if (o.status === "rejected") continue;
        const text = `（推断）${o.claim || ""} ${o.basedOn || ""}`;
        if (o.claim) docs.push({ id: o.id || "inf", type: "life_inference", text });
      } catch {}
    }
  }

  for (const slice of ["outcomes", "domains", "org_touchpoints", "capability_signals", "people"]) {
    const file = path.join(pkgDir, "life", slice + ".json");
    const raw = safeRead(file);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      for (const it of data.items || []) {
        if (slice === "people" && it.status === "rejected") continue;
        let text = "";
        if (slice === "outcomes") text = [it.title, it.when, it.note].filter(Boolean).join(" ");
        else if (slice === "domains") text = it.title || "";
        else if (slice === "org_touchpoints") text = [it.org, it.kind, it.note].filter(Boolean).join(" ");
        else if (slice === "capability_signals") text = [it.signal, it.polarity].filter(Boolean).join(" ");
        else if (slice === "people") text = [it.name, it.relationType, it.context].filter(Boolean).join(" ");
        if (text.trim()) docs.push({ id: it.id || slice, type: "life_" + slice, text });
      }
    } catch {}
  }

  return docs;
}

function safeRead(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

// Build an inverted-ish index with df/idf for TF-IDF-lite scoring.
function buildIndex(pkgDir) {
  const docs = loadDocs(pkgDir);
  const df = new Map();
  const docTokens = docs.map((d) => {
    const counts = new Map();
    for (const tk of tokenize(d.text)) counts.set(tk, (counts.get(tk) || 0) + 1);
    for (const tk of counts.keys()) df.set(tk, (df.get(tk) || 0) + 1);
    return counts;
  });
  const N = docs.length || 1;
  const idf = new Map();
  for (const [tk, d] of df) idf.set(tk, Math.log(1 + N / d));
  return { docs, docTokens, idf, N };
}

function getIndex(pkgDir) {
  const lifeDir = path.join(pkgDir, "life");
  const sig =
    fileSig(path.join(pkgDir, "memory", "raw-memory.jsonl")) +
    "|" +
    fileSig(path.join(pkgDir, "decision-frameworks-raw.json")) +
    "|" +
    fileSig(path.join(lifeDir, "events.jsonl")) +
    "|" +
    fileSig(path.join(lifeDir, "inferences.jsonl")) +
    "|" +
    fileSig(path.join(lifeDir, "outcomes.json")) +
    "|" +
    fileSig(path.join(lifeDir, "domains.json")) +
    "|" +
    fileSig(path.join(lifeDir, "org_touchpoints.json")) +
    "|" +
    fileSig(path.join(lifeDir, "people.json")) +
    "|" +
    fileSig(path.join(lifeDir, "capability_signals.json"));
  const hit = _cache.get(pkgDir);
  if (hit && hit.sig === sig) return hit.index;
  const index = buildIndex(pkgDir);
  _cache.set(pkgDir, { sig, index });
  return index;
}

function scoreDoc(queryCounts, docCounts, idf) {
  let score = 0;
  let docLen = 0;
  for (const c of docCounts.values()) docLen += c;
  for (const [tk, qc] of queryCounts) {
    const dc = docCounts.get(tk);
    if (!dc) continue;
    const w = idf.get(tk) || 0.1;
    score += w * qc * Math.min(dc, 3);
  }
  // length normalization to avoid favoring long docs
  return score / Math.sqrt(docLen + 1);
}

// Retrieve top items for a query. Returns { memories:[], frameworks:[], life:[] }.
function retrieve(pkgDir, query, opts = {}) {
  const topMem = opts.topMemories ?? 6;
  const topFw = opts.topFrameworks ?? 3;
  const topLife = opts.topLife ?? 5;
  const minScore = opts.minScore ?? 0.15;
  if (!query || !String(query).trim()) return { memories: [], frameworks: [], life: [] };

  const index = getIndex(pkgDir);
  if (!index.docs.length) return { memories: [], frameworks: [], life: [] };

  const queryCounts = new Map();
  for (const tk of tokenize(query)) queryCounts.set(tk, (queryCounts.get(tk) || 0) + 1);

  const scored = index.docs.map((d, i) => ({
    doc: d,
    score: scoreDoc(queryCounts, index.docTokens[i], index.idf),
  }));
  scored.sort((a, b) => b.score - a.score);

  const memories = [];
  const frameworks = [];
  const life = [];
  for (const s of scored) {
    if (s.score < minScore) break;
    if (s.doc.type === "memory" && memories.length < topMem) memories.push(s);
    else if (s.doc.type === "framework" && frameworks.length < topFw) frameworks.push(s);
    else if (String(s.doc.type || "").startsWith("life_") && life.length < topLife) life.push(s);
    if (memories.length >= topMem && frameworks.length >= topFw && life.length >= topLife) break;
  }
  return {
    memories: memories.map((s) => ({ id: s.doc.id, text: s.doc.text, score: +s.score.toFixed(3) })),
    frameworks: frameworks.map((s) => ({ id: s.doc.id, name: s.doc.name, text: s.doc.text, score: +s.score.toFixed(3) })),
    life: life.map((s) => ({ id: s.doc.id, type: s.doc.type, text: s.doc.text, score: +s.score.toFixed(3) })),
  };
}

// Render retrieved items into a system-prompt section.
function renderContext(result) {
  if (!result || (!result.memories.length && !result.frameworks.length && !(result.life || []).length)) return "";
  const parts = ["## 相关背景（按当前问题从原始底料与人生切片检索，仅供参考，非固定人格）"];
  if (result.frameworks.length) {
    parts.push("### 可能相关的判断框架");
    for (const f of result.frameworks) parts.push("- " + f.text);
  }
  if (result.memories.length) {
    parts.push("### 可能相关的观点/记忆");
    for (const m of result.memories) parts.push("- " + m.text);
  }
  if ((result.life || []).length) {
    parts.push("### 可能相关的人生与社会切片");
    for (const L of result.life) parts.push("- " + L.text);
  }
  return parts.join("\n");
}

module.exports = { tokenize, buildIndex, retrieve, renderContext };

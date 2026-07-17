"use strict";

/**
 * Life / identity writes via PackageStore (P1-07, hardened).
 * Preview creates a candidate change set (package bytes unchanged).
 * Commit requires main-process confirmation + non-expired changeSetId.
 *
 * Renderer must not supply dataKinds, actor, ops, or package paths as the write plan.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PackageStore, readManifest, storeRootFor } = require("../package-store");
const { normalizeEvent } = require("../life");

const ACTOR = "owner:life";
const MATERIAL_KIND = "identity";
const META_SCHEMA_VERSION = 1;
const CHANGESET_TTL_MS = 15 * 60 * 1000;
const FACT_FIELDS = Object.freeze(["events", "facts", "outcomes"]);

const LIMITS = Object.freeze({
  events: 40,
  facts: 40,
  inferences: 40,
  outcomes: 40,
  domains: 40,
  org_touchpoints: 40,
  alter_candidates: 40,
  mind_hooks: 40,
  capability_signals: 40,
});

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

function normKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。、；：""'']/g, "");
}

function looksLikeOrgName(name) {
  return /公司|集团|有限|协会|研究院|大学|学院|政府|委员会|基金会|银行|证券|论坛|峰会|中心|部|厅|局|委|（待/.test(
    String(name || "")
  );
}

function emptyFacet(facet, updatedAt) {
  return { version: 1, facet, updatedAt, items: [] };
}

function emptySlice(slice, updatedAt) {
  return { version: 1, slice, updatedAt, items: [] };
}

function makeIdFactory(createdAt) {
  let seq = 0;
  const base = Date.parse(createdAt);
  const stamp = Number.isFinite(base) ? base.toString(36) : Date.now().toString(36);
  return function makeId(prefix) {
    seq += 1;
    return `${prefix}_${stamp}_${String(seq).padStart(3, "0")}`;
  };
}

function trimList(arr, max) {
  if (!Array.isArray(arr)) return [];
  if (arr.length > max) {
    throw err("too_many_items", `单次可写入条目过多（上限 ${max}），请减少勾选后重试。`);
  }
  return arr;
}

/** Whitelist fact confirmation fields from renderer; ignore unknowns. */
function normalizeFactConfirmedFields(raw) {
  const allowed = new Set(FACT_FIELDS);
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    const f = String(item || "");
    if (allowed.has(f) && !out.includes(f)) out.push(f);
  }
  return out;
}

function fieldConfirmed(fields, name) {
  return fields.includes(name);
}

function packageInvalid(rel) {
  throw err("package_content_invalid", `资料内容无效，无法安全写入：${rel}`);
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function readFileTextOrInvalid(pkgDir, rel) {
  const abs = path.join(pkgDir, rel);
  if (!fs.existsSync(abs)) return null;
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    packageInvalid(rel);
  }
}

function parseJsonOrInvalid(text, rel) {
  try {
    return JSON.parse(text);
  } catch {
    packageInvalid(rel);
  }
}

function readTextStrict(pkgDir, rel) {
  const text = readFileTextOrInvalid(pkgDir, rel);
  return text == null ? "" : text;
}

/** Facet JSON: roles / relations / outcomes / interests */
function readFacetJson(pkgDir, rel, facetName, createdAt) {
  const text = readFileTextOrInvalid(pkgDir, rel);
  if (text == null) return emptyFacet(facetName, createdAt);
  const data = parseJsonOrInvalid(text, rel);
  if (!isPlainObject(data)) packageInvalid(rel);
  if (!Object.prototype.hasOwnProperty.call(data, "items") || !Array.isArray(data.items)) {
    packageInvalid(rel);
  }
  if (
    Object.prototype.hasOwnProperty.call(data, "facet") &&
    data.facet != null &&
    typeof data.facet !== "string"
  ) {
    packageInvalid(rel);
  }
  return data;
}

/** Slice JSON: domains / org_touchpoints / people / capability_signals / mind_hooks */
function readSliceJson(pkgDir, rel, sliceName, createdAt) {
  const text = readFileTextOrInvalid(pkgDir, rel);
  if (text == null) return emptySlice(sliceName, createdAt);
  const data = parseJsonOrInvalid(text, rel);
  if (!isPlainObject(data)) packageInvalid(rel);
  if (!Object.prototype.hasOwnProperty.call(data, "items") || !Array.isArray(data.items)) {
    packageInvalid(rel);
  }
  if (
    Object.prototype.hasOwnProperty.call(data, "slice") &&
    data.slice != null &&
    typeof data.slice !== "string"
  ) {
    packageInvalid(rel);
  }
  return data;
}

function readSourceIndexJson(pkgDir) {
  const rel = "sources/source-index.json";
  const text = readFileTextOrInvalid(pkgDir, rel);
  if (text == null) return { sources: [] };
  const data = parseJsonOrInvalid(text, rel);
  if (!isPlainObject(data)) packageInvalid(rel);
  if (!Object.prototype.hasOwnProperty.call(data, "sources") || !Array.isArray(data.sources)) {
    packageInvalid(rel);
  }
  return data;
}

function readIdentityJson(pkgDir) {
  const rel = "identity.json";
  const text = readFileTextOrInvalid(pkgDir, rel);
  if (text == null) {
    return { displayName: "", digitalMeId: "", identityClaims: [] };
  }
  const data = parseJsonOrInvalid(text, rel);
  if (!isPlainObject(data)) packageInvalid(rel);
  if (Object.prototype.hasOwnProperty.call(data, "identityClaims")) {
    if (data.identityClaims != null && !Array.isArray(data.identityClaims)) {
      packageInvalid(rel);
    }
  }
  return data;
}

/** JSONL: each non-empty line must parse to a plain object. */
function readJsonlStrict(pkgDir, rel) {
  const text = readFileTextOrInvalid(pkgDir, rel);
  if (text == null) return [];
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      packageInvalid(rel);
    }
    if (!isPlainObject(row)) packageInvalid(rel);
    rows.push(row);
  }
  return rows;
}

function existingSourceIds(packageDir) {
  const index = readSourceIndexJson(packageDir);
  return new Set(
    (index.sources || []).map((s) => (s && s.id ? String(s.id) : "")).filter(Boolean)
  );
}

function generateUniqueSourceId(existingIds) {
  for (let i = 0; i < 8; i += 1) {
    const id = "src_life_" + crypto.randomUUID().replace(/-/g, "");
    if (!existingIds.has(id)) return id;
  }
  throw err("source_id_collision", "无法生成唯一来源编号，请重试。");
}

/**
 * Build source metadata. ID is always generated unless injectSourceMeta is supplied (tests only).
 * Renderer/IPC must never supply injectSourceMeta or a trusted source id.
 */
function buildSourceMeta(packageDir, input, createdAt, injectSourceMeta) {
  const filePath = String(
    (input && input.filePath) ||
      (injectSourceMeta && (injectSourceMeta.location || injectSourceMeta.filePath)) ||
      ""
  );
  const title = String(
    (input && input.title) ||
      (injectSourceMeta && injectSourceMeta.title) ||
      path.basename(filePath) ||
      "社会事实材料"
  );
  const existingIds = existingSourceIds(packageDir);
  let id;
  if (
    injectSourceMeta &&
    typeof injectSourceMeta.id === "string" &&
    injectSourceMeta.id.trim()
  ) {
    id = injectSourceMeta.id.trim();
  } else {
    id = generateUniqueSourceId(existingIds);
  }
  return {
    id,
    type: "social_document",
    title,
    author: "",
    createdAt,
    location: filePath || (injectSourceMeta && injectSourceMeta.location) || "",
    sensitivity: "private",
    usedFor: [
      "life/events",
      "life/roles",
      "life/inferences",
      "life/outcomes",
      "life/domains",
      "life/org_touchpoints",
      "identity",
    ],
    materialKind: MATERIAL_KIND,
  };
}

function normalizeIdentityPayload(raw) {
  const body = raw && typeof raw === "object" ? raw : {};
  let events = Array.isArray(body.events) ? body.events : [];
  if (!events.length && Array.isArray(body.claims)) {
    events = body.claims.map((c) => ({
      when: c.when || "",
      what: c.value,
      roleLabels: [],
      org: c.org || "",
      actors: [],
      outcome: "",
      facets: ["roles"],
      confidence: "medium",
    }));
  }
  return {
    events: trimList(events, LIMITS.events),
    facts: trimList(body.facts, LIMITS.facts),
    inferences: trimList(body.inferences, LIMITS.inferences),
    outcomes: trimList(body.outcomes, LIMITS.outcomes),
    domains: trimList(body.domains, LIMITS.domains),
    org_touchpoints: trimList(body.org_touchpoints, LIMITS.org_touchpoints),
    alter_candidates: trimList(body.alter_candidates, LIMITS.alter_candidates),
    mind_hooks: trimList(body.mind_hooks, LIMITS.mind_hooks),
    capability_signals: trimList(body.capability_signals, LIMITS.capability_signals),
  };
}

function countIdentity(identity) {
  const id = identity || {};
  return (
    (id.events || []).length +
    (id.facts || []).length +
    (id.inferences || []).length +
    (id.outcomes || []).length +
    (id.domains || []).length +
    (id.org_touchpoints || []).length +
    (id.alter_candidates || []).length +
    (id.mind_hooks || []).length +
    (id.capability_signals || []).length
  );
}

function createKindAccumulator() {
  const pathSets = new Map();
  const fieldKinds = {};
  return {
    contribute(rel, kind, field) {
      if (!rel || !kind) return;
      if (!pathSets.has(rel)) pathSets.set(rel, new Set());
      pathSets.get(rel).add(kind);
      if (field) fieldKinds[field] = kind;
    },
    finalize(affectedPaths) {
      const pathDataKinds = {};
      const all = new Set();
      for (const rel of affectedPaths) {
        const set = pathSets.get(rel);
        if (!set || !set.size) {
          throw err("path_kind_incomplete", `缺少路径分类：${rel}`);
        }
        const arr = [...set].sort();
        pathDataKinds[rel] = arr;
        for (const k of arr) all.add(k);
      }
      for (const rel of pathSets.keys()) {
        if (!affectedPaths.includes(rel)) {
          throw err("path_kind_extra", `多余路径分类：${rel}`);
        }
      }
      return {
        pathDataKinds,
        dataKinds: [...all].sort(),
        fieldKinds: { ...fieldKinds },
      };
    },
  };
}

function upsertOrgItems(data, orgs, sourceId, createdAt, makeId, note, confidence) {
  let added = 0;
  const addedItems = [];
  for (const org of orgs || []) {
    const name = String(org || "").trim();
    if (!name || name.includes("待从正文") || name.includes("（待")) continue;
    const key = normKey(name);
    if ((data.items || []).some((it) => normKey(it.org) === key)) continue;
    const item = {
      id: makeId("org"),
      org: name,
      kind: "other",
      note: note || "",
      confidence: confidence || "medium",
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt,
    };
    data.items.push(item);
    addedItems.push(item);
    added += 1;
  }
  return { added, addedItems };
}

/**
 * Build PackageStore ops from identity payload. Read-only against packageDir.
 * Classification is derived only from ops that actually change content.
 */
function identityPayloadToOps(packageDir, identity, sourceMeta, options = {}) {
  const factConfirmedFields = normalizeFactConfirmedFields(options.factConfirmedFields);
  const createdAt = sourceMeta.createdAt || isoNow();
  const makeId = makeIdFactory(createdAt);
  const sourceId = sourceMeta.id;
  const kinds = createKindAccumulator();
  const contentOps = [];
  const counts = {
    events: 0,
    roles: 0,
    relations: 0,
    outcomes: 0,
    interests: 0,
    claims: 0,
    facts: 0,
    inferences: 0,
    domains: 0,
    org_touchpoints: 0,
    people: 0,
    capability_signals: 0,
    mind_hooks: 0,
  };
  const archiveClaims = [];
  const archiveFacts = [];

  const eventsKind = fieldConfirmed(factConfirmedFields, "events") ? "fact" : "inference";
  const factsKind = fieldConfirmed(factConfirmedFields, "facts") ? "fact" : "inference";
  const outcomesKind = fieldConfirmed(factConfirmedFields, "outcomes") ? "fact" : "inference";

  const putJson = (rel, data, kind, field) => {
    contentOps.push({
      type: "write_text",
      path: rel,
      content: JSON.stringify(data, null, 2) + "\n",
    });
    kinds.contribute(rel, kind, field);
  };

  // --- events: normalize all; append only new rows; still derive facets for duplicates ---
  const prevEvents = readJsonlStrict(packageDir, "life/events.jsonl");
  const seenEventKeys = new Set(
    prevEvents.map((r) => normKey((r.what || "") + "|" + (r.org || "") + "|" + (r.when || "")))
  );
  const eventRows = []; // all valid normalized events (for facet derivation / claims)
  const newEventRows = []; // rows actually appended
  for (const raw of identity.events || []) {
    const ev = normalizeEvent(raw);
    if (!ev) continue;
    const key = normKey(ev.what + "|" + (ev.org || "") + "|" + (ev.when || ""));
    const isNew = !seenEventKeys.has(key);
    if (isNew) seenEventKeys.add(key);
    const row = {
      id: makeId("evt"),
      when: ev.when,
      what: ev.what,
      roleLabels: ev.roleLabels,
      org: ev.org,
      actors: ev.actors,
      outcome: ev.outcome,
      facets: ev.facets,
      confidence: ev.confidence,
      evidence: sourceId ? [sourceId] : [],
      createdAt,
      dataKindHint: eventsKind,
      _isNew: isNew,
    };
    eventRows.push(row);
    if (isNew) newEventRows.push(row);
  }
  if (newEventRows.length) {
    counts.events = newEventRows.length;
    for (const row of newEventRows) {
      const { _isNew, ...persist } = row;
      contentOps.push({ type: "append_jsonl", path: "life/events.jsonl", row: persist });
    }
    kinds.contribute("life/events.jsonl", eventsKind, "events");
  }
  for (const row of eventRows) delete row._isNew;

  const roles = readFacetJson(packageDir, "life/roles.json", "roles", createdAt);
  const relations = readFacetJson(packageDir, "life/relations.json", "relations", createdAt);
  const outcomes = readFacetJson(packageDir, "life/outcomes.json", "outcomes", createdAt);
  const interests = readFacetJson(packageDir, "life/interests.json", "interests", createdAt);
  const orgTouch = readSliceJson(
    packageDir,
    "life/org_touchpoints.json",
    "org_touchpoints",
    createdAt
  );

  let rolesDirty = false;
  let relationsDirty = false;
  let outcomesDirtyFromEvents = false;
  let interestsDirty = false;
  let orgDirtyFromEvents = false;
  let outcomesDirtyDirect = false;
  let orgDirtyDirect = false;

  for (const event of eventRows) {
    const facets = event.facets || ["roles"];
    if (facets.includes("roles") || facets.includes("relations") || !facets.length) {
      const title = event.roleLabels[0] || event.what;
      const org = event.org || "";
      const key = normKey(title + "|" + org + "|" + (event.when || ""));
      const existing = roles.items.find(
        (it) => normKey((it.title || "") + "|" + (it.org || "") + "|" + (it.when || "")) === key
      );
      if (existing) {
        if (sourceId && !(existing.sourceRefs || []).includes(sourceId)) {
          existing.sourceRefs = existing.sourceRefs || [];
          existing.sourceRefs.push(sourceId);
          rolesDirty = true;
        }
      } else {
        roles.items.push({
          id: makeId("role"),
          title,
          org,
          when: event.when || "",
          summary: event.what,
          status: /至今|现在|现任|在任/.test(event.when + event.what) ? "active" : "unknown",
          sourceRefs: sourceId ? [sourceId] : [],
          eventIds: event.id ? [event.id] : [],
          createdAt,
          updatedAt: createdAt,
        });
        counts.roles += 1;
        rolesDirty = true;
      }
    }
    if (facets.includes("relations") || (event.actors && event.actors.length)) {
      for (const actor of event.actors || []) {
        if (!actor || looksLikeOrgName(actor)) continue;
        const key = normKey(actor + "|" + (event.roleLabels[0] || event.what));
        if (
          relations.items.some(
            (it) => normKey((it.counterparty || "") + "|" + (it.relation || "")) === key
          )
        ) {
          continue;
        }
        relations.items.push({
          id: makeId("rel"),
          counterparty: actor,
          relation: event.roleLabels[0] || "关联",
          when: event.when || "",
          note: event.what,
          sourceRefs: sourceId ? [sourceId] : [],
          createdAt,
        });
        counts.relations += 1;
        relationsDirty = true;
      }
    }
    if (facets.includes("outcomes") || event.outcome) {
      const title = event.outcome || event.what;
      const key = normKey(title);
      if (!outcomes.items.some((it) => normKey(it.title) === key)) {
        outcomes.items.push({
          id: makeId("out"),
          title,
          when: event.when || "",
          note: event.what,
          sourceRefs: sourceId ? [sourceId] : [],
          createdAt,
          dataKindHint: eventsKind,
        });
        counts.outcomes += 1;
        outcomesDirtyFromEvents = true;
      }
    }
    if (facets.includes("interests")) {
      const title = event.what;
      const key = normKey(title);
      if (!interests.items.some((it) => normKey(it.title || it.topic || "") === key)) {
        interests.items.push({
          id: makeId("int"),
          title,
          when: event.when || "",
          sourceRefs: sourceId ? [sourceId] : [],
          createdAt,
        });
        counts.interests += 1;
        interestsDirty = true;
      }
    }
    const orgs = [];
    if (event.org) orgs.push(event.org);
    for (const a of event.actors || []) {
      if (looksLikeOrgName(a)) orgs.push(a);
    }
    const orgRes = upsertOrgItems(
      orgTouch,
      orgs,
      sourceId,
      createdAt,
      makeId,
      event.what,
      event.confidence
    );
    if (orgRes.added) {
      counts.org_touchpoints += orgRes.added;
      orgDirtyFromEvents = true;
    }
  }

  // Direct outcomes (separate confirmation)
  for (const o of identity.outcomes || []) {
    const title = String((o && (o.title || o.what)) || "").trim();
    if (!title || title.includes("（待")) continue;
    const key = normKey(title);
    if (outcomes.items.some((it) => normKey(it.title) === key)) continue;
    outcomes.items.push({
      id: makeId("out"),
      title,
      when: (o && o.when) || "",
      note: (o && o.note) || "",
      confidence: (o && o.confidence) || "medium",
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt,
      dataKindHint: outcomesKind,
    });
    counts.outcomes += 1;
    outcomesDirtyDirect = true;
  }

  const domains = readSliceJson(packageDir, "life/domains.json", "domains", createdAt);
  let domainsDirty = false;
  for (const d of identity.domains || []) {
    const title = String(d || "").trim();
    if (!title) continue;
    const key = normKey(title);
    if (domains.items.some((it) => normKey(it.title) === key)) continue;
    domains.items.push({
      id: makeId("dom"),
      title,
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt,
    });
    counts.domains += 1;
    domainsDirty = true;
  }

  for (const tp of identity.org_touchpoints || []) {
    const org = String((tp && tp.org) || "").trim();
    if (!org || org.includes("待从正文") || org.includes("（待")) continue;
    const key = normKey(org);
    if (orgTouch.items.some((it) => normKey(it.org) === key)) continue;
    orgTouch.items.push({
      id: makeId("org"),
      org,
      kind: (tp && tp.kind) || "other",
      note: (tp && tp.note) || "",
      confidence: (tp && tp.confidence) || "medium",
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt,
    });
    counts.org_touchpoints += 1;
    orgDirtyDirect = true;
  }

  const people = readSliceJson(packageDir, "life/people.json", "people", createdAt);
  let peopleDirty = false;
  for (const a of identity.alter_candidates || []) {
    const name = String((a && a.name) || "").trim();
    if (!name || looksLikeOrgName(name)) continue;
    const key = normKey(name);
    if (people.items.some((it) => normKey(it.name) === key)) continue;
    people.items.push({
      id: makeId("ppl"),
      name,
      relationType: (a && a.relationType) || "其他",
      context: (a && a.context) || "",
      status: (a && a.confidence) === "low" ? "candidate" : "confirmed",
      confidence: (a && a.confidence) || "low",
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt,
    });
    counts.people += 1;
    peopleDirty = true;
  }

  const caps = readSliceJson(
    packageDir,
    "life/capability_signals.json",
    "capability_signals",
    createdAt
  );
  let capsDirty = false;
  for (const s of identity.capability_signals || []) {
    const signal = String((s && s.signal) || "").trim();
    if (!signal) continue;
    const key = normKey(signal);
    if (caps.items.some((it) => normKey(it.signal) === key)) continue;
    caps.items.push({
      id: makeId("cap"),
      signal,
      polarity: (s && s.polarity) || "scope",
      confidence: (s && s.confidence) || "low",
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt,
    });
    counts.capability_signals += 1;
    capsDirty = true;
  }

  const minds = readSliceJson(packageDir, "life/mind_hooks.json", "mind_hooks", createdAt);
  let mindsDirty = false;
  for (const h of identity.mind_hooks || []) {
    const text = String(h || "").trim();
    if (!text) continue;
    const key = normKey(text);
    if (minds.items.some((it) => normKey(it.text) === key)) continue;
    minds.items.push({
      id: makeId("mind"),
      text,
      status: "pending_distill",
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt,
    });
    counts.mind_hooks += 1;
    mindsDirty = true;
  }

  // inferences — append_jsonl
  const prevInf = readJsonlStrict(packageDir, "life/inferences.jsonl");
  const seenInf = new Set(prevInf.map((r) => normKey(r.claim)));
  const infRows = [];
  for (const inf of identity.inferences || []) {
    if (!inf || !String(inf.claim || "").trim()) continue;
    const claim = String(inf.claim).trim();
    const k = normKey(claim);
    if (seenInf.has(k)) continue;
    seenInf.add(k);
    infRows.push({
      id: makeId("inf"),
      type: String(inf.type || "activity"),
      claim,
      confidence: inf.confidence === "high" || inf.confidence === "low" ? inf.confidence : "medium",
      basedOn: String(inf.basedOn || "").trim(),
      status: inf.confidence === "low" ? "open" : "confirmed",
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt,
      dataKindHint: "inference",
    });
  }
  if (infRows.length) {
    counts.inferences = infRows.length;
    for (const row of infRows) {
      contentOps.push({ type: "append_jsonl", path: "life/inferences.jsonl", row });
    }
    kinds.contribute("life/inferences.jsonl", "inference", "inferences");
  }

  // facts markdown — only append sentences not already present
  const factClean = (identity.facts || [])
    .filter((f) => typeof f === "string" && f.trim())
    .map((f) => f.trim());
  if (factClean.length) {
    let before = readTextStrict(packageDir, "identity-facts.md");
    const existingFactKeys = new Set();
    for (const line of before.split("\n")) {
      const m = line.match(/^\s*-\s+(.+)$/);
      if (m) existingFactKeys.add(normKey(m[1]));
    }
    const newFacts = factClean.filter((f) => !existingFactKeys.has(normKey(f)));
    if (newFacts.length) {
      counts.facts = newFacts.length;
      archiveFacts.push(...newFacts);
      if (!before) {
        before =
          "# 社会事实备忘\n\n> 由「社会事实」导入；补充未能结构化为事件的短句。不当作写作风格。\n";
      }
      const block =
        `\n\n## ${sourceMeta.title || "社会事实"}\n` +
        `> 来源：${sourceId || "local"} · ${createdAt}\n` +
        `> 数据类别：${factsKind}\n\n` +
        newFacts.map((f) => "- " + f).join("\n") +
        "\n";
      const prefix = before.endsWith("\n") ? before : before + "\n";
      contentOps.push({
        type: "write_text",
        path: "identity-facts.md",
        content: prefix + block,
      });
      kinds.contribute("identity-facts.md", factsKind, "facts");
    }
  }

  // identityClaims only when events explicitly confirmed
  if (fieldConfirmed(factConfirmedFields, "events") && eventRows.length) {
    const idPath = "identity.json";
    const data = readIdentityJson(packageDir);
    // Missing identityClaims is allowed; wrong types already rejected by readIdentityJson.
    if (!Object.prototype.hasOwnProperty.call(data, "identityClaims")) {
      data.identityClaims = [];
    }
    const existing = new Set(data.identityClaims.map((c) => normKey(c.value)));
    let added = 0;
    for (const ev of eventRows) {
      const value = ev.what;
      if (!value || existing.has(normKey(value))) continue;
      const claim = {
        type: "role",
        value,
        when: ev.when || "",
        org: ev.org || "",
        sourceRefs: sourceId ? [sourceId] : [],
        recordedAt: createdAt,
      };
      data.identityClaims.push(claim);
      archiveClaims.push(claim);
      existing.add(normKey(value));
      added += 1;
    }
    counts.claims = added;
    if (added) putJson(idPath, data, "owner_assertion", "identityClaims");
  }

  if (rolesDirty) {
    roles.updatedAt = createdAt;
    roles.facet = "roles";
    putJson("life/roles.json", roles, eventsKind, "events");
  }
  if (relationsDirty) {
    relations.updatedAt = createdAt;
    relations.facet = "relations";
    putJson("life/relations.json", relations, eventsKind, "events");
  }
  if (interestsDirty) {
    interests.updatedAt = createdAt;
    interests.facet = "interests";
    putJson("life/interests.json", interests, eventsKind, "events");
  }
  if (outcomesDirtyFromEvents || outcomesDirtyDirect) {
    outcomes.updatedAt = createdAt;
    outcomes.facet = "outcomes";
    // Path may carry both event-derived and direct outcome kinds.
    contentOps.push({
      type: "write_text",
      path: "life/outcomes.json",
      content: JSON.stringify(outcomes, null, 2) + "\n",
    });
    if (outcomesDirtyFromEvents) kinds.contribute("life/outcomes.json", eventsKind, "events");
    if (outcomesDirtyDirect) kinds.contribute("life/outcomes.json", outcomesKind, "outcomes");
  }
  if (domainsDirty) {
    domains.updatedAt = createdAt;
    domains.slice = "domains";
    putJson("life/domains.json", domains, "inference", "domains");
  }
  if (orgDirtyFromEvents || orgDirtyDirect) {
    orgTouch.updatedAt = createdAt;
    orgTouch.slice = "org_touchpoints";
    contentOps.push({
      type: "write_text",
      path: "life/org_touchpoints.json",
      content: JSON.stringify(orgTouch, null, 2) + "\n",
    });
    kinds.contribute("life/org_touchpoints.json", "current_state", "org_touchpoints");
  }
  if (peopleDirty) {
    people.updatedAt = createdAt;
    people.slice = "people";
    putJson("life/people.json", people, "inference", "alter_candidates");
  }
  if (capsDirty) {
    caps.updatedAt = createdAt;
    caps.slice = "capability_signals";
    putJson("life/capability_signals.json", caps, "inference", "capability_signals");
  }
  if (mindsDirty) {
    minds.updatedAt = createdAt;
    minds.slice = "mind_hooks";
    putJson("life/mind_hooks.json", minds, "inference", "mind_hooks");
  }

  // Deduplicate content ops by path (last write_text wins; append_jsonl keep all)
  const writeByPath = new Map();
  const appendOps = [];
  for (const op of contentOps) {
    if (op.type === "append_jsonl") appendOps.push(op);
    else writeByPath.set(op.path, op);
  }
  const substantiveOps = [...appendOps, ...writeByPath.values()];
  if (!substantiveOps.length) {
    throw err("empty_write", "没有可写入的人生事实条目。");
  }

  // Source index only after substantive content exists
  const indexRel = "sources/source-index.json";
  const indexData = readSourceIndexJson(packageDir);
  if (!indexData.sources.some((s) => s && s.id === sourceId)) {
    indexData.sources.push({ ...sourceMeta });
    substantiveOps.push({
      type: "write_text",
      path: indexRel,
      content: JSON.stringify(indexData, null, 2) + "\n",
    });
  }

  const affectedPaths = [...new Set(substantiveOps.map((o) => o.path))].sort();
  const contentPaths = affectedPaths.filter((p) => p !== indexRel);
  const finalized = kinds.finalize(contentPaths);
  if (affectedPaths.includes(indexRel)) {
    // Source index records the full set of kinds from this change set.
    finalized.pathDataKinds[indexRel] = finalized.dataKinds.length
      ? [...finalized.dataKinds]
      : ["inference"];
  }

  // Re-assert completeness including source path
  const kindPaths = Object.keys(finalized.pathDataKinds).sort();
  if (JSON.stringify(kindPaths) !== JSON.stringify(affectedPaths)) {
    throw err("path_kind_mismatch", "路径分类与变更路径不一致。");
  }

  return {
    ops: substantiveOps,
    counts,
    dataKinds: finalized.dataKinds,
    pathDataKinds: finalized.pathDataKinds,
    fieldKinds: finalized.fieldKinds,
    factConfirmedFields,
    archiveRecord: {
      title: sourceMeta.title || "社会事实",
      filePath: sourceMeta.location || "",
      claims: archiveClaims,
      facts: archiveFacts,
    },
  };
}

/**
 * Derive kinds from already-built ops result (for tests / API clarity).
 * Prefer identityPayloadToOps output; this re-runs for a payload snapshot.
 */
function deriveIdentityDataKinds(identity, factConfirmedFields) {
  // Lightweight preview of classification without package dir: not used for commit.
  // Real classification always comes from identityPayloadToOps.
  const fields = normalizeFactConfirmedFields(factConfirmedFields);
  const fieldKinds = {
    events: fieldConfirmed(fields, "events") ? "fact" : "inference",
    facts: fieldConfirmed(fields, "facts") ? "fact" : "inference",
    outcomes: fieldConfirmed(fields, "outcomes") ? "fact" : "inference",
    identityClaims: fieldConfirmed(fields, "events") ? "owner_assertion" : null,
    domains: "inference",
    org_touchpoints: "current_state",
    alter_candidates: "inference",
    capability_signals: "inference",
    mind_hooks: "inference",
    inferences: "inference",
  };
  return { fieldKinds, factConfirmedFields: fields };
}

function previewLifeIdentityWrite(packageDir, payload, storeHooks) {
  const body = payload || {};
  const identity = normalizeIdentityPayload(body.identity);
  if (!countIdentity(identity)) {
    throw err("empty_write", "没有可写入的人生事实条目。");
  }
  const factConfirmedFields = normalizeFactConfirmedFields(body.factConfirmedFields);
  const createdAt = isoNow();
  // Ignore body.sourceMeta (renderer-forgeable). Tests may pass injectSourceMeta only.
  const injectSourceMeta =
    (body && body.injectSourceMeta) ||
    (storeHooks && storeHooks.injectSourceMeta) ||
    null;
  const hooks =
    storeHooks && typeof storeHooks === "object" ? { ...storeHooks } : {};
  delete hooks.injectSourceMeta;
  const sourceMeta = buildSourceMeta(
    packageDir,
    { filePath: body.filePath, title: body.title },
    createdAt,
    injectSourceMeta
  );
  const built = identityPayloadToOps(packageDir, identity, sourceMeta, { factConfirmedFields });

  const sourceRefs = [sourceMeta.id];
  if (sourceMeta.location) sourceRefs.push(String(sourceMeta.location).slice(0, 500));

  const store = openStore(packageDir, hooks);
  store.recover();

  const reason =
    String(body.reason || "").trim() ||
    `人生事实写入：${sourceMeta.title}（事件 ${built.counts.events} / 事实短句 ${built.counts.facts} / 推断 ${built.counts.inferences}）`;

  const cs = store.createChangeSet({
    actor: ACTOR,
    reason: reason.slice(0, 2000),
    sourceRefs,
    dataKinds: built.dataKinds,
    ops: built.ops,
  });

  const expiresAt = new Date(Date.now() + CHANGESET_TTL_MS).toISOString();
  const csPath = path.join(storeRootFor(packageDir), "changesets", cs.id + ".json");
  const saved = JSON.parse(fs.readFileSync(csPath, "utf8"));
  saved.expiresAt = expiresAt;
  saved.lifeIdentityMeta = {
    schemaVersion: META_SCHEMA_VERSION,
    materialKind: MATERIAL_KIND,
    sourceMeta,
    counts: built.counts,
    factConfirmedFields: built.factConfirmedFields,
    pathDataKinds: built.pathDataKinds,
    fieldKinds: built.fieldKinds,
    archiveRecord: built.archiveRecord,
  };
  fs.writeFileSync(csPath, JSON.stringify(saved, null, 2), "utf8");

  const storePreview = store.preview(cs.id);
  const affectedPaths = [...(cs.affectedPaths || [])].sort();
  assertPathKindsAlign(affectedPaths, built.pathDataKinds, built.dataKinds);

  return {
    materialKind: MATERIAL_KIND,
    changeSetId: cs.id,
    baseRevision: cs.baseRevision,
    baseRootSha256: cs.baseRootSha256,
    beforeHashes: cs.beforeHashes,
    expiresAt,
    actor: ACTOR,
    reason: cs.reason,
    dataKinds: built.dataKinds,
    pathDataKinds: built.pathDataKinds,
    fieldKinds: built.fieldKinds,
    factConfirmedFields: built.factConfirmedFields,
    sourceRefs,
    sourceMeta,
    counts: built.counts,
    affectedPaths,
    storePreview,
    events: built.counts.events,
    roles: built.counts.roles,
    relations: built.counts.relations,
    outcomes: built.counts.outcomes,
    interests: built.counts.interests,
    claims: built.counts.claims,
    facts: built.counts.facts,
    inferences: built.counts.inferences,
    domains: built.counts.domains,
    org_touchpoints: built.counts.org_touchpoints,
    people: built.counts.people,
    capability_signals: built.counts.capability_signals,
    mind_hooks: built.counts.mind_hooks,
  };
}

function assertPathKindsAlign(affectedPaths, pathDataKinds, dataKinds) {
  const paths = [...affectedPaths].sort();
  const kindPaths = Object.keys(pathDataKinds || {}).sort();
  if (JSON.stringify(paths) !== JSON.stringify(kindPaths)) {
    throw err("path_kind_mismatch", "路径分类与变更路径不一致。");
  }
  const union = new Set();
  for (const p of paths) {
    const v = pathDataKinds[p];
    if (!Array.isArray(v) || !v.length) {
      throw err("path_kind_incomplete", `缺少路径分类：${p}`);
    }
    for (const k of v) union.add(k);
  }
  const expected = [...union].sort();
  const actual = [...(dataKinds || [])].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw err("data_kinds_mismatch", "数据类别与路径分类汇总不一致。");
  }
}

function loadCandidate(packageDir, changeSetId) {
  const csPath = path.join(storeRootFor(packageDir), "changesets", changeSetId + ".json");
  if (!fs.existsSync(csPath)) {
    throw err("changeset_not_found", "变更集不存在或已失效，请重新预览后再确认。");
  }
  return JSON.parse(fs.readFileSync(csPath, "utf8"));
}

function assertCandidateBound(cs) {
  if (!cs || typeof cs !== "object") {
    throw err("changeset_invalid", "变更集无效，已拒绝写入。");
  }
  if (cs.actor !== ACTOR) {
    throw err("changeset_actor_mismatch", "变更集来源不匹配，已拒绝写入。");
  }
  if (!cs.expiresAt) {
    throw err("changeset_expiry_missing", "变更集缺少过期时间，已拒绝写入。");
  }
  const exp = Date.parse(cs.expiresAt);
  if (!Number.isFinite(exp)) {
    throw err("changeset_expiry_invalid", "变更集过期时间无效，已拒绝写入。");
  }
  if (Date.now() > exp) {
    throw err("changeset_expired", "预览已过期，请重新预览后再确认写入。");
  }
  const meta = cs.lifeIdentityMeta;
  if (!meta || typeof meta !== "object") {
    throw err("changeset_meta_missing", "变更集缺少人生事实元数据，已拒绝写入。");
  }
  if (meta.schemaVersion !== META_SCHEMA_VERSION) {
    throw err("changeset_meta_version_mismatch", "变更集元数据版本不匹配，已拒绝写入。");
  }
  if (meta.materialKind !== MATERIAL_KIND) {
    throw err("changeset_material_mismatch", "变更集类型不匹配，已拒绝写入。");
  }
  assertPathKindsAlign(cs.affectedPaths || [], meta.pathDataKinds, cs.dataKinds);
}

function commitLifeIdentityWrite(packageDir, payload, storeHooks) {
  const body = payload || {};
  if (
    body.identity != null ||
    body.ops != null ||
    body.dataKinds != null ||
    body.affectedPaths != null ||
    body.filePath != null ||
    body.title != null ||
    body.factConfirmedFields != null ||
    body.pathDataKinds != null
  ) {
    throw err(
      "identity_commit_payload_rejected",
      "人生事实提交只接受变更集编号与确认标记，不能再次提交原始内容或写入计划。"
    );
  }
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
  assertCandidateBound(cs);
  const meta = cs.lifeIdentityMeta;

  const store = openStore(packageDir, storeHooks);
  store.recover();
  const committed = store.commit(changeSetId, { confirmed: true });
  const manifest = readManifest(packageDir);
  const counts = meta.counts || {};

  return {
    ok: true,
    materialKind: MATERIAL_KIND,
    changeSetId: committed.changeSetId,
    revision: committed.revision,
    rollbackVersion: committed.rollbackVersion,
    affectedPaths: committed.affectedPaths || cs.affectedPaths || [],
    rootSha256: committed.rootSha256,
    baseRevision: cs.baseRevision,
    actor: ACTOR,
    reason: cs.reason,
    dataKinds: cs.dataKinds || [],
    pathDataKinds: meta.pathDataKinds || {},
    fieldKinds: meta.fieldKinds || {},
    factConfirmedFields: meta.factConfirmedFields || [],
    sourceRefs: cs.sourceRefs || [],
    sourceMeta: meta.sourceMeta || null,
    updatedAt: (manifest && manifest.updatedAt) || isoNow(),
    archiveRecord: meta.archiveRecord || {
      title: (meta.sourceMeta && meta.sourceMeta.title) || "社会事实",
      filePath: (meta.sourceMeta && meta.sourceMeta.location) || "",
      claims: [],
      facts: [],
    },
    events: counts.events || 0,
    roles: counts.roles || 0,
    relations: counts.relations || 0,
    outcomes: counts.outcomes || 0,
    interests: counts.interests || 0,
    claims: counts.claims || 0,
    facts: counts.facts || 0,
    inferences: counts.inferences || 0,
    domains: counts.domains || 0,
    org_touchpoints: counts.org_touchpoints || 0,
    people: counts.people || 0,
    capability_signals: counts.capability_signals || 0,
    mind_hooks: counts.mind_hooks || 0,
  };
}

/**
 * Orchestrate Package commit + local archive (injectable for tests).
 * archiveRecord is stripped from the public return value.
 */
function runIdentityCommitAndArchive(options = {}) {
  const {
    packageDir,
    payload,
    storeHooks,
    userData,
    commitFn = commitLifeIdentityWrite,
    archiveFn,
  } = options;
  if (typeof archiveFn !== "function") {
    throw err("archive_fn_required", "缺少归档函数。");
  }
  const committed = commitFn(packageDir, payload, storeHooks);
  const archiveRecord = committed.archiveRecord;
  const publicResult = { ...committed };
  delete publicResult.archiveRecord;

  try {
    archiveFn(userData, {
      title: (archiveRecord && archiveRecord.title) || "社会事实",
      filePath: (archiveRecord && archiveRecord.filePath) || "",
      claims: (archiveRecord && archiveRecord.claims) || [],
      facts: (archiveRecord && archiveRecord.facts) || [],
    });
  } catch {
    publicResult.archiveWarning = "资料已写入，但本机运行归档未完成。";
    console.warn("[identity-write] archive_failed");
  }
  return publicResult;
}

module.exports = {
  ACTOR,
  MATERIAL_KIND,
  META_SCHEMA_VERSION,
  CHANGESET_TTL_MS,
  FACT_FIELDS,
  LIMITS,
  normalizeFactConfirmedFields,
  deriveIdentityDataKinds,
  normalizeIdentityPayload,
  identityPayloadToOps,
  previewLifeIdentityWrite,
  commitLifeIdentityWrite,
  runIdentityCommitAndArchive,
  assertCandidateBound,
  countIdentity,
  buildSourceMeta,
};

"use strict";

/**
 * Life / identity writes via PackageStore (P1-07).
 * Preview creates a candidate change set (package bytes unchanged).
 * Commit requires main-process confirmation + non-expired changeSetId.
 *
 * Renderer must not supply dataKinds, actor, ops, or package paths as the write plan.
 */

const fs = require("node:fs");
const path = require("node:path");
const { PackageStore, readManifest, storeRootFor } = require("../package-store");
const { normalizeEvent } = require("../life");

const ACTOR = "owner:life";
const MATERIAL_KIND = "identity";
const CHANGESET_TTL_MS = 15 * 60 * 1000;

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

function parseJsonl(text) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip corrupt line */
    }
  }
  return rows;
}

function jsonlBody(rows) {
  if (!rows.length) return "";
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

function buildSourceMeta(input, createdAt) {
  const filePath = String((input && input.filePath) || "");
  const title = String((input && input.title) || path.basename(filePath) || "社会事实材料");
  const base = path.basename(filePath || title || "identity");
  const id =
    (input && input.id) ||
    "src_life_" + base.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 36) + "_" + Date.parse(createdAt).toString(36);
  return {
    id,
    type: "social_document",
    title,
    author: "",
    createdAt,
    location: filePath || (input && input.location) || "",
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

/**
 * Derive change-set dataKinds from confirmed payload + confirmAsFact.
 * Renderer-supplied dataKinds must never be trusted — ignore them.
 */
function deriveIdentityDataKinds(identity, confirmAsFact) {
  const id = identity || {};
  const kinds = new Set();
  const pathDataKinds = {};

  const has = (arr) => Array.isArray(arr) && arr.length > 0;
  const mark = (rel, kind) => {
    kinds.add(kind);
    pathDataKinds[rel] = kind;
  };

  if (has(id.events)) {
    mark("life/events.jsonl", confirmAsFact ? "fact" : "inference");
    mark("life/roles.json", confirmAsFact ? "fact" : "inference");
    mark("life/relations.json", confirmAsFact ? "fact" : "inference");
    mark("life/interests.json", confirmAsFact ? "fact" : "inference");
    if (confirmAsFact) mark("identity.json", "owner_assertion");
  }
  if (has(id.facts)) {
    mark("identity-facts.md", confirmAsFact ? "fact" : "inference");
  }
  if (has(id.outcomes)) {
    mark("life/outcomes.json", confirmAsFact ? "fact" : "inference");
  }
  if (has(id.domains)) mark("life/domains.json", "inference");
  if (has(id.org_touchpoints)) mark("life/org_touchpoints.json", "current_state");
  if (has(id.alter_candidates)) mark("life/people.json", "inference");
  if (has(id.capability_signals)) mark("life/capability_signals.json", "inference");
  if (has(id.mind_hooks)) mark("life/mind_hooks.json", "inference");
  if (has(id.inferences)) mark("life/inferences.jsonl", "inference");

  if (kinds.size) mark("sources/source-index.json", [...kinds][0]);

  return {
    dataKinds: [...kinds],
    pathDataKinds,
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

function upsertOrgItems(data, orgs, sourceId, createdAt, makeId, note, confidence) {
  let added = 0;
  for (const org of orgs || []) {
    const name = String(org || "").trim();
    if (!name || name.includes("待从正文") || name.includes("（待")) continue;
    const key = normKey(name);
    if ((data.items || []).some((it) => normKey(it.org) === key)) continue;
    data.items.push({
      id: makeId("org"),
      org: name,
      kind: "other",
      note: note || "",
      confidence: confidence || "medium",
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt,
    });
    added += 1;
  }
  return added;
}

/**
 * Build PackageStore ops from identity payload. Read-only against packageDir.
 * Does not call ensureLifeScaffold or any package writers.
 */
function identityPayloadToOps(packageDir, identity, sourceMeta, options = {}) {
  const confirmAsFact = options.confirmAsFact === true;
  const createdAt = sourceMeta.createdAt || isoNow();
  const makeId = makeIdFactory(createdAt);
  const sourceId = sourceMeta.id;
  const ops = [];
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

  const putJson = (rel, data) => {
    ops.push({
      type: "write_text",
      path: rel,
      content: JSON.stringify(data, null, 2) + "\n",
    });
  };

  const indexRel = "sources/source-index.json";
  const indexData = readJson(packageDir, indexRel, { sources: [] });
  if (!Array.isArray(indexData.sources)) indexData.sources = [];
  if (!indexData.sources.some((s) => s && s.id === sourceId)) {
    indexData.sources.push({ ...sourceMeta });
    putJson(indexRel, indexData);
  }

  const eventRows = [];
  for (const raw of identity.events || []) {
    const ev = normalizeEvent(raw);
    if (!ev) continue;
    eventRows.push({
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
      dataKindHint: confirmAsFact ? "fact" : "inference",
    });
  }
  counts.events = eventRows.length;

  const roles = readJson(packageDir, "life/roles.json", emptyFacet("roles", createdAt));
  if (!Array.isArray(roles.items)) roles.items = [];
  const relations = readJson(packageDir, "life/relations.json", emptyFacet("relations", createdAt));
  if (!Array.isArray(relations.items)) relations.items = [];
  const outcomes = readJson(packageDir, "life/outcomes.json", emptyFacet("outcomes", createdAt));
  if (!Array.isArray(outcomes.items)) outcomes.items = [];
  const interests = readJson(packageDir, "life/interests.json", emptyFacet("interests", createdAt));
  if (!Array.isArray(interests.items)) interests.items = [];
  const orgTouch = readJson(packageDir, "life/org_touchpoints.json", emptySlice("org_touchpoints", createdAt));
  if (!Array.isArray(orgTouch.items)) orgTouch.items = [];

  let rolesDirty = false;
  let relationsDirty = false;
  let outcomesDirty = false;
  let interestsDirty = false;
  let orgDirty = false;

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
        }
        existing.updatedAt = createdAt;
        rolesDirty = true;
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
        });
        counts.outcomes += 1;
        outcomesDirty = true;
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
    const n = upsertOrgItems(orgTouch, orgs, sourceId, createdAt, makeId, event.what, event.confidence);
    if (n) {
      counts.org_touchpoints += n;
      orgDirty = true;
    }
  }

  if (eventRows.length) {
    const prev = parseJsonl(readText(packageDir, "life/events.jsonl"));
    ops.push({
      type: "write_text",
      path: "life/events.jsonl",
      content: jsonlBody(prev.concat(eventRows)),
    });
  }

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
      dataKindHint: confirmAsFact ? "fact" : "inference",
    });
    counts.outcomes += 1;
    outcomesDirty = true;
  }

  const domains = readJson(packageDir, "life/domains.json", emptySlice("domains", createdAt));
  if (!Array.isArray(domains.items)) domains.items = [];
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
    orgDirty = true;
  }

  const people = readJson(packageDir, "life/people.json", emptySlice("people", createdAt));
  if (!Array.isArray(people.items)) people.items = [];
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

  const caps = readJson(
    packageDir,
    "life/capability_signals.json",
    emptySlice("capability_signals", createdAt)
  );
  if (!Array.isArray(caps.items)) caps.items = [];
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

  const minds = readJson(packageDir, "life/mind_hooks.json", emptySlice("mind_hooks", createdAt));
  if (!Array.isArray(minds.items)) minds.items = [];
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

  const infClean = (identity.inferences || []).filter((inf) => inf && String(inf.claim || "").trim());
  if (infClean.length) {
    const prevInf = parseJsonl(readText(packageDir, "life/inferences.jsonl"));
    const seen = new Set(prevInf.map((r) => normKey(r.claim)));
    const added = [];
    for (const inf of infClean) {
      const claim = String(inf.claim).trim();
      const k = normKey(claim);
      if (seen.has(k)) continue;
      seen.add(k);
      added.push({
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
    counts.inferences = added.length;
    if (added.length) {
      ops.push({
        type: "write_text",
        path: "life/inferences.jsonl",
        content: jsonlBody(prevInf.concat(added)),
      });
    }
  }

  const factClean = (identity.facts || []).filter((f) => typeof f === "string" && f.trim());
  if (factClean.length) {
    counts.facts = factClean.length;
    let before = readText(packageDir, "identity-facts.md");
    if (!before) {
      before =
        "# 社会事实备忘\n\n> 由「社会事实」导入；补充未能结构化为事件的短句。不当作写作风格。\n";
    }
    const kindNote = confirmAsFact ? "fact" : "inference";
    const block =
      `\n\n## ${sourceMeta.title || "社会事实"}\n` +
      `> 来源：${sourceId || "local"} · ${createdAt}\n` +
      `> 数据类别：${kindNote}\n\n` +
      factClean.map((f) => "- " + f.trim()).join("\n") +
      "\n";
    const prefix = before.endsWith("\n") ? before : before + "\n";
    ops.push({
      type: "write_text",
      path: "identity-facts.md",
      content: prefix + block,
    });
  }

  if (confirmAsFact && eventRows.length) {
    const idPath = "identity.json";
    let data = readJson(packageDir, idPath, null);
    if (!data || typeof data !== "object") {
      data = { displayName: "", digitalMeId: "", identityClaims: [] };
    }
    if (!Array.isArray(data.identityClaims)) data.identityClaims = [];
    const existing = new Set(data.identityClaims.map((c) => normKey(c.value)));
    let added = 0;
    for (const ev of eventRows) {
      const value = ev.what;
      if (!value || existing.has(normKey(value))) continue;
      data.identityClaims.push({
        type: "role",
        value,
        when: ev.when || "",
        org: ev.org || "",
        sourceRefs: sourceId ? [sourceId] : [],
        recordedAt: createdAt,
      });
      existing.add(normKey(value));
      added += 1;
    }
    counts.claims = added;
    if (added) putJson(idPath, data);
  }

  if (rolesDirty) {
    roles.updatedAt = createdAt;
    roles.facet = "roles";
    putJson("life/roles.json", roles);
  }
  if (relationsDirty) {
    relations.updatedAt = createdAt;
    relations.facet = "relations";
    putJson("life/relations.json", relations);
  }
  if (outcomesDirty) {
    outcomes.updatedAt = createdAt;
    outcomes.facet = "outcomes";
    putJson("life/outcomes.json", outcomes);
  }
  if (interestsDirty) {
    interests.updatedAt = createdAt;
    interests.facet = "interests";
    putJson("life/interests.json", interests);
  }
  if (domainsDirty) {
    domains.updatedAt = createdAt;
    domains.slice = "domains";
    putJson("life/domains.json", domains);
  }
  if (orgDirty) {
    orgTouch.updatedAt = createdAt;
    orgTouch.slice = "org_touchpoints";
    putJson("life/org_touchpoints.json", orgTouch);
  }
  if (peopleDirty) {
    people.updatedAt = createdAt;
    people.slice = "people";
    putJson("life/people.json", people);
  }
  if (capsDirty) {
    caps.updatedAt = createdAt;
    caps.slice = "capability_signals";
    putJson("life/capability_signals.json", caps);
  }
  if (mindsDirty) {
    minds.updatedAt = createdAt;
    minds.slice = "mind_hooks";
    putJson("life/mind_hooks.json", minds);
  }

  const byPath = new Map();
  for (const op of ops) byPath.set(op.path, op);
  const deduped = [...byPath.values()];
  if (!deduped.length) {
    throw err("empty_write", "没有可写入的人生事实条目。");
  }
  return { ops: deduped, counts };
}

function previewLifeIdentityWrite(packageDir, payload, storeHooks) {
  const body = payload || {};
  const identity = normalizeIdentityPayload(body.identity);
  if (!countIdentity(identity)) {
    throw err("empty_write", "没有可写入的人生事实条目。");
  }
  const confirmAsFact = body.confirmAsFact === true;
  const createdAt = isoNow();
  const sourceMeta = buildSourceMeta(body.sourceMeta || body, createdAt);
  const { dataKinds, pathDataKinds } = deriveIdentityDataKinds(identity, confirmAsFact);
  const { ops, counts } = identityPayloadToOps(packageDir, identity, sourceMeta, {
    confirmAsFact,
  });

  const sourceRefs = [sourceMeta.id];
  if (sourceMeta.location) sourceRefs.push(String(sourceMeta.location).slice(0, 500));

  const store = openStore(packageDir, storeHooks);
  store.recover();

  const reason =
    String(body.reason || "").trim() ||
    `人生事实写入：${sourceMeta.title}（事件 ${counts.events} / 事实短句 ${counts.facts} / 推断 ${counts.inferences}）`;

  const cs = store.createChangeSet({
    actor: ACTOR,
    reason: reason.slice(0, 2000),
    sourceRefs,
    dataKinds,
    ops,
  });

  const expiresAt = new Date(Date.now() + CHANGESET_TTL_MS).toISOString();
  const csPath = path.join(storeRootFor(packageDir), "changesets", cs.id + ".json");
  const saved = JSON.parse(fs.readFileSync(csPath, "utf8"));
  saved.expiresAt = expiresAt;
  saved.lifeIdentityMeta = {
    materialKind: MATERIAL_KIND,
    sourceMeta,
    counts,
    confirmAsFact,
    pathDataKinds,
    fieldKinds: {
      events: confirmAsFact ? "fact" : "inference",
      facts: confirmAsFact ? "fact" : "inference",
      outcomes: confirmAsFact ? "fact" : "inference",
      identityClaims: confirmAsFact ? "owner_assertion" : null,
      domains: "inference",
      org_touchpoints: "current_state",
      alter_candidates: "inference",
      capability_signals: "inference",
      mind_hooks: "inference",
      inferences: "inference",
    },
  };
  fs.writeFileSync(csPath, JSON.stringify(saved, null, 2), "utf8");

  const storePreview = store.preview(cs.id);

  return {
    materialKind: MATERIAL_KIND,
    changeSetId: cs.id,
    baseRevision: cs.baseRevision,
    baseRootSha256: cs.baseRootSha256,
    beforeHashes: cs.beforeHashes,
    expiresAt,
    actor: ACTOR,
    reason: cs.reason,
    dataKinds,
    pathDataKinds,
    fieldKinds: saved.lifeIdentityMeta.fieldKinds,
    confirmAsFact,
    sourceRefs,
    sourceMeta,
    counts,
    affectedPaths: cs.affectedPaths,
    storePreview,
    events: counts.events,
    roles: counts.roles,
    relations: counts.relations,
    outcomes: counts.outcomes,
    interests: counts.interests,
    claims: counts.claims,
    facts: counts.facts,
    inferences: counts.inferences,
    domains: counts.domains,
    org_touchpoints: counts.org_touchpoints,
    people: counts.people,
    capability_signals: counts.capability_signals,
    mind_hooks: counts.mind_hooks,
  };
}

function loadCandidate(packageDir, changeSetId) {
  const csPath = path.join(storeRootFor(packageDir), "changesets", changeSetId + ".json");
  if (!fs.existsSync(csPath)) {
    throw err("changeset_not_found", "变更集不存在或已失效，请重新预览后再确认。");
  }
  return JSON.parse(fs.readFileSync(csPath, "utf8"));
}

function commitLifeIdentityWrite(packageDir, payload, storeHooks) {
  const body = payload || {};
  if (
    body.identity != null ||
    body.ops != null ||
    body.dataKinds != null ||
    body.affectedPaths != null ||
    body.filePath != null ||
    body.title != null
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
  if (cs.actor && cs.actor !== ACTOR) {
    throw err("changeset_actor_mismatch", "变更集来源不匹配，已拒绝写入。");
  }
  const meta = cs.lifeIdentityMeta || {};
  if (meta.materialKind && meta.materialKind !== MATERIAL_KIND) {
    throw err("changeset_material_mismatch", "变更集类型不匹配，已拒绝写入。");
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
    confirmAsFact: !!meta.confirmAsFact,
    sourceRefs: cs.sourceRefs || [],
    sourceMeta: meta.sourceMeta || null,
    updatedAt: (manifest && manifest.updatedAt) || isoNow(),
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

module.exports = {
  ACTOR,
  MATERIAL_KIND,
  CHANGESET_TTL_MS,
  LIMITS,
  deriveIdentityDataKinds,
  normalizeIdentityPayload,
  identityPayloadToOps,
  previewLifeIdentityWrite,
  commitLifeIdentityWrite,
  countIdentity,
  buildSourceMeta,
};

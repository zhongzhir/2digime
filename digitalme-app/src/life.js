"use strict";

/**
 * Life graph: timeline events + facet tables (roles, relations, outcomes, interests).
 * See digitalme_life_graph_v0.1.md
 */

const fs = require("node:fs");
const path = require("node:path");

const FACET_FILES = {
  roles: "roles.json",
  relations: "relations.json",
  outcomes: "outcomes.json",
  interests: "interests.json",
};

const EXTRA_SLICE_FILES = {
  domains: "domains.json",
  org_touchpoints: "org_touchpoints.json",
  capability_signals: "capability_signals.json",
  people: "people.json",
  mind_hooks: "mind_hooks.json",
};

function isoNow() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

function lifeDir(pkgDir) {
  return path.join(pkgDir, "life");
}

function ensureLifeScaffold(pkgDir) {
  const dir = lifeDir(pkgDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const eventsPath = path.join(dir, "events.jsonl");
  if (!fs.existsSync(eventsPath)) fs.writeFileSync(eventsPath, "", "utf8");
  const readme = path.join(dir, "README.md");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      "# 人生轨迹（life）\n\n" +
        "- `events.jsonl`：时间主线（每行一条事件）\n" +
        "- `inferences.jsonl`：围绕本人的待证实推断（须可调用，非归档）\n" +
        "- `roles.json` / `outcomes.json` / `interests.json`：维度切片\n" +
        "- `domains.json` / `org_touchpoints.json` / `capability_signals.json` / `people.json` / `mind_hooks.json`：人模型富化切片\n" +
        "- `relations.json`：旧机构派生（产品面不以机构冒充 L4 关系）\n" +
        "- 由「社会事实」导入写入；写入后须可被对话/认知面板/报告调用。\n",
      "utf8"
    );
  }
  const infPath = path.join(dir, "inferences.jsonl");
  if (!fs.existsSync(infPath)) fs.writeFileSync(infPath, "", "utf8");
  for (const [key, file] of Object.entries(FACET_FILES)) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(
        p,
        JSON.stringify({ version: 1, facet: key, updatedAt: isoNow(), items: [] }, null, 2),
        "utf8"
      );
    }
  }
  for (const [key, file] of Object.entries(EXTRA_SLICE_FILES)) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(
        p,
        JSON.stringify({ version: 1, slice: key, updatedAt: isoNow(), items: [] }, null, 2),
        "utf8"
      );
    }
  }
  return dir;
}

function readFacet(pkgDir, facet) {
  ensureLifeScaffold(pkgDir);
  const file = path.join(lifeDir(pkgDir), FACET_FILES[facet]);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { version: 1, facet, updatedAt: isoNow(), items: [] };
  }
}

function writeFacet(pkgDir, facet, data) {
  ensureLifeScaffold(pkgDir);
  data.updatedAt = isoNow();
  data.facet = facet;
  fs.writeFileSync(path.join(lifeDir(pkgDir), FACET_FILES[facet]), JSON.stringify(data, null, 2), "utf8");
}

function readSlice(pkgDir, slice) {
  ensureLifeScaffold(pkgDir);
  const file = path.join(lifeDir(pkgDir), EXTRA_SLICE_FILES[slice]);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { version: 1, slice, updatedAt: isoNow(), items: [] };
  }
}

function writeSlice(pkgDir, slice, data) {
  ensureLifeScaffold(pkgDir);
  data.updatedAt = isoNow();
  data.slice = slice;
  fs.writeFileSync(path.join(lifeDir(pkgDir), EXTRA_SLICE_FILES[slice]), JSON.stringify(data, null, 2), "utf8");
}

function looksLikeOrgName(name) {
  return /公司|集团|有限|协会|研究院|大学|学院|政府|委员会|基金会|银行|证券|论坛|峰会|中心|工作室|厅|局|委|（待/.test(
    String(name || "")
  );
}

function normKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。、；：""'']/g, "");
}

function normalizeEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const what = String(raw.what || raw.value || "").trim();
  if (!what || what.includes("\uFFFD")) return null;
  const roleLabels = Array.isArray(raw.roleLabels)
    ? raw.roleLabels.map((x) => String(x).trim()).filter(Boolean)
    : Array.isArray(raw.roles)
      ? raw.roles.map((x) => String(x).trim()).filter(Boolean)
      : [];
  const actors = Array.isArray(raw.actors)
    ? raw.actors.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const org = String(raw.org || "").trim();
  if (org && !actors.includes(org)) actors.unshift(org);
  let facets = Array.isArray(raw.facets) ? raw.facets.map(String) : [];
  if (!facets.length) {
    const t = String(raw.type || "role");
    if (t === "interest") facets = ["interests"];
    else if (t === "project" || t === "outcome") facets = ["outcomes", "roles"];
    else if (t === "affiliation" || t === "relation") facets = ["relations", "roles"];
    else facets = ["roles"];
  }
  return {
    when: String(raw.when || "").trim(),
    what,
    roleLabels,
    org: org || (actors[0] || ""),
    actors,
    outcome: String(raw.outcome || "").trim(),
    facets,
    confidence: raw.confidence === "high" || raw.confidence === "low" ? raw.confidence : "medium",
  };
}

function claimToEvent(claim) {
  if (!claim) return null;
  const value = typeof claim === "string" ? claim : claim.value;
  if (!value || !String(value).trim()) return null;
  const type = (claim && claim.type) || "role";
  return normalizeEvent({
    when: claim.when || "",
    what: String(value).trim(),
    roleLabels: type === "role" || type === "profession" ? [String(value).trim().slice(0, 40)] : [],
    org: claim.org || "",
    actors: claim.actors || [],
    outcome: "",
    type,
    facets:
      type === "interest"
        ? ["interests"]
        : type === "project"
          ? ["outcomes", "roles"]
          : type === "affiliation"
            ? ["relations", "roles"]
            : ["roles"],
    confidence: "medium",
  });
}

function appendEvents(pkgDir, events, sourceId) {
  ensureLifeScaffold(pkgDir);
  const file = path.join(lifeDir(pkgDir), "events.jsonl");
  const lines = [];
  const written = [];
  for (const raw of events || []) {
    const ev = normalizeEvent(raw);
    if (!ev) continue;
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
      createdAt: isoNow(),
    };
    lines.push(JSON.stringify(row));
    written.push(row);
  }
  if (!lines.length) return [];
  const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const needsNL = raw.length > 0 && !raw.endsWith("\n");
  fs.appendFileSync(file, (needsNL ? "\n" : "") + lines.join("\n") + "\n", "utf8");
  return written;
}

function upsertRoleFromEvent(pkgDir, event, sourceId) {
  const data = readFacet(pkgDir, "roles");
  const title = event.roleLabels[0] || event.what;
  const org = event.org || "";
  const key = normKey(title + "|" + org + "|" + (event.when || ""));
  const existing = data.items.find(
    (it) => normKey((it.title || "") + "|" + (it.org || "") + "|" + (it.when || "")) === key
  );
  if (existing) {
    if (sourceId && !existing.sourceRefs.includes(sourceId)) existing.sourceRefs.push(sourceId);
    existing.updatedAt = isoNow();
    writeFacet(pkgDir, "roles", data);
    return false;
  }
  data.items.push({
    id: makeId("role"),
    title,
    org,
    when: event.when || "",
    summary: event.what,
    status: /至今|现在|现任|在任/.test(event.when + event.what) ? "active" : "unknown",
    sourceRefs: sourceId ? [sourceId] : [],
    eventIds: event.id ? [event.id] : [],
    createdAt: isoNow(),
    updatedAt: isoNow(),
  });
  writeFacet(pkgDir, "roles", data);
  return true;
}

function upsertRelationFromEvent(pkgDir, event, sourceId) {
  // Legacy facet: only keep non-org actors as soft notes; L4 people go via appendPeople.
  const data = readFacet(pkgDir, "relations");
  let added = 0;
  for (const actor of event.actors || []) {
    if (!actor || looksLikeOrgName(actor)) continue;
    const key = normKey(actor + "|" + (event.roleLabels[0] || event.what));
    if (data.items.some((it) => normKey((it.counterparty || "") + "|" + (it.relation || "")) === key)) {
      continue;
    }
    data.items.push({
      id: makeId("rel"),
      counterparty: actor,
      relation: event.roleLabels[0] || "关联",
      when: event.when || "",
      note: event.what,
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt: isoNow(),
    });
    added++;
  }
  if (added) writeFacet(pkgDir, "relations", data);
  return added;
}

function appendOutcomesDirect(pkgDir, outcomes, sourceId) {
  const data = readFacet(pkgDir, "outcomes");
  let added = 0;
  for (const o of outcomes || []) {
    const title = String((o && (o.title || o.what)) || "").trim();
    if (!title || title.includes("（待")) continue;
    const key = normKey(title);
    if (data.items.some((it) => normKey(it.title) === key)) continue;
    data.items.push({
      id: makeId("out"),
      title,
      when: (o && o.when) || "",
      note: (o && o.note) || "",
      confidence: (o && o.confidence) || "medium",
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt: isoNow(),
    });
    added++;
  }
  if (added) writeFacet(pkgDir, "outcomes", data);
  return added;
}

function appendDomains(pkgDir, domains, sourceId) {
  const data = readSlice(pkgDir, "domains");
  let added = 0;
  for (const d of domains || []) {
    const title = String(d || "").trim();
    if (!title) continue;
    const key = normKey(title);
    if (data.items.some((it) => normKey(it.title) === key)) continue;
    data.items.push({
      id: makeId("dom"),
      title,
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt: isoNow(),
    });
    added++;
  }
  if (added) writeSlice(pkgDir, "domains", data);
  return added;
}

function appendOrgTouchpoints(pkgDir, touchpoints, sourceId) {
  const data = readSlice(pkgDir, "org_touchpoints");
  let added = 0;
  for (const tp of touchpoints || []) {
    const org = String((tp && tp.org) || "").trim();
    if (!org || org.includes("待从正文") || org.includes("（待")) continue;
    const key = normKey(org);
    if (data.items.some((it) => normKey(it.org) === key)) continue;
    data.items.push({
      id: makeId("org"),
      org,
      kind: (tp && tp.kind) || "other",
      note: (tp && tp.note) || "",
      confidence: (tp && tp.confidence) || "medium",
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt: isoNow(),
    });
    added++;
  }
  if (added) writeSlice(pkgDir, "org_touchpoints", data);
  return added;
}

function appendPeople(pkgDir, alters, sourceId) {
  const data = readSlice(pkgDir, "people");
  let added = 0;
  for (const a of alters || []) {
    const name = String((a && a.name) || "").trim();
    if (!name || looksLikeOrgName(name)) continue;
    const key = normKey(name);
    if (data.items.some((it) => normKey(it.name) === key)) continue;
    data.items.push({
      id: makeId("ppl"),
      name,
      relationType: (a && a.relationType) || "其他",
      context: (a && a.context) || "",
      // 少决策：非 low 置信默认确认；low 仍为候选
      status: (a && a.confidence) === "low" ? "candidate" : "confirmed",
      confidence: (a && a.confidence) || "low",
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt: isoNow(),
    });
    added++;
  }
  if (added) writeSlice(pkgDir, "people", data);
  return added;
}

function appendCapabilitySignals(pkgDir, signals, sourceId) {
  const data = readSlice(pkgDir, "capability_signals");
  let added = 0;
  for (const s of signals || []) {
    const signal = String((s && s.signal) || "").trim();
    if (!signal) continue;
    const key = normKey(signal);
    if (data.items.some((it) => normKey(it.signal) === key)) continue;
    data.items.push({
      id: makeId("cap"),
      signal,
      polarity: (s && s.polarity) || "scope",
      confidence: (s && s.confidence) || "low",
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt: isoNow(),
    });
    added++;
  }
  if (added) writeSlice(pkgDir, "capability_signals", data);
  return added;
}

function appendMindHooks(pkgDir, hooks, sourceId) {
  const data = readSlice(pkgDir, "mind_hooks");
  let added = 0;
  for (const h of hooks || []) {
    const text = String(h || "").trim();
    if (!text) continue;
    const key = normKey(text);
    if (data.items.some((it) => normKey(it.text) === key)) continue;
    data.items.push({
      id: makeId("mind"),
      text,
      status: "pending_distill",
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt: isoNow(),
    });
    added++;
  }
  if (added) writeSlice(pkgDir, "mind_hooks", data);
  return added;
}

function appendOrgFromEvent(pkgDir, event, sourceId) {
  const orgs = [];
  if (event.org) orgs.push(event.org);
  for (const a of event.actors || []) {
    if (looksLikeOrgName(a)) orgs.push(a);
  }
  return appendOrgTouchpoints(
    pkgDir,
    orgs.map((org) => ({ org, kind: "other", note: event.what, confidence: event.confidence || "medium" })),
    sourceId
  );
}

function upsertOutcomeFromEvent(pkgDir, event, sourceId) {
  if (!event.outcome && !(event.facets || []).includes("outcomes")) return false;
  const data = readFacet(pkgDir, "outcomes");
  const title = event.outcome || event.what;
  const key = normKey(title);
  if (data.items.some((it) => normKey(it.title) === key)) return false;
  data.items.push({
    id: makeId("out"),
    title,
    when: event.when || "",
    note: event.what,
    sourceRefs: sourceId ? [sourceId] : [],
    createdAt: isoNow(),
  });
  writeFacet(pkgDir, "outcomes", data);
  return true;
}

function upsertInterestFromEvent(pkgDir, event, sourceId) {
  if (!(event.facets || []).includes("interests")) return false;
  const data = readFacet(pkgDir, "interests");
  const title = event.what;
  const key = normKey(title);
  if (data.items.some((it) => normKey(it.title) === key)) return false;
  data.items.push({
    id: makeId("int"),
    title,
    when: event.when || "",
    sourceRefs: sourceId ? [sourceId] : [],
    createdAt: isoNow(),
  });
  writeFacet(pkgDir, "interests", data);
  return true;
}

function applyEventToFacets(pkgDir, event, sourceId) {
  const facets = event.facets || ["roles"];
  let roles = 0;
  let relations = 0;
  let outcomes = 0;
  let interests = 0;
  let orgTouch = 0;
  if (facets.includes("roles") || facets.includes("relations") || !facets.length) {
    if (upsertRoleFromEvent(pkgDir, event, sourceId)) roles++;
  }
  if (facets.includes("relations") || (event.actors && event.actors.length)) {
    relations += upsertRelationFromEvent(pkgDir, event, sourceId);
  }
  if (facets.includes("outcomes") || event.outcome) {
    if (upsertOutcomeFromEvent(pkgDir, event, sourceId)) outcomes++;
  }
  if (facets.includes("interests")) {
    if (upsertInterestFromEvent(pkgDir, event, sourceId)) interests++;
  }
  orgTouch += appendOrgFromEvent(pkgDir, event, sourceId);
  return { roles, relations, outcomes, interests, orgTouch };
}

function appendPlainFacts(pkgDir, facts, sourceTitle, sourceId) {
  const clean = (facts || []).filter((f) => typeof f === "string" && f.trim());
  if (!clean.length) return 0;
  const file = path.join(pkgDir, "identity-facts.md");
  const block =
    `\n\n## ${sourceTitle || "社会事实"}\n` +
    `> 来源：${sourceId || "local"} · ${isoNow()}\n\n` +
    clean.map((f) => "- " + f.trim()).join("\n") +
    "\n";
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      "# 社会事实备忘\n\n> 由「社会事实」导入；补充未能结构化为事件的短句。不当作写作风格。\n",
      "utf8"
    );
  }
  fs.appendFileSync(file, block, "utf8");
  return clean.length;
}

function syncIdentityClaimsFromRoles(pkgDir, events, sourceId) {
  const file = path.join(pkgDir, "identity.json");
  if (!fs.existsSync(file)) return 0;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data.identityClaims)) data.identityClaims = [];
  const existing = new Set(data.identityClaims.map((c) => normKey(c.value)));
  let added = 0;
  for (const ev of events || []) {
    const value = ev.what;
    if (!value || existing.has(normKey(value))) continue;
    data.identityClaims.push({
      type: "role",
      value,
      when: ev.when || "",
      org: ev.org || "",
      sourceRefs: sourceId ? [sourceId] : [],
      recordedAt: isoNow(),
    });
    existing.add(normKey(value));
    added++;
  }
  if (added) fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  return added;
}

function registerSource(pkgDir, sourceMeta) {
  const file = path.join(pkgDir, "sources", "source-index.json");
  if (!fs.existsSync(file)) return;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data.sources) data.sources = [];
  if (!data.sources.some((s) => s.id === sourceMeta.id)) {
    data.sources.push(sourceMeta);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  }
}

function appendInferences(pkgDir, inferences, sourceId) {
  ensureLifeScaffold(pkgDir);
  const clean = (inferences || []).filter((inf) => inf && String(inf.claim || "").trim());
  if (!clean.length) return [];
  const file = path.join(lifeDir(pkgDir), "inferences.jsonl");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const seen = new Set();
  for (const line of existing.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.claim) seen.add(normKey(row.claim));
    } catch {
      /* skip */
    }
  }
  const written = [];
  for (const inf of clean) {
    const claim = String(inf.claim).trim();
    const k = normKey(claim);
    if (seen.has(k)) continue;
    seen.add(k);
    const row = {
      id: makeId("inf"),
      type: String(inf.type || "activity"),
      claim,
      confidence: inf.confidence === "high" || inf.confidence === "low" ? inf.confidence : "medium",
      basedOn: String(inf.basedOn || "").trim(),
      // 少决策：中高置信默认已确认；仅 low 留待用户抽空看
      status: inf.confidence === "low" ? "open" : "confirmed",
      sourceRefs: sourceId ? [sourceId] : [],
      createdAt: isoNow(),
    };
    fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf8");
    written.push(row);
  }
  return written;
}

function listInferences(pkgDir, opts = {}) {
  ensureLifeScaffold(pkgDir);
  const limit = opts.limit != null ? opts.limit : 200;
  const statusFilter = opts.status; // string | string[] | undefined
  const file = path.join(lifeDir(pkgDir), "inferences.jsonl");
  if (!fs.existsSync(file)) return [];
  const rows = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  rows.reverse();
  let out = rows;
  if (statusFilter) {
    const set = new Set(Array.isArray(statusFilter) ? statusFilter : [statusFilter]);
    out = out.filter((r) => set.has(r.status || "open"));
  }
  if (limit > 0 && out.length > limit) return out.slice(0, limit);
  return out;
}

function writeAllInferences(pkgDir, rows) {
  ensureLifeScaffold(pkgDir);
  const file = path.join(lifeDir(pkgDir), "inferences.jsonl");
  const body = (rows || []).map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(file, body ? body + "\n" : "", "utf8");
}

/** Update inference status (open|confirmed|rejected) and/or claim text. */
function updateInference(pkgDir, payload) {
  ensureLifeScaffold(pkgDir);
  const id = payload && payload.id;
  if (!id) return { ok: false, error: "缺少 id" };
  const all = listInferences(pkgDir, { limit: 10000 }).reverse();
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) return { ok: false, error: "未找到该推断" };
  const row = all[idx];
  if (payload.status && ["open", "confirmed", "rejected"].includes(payload.status)) {
    row.status = payload.status;
  }
  if (typeof payload.claim === "string" && payload.claim.trim()) {
    row.claim = payload.claim.trim();
  }
  if (typeof payload.type === "string" && payload.type.trim()) {
    row.type = payload.type.trim();
  }
  row.updatedAt = isoNow();
  writeAllInferences(pkgDir, all);
  return { ok: true, item: row };
}

function updatePerson(pkgDir, payload) {
  ensureLifeScaffold(pkgDir);
  const id = payload && payload.id;
  if (!id) return { ok: false, error: "缺少 id" };
  const data = readSlice(pkgDir, "people");
  const item = (data.items || []).find((it) => it.id === id);
  if (!item) return { ok: false, error: "未找到该关系人" };
  if (payload.status && ["candidate", "confirmed", "rejected"].includes(payload.status)) {
    item.status = payload.status;
  }
  if (typeof payload.name === "string" && payload.name.trim()) item.name = payload.name.trim();
  if (typeof payload.relationType === "string" && payload.relationType.trim()) {
    item.relationType = payload.relationType.trim();
  }
  if (typeof payload.context === "string") item.context = payload.context.trim();
  item.updatedAt = isoNow();
  writeSlice(pkgDir, "people", data);
  return { ok: true, item, people: data };
}

function updateMindHook(pkgDir, payload) {
  ensureLifeScaffold(pkgDir);
  const id = payload && payload.id;
  if (!id) return { ok: false, error: "缺少 id" };
  const data = readSlice(pkgDir, "mind_hooks");
  const item = (data.items || []).find((it) => it.id === id);
  if (!item) return { ok: false, error: "未找到该观念线索" };
  if (payload.status && ["pending_distill", "in_review", "distilled", "rejected"].includes(payload.status)) {
    item.status = payload.status;
  }
  if (typeof payload.text === "string" && payload.text.trim()) item.text = payload.text.trim();
  item.updatedAt = isoNow();
  writeSlice(pkgDir, "mind_hooks", data);
  return { ok: true, item, mind_hooks: data };
}

function listPendingMindHooks(pkgDir) {
  const data = readSlice(pkgDir, "mind_hooks");
  return (data.items || []).filter((h) => h.status === "pending_distill" || h.status === "in_review");
}

function markMindHooksStatus(pkgDir, ids, status) {
  const data = readSlice(pkgDir, "mind_hooks");
  const set = new Set(ids || []);
  let n = 0;
  for (const it of data.items || []) {
    if (set.has(it.id)) {
      it.status = status;
      it.updatedAt = isoNow();
      n++;
    }
  }
  if (n) writeSlice(pkgDir, "mind_hooks", data);
  return n;
}

/**
 * Coverage gaps for self-development guidance (Line A).
 * Prefer few, actionable items — one primary path over many choices.
 */
function buildCoverageGaps(pkgDir, pkgExtras = {}) {
  const snap = getCognitionSnapshot(pkgDir, pkgExtras);
  const c = snap.coverage || {};
  const gaps = [];
  const lowOpen = c.openInferences || 0;

  // Primary: materials intake if overall thin
  const thin =
    !c.mind && (c.events || 0) < 2 && (c.outcomes || 0) < 1 && (c.people || 0) < 1;
  if (thin) {
    gaps.push({
      id: "gap_bootstrap",
      layer: "起步",
      title: "建议先备齐履历与自我评测",
      hint: "提交简历或任职材料，并完成自我评测（或提交带判断理由的材料）。同一文件含两类内容亦可。然后点击「开始构建」。",
      actionTab: "build",
    });
    return gaps;
  }

  if ((c.mindHooks || 0) > 0) {
    gaps.push({
      id: "gap_hooks",
      layer: "观念",
      title: `有 ${c.mindHooks} 条观念线索可一键写入`,
      hint: "点「一键写入观念线索」，无需逐条勾选。",
      actionTab: "cognition",
    });
  } else if (!c.mind) {
    gaps.push({
      id: "gap_mind",
      layer: "观念与表达",
      title: "想法与表达仍偏少",
      hint: "完成「自我评测」，或提交带取舍理由的决策、复盘材料后开始构建。",
      actionTab: "build",
    });
  }

  if ((c.events || 0) < 3) {
    gaps.push({
      id: "gap_events",
      layer: "人生叙事",
      title: "经历事件还不多",
      hint: "提交履历或任职材料后开始构建；或在自我评测中填写「经历概要」。",
      actionTab: "build",
    });
  }

  if (lowOpen > 0) {
    gaps.push({
      id: "gap_inf_low",
      layer: "低把握线索",
      title: `${lowOpen} 条低把握推断可选看`,
      hint: "中高把握已自动采纳。低把握不影响使用，有空再在认知页扫一眼即可。",
      actionTab: "cognition",
    });
  }

  return gaps.slice(0, 3);
}

/**
 * Legacy identity write — blocked (P1-07).
 * Callers must use life/package-write preview + PackageStore commit.
 */
function writeLifeBack() {
  const e = new Error(
    "人生事实不得再直接写入 Package；请经 PackageStore 预览并确认后提交。"
  );
  e.code = "life_direct_write_blocked";
  throw e;
}

/** Compact text for system prompt — roles / achievements / domains / capabilities / open inferences. */
function summarizeLifeForPrompt(pkgDir, limit = 12) {
  try {
    ensureLifeScaffold(pkgDir);
    const parts = [];
    const roles = readFacet(pkgDir, "roles").items || [];
    if (roles.length) {
      const lines = roles.slice(0, limit).map((r) => {
        const when = r.when ? `（${r.when}）` : "";
        const org = r.org ? ` @ ${r.org}` : "";
        return `- ${r.title || r.summary}${org}${when}`;
      });
      parts.push("## 社会角色与任职（人生轨迹）\n\n" + lines.join("\n"));
    }
    const outcomes = readFacet(pkgDir, "outcomes").items || [];
    if (outcomes.length) {
      parts.push(
        "## 成就与结果\n\n" +
          outcomes
            .slice(0, 8)
            .map((o) => `- ${o.title}${o.when ? `（${o.when}）` : ""}`)
            .join("\n")
      );
    }
    const domains = readSlice(pkgDir, "domains").items || [];
    if (domains.length) {
      parts.push("## 议题与专长信号\n\n" + domains.slice(0, 10).map((d) => `- ${d.title}`).join("\n"));
    }
    const caps = readSlice(pkgDir, "capability_signals").items || [];
    if (caps.length) {
      parts.push(
        "## 能力边界线索\n\n" +
          caps
            .slice(0, 8)
            .map((c) => `- [${c.polarity || "scope"}] ${c.signal}`)
            .join("\n")
      );
    }
    const orgs = readSlice(pkgDir, "org_touchpoints").items || [];
    if (orgs.length) {
      parts.push(
        "## 机构触点（非人际关系）\n\n" +
          orgs
            .slice(0, 8)
            .map((o) => `- ${o.org}${o.kind ? ` · ${o.kind}` : ""}`)
            .join("\n")
      );
    }
    const people = (readSlice(pkgDir, "people").items || []).filter(
      (p) => p.status === "confirmed" || p.status === "candidate"
    );
    if (people.length) {
      parts.push(
        "## 关系人（已确认优先；候选须谨慎使用）\n\n" +
          people
            .filter((p) => p.status !== "rejected")
            .slice(0, 8)
            .map((p) => {
              const st = p.status === "confirmed" ? "已确认" : "候选待确认";
              return `- ${p.name}${p.relationType ? ` · ${p.relationType}` : ""} [${st}]`;
            })
            .join("\n")
      );
    }
    const inferences = listInferences(pkgDir, { limit: 12, status: ["open", "confirmed"] });
    if (inferences.length) {
      const lines = inferences.map((i) => {
        const conf = i.confidence ? ` [${i.confidence}]` : "";
        const st = i.status === "confirmed" ? "已确认" : "开放推断";
        return `- （${st}${conf}）${i.claim}`;
      });
      parts.push(
        "## 围绕本人的推断与线索\n\n" +
          lines.join("\n") +
          "\n\n标注「开放推断」者勿说成确定事实；「已确认」可作较强依据但仍可核对。"
      );
    }
    return parts.join("\n\n");
  } catch {
    return "";
  }
}

function listRecentEvents(pkgDir, limit = 20) {
  return listEvents(pkgDir, { limit, order: "desc" });
}

/** Read all (or capped) events. order: desc = newest createdAt first; timeline = by when text then createdAt. */
function listEvents(pkgDir, opts = {}) {
  ensureLifeScaffold(pkgDir);
  const limit = opts.limit != null ? opts.limit : 500;
  const order = opts.order || "timeline";
  const file = path.join(lifeDir(pkgDir), "events.jsonl");
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  if (order === "desc") {
    rows.reverse();
  } else {
    // Rough chronological: longer/earlier "when" strings first; empty when last.
    rows.sort((a, b) => {
      const aw = String(a.when || "");
      const bw = String(b.when || "");
      if (aw && !bw) return -1;
      if (!aw && bw) return 1;
      if (aw !== bw) return aw.localeCompare(bw, "zh");
      return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    });
  }
  if (limit > 0 && rows.length > limit) return rows.slice(0, limit);
  return rows;
}

function getLifeGraph(pkgDir, opts = {}) {
  ensureLifeScaffold(pkgDir);
  return {
    events: listEvents(pkgDir, { limit: opts.eventLimit ?? 500, order: opts.order || "timeline" }),
    inferences: listInferences(pkgDir, { limit: opts.inferenceLimit ?? 100 }),
    roles: readFacet(pkgDir, "roles"),
    relations: readFacet(pkgDir, "relations"),
    outcomes: readFacet(pkgDir, "outcomes"),
    interests: readFacet(pkgDir, "interests"),
    domains: readSlice(pkgDir, "domains"),
    org_touchpoints: readSlice(pkgDir, "org_touchpoints"),
    people: readSlice(pkgDir, "people"),
    capability_signals: readSlice(pkgDir, "capability_signals"),
    mind_hooks: readSlice(pkgDir, "mind_hooks"),
  };
}

/** Snapshot for「我·认知」panel and self-report generation. */
function getCognitionSnapshot(pkgDir, pkgExtras = {}) {
  const graph = getLifeGraph(pkgDir, { eventLimit: 200, inferenceLimit: 80 });
  const persona = String(pkgExtras.persona || "").trim();
  const frameworksRaw = String(pkgExtras.decisionFrameworks || "").trim();
  let frameworkCount = 0;
  try {
    const fw = JSON.parse(frameworksRaw || "{}");
    frameworkCount = (fw.frameworks || []).length;
  } catch {
    frameworkCount = frameworksRaw ? 1 : 0;
  }
  const memLines = String(pkgExtras.longTermMemory || "")
    .split("\n")
    .filter((l) => l.trim()).length;
  const allInf = graph.inferences || [];
  const openInf = allInf.filter((i) => (i.status || "open") === "open");
  const lowOpenInf = openInf.filter((i) => i.confidence === "low");
  const confirmedInf = allInf.filter((i) => i.status === "confirmed");
  const peopleAll = (graph.people && graph.people.items) || [];
  const peopleActive = peopleAll.filter((p) => p.status !== "rejected");
  const peopleConfirmed = peopleAll.filter((p) => p.status === "confirmed");
  const hooksPending = ((graph.mind_hooks && graph.mind_hooks.items) || []).filter(
    (h) => h.status === "pending_distill" || h.status === "in_review"
  );
  const recentCutoff = Date.now() - 48 * 60 * 60 * 1000;
  function isRecent(row) {
    const t = Date.parse(row && (row.updatedAt || row.createdAt) || "");
    return Number.isFinite(t) && t >= recentCutoff;
  }
  const recentConfirmedInf = confirmedInf.filter(isRecent).slice(0, 20);
  const recentPeople = peopleConfirmed.filter(isRecent).slice(0, 12);
  const recentOutcomes = ((graph.outcomes && graph.outcomes.items) || []).filter(isRecent).slice(0, 12);
  const peopleCandidates = peopleAll.filter((p) => p.status === "candidate");
  const peopleConfirmedSorted = peopleConfirmed;
  return {
    coverage: {
      mind: persona.length > 80 || frameworkCount > 0 || memLines > 0,
      events: (graph.events || []).length,
      roles: ((graph.roles && graph.roles.items) || []).length,
      outcomes: ((graph.outcomes && graph.outcomes.items) || []).length,
      domains: ((graph.domains && graph.domains.items) || []).length,
      orgTouchpoints: ((graph.org_touchpoints && graph.org_touchpoints.items) || []).length,
      people: peopleConfirmed.length,
      peopleCandidates: peopleCandidates.length,
      capabilities: ((graph.capability_signals && graph.capability_signals.items) || []).length,
      inferences: confirmedInf.length + openInf.length,
      openInferences: lowOpenInf.length,
      mindHooks: hooksPending.length,
    },
    mind: {
      personaPreview: persona.slice(0, 400),
      frameworkCount,
      memoryCount: memLines,
      hooks: hooksPending,
    },
    achievements: (graph.outcomes && graph.outcomes.items) || [],
    social: {
      // Candidates first for校对
      people: [...peopleCandidates, ...peopleConfirmedSorted.filter((p) => p.status !== "candidate")],
      orgTouchpoints: (graph.org_touchpoints && graph.org_touchpoints.items) || [],
    },
    capability: {
      signals: (graph.capability_signals && graph.capability_signals.items) || [],
      domains: (graph.domains && graph.domains.items) || [],
    },
    inferences: {
      open: lowOpenInf,
      openAll: openInf,
      confirmed: confirmedInf,
    },
    recentAuto: {
      inferences: recentConfirmedInf,
      people: recentPeople,
      outcomes: recentOutcomes,
    },
    roles: (graph.roles && graph.roles.items) || [],
  };
}

function buildCognitionReportPrompt(snapshot) {
  return [
    {
      role: "system",
      content:
        "你是 Digital Me 的自我认知简报作者。根据给定的结构化切片，写一份简洁中文 Markdown 简报。" +
        "章节固定为：我的观念、我的成就、我的社会关系（区分关系人与机构触点）、我的能力边界、开放推断与待核实。" +
        "推断必须标明「待证实」；不要编造切片中没有的人名/机构；语气克制、可执行。",
    },
    {
      role: "user",
      content: "请根据以下 JSON 快照写自我认知简报：\n\n" + JSON.stringify(snapshot, null, 2),
    },
  ];
}

function writeAllEvents(pkgDir, events) {
  ensureLifeScaffold(pkgDir);
  const file = path.join(lifeDir(pkgDir), "events.jsonl");
  const body = (events || []).map((e) => JSON.stringify(e)).join("\n");
  fs.writeFileSync(file, body ? body + "\n" : "", "utf8");
}

/** Create or update a single timeline event; returns { ok, event, error }. */
function upsertEvent(pkgDir, payload) {
  ensureLifeScaffold(pkgDir);
  const ev = normalizeEvent(payload || {});
  if (!ev) return { ok: false, error: "请填写事件内容" };
  const rows = listEvents(pkgDir, { limit: 10000, order: "desc" }).reverse();
  const id = payload && payload.id ? String(payload.id) : "";
  let event;
  if (id) {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return { ok: false, error: "未找到该事件" };
    event = {
      ...rows[idx],
      when: ev.when,
      what: ev.what,
      roleLabels: ev.roleLabels,
      org: ev.org,
      actors: ev.actors,
      outcome: ev.outcome,
      facets: ev.facets,
      confidence: ev.confidence,
      updatedAt: isoNow(),
    };
    rows[idx] = event;
  } else {
    event = {
      id: makeId("evt"),
      when: ev.when,
      what: ev.what,
      roleLabels: ev.roleLabels,
      org: ev.org,
      actors: ev.actors,
      outcome: ev.outcome,
      facets: ev.facets,
      confidence: ev.confidence,
      evidence: Array.isArray(payload.evidence) ? payload.evidence : [],
      createdAt: isoNow(),
    };
    rows.push(event);
  }
  writeAllEvents(pkgDir, rows);
  applyEventToFacets(pkgDir, event, (event.evidence && event.evidence[0]) || null);
  return { ok: true, event };
}

function deleteEvent(pkgDir, id) {
  ensureLifeScaffold(pkgDir);
  const target = String(id || "");
  if (!target) return { ok: false, error: "缺少事件 id" };
  const rows = listEvents(pkgDir, { limit: 10000, order: "desc" }).reverse();
  const next = rows.filter((r) => r.id !== target);
  if (next.length === rows.length) return { ok: false, error: "未找到该事件" };
  writeAllEvents(pkgDir, next);
  // Drop role rows that only referenced this event
  const roles = readFacet(pkgDir, "roles");
  roles.items = (roles.items || []).filter((it) => {
    const ids = it.eventIds || [];
    if (!ids.includes(target)) return true;
    const remaining = ids.filter((x) => x !== target);
    if (!remaining.length) return false;
    it.eventIds = remaining;
    return true;
  });
  writeFacet(pkgDir, "roles", roles);
  return { ok: true };
}

module.exports = {
  ensureLifeScaffold,
  normalizeEvent,
  claimToEvent,
  appendEvents,
  appendInferences,
  listInferences,
  updateInference,
  updatePerson,
  updateMindHook,
  listPendingMindHooks,
  markMindHooksStatus,
  buildCoverageGaps,
  writeLifeBack,
  summarizeLifeForPrompt,
  listRecentEvents,
  listEvents,
  getLifeGraph,
  getCognitionSnapshot,
  buildCognitionReportPrompt,
  readFacet,
  readSlice,
  upsertEvent,
  deleteEvent,
  appendPeople,
  appendMindHooks,
};

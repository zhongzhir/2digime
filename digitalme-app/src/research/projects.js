"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** Optional progress hints — never hard gates except “no sources → no fake final”. */
const PROGRESS = ["question", "sources", "synthesis", "write"];
const PROGRESS_LABELS = {
  question: "问题",
  sources: "材料",
  synthesis: "整理",
  write: "成文",
};

/** Available before any materials: help user start from a question alone. */
const DISCOVERY_ACTIONS = [
  {
    id: "clarify",
    title: "理清问题",
    blurb: "把问题、范围和先不做的事写清楚。",
    needsSources: false,
    artifactType: "plan",
    recommendedExtensions: [],
    systemHint:
      "【起步：理清问题】用户可能还没有任何材料。帮助把研究问题、范围、成功标准、本次不做的事写清楚；可建议下一步该找什么材料。禁止编造具体数据或市场份额等事实。",
    prompt:
      "我目前只有研究问题、还没有材料。请帮我：1）把问题表述得可检验；2）划清范围与本次不做的事；3）列出为回答此问题必须收集的材料类型（按优先级）。不要编造数据。",
  },
  {
    id: "find_sources",
    title: "该找什么材料",
    blurb: "列出应收集的资料类型与优先顺序。",
    needsSources: false,
    artifactType: "plan",
    recommendedExtensions: ["fetch"],
    systemHint:
      "【起步：找材料】用户尚无材料。只输出可执行的收集清单（类型、可能出处、为何需要、如何判断可信），禁止假装已读过具体报告或给出无出处的市场份额/品种排名。",
    prompt:
      "围绕当前研究问题，列出应优先收集的材料清单：材料类型、可能的公开出处或渠道、要提取的关键字段、可信度注意点。不要编造尚未收集到的事实结论。",
  },
  {
    id: "search_keywords",
    title: "检索线索",
    blurb: "给出检索词与可能的公开出处。",
    needsSources: false,
    artifactType: "plan",
    recommendedExtensions: ["fetch"],
    systemHint:
      "【起步：检索线索】给出中英文检索词、可能的公开渠道（统计、协会、研报、新闻等）与核实建议；标明这些只是线索。禁止编造检索结果内容。",
    prompt:
      "请给出检索线索：关键词组合、可能的公开渠道、建议阅读时关注的字段。明确说明：以下不是已核实结论，需我自行查找后添加为材料。",
  },
];

/** Require at least one material in the notebook. */
const SOURCE_ACTIONS = [
  {
    id: "compare_table",
    title: "整理对照表",
    blurb: "按已添加材料提炼要点对照（须标注出处）。",
    needsSources: true,
    artifactType: "compare_table",
    recommendedExtensions: ["filesystem", "fetch"],
    systemHint:
      "【整理：对照表】只依据用户已添加的材料作答；每行结论旁标注材料标题；缺证据处写「待核实」，禁止编造。",
    prompt:
      "请基于当前已添加的材料，输出 Markdown 对照表：主题/结论 | 材料 | 支持程度（支持/部分支持/不支持/待核实）| 摘录要点。",
  },
  {
    id: "contradictions",
    title: "找出不一致",
    blurb: "标出材料之间互相冲突或张力之处。",
    needsSources: true,
    artifactType: "contradictions",
    recommendedExtensions: [],
    systemHint:
      "【整理：不一致】只用已添加材料；列出互相矛盾或张力的说法并挂材料标题；无法判断处标待核实。",
    prompt:
      "请基于已添加材料，列出不一致或张力：说法 A vs 说法 B、各自材料、可能原因、建议核实项。",
  },
  {
    id: "gaps",
    title: "列出证据缺口",
    blurb: "相对研究问题，还缺哪些证据。",
    needsSources: true,
    artifactType: "gaps",
    recommendedExtensions: ["fetch"],
    systemHint:
      "【整理：缺口】对照研究问题与已有材料，列出证据缺口与下一步应补的材料类型；勿假装已有结论。",
    prompt:
      "请对照研究问题与已添加材料，输出缺口清单：缺什么证据、为何重要、建议补充的材料类型或检索线索。",
  },
];

function storePath(userData) {
  return path.join(userData, "research-projects.json");
}

function emptyStore() {
  return { version: 2, items: [], activeId: null };
}

function newId(prefix) {
  return (prefix || "rn") + "_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1000);
}

function mapLegacyStageToProgress(stage) {
  const m = {
    proposition: "question",
    materials: "sources",
    framework: "synthesis",
    draft: "synthesis",
    revise: "synthesis",
    final: "write",
  };
  return m[stage] || "question";
}

/** Migrate v0.3.1 ResearchProject → ResearchNotebook (idempotent). */
function migrateItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.kind === "notebook" || (raw.question != null && Array.isArray(raw.sources))) {
    return normalizeNotebook(raw);
  }

  const question = String(raw.question || raw.proposition || "").trim() || "未命名研究";
  const sources = Array.isArray(raw.sources)
    ? raw.sources
    : (raw.materials || []).map((m) => ({
        id: m.id || newId("src"),
        title: m.title || "未命名来源",
        urlOrPath: m.source || m.urlOrPath || "",
        excerpt: m.note || m.excerpt || "",
        trust: m.trust || "medium",
        createdAt: m.createdAt || new Date().toISOString(),
      }));

  const artifacts = Array.isArray(raw.artifacts) ? raw.artifacts.slice() : [];
  const fw = raw.framework || {};
  if (fw.outline && !artifacts.some((a) => a.type === "outline")) {
    artifacts.push({
      id: newId("art"),
      type: "outline",
      title: "分析提纲（迁移）",
      content: String(fw.outline),
      createdAt: raw.updatedAt || new Date().toISOString(),
    });
  }
  if (fw.openQuestions && !artifacts.some((a) => a.type === "gaps" && a.title === "待核实（迁移）")) {
    artifacts.push({
      id: newId("art"),
      type: "gaps",
      title: "待核实（迁移）",
      content: String(fw.openQuestions),
      createdAt: raw.updatedAt || new Date().toISOString(),
    });
  }
  const drafts = raw.drafts || {};
  const draftBody = drafts.final || drafts.revise || drafts.draft || "";
  if (draftBody && !artifacts.some((a) => a.type === "draft_notes")) {
    artifacts.push({
      id: newId("art"),
      type: "draft_notes",
      title: "正文草稿（迁移）",
      content: String(draftBody),
      createdAt: raw.updatedAt || new Date().toISOString(),
    });
  }

  return normalizeNotebook({
    id: raw.id || newId("rn"),
    kind: "notebook",
    question,
    scope: raw.scope || "",
    sources,
    threads: Array.isArray(raw.threads) ? raw.threads : [],
    artifacts,
    claimNotes: Array.isArray(raw.claimNotes) ? raw.claimNotes : [],
    progress: raw.progress || mapLegacyStageToProgress(raw.stage),
    boundSkillIds: raw.boundSkillIds || [],
    deliverableId: raw.deliverableId || null,
    packageRef: raw.packageRef || null,
    checks: raw.checks || [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  });
}

function normalizeNotebook(item) {
  const now = new Date().toISOString();
  return {
    id: item.id,
    kind: "notebook",
    question: String(item.question || item.proposition || "未命名研究").trim() || "未命名研究",
    scope: String(item.scope || ""),
    sources: Array.isArray(item.sources) ? item.sources : [],
    threads: Array.isArray(item.threads) ? item.threads : [],
    artifacts: Array.isArray(item.artifacts) ? item.artifacts : [],
    claimNotes: Array.isArray(item.claimNotes) ? item.claimNotes : [],
    progress: PROGRESS.includes(item.progress) ? item.progress : "question",
    boundSkillIds: Array.isArray(item.boundSkillIds) ? item.boundSkillIds : [],
    deliverableId: item.deliverableId || null,
    packageRef: item.packageRef || null,
    checks: Array.isArray(item.checks) ? item.checks : [],
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now,
    // Compat aliases for older renderer until fully switched
    proposition: String(item.question || item.proposition || "").trim(),
    materials: Array.isArray(item.sources) ? item.sources : [],
    stage: item.progress || "question",
    drafts: item.drafts || { draft: "", revise: "", final: "" },
    framework: item.framework || { outline: "", assumptions: "", openQuestions: "" },
    methodTags: item.methodTags || [],
  };
}

function readStore(userData) {
  const p = storePath(userData);
  try {
    if (!fs.existsSync(p)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!raw || !Array.isArray(raw.items)) return emptyStore();
    const items = raw.items.map(migrateItem).filter(Boolean);
    const store = {
      version: 2,
      items,
      activeId: raw.activeId || null,
    };
    if (raw.version !== 2 || items.some((_, i) => raw.items[i] && raw.items[i].kind !== "notebook")) {
      writeStore(userData, store);
    }
    return store;
  } catch {
    return emptyStore();
  }
}

function writeStore(userData, store) {
  const toSave = {
    version: 2,
    activeId: store.activeId || null,
    items: (store.items || []).map((it) => {
      const n = normalizeNotebook(it);
      return {
        id: n.id,
        kind: "notebook",
        question: n.question,
        scope: n.scope,
        sources: n.sources,
        threads: n.threads,
        artifacts: n.artifacts,
        claimNotes: n.claimNotes,
        progress: n.progress,
        boundSkillIds: n.boundSkillIds,
        deliverableId: n.deliverableId,
        packageRef: n.packageRef,
        checks: n.checks,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      };
    }),
  };
  fs.writeFileSync(storePath(userData), JSON.stringify(toSave, null, 2), "utf8");
}

function createProject(userData, { proposition, question, packageRef } = {}) {
  const store = readStore(userData);
  const now = new Date().toISOString();
  const q = String(question || proposition || "").trim() || "未命名研究";
  const item = normalizeNotebook({
    id: newId("rn"),
    kind: "notebook",
    question: q,
    scope: "",
    sources: [],
    threads: [],
    artifacts: [],
    claimNotes: [],
    progress: "question",
    boundSkillIds: [],
    deliverableId: null,
    packageRef: packageRef || null,
    checks: [],
    createdAt: now,
    updatedAt: now,
  });
  store.items.unshift(item);
  store.activeId = item.id;
  writeStore(userData, store);
  return item;
}

function listProjects(userData) {
  return readStore(userData)
    .items.slice()
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .map((it) => ({
      id: it.id,
      question: it.question,
      proposition: it.question,
      progress: it.progress,
      progressLabel: PROGRESS_LABELS[it.progress] || it.progress,
      stage: it.progress,
      stageLabel: PROGRESS_LABELS[it.progress] || it.progress,
      sourceCount: (it.sources || []).length,
      materialCount: (it.sources || []).length,
      artifactCount: (it.artifacts || []).length,
      updatedAt: it.updatedAt,
      createdAt: it.createdAt,
    }));
}

function getProject(userData, id) {
  const item = readStore(userData).items.find((x) => x.id === id) || null;
  return item ? normalizeNotebook(item) : null;
}

function saveProject(userData, item) {
  if (!item || !item.id) throw new Error("缺少研究空间 id。");
  const store = readStore(userData);
  const i = store.items.findIndex((x) => x.id === item.id);
  const now = new Date().toISOString();
  const merged = normalizeNotebook({
    ...item,
    question: item.question || item.proposition,
    sources: item.sources || item.materials || [],
    progress: item.progress || item.stage || "question",
    updatedAt: now,
    createdAt: (i >= 0 && store.items[i].createdAt) || item.createdAt || now,
  });
  if (i >= 0) store.items[i] = merged;
  else store.items.unshift(merged);
  store.activeId = merged.id;
  writeStore(userData, store);
  return merged;
}

function deleteProject(userData, id) {
  const store = readStore(userData);
  store.items = store.items.filter((x) => x.id !== id);
  if (store.activeId === id) store.activeId = store.items[0] ? store.items[0].id : null;
  writeStore(userData, store);
  return { ok: true };
}

function setActiveProject(userData, id) {
  const store = readStore(userData);
  if (id && !store.items.find((x) => x.id === id)) throw new Error("研究空间不存在。");
  store.activeId = id || null;
  writeStore(userData, store);
  return { ok: true, activeId: store.activeId };
}

function getActiveProject(userData) {
  const store = readStore(userData);
  if (!store.activeId) return null;
  const item = store.items.find((x) => x.id === store.activeId);
  return item ? normalizeNotebook(item) : null;
}

function setProgress(userData, id, progress) {
  const mapped = PROGRESS.includes(progress) ? progress : mapLegacyStageToProgress(progress);
  if (!PROGRESS.includes(mapped)) throw new Error("未知进度：" + progress);
  const item = getProject(userData, id);
  if (!item) throw new Error("研究空间不存在。");
  item.progress = mapped;
  return saveProject(userData, item);
}

/** @deprecated alias — maps old stages to progress */
function setStage(userData, id, stage) {
  return setProgress(userData, id, mapLegacyStageToProgress(stage) || stage);
}

function sanitizeExcerpt(text, maxLen = 2000) {
  let s = String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const jsHits = (s.match(/\b(function|var|const|let|document|window|return)\b/gi) || []).length;
  const punct = (s.match(/[{};]/g) || []).length;
  if (jsHits >= 2 || punct > 12) return "";
  if (/^\s*(\{|function\s)/i.test(s) && s.length > 40) return "";
  return s.slice(0, maxLen);
}

function addSource(userData, id, source) {
  const item = getProject(userData, id);
  if (!item) throw new Error("研究空间不存在。");
  const entry = {
    id: newId("src"),
    title: String(source.title || "未命名来源").trim(),
    urlOrPath: String(source.urlOrPath || source.source || "").trim(),
    excerpt: sanitizeExcerpt(source.excerpt || source.note || ""),
    trust: source.trust || "medium",
    createdAt: new Date().toISOString(),
    origin: source.origin || undefined,
  };
  item.sources = item.sources || [];
  item.sources.unshift(entry);
  if (item.progress === "question") item.progress = "sources";
  return saveProject(userData, item);
}

function addMaterial(userData, id, material) {
  return addSource(userData, id, material);
}

function addSourcesFromSearch(userData, id, hits) {
  const item = getProject(userData, id);
  if (!item) throw new Error("研究空间不存在。");
  const list = Array.isArray(hits) ? hits : [];
  const seen = new Set((item.sources || []).map((s) => String(s.urlOrPath || "").toLowerCase()));
  let added = 0;
  for (const hit of list) {
    const url = String(hit.url || "").trim();
    if (!url || seen.has(url.toLowerCase())) continue;
    seen.add(url.toLowerCase());
    item.sources = item.sources || [];
    item.sources.unshift({
      id: newId("src"),
      title: String(hit.title || "网页摘录").trim().slice(0, 200),
      urlOrPath: url,
      excerpt: sanitizeExcerpt(hit.snippet || "", 2000),
      trust: hit.provider === "brave" ? "medium" : "low",
      createdAt: new Date().toISOString(),
      origin: "search",
    });
    added++;
  }
  if (added && item.progress === "question") item.progress = "sources";
  const saved = saveProject(userData, item);
  return { project: saved, added };
}

function addLocalFileSource(userData, id, payload) {
  const filePath = String(payload.filePath || "").trim();
  if (!filePath) throw new Error("请提供文件路径。");
  const title = String(payload.title || payload.fileName || "本地文件").trim();
  const excerpt = String(payload.excerpt || "").trim().slice(0, 12000);
  return addSource(userData, id, {
    title,
    urlOrPath: filePath,
    excerpt,
    trust: "high",
    origin: "local",
  });
}

function removeSource(userData, id, sourceId) {
  const item = getProject(userData, id);
  if (!item) throw new Error("研究空间不存在。");
  item.sources = (item.sources || []).filter((m) => m.id !== sourceId);
  return saveProject(userData, item);
}

function removeMaterial(userData, id, materialId) {
  return removeSource(userData, id, materialId);
}

function addArtifact(userData, id, artifact) {
  const item = getProject(userData, id);
  if (!item) throw new Error("研究空间不存在。");
  const entry = {
    id: newId("art"),
    type: artifact.type || "note",
    title: String(artifact.title || "综合物").trim(),
    content: String(artifact.content || ""),
    createdAt: new Date().toISOString(),
  };
  item.artifacts = item.artifacts || [];
  item.artifacts.unshift(entry);
  item.progress = "synthesis";
  return saveProject(userData, item);
}

function removeArtifact(userData, id, artifactId) {
  const item = getProject(userData, id);
  if (!item) throw new Error("研究空间不存在。");
  item.artifacts = (item.artifacts || []).filter((a) => a.id !== artifactId);
  return saveProject(userData, item);
}

function upsertClaimNotes(userData, id, notes) {
  const item = getProject(userData, id);
  if (!item) throw new Error("研究空间不存在。");
  item.claimNotes = Array.isArray(notes) ? notes : [];
  return saveProject(userData, item);
}

/**
 * Minimal claim↔source audit (not full CVP).
 * Builds / refreshes claimNotes from sources + optional text.
 */
function runClaimAudit(userData, id) {
  const item = getProject(userData, id);
  if (!item) throw new Error("研究空间不存在。");
  const sources = item.sources || [];
  const details = [];
  let summary = "";

  if (!sources.length) {
    summary = "还没有参考材料。可先用「起步」规划该找什么，找到后再做结论核对。";
    details.push("添加材料后，才能把结论挂到具体出处上。");
  } else {
    const notes = sources.map((s) => ({
      id: newId("cl"),
      claim: "来自「" + s.title + "」的要点待提炼",
      sourceIds: [s.id],
      support: s.excerpt ? "partial" : "pending",
      note: s.excerpt ? String(s.excerpt).slice(0, 200) : "尚无摘录，待核实",
    }));
    // Keep user-edited claims that still point to existing sources
    const keep = (item.claimNotes || []).filter(
      (c) => Array.isArray(c.sourceIds) && c.sourceIds.some((sid) => sources.some((s) => s.id === sid)) && c.edited
    );
    item.claimNotes = keep.concat(notes.filter((n) => !keep.some((k) => k.sourceIds[0] === n.sourceIds[0])));
    summary = `已从参考材料生成 ${item.claimNotes.length} 条结论锚点（支持 / 部分支持 / 不支持 / 待核实）。请人工改写表述并核对。`;
    details.push(...item.claimNotes.slice(0, 12).map((c) => `[${c.support}] ${c.claim}`));
  }

  const check = {
    id: newId("chk"),
    kind: "claims",
    summary,
    details,
    createdAt: new Date().toISOString(),
  };
  item.checks = item.checks || [];
  item.checks.unshift(check);
  const saved = saveProject(userData, item);
  return { check, project: saved, claimNotes: saved.claimNotes };
}

/** Legacy kinds mapped onto source-aware checks */
function runChecks(userData, id, kind) {
  const item = getProject(userData, id);
  if (!item) throw new Error("研究空间不存在。");
  const sources = item.sources || [];
  const artText = (item.artifacts || []).map((a) => a.content || "").join("\n");
  let summary = "";
  let details = [];

  if (kind === "claims" || kind === "sources") {
    return runClaimAudit(userData, id);
  }
  if (kind === "open" || kind === "gaps") {
    const gapArts = (item.artifacts || []).filter((a) => a.type === "gaps");
    if (!sources.length) {
      summary = "还没有参考材料。可先规划该找什么，再列证据缺口。";
      details = ["参考材料为空"];
    } else if (gapArts.length) {
      summary = `已有 ${gapArts.length} 份缺口类整理；请逐项核实。`;
      details = gapArts.slice(0, 5).map((a) => a.title + "：" + String(a.content).slice(0, 120));
    } else {
      summary = `有 ${sources.length} 条材料，尚无缺口清单。可用「列出证据缺口」生成。`;
      details = sources.slice(0, 8).map((s) => "已有材料：" + s.title);
    }
  } else if (kind === "challenge" || kind === "contradictions") {
    if (!sources.length) {
      summary = "还没有参考材料时，无法做有依据的不一致检查。可先用「起步」规划材料。";
      details = ["请先添加参考材料"];
    } else {
      summary = "请对照已添加材料检查不一致；下列为引导问题（结论须挂材料）。";
      details = [
        "材料之间是否存在直接冲突的事实或数据？",
        "同一结论是否只被单一低可信材料支持？",
        "是否有与当前整理相反的摘录被忽略？",
        "研究问题是否过大，导致无法用现有材料检验？",
      ];
      if (item.question) details.unshift("问题「" + item.question + "」：现有材料能否证伪关键结论？");
      if (artText) details.push("整理稿字数约 " + artText.length + "，请抽查引用是否落在材料标题上。");
    }
  } else {
    throw new Error("未知检查类型：" + kind);
  }

  const check = {
    id: newId("chk"),
    kind,
    summary,
    details,
    createdAt: new Date().toISOString(),
  };
  item.checks = item.checks || [];
  item.checks.unshift(check);
  const saved = saveProject(userData, item);
  return { check, project: saved };
}

function getDiscoveryActions() {
  return DISCOVERY_ACTIONS.map((p) => ({ ...p }));
}

function getSourceActions() {
  return SOURCE_ACTIONS.map((p) => ({ ...p }));
}

function getAllActions() {
  return getDiscoveryActions().concat(getSourceActions());
}

function getSourceAction(id) {
  return getAllActions().find((p) => p.id === id) || null;
}

function getActionsForNotebook(item) {
  const hasSources = !!(item && (item.sources || []).length);
  return hasSources ? getSourceActions() : getDiscoveryActions();
}

function getMethodPacks() {
  return getAllActions();
}

function getMethodPack(id) {
  return getSourceAction(id);
}

function getProgressSteps() {
  return PROGRESS.map((id) => ({ id, label: PROGRESS_LABELS[id] }));
}

function getStages() {
  return getProgressSteps();
}

function hasExportableContent(item) {
  const body =
    (item.artifacts || []).find((a) => a.type === "draft_notes" || a.type === "outline" || a.type === "plan")
      ?.content ||
    (item.artifacts || [])[0]?.content ||
    "";
  return !!String(body).trim() || !!(item.claimNotes || []).length;
}

function assertCanSendPlanToWriting(item) {
  if (!hasExportableContent(item)) {
    throw new Error("还没有可送出的内容。请先在对话中得到答复，或点「存为当前稿」。");
  }
}

function buildExportDeliverable(item, draftOverride) {
  const hasSources = !!(item.sources || []).length;
  let body = String(draftOverride || "").trim();
  if (!body) {
    body =
      (item.artifacts || []).find((a) => a.type === "draft_notes" || a.type === "outline" || a.type === "plan")
        ?.content ||
      (item.artifacts || [])[0]?.content ||
      "";
    body = String(body).trim();
  }
  if (!body && !(item.claimNotes || []).length) {
    throw new Error("还没有可导出的内容。请先在对话中得到答复，或点「存为当前稿」。");
  }
  const parts = [];
  parts.push("# " + (item.question || "研究答复"));
  parts.push("");
  if (!hasSources) {
    parts.push("> **说明**：本文为初步答复，尚未对照参考材料，请勿当作已核实结论。");
  } else {
    parts.push("> **说明**：本文已对照 " + item.sources.length + " 份参考材料整理。");
  }
  parts.push("");
  if (body) {
    parts.push(body);
  }
  if ((item.claimNotes || []).length) {
    parts.push("");
    parts.push("## 结论与依据");
    const supportLabel = (s) =>
      ({ support: "支持", partial: "部分支持", none: "不支持", pending: "待核实" }[s] || "待核实");
    for (const c of item.claimNotes) {
      parts.push(`- [${supportLabel(c.support)}] ${c.claim}${c.note ? " — " + c.note : ""}`);
    }
  }
  if (hasSources) {
    parts.push("");
    parts.push("## 参考材料");
    for (const s of item.sources || []) {
      parts.push(
        `- **${s.title}**${s.urlOrPath ? "（" + s.urlOrPath + "）" : ""}` +
          (s.excerpt ? "\n  > " + String(s.excerpt).replace(/\n/g, " ").slice(0, 300) : "")
      );
    }
  }
  return parts.join("\n");
}

function assertCanSendToWriting(item) {
  if (!hasExportableContent(item)) {
    throw new Error("还没有可送去改稿的内容。请先在对话中生成答复，或保存当前稿。");
  }
}

function getWritingExportTitle(item, mode) {
  const q = item.question || "研究";
  return mode === "plan" ? "研究计划 · " + q : q;
}

function buildWritingPayload(item) {
  const parts = [];
  const hasSources = !!(item.sources || []).length;
  parts.push("# " + (item.question || (hasSources ? "研究整理" : "研究计划")));
  parts.push("");
  parts.push("## 研究问题");
  parts.push(item.question || "");
  if (item.scope) {
    parts.push("");
    parts.push("## 范围");
    parts.push(item.scope);
  }
  parts.push("");
  parts.push("## 参考材料");
  if (!hasSources) {
    parts.push("（尚未添加。下文若为收集计划或检索线索，请核实后再当作事实结论。）");
  } else {
    for (const s of item.sources || []) {
      parts.push(
        `- **${s.title}**${s.urlOrPath ? "（" + s.urlOrPath + "）" : ""} · 可信度 ${s.trust || "medium"}` +
          (s.excerpt ? "\n  > " + String(s.excerpt).replace(/\n/g, " ").slice(0, 300) : "")
      );
    }
  }
  if ((item.claimNotes || []).length) {
    parts.push("");
    parts.push("## 结论与依据");
    const supportLabel = (s) =>
      ({ support: "支持", partial: "部分支持", none: "不支持", pending: "待核实" }[s] || "待核实");
    for (const c of item.claimNotes) {
      parts.push(`- [${supportLabel(c.support)}] ${c.claim}${c.note ? " — " + c.note : ""}`);
    }
  }
  for (const a of item.artifacts || []) {
    parts.push("");
    const typeLabel =
      {
        compare_table: "对照表",
        contradictions: "不一致",
        gaps: "证据缺口",
        plan: "计划",
        outline: "提纲",
        draft_notes: "草稿",
        note: "笔记",
      }[a.type] || a.type || "整理";
    parts.push("## " + (a.title || typeLabel));
    parts.push(a.content || "");
  }
  return parts.join("\n");
}

module.exports = {
  sanitizeExcerpt,
  PROGRESS,
  PROGRESS_LABELS,
  DISCOVERY_ACTIONS,
  SOURCE_ACTIONS,
  createProject,
  listProjects,
  getProject,
  saveProject,
  deleteProject,
  setActiveProject,
  getActiveProject,
  setProgress,
  setStage,
  addSource,
  addMaterial,
  addSourcesFromSearch,
  addLocalFileSource,
  removeSource,
  removeMaterial,
  addArtifact,
  removeArtifact,
  upsertClaimNotes,
  runClaimAudit,
  runChecks,
  getDiscoveryActions,
  getSourceActions,
  getAllActions,
  getActionsForNotebook,
  getSourceAction,
  getMethodPacks,
  getMethodPack,
  getProgressSteps,
  getStages,
  hasExportableContent,
  assertCanSendPlanToWriting,
  assertCanSendToWriting,
  getWritingExportTitle,
  buildExportDeliverable,
  buildWritingPayload,
  migrateItem,
};

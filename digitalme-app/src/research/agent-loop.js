"use strict";

const researchGrounded = require("./grounded");

const AGENT_STEPS = [
  { id: "clarify", label: "澄清问题" },
  { id: "search", label: "检索材料" },
  { id: "read", label: "阅读来源" },
  { id: "synthesize", label: "撰写成果" },
];

function parseClarifyJson(text) {
  const raw = String(text || "").trim();
  try {
    const j = JSON.parse(raw);
    return {
      clarifiedQuestion: String(j.clarifiedQuestion || j.question || "").trim(),
      scope: String(j.scope || "").trim(),
      searchQuery: String(j.searchQuery || j.query || "").trim(),
    };
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return parseClarifyJson(m[0]);
      } catch {
        // fall through
      }
    }
  }
  return null;
}

function fallbackClarify(question) {
  const q = String(question || "").trim();
  return { clarifiedQuestion: q, scope: "", searchQuery: q.slice(0, 120) };
}

async function stepClarify({ question, callModel, cfg, notify }) {
  notify({ step: "clarify", phase: "running", label: "正在澄清问题与检索词…" });
  const q = String(question || "").trim();
  if (!q) throw new Error("请提供研究问题。");
  try {
    const reply = await callModel(cfg, [
      {
        role: "system",
        content:
          "你是研究助手。用户给出研究问题，你只输出一行 JSON，不要 markdown：" +
          '{"clarifiedQuestion":"一句清晰的研究问题","scope":"范围边界（可空）","searchQuery":"用于网页检索的关键词（中文或英文，40字内）"}',
      },
      { role: "user", content: q },
    ], { temperature: 0.2 });
    const parsed = parseClarifyJson(reply);
    if (parsed && parsed.clarifiedQuestion && parsed.searchQuery) {
      notify({ step: "clarify", phase: "done", label: "问题已澄清" });
      return parsed;
    }
  } catch {
    // heuristic fallback
  }
  const fb = fallbackClarify(q);
  notify({ step: "clarify", phase: "done", label: "已使用原问题继续" });
  return fb;
}

async function stepSearch({
  userData,
  projectId,
  searchQuery,
  projects,
  webSearch,
  ensureExtensionConnected,
  enrichSearchHitsWithFetch,
  getExtensionManager,
  notify,
}) {
  notify({ step: "search", phase: "running", label: "正在检索并入库…" });
  await ensureExtensionConnected("fetch");
  await ensureExtensionConnected("brave-search");
  const em = await getExtensionManager();
  const { provider, results } = await webSearch.searchWeb(em, searchQuery);
  const enriched = await enrichSearchHitsWithFetch(em, results, 3);
  const { project, added } = projects.addSourcesFromSearch(userData, projectId, enriched);
  notify({
    step: "search",
    phase: "done",
    label: added ? `已入库 ${added} 条材料` : "检索完成",
    provider,
    added,
  });
  return { project, added, provider, results: enriched };
}

async function stepReadSources({
  userData,
  projectId,
  projects,
  ensureExtensionConnected,
  getExtensionManager,
  formatToolResult,
  notify,
  limit = 5,
}) {
  notify({ step: "read", phase: "running", label: "正在阅读来源正文…" });
  await ensureExtensionConnected("fetch");
  const em = await getExtensionManager();
  const st = em.getSessionStatus().find((s) => s.id === "fetch" && s.status === "connected");
  let item = projects.getProject(userData, projectId);
  if (!item || !st) {
    notify({ step: "read", phase: "done", label: "跳过（网页阅读未就绪）" });
    return item;
  }
  const sources = item.sources || [];
  let read = 0;
  for (const src of sources.slice(0, limit)) {
    const url = String(src.urlOrPath || "").trim();
    if (!url.startsWith("http")) continue;
    if (String(src.excerpt || "").length > 400) continue;
    try {
      const result = await em.callTool("fetch", "fetch_markdown", { url });
      const text = formatToolResult(result).slice(0, 4500);
      if (text && text.length > 80) {
        src.excerpt = text;
        src.fetched = true;
        read++;
      }
    } catch {
      // keep snippet
    }
  }
  if (read) item = projects.saveProject(userData, item);
  notify({ step: "read", phase: "done", label: read ? `已阅读 ${read} 份来源` : "来源摘录已就绪" });
  return item;
}

function buildSourcesBlock(sources) {
  return (sources || [])
    .slice(0, 20)
    .map((s, i) => {
      const loc = s.urlOrPath || "";
      const ex = String(s.excerpt || "").slice(0, 3500);
      return `${i + 1}. 《${s.title}》${loc ? "（" + loc + "）" : ""}\n${ex || "（无摘录）"}`;
    })
    .join("\n\n");
}

async function stepSynthesize({
  item,
  clarifiedQuestion,
  scope,
  callModel,
  cfg,
  scenarioHint,
  notify,
}) {
  notify({ step: "synthesize", phase: "running", label: "正在撰写有依据的答复…" });
  const sources = item.sources || [];
  const groundedAppend = researchGrounded.buildGroundedSystemAppend(item);
  const system =
    (scenarioHint || "当前在研究场景。") +
    "\n\n" +
    groundedAppend +
    "\n\n输出结构：\n1) 正文答复（Markdown）\n2) 末尾必须有 ## 结论与依据 小节";
  const userContent =
    `研究问题：${clarifiedQuestion || item.question}\n` +
    (scope ? `范围：${scope}\n` : "") +
    `\n【参考材料】\n${buildSourcesBlock(sources) || "（无 — 仅可给初步分析）"}\n\n` +
    "请写出完整答复。有材料时每条重要结论须在正文或「结论与依据」中对应材料标题。";
  const reply = await callModel(cfg, [
    { role: "system", content: system },
    { role: "user", content: userContent },
  ], { temperature: 0.5 });
  notify({ step: "synthesize", phase: "done", label: "答复已完成" });
  return String(reply || "").trim();
}

/**
 * Four-step research agent: clarify → search → read → synthesize.
 */
async function runResearchAgentLoop(deps) {
  const {
    userData,
    projectId,
    question,
    onProgress,
    callModel,
    cfg,
    projects,
    webSearch,
    ensureExtensionConnected,
    enrichSearchHitsWithFetch,
    getExtensionManager,
    formatToolResult,
    scenarioHint,
  } = deps;

  const notify = (payload) => {
    if (typeof onProgress === "function") onProgress(payload);
  };

  let item = projects.getProject(userData, projectId);
  if (!item) throw new Error("研究空间不存在。");

  const clarify = await stepClarify({ question, callModel, cfg, notify });
  if (clarify.clarifiedQuestion) {
    item.question = clarify.clarifiedQuestion;
    item.proposition = clarify.clarifiedQuestion;
  }
  if (clarify.scope) item.scope = clarify.scope;
  item = projects.saveProject(userData, item);

  const search = await stepSearch({
    userData,
    projectId: item.id,
    searchQuery: clarify.searchQuery || clarify.clarifiedQuestion || question,
    projects,
    webSearch,
    ensureExtensionConnected,
    enrichSearchHitsWithFetch,
    getExtensionManager,
    notify,
  });
  item = search.project;

  item = await stepReadSources({
    userData,
    projectId: item.id,
    projects,
    ensureExtensionConnected,
    getExtensionManager,
    formatToolResult,
    notify,
  });

  const reply = await stepSynthesize({
    item,
    clarifiedQuestion: clarify.clarifiedQuestion,
    scope: clarify.scope,
    callModel,
    cfg,
    scenarioHint,
    notify,
  });

  const claimNotes = researchGrounded.parseClaimNotesFromText(reply, item.sources || []);
  if (claimNotes.length) {
    item.claimNotes = claimNotes;
  }
  item.progress = (item.sources || []).length ? "synthesis" : item.progress;
  item = projects.saveProject(userData, item);

  const grounded = researchGrounded.validateGroundedContent(item, reply);

  notify({ step: "done", phase: "done", label: "调研完成" });

  return {
    project: item,
    reply,
    claimNotes: item.claimNotes || [],
    steps: AGENT_STEPS.map((s) => s.id),
    clarify,
    search: { added: search.added, provider: search.provider },
    grounded,
  };
}

module.exports = {
  AGENT_STEPS,
  runResearchAgentLoop,
};

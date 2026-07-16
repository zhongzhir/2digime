"use strict";

const fs = require("node:fs");
const path = require("node:path");

function libraryPath(userData) {
  return path.join(userData, "deliverables-library.json");
}

function emptyStore() {
  return { version: 1, items: [] };
}

function readStore(userData) {
  const p = libraryPath(userData);
  try {
    if (!fs.existsSync(p)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!raw || !Array.isArray(raw.items)) return emptyStore();
    return raw;
  } catch {
    return emptyStore();
  }
}

function writeStore(userData, store) {
  fs.writeFileSync(libraryPath(userData), JSON.stringify(store, null, 2), "utf8");
}

function listDeliverables(userData) {
  const store = readStore(userData);
  return store.items
    .slice()
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .map((it) => ({
      id: it.id,
      type: it.type,
      templateId: it.templateId,
      title: it.title,
      status: it.status,
      formats: it.formats,
      sourceSessionId: it.sourceSessionId || null,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      preview: String(it.content || "").slice(0, 160),
    }));
}

function getDeliverable(userData, id) {
  return readStore(userData).items.find((x) => x.id === id) || null;
}

function upsertDeliverable(userData, item) {
  const store = readStore(userData);
  const now = new Date().toISOString();
  const id = item.id || "dlv_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1000);
  const next = {
    id,
    type: item.type || "memo",
    templateId: item.templateId || null,
    title: item.title || "未命名产物",
    status: item.status || "draft",
    content: item.content || "",
    formats: item.formats || ["md", "docx"],
    sourceSessionId: item.sourceSessionId || null,
    packageRef: item.packageRef || null,
    evidenceRefs: item.evidenceRefs || [],
    createdAt: item.createdAt || now,
    updatedAt: now,
  };
  const i = store.items.findIndex((x) => x.id === id);
  if (i >= 0) store.items[i] = { ...store.items[i], ...next, createdAt: store.items[i].createdAt };
  else store.items.unshift(next);
  writeStore(userData, store);
  return next;
}

function deleteDeliverable(userData, id) {
  const store = readStore(userData);
  store.items = store.items.filter((x) => x.id !== id);
  writeStore(userData, store);
  return { ok: true };
}

/** Built-in document templates (v0.3). */
const TEMPLATES = [
  {
    id: "report",
    type: "report",
    title: "研究报告",
    blurb: "结构清晰的分析报告草稿，可导出 Word / Markdown。",
    formats: ["md", "docx"],
    skeleton: (topic) =>
      `# ${topic || "研究报告"}\n\n## 摘要\n\n（用 2～4 句概括核心结论；新建后可在此改写，或让数字之我按提纲生成全文。）\n\n## 背景与问题\n\n（说明研究背景、要回答的问题。）\n\n## 分析\n\n### 要点一\n\n（展开论据与数据。）\n\n### 要点二\n\n## 结论与建议\n\n（可执行建议。）\n\n## 待核实信息\n\n- \n`,
    workbenchPrompt: (topic) =>
      `请写一份结构清晰的研究报告草稿（用 Markdown 标题与条目）。主题：${topic || "（请补充主题）"}`,
  },
  {
    id: "request_doc",
    type: "request_doc",
    title: "请示",
    blurb: "正式请示文稿：事由、依据、方案、请求事项。",
    formats: ["md", "docx"],
    skeleton: (topic) =>
      `# 关于${topic || "××"}的请示\n\n## 请示事项\n\n## 背景与依据\n\n## 方案说明\n\n## 需协调事项\n\n## 请求批复内容\n\n`,
    workbenchPrompt: (topic) =>
      `请整理一份请示文稿，语气正式、条理清楚。主题：${topic || "（请补充主题）"}`,
  },
  {
    id: "proposal",
    type: "proposal",
    title: "方案",
    blurb: "可落地的方案提纲：目标、路径、资源、风险。",
    formats: ["md", "docx"],
    skeleton: (topic) =>
      `# ${topic || "方案"}实施方案\n\n## 目标\n\n## 现状与差距\n\n## 实施路径\n\n1. \n2. \n\n## 资源与分工\n\n## 风险与应对\n\n## 里程碑\n\n`,
    workbenchPrompt: (topic) =>
      `请整理一份方案提纲，目标清晰、可执行。主题：${topic || "（请补充主题）"}`,
  },
  {
    id: "memo",
    type: "memo",
    title: "备忘录 / 纪要",
    blurb: "会议纪要或备忘：决议、待办、责任人。",
    formats: ["md", "docx"],
    skeleton: (topic) =>
      `# ${topic || "会议纪要"}\n\n- 时间：\n- 参与人：\n\n## 讨论要点\n\n## 决议\n\n## 待办\n\n| 事项 | 责任人 | 截止 |\n|------|--------|------|\n|  |  |  |\n`,
    workbenchPrompt: (topic) =>
      `请整理一份备忘录/会议纪要（Markdown）。主题：${topic || "（请补充主题）"}`,
  },
  {
    id: "table",
    type: "table",
    title: "结构化表格",
    blurb: "清单/对比表，可导出 CSV（用 WPS 或 Excel 打开）。",
    formats: ["csv", "md"],
    skeleton: (topic) =>
      `# ${topic || "对照表"}\n\n| 项目 | 说明 | 状态 | 备注 |\n|------|------|------|------|\n| 示例一 |  | 进行中 |  |\n| 示例二 |  | 待定 |  |\n`,
    workbenchPrompt: (topic) =>
      `请整理一份结构化对照表（Markdown 表格）。主题：${topic || "（请补充主题）"}。表头清晰，便于导出 CSV。`,
  },
  {
    id: "ppt",
    type: "ppt",
    title: "演讲 PPT",
    blurb: "生成幻灯片结构并导出 .pptx；也可从成稿一键生成。",
    formats: ["pptx"],
    skeleton: null,
    workbenchPrompt: null,
    openPptForm: true,
  },
];

/** Starter scenario packs — prompt + recommended capabilities + system hint. */
const SCENARIO_PACKS = [
  {
    id: "writing_voice",
    title: "写作表达",
    blurb: "按你的文风起草或改写；可自动使用本地文件与网页阅读能力。",
    prompt:
      "请按我的表达风格，起草或改写下面内容，要求像我、可读、有立场但不空喊。原文或主题：",
    recommendedExtensions: ["filesystem", "fetch"],
    templateId: "report",
    systemHint:
      "【本轮场景：写作表达】优先按本人风格与判断框架写作。" +
      "若用户提供链接，应使用已连接的网页阅读能力获取正文后再写；" +
      "若涉及本地草稿或素材，可使用本地文件能力。" +
      "较长成稿请放入 markdown 代码块，供右侧成稿预览。",
  },
  {
    id: "founder_decision",
    title: "决策分析",
    blurb: "用你的判断框架拆解选择题；可启用分步思考。",
    prompt:
      "请用我的判断框架，帮我分析下面这个决策问题：目标、选项、关键不确定因素、我通常会看重的信号、建议与风险。问题：",
    recommendedExtensions: ["sequential-thinking"],
    systemHint:
      "【本轮场景：决策分析】严格依据本人判断框架与记忆作答；" +
      "可使用分步思考能力把论证拆开；结论须标明假设与风险，勿编造未给出的事实。",
  },
  {
    id: "research_invest",
    title: "投研分析",
    blurb: "短研报骨架；有链接时可先阅读网页再分析。",
    prompt:
      "请写一份投研向的短分析（Markdown）：结论先行、关键假设、证据、风险、待核实清单。标的或主题：",
    recommendedExtensions: ["fetch", "sequential-thinking"],
    templateId: "report",
    systemHint:
      "【本轮场景：投研分析】结论先行，证据与待核实点必须分开列出。" +
      "若用户给出网址，应先阅读网页再分析；缺少证据处明确标注「待核实」，禁止编造数据。",
  },
];

function getTemplates() {
  return TEMPLATES.map(({ id, type, title, blurb, formats, openPptForm }) => ({
    id,
    type,
    title,
    blurb,
    formats,
    openPptForm: !!openPptForm,
  }));
}

function getScenarioPacks() {
  return SCENARIO_PACKS.map((p) => ({
    id: p.id,
    title: p.title,
    blurb: p.blurb,
    prompt: p.prompt,
    recommendedExtensions: p.recommendedExtensions || [],
    templateId: p.templateId || null,
    systemHint: p.systemHint || "",
  }));
}

function getScenarioPackById(id) {
  return getScenarioPacks().find((p) => p.id === id) || null;
}

function createFromTemplate(userData, { templateId, title, packageRef, sourceSessionId }) {
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) throw new Error("未知模板：" + templateId);
  if (tpl.openPptForm) {
    return { openPptForm: true, template: getTemplates().find((t) => t.id === "ppt") };
  }
  const topic = (title || "").trim() || tpl.title;
  return upsertDeliverable(userData, {
    type: tpl.type,
    templateId: tpl.id,
    title: topic,
    status: "draft",
    content: tpl.skeleton(topic),
    formats: tpl.formats,
    packageRef: packageRef || null,
    sourceSessionId: sourceSessionId || null,
  });
}

/** Blank / freeform document — primary write path (v0.3.7). */
function createBlank(userData, { title, content, packageRef, sourceSessionId } = {}) {
  const topic = String(title || "").trim() || "未命名文稿";
  return upsertDeliverable(userData, {
    type: "general",
    templateId: null,
    title: topic,
    status: "draft",
    content: content != null ? String(content) : "",
    formats: ["md", "docx"],
    packageRef: packageRef || null,
    sourceSessionId: sourceSessionId || null,
  });
}

function importFromArtifact(userData, { id, title, content, sourceSessionId, packageRef, type, status }) {
  const text = String(content || "").trim();
  if (!text) throw new Error("没有可导入的成稿内容。");
  const inferredType =
    type ||
    (/请示/.test(title || text)
      ? "request_doc"
      : /方案/.test(title || text)
        ? "proposal"
        : /纪要|备忘/.test(title || text)
          ? "memo"
          : "report");
  const prev = id ? getDeliverable(userData, id) : null;
  return upsertDeliverable(userData, {
    id: id || undefined,
    type: inferredType || (prev && prev.type) || "report",
    templateId:
      (prev && prev.templateId) ||
      (inferredType === "report" ? "report" : inferredType),
    title: title || (prev && prev.title) || "工作台成稿",
    status: status || "ready",
    content: text,
    formats: (prev && prev.formats) || ["md", "docx"],
    sourceSessionId: sourceSessionId || (prev && prev.sourceSessionId) || null,
    packageRef: packageRef || (prev && prev.packageRef) || null,
    createdAt: prev && prev.createdAt,
  });
}

function workbenchPromptForTemplate(templateId, topic) {
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tpl || !tpl.workbenchPrompt) return null;
  return tpl.workbenchPrompt(topic);
}

/** Extract first markdown table → CSV text (UTF-8 with BOM for Excel/WPS). */
function markdownTableToCsv(md) {
  const lines = String(md || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const rows = [];
  for (const line of lines) {
    if (!/^\|/.test(line)) continue;
    if (/^\|?\s*:?-{3,}/.test(line.replace(/\|/g, "|"))) {
      // separator row
      if (/^[\|\s:\-]+$/.test(line)) continue;
    }
    if (/^\|?\s*[-:| ]+\s*\|?\s*$/.test(line)) continue;
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.length) rows.push(cells);
  }
  if (rows.length < 1) throw new Error("文稿里没有找到可导出的表格。请先用 Markdown 表格整理内容。");
  const escapeCell = (c) => {
    const s = String(c ?? "");
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const body = rows.map((r) => r.map(escapeCell).join(",")).join("\n");
  return "\uFEFF" + body + "\n";
}

module.exports = {
  listDeliverables,
  getDeliverable,
  upsertDeliverable,
  deleteDeliverable,
  getTemplates,
  getScenarioPacks,
  getScenarioPackById,
  createFromTemplate,
  createBlank,
  importFromArtifact,
  workbenchPromptForTemplate,
  markdownTableToCsv,
  TEMPLATES,
  SCENARIO_PACKS,
};

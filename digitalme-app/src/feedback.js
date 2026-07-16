"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { hasReplacementChar } = require("./builder");

const CATEGORIES = {
  style: { label: "表达风格", file: "style-guide.md", section: "## 用户反馈（风格纠正）" },
  memory: { label: "观点/记忆", file: "memory/long-term-memory.jsonl" },
  boundary: { label: "行为边界", file: "persona.md", section: "## 不应代表本人做出的事项" },
  persona: { label: "人格/立场", file: "persona.md", section: "## 用户反馈（人格/立场）" },
};

const CLASSIFY_RULES = [
  { cat: "boundary", re: /不要|不能|禁止|绝不要|不代表|边界|擅自|未经|别替/, w: 2 },
  { cat: "style", re: /风格|口吻|太.{0,3}了|啰嗦|冗长|用词|写法|语气|书面|口语|不要用|表达|像不像|不像我/, w: 2 },
  { cat: "persona", re: /人格|价值观|立场|定位|态度|身份|我不是/, w: 2 },
  { cat: "memory", re: /观点|判断|我认为|不对|实际上|事实是|错误|应该是|没说|没写过|曲解/, w: 2 },
];

function isoNow() {
  return new Date().toISOString();
}

function classifyFeedback({ correction }) {
  const text = String(correction || "");
  const scores = { style: 0, memory: 0, boundary: 0, persona: 0 };
  for (const r of CLASSIFY_RULES) {
    if (r.re.test(text)) scores[r.cat] += r.w;
  }
  let best = "memory";
  let max = 0;
  for (const [k, v] of Object.entries(scores)) {
    if (v > max) { max = v; best = k; }
  }
  return { category: best, ...CATEGORIES[best], scores };
}

function buildWritePlan({ category, correction, userQuestion, assistantExcerpt }) {
  const cat = CATEGORIES[category] || CATEGORIES.memory;
  const corr = String(correction || "").trim();
  if (!corr || hasReplacementChar(corr)) throw new Error("修正内容无效或含乱码。");

  const ctx = [];
  if (userQuestion) ctx.push(`相关问题：${userQuestion}`);
  if (assistantExcerpt) ctx.push(`原回复摘要：${String(assistantExcerpt).slice(0, 200)}`);
  const contextNote = ctx.length ? `（${ctx.join("；")}）` : "";

  if (category === "memory") {
    return {
      category,
      categoryLabel: cat.label,
      targetFile: cat.file,
      proposedContent: corr,
      memoryEntry: {
        content: corr.startsWith("用户纠正") ? corr : `用户纠正：${corr}${contextNote}`,
        theme: "用户反馈",
        confidence: "high",
      },
      summary: `新增 1 条核心记忆：${corr.slice(0, 80)}${corr.length > 80 ? "…" : ""}`,
    };
  }

  const line = `- ${corr}${contextNote}`;
  return {
    category,
    categoryLabel: cat.label,
    targetFile: cat.file,
    proposedContent: line,
    appendLine: line,
    section: cat.section,
    summary: `写入 ${cat.file}：${corr.slice(0, 80)}${corr.length > 80 ? "…" : ""}`,
  };
}

function ensureSection(filePath, section) {
  let text = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (!text.includes(section)) {
    text = text.trimEnd() + `\n\n${section}\n\n> 由对话反馈自动沉淀，供后续输出参考。\n`;
    fs.writeFileSync(filePath, text, "utf8");
  }
  return text;
}

function appendToSection(pkgDir, relFile, section, line) {
  const filePath = path.join(pkgDir, relFile);
  ensureSection(filePath, section);
  fs.appendFileSync(filePath, line + "\n", "utf8");
}

function appendMemory(pkgDir, entry) {
  const file = path.join(pkgDir, "memory", "long-term-memory.jsonl");
  let maxId = 0;
  if (fs.existsSync(file)) {
    for (const l of fs.readFileSync(file, "utf8").split("\n")) {
      const mm = /"id"\s*:\s*"core_(\d+)"/.exec(l) || /"id"\s*:\s*"mem_(\d+)"/.exec(l) || /"id"\s*:\s*"fb_(\d+)"/.exec(l);
      if (mm) maxId = Math.max(maxId, parseInt(mm[1], 10));
    }
  }
  const row = {
    id: "fb_" + String(maxId + 1).padStart(3, "0"),
    type: "long_term",
    content: entry.content,
    theme: entry.theme || "用户反馈",
    confidence: entry.confidence || "high",
    sensitivity: "private",
    createdAt: isoNow(),
    sourceRefs: ["feedback"],
    expiresAt: null,
  };
  const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const needsNL = raw.length > 0 && !raw.endsWith("\n");
  fs.appendFileSync(file, (needsNL ? "\n" : "") + JSON.stringify(row) + "\n", "utf8");
  return row.id;
}

function applyFeedback(pkgDir, plan) {
  if (plan.category === "memory") {
    const id = appendMemory(pkgDir, plan.memoryEntry);
    return { ok: true, targetFile: plan.targetFile, id, category: plan.category };
  }
  appendToSection(pkgDir, plan.targetFile, plan.section, plan.appendLine);
  return { ok: true, targetFile: plan.targetFile, category: plan.category };
}

function previewFeedback(payload) {
  const classified = classifyFeedback(payload);
  const plan = buildWritePlan({ ...payload, category: classified.category });
  return { ...plan, scores: classified.scores };
}

module.exports = { classifyFeedback, buildWritePlan, previewFeedback, applyFeedback, CATEGORIES };

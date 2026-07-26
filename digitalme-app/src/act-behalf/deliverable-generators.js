"use strict";

/**
 * DVL2-03 per-kind generators — produce in-memory file buffers only.
 */

const { buildDocxFromMarkdown } = require("../outputs/document");
const { buildPptx, parsePlanJson } = require("../outputs/pptx");
const { markdownToHtml, slidesToHtmlDeck } = require("./deliverable-md-html");
const { minimalPngBuffer } = require("./deliverable-artifact-fs");

function clampText(s, max) {
  const t = String(s || "");
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n…（已截断）";
}

function snapshotContext(pkg, deliverable) {
  const snap = (pkg && pkg.executionSnapshot) || {};
  const input = snap.inputSummary || {};
  return {
    goal: String(input.goal || ""),
    audience: input.audience != null ? String(input.audience) : "",
    usage: input.usage != null ? String(input.usage) : "",
    summary: String(input.understandingSummary || ""),
    title: String((deliverable && deliverable.title) || "成果"),
    purpose: String((deliverable && deliverable.purpose) || ""),
    kind: String((deliverable && deliverable.kind) || "other"),
  };
}

function buildDocumentMessages(ctx) {
  return [
    {
      role: "system",
      content:
        "你是 Digital Me 的成果写作者。根据任务理解与成果说明，输出完整 Markdown 文档。" +
        "使用中文。包含标题与若干小节。不要输出代码围栏包裹整篇。不要编造未给出的隐私事实。",
    },
    {
      role: "user",
      content: clampText(
        [
          `任务目标：${ctx.goal}`,
          ctx.audience ? `受众：${ctx.audience}` : "",
          ctx.usage ? `用途：${ctx.usage}` : "",
          ctx.summary ? `理解摘要：${ctx.summary}` : "",
          `成果标题：${ctx.title}`,
          ctx.purpose ? `成果用途：${ctx.purpose}` : "",
          "请直接输出 Markdown 正文。",
        ]
          .filter(Boolean)
          .join("\n"),
        8000
      ),
    },
  ];
}

function buildSlideMessages(ctx) {
  return [
    {
      role: "system",
      content:
        "你规划演示文稿结构。只输出 JSON：" +
        '{"title":"...","subtitle":"...","closing":"...","slides":[{"title":"...","bullets":["..."]}]}' +
        " 不要 markdown 代码围栏。使用中文。8-12 页为宜。",
    },
    {
      role: "user",
      content: clampText(
        `主题：${ctx.title}\n目标：${ctx.goal}\n受众：${ctx.audience}\n用途：${ctx.usage}\n说明：${ctx.purpose}`,
        6000
      ),
    },
  ];
}

function buildWebpageMessages(ctx) {
  return [
    {
      role: "system",
      content:
        "你撰写单页介绍内容。输出 Markdown（将转为独立 HTML）。使用中文，结构清晰，含标题与要点列表。",
    },
    {
      role: "user",
      content: clampText(
        `页面标题：${ctx.title}\n目标：${ctx.goal}\n受众：${ctx.audience}\n用途：${ctx.usage}\n说明：${ctx.purpose}`,
        6000
      ),
    },
  ];
}

async function generateDocument({ pkg, deliverable, callModel }) {
  const ctx = snapshotContext(pkg, deliverable);
  let md;
  if (typeof callModel === "function") {
    md = String(await callModel(buildDocumentMessages(ctx), { taskType: "artifact", temperature: 0.4 }));
  } else {
    md = `# ${ctx.title}\n\n## 概述\n\n${ctx.goal || "（无目标）"}\n\n## 说明\n\n面向：${ctx.audience || "通用读者"}。用途：${ctx.usage || "介绍"}。\n`;
  }
  md = String(md || "").trim();
  if (!md || md.length < 20) {
    const e = new Error("模型未返回有效文档内容。");
    e.code = "empty_model_output";
    throw e;
  }
  if (md.length > 80000) md = md.slice(0, 80000);
  const html = markdownToHtml(md, { title: ctx.title });
  const files = {
    "artifact.md": md,
    "artifact.html": html,
  };
  try {
    files["artifact.docx"] = buildDocxFromMarkdown(md, ctx.title);
  } catch {
    /* DOCX optional — do not block */
  }
  return {
    kind: "document",
    displayFormats: Object.keys(files).map((n) => n.replace(/^artifact\./, "")),
    primaryFile: "artifact.md",
    files,
    contentLabel: "文档",
  };
}

async function generatePresentation({ pkg, deliverable, callModel }) {
  const ctx = snapshotContext(pkg, deliverable);
  let raw;
  if (typeof callModel === "function") {
    raw = String(await callModel(buildSlideMessages(ctx), { taskType: "artifact", temperature: 0.35 }));
  } else {
    raw = JSON.stringify({
      title: ctx.title,
      subtitle: ctx.goal.slice(0, 80),
      closing: "谢谢",
      slides: [
        { title: "背景", bullets: [ctx.goal || "项目介绍"] },
        { title: "要点", bullets: [ctx.purpose || "核心信息", ctx.audience || "目标受众"] },
        { title: "下一步", bullets: ["欢迎交流"] },
      ],
    });
  }
  let plan;
  try {
    plan = parsePlanJson(raw);
  } catch (err) {
    const e = new Error("模型未返回有效演示结构。");
    e.code = "invalid_slide_structure";
    e.cause = err;
    throw e;
  }
  const files = {};
  let usedPptx = false;
  try {
    files["artifact.pptx"] = await buildPptx(plan);
    usedPptx = true;
  } catch {
    /* fall through to HTML deck */
  }
  files["artifact.html"] = slidesToHtmlDeck(plan);
  files["slides.json"] = JSON.stringify(plan, null, 2);
  return {
    kind: "presentation",
    displayFormats: usedPptx ? ["pptx", "html"] : ["html"],
    uiFormatLabel: usedPptx ? "演示文稿（PPTX）" : "网页演示文稿",
    primaryFile: usedPptx ? "artifact.pptx" : "artifact.html",
    files,
    contentLabel: usedPptx ? "演示文稿" : "网页演示文稿",
    slideModel: plan,
  };
}

async function generateWebpage({ pkg, deliverable, callModel }) {
  const ctx = snapshotContext(pkg, deliverable);
  let md;
  if (typeof callModel === "function") {
    md = String(await callModel(buildWebpageMessages(ctx), { taskType: "artifact", temperature: 0.4 }));
  } else {
    md = `# ${ctx.title}\n\n${ctx.goal}\n\n- ${ctx.purpose || "介绍要点"}\n`;
  }
  md = String(md || "").trim();
  if (!md || md.length < 12) {
    const e = new Error("模型未返回有效网页内容。");
    e.code = "empty_model_output";
    throw e;
  }
  const html = markdownToHtml(md, { title: ctx.title });
  return {
    kind: "webpage",
    displayFormats: ["html", "md"],
    primaryFile: "artifact.html",
    files: {
      "artifact.html": html,
      "artifact.md": md,
    },
    contentLabel: "网页",
  };
}

async function generateImage({ pkg, deliverable, callModel, imageMode }) {
  void pkg;
  void deliverable;
  void callModel;
  // No production image model in repo. Mock mode writes minimal PNG for automated tests only.
  if (imageMode === "mock") {
    return {
      kind: "image",
      displayFormats: ["png"],
      primaryFile: "artifact.png",
      files: { "artifact.png": minimalPngBuffer() },
      contentLabel: "图片",
      mock: true,
    };
  }
  const e = new Error("尚未配置可用的图片生成能力。");
  e.code = "image_capability_unavailable";
  throw e;
}

async function generateByKind(kind, deps) {
  switch (String(kind || "")) {
    case "document":
      return generateDocument(deps);
    case "presentation":
      return generatePresentation(deps);
    case "webpage":
      return generateWebpage(deps);
    case "image":
      return generateImage(deps);
    default: {
      const e = new Error("该成果类型尚未接入真实生成。");
      e.code = "kind_not_supported";
      throw e;
    }
  }
}

module.exports = {
  generateByKind,
  generateDocument,
  generatePresentation,
  generateWebpage,
  generateImage,
  snapshotContext,
};

"use strict";

/**
 * DVL2-03 per-kind generators — produce in-memory file buffers only.
 */

const { buildDocxFromMarkdown } = require("../outputs/document");
const { buildPptx, parsePlanJson } = require("../outputs/pptx");
const { markdownToHtml, slidesToHtmlDeck } = require("./deliverable-md-html");
const { minimalPngBuffer } = require("./deliverable-artifact-fs");
const {
  buildGenerationContext,
  assertGeneratedContentUsable,
} = require("./deliverable-context");
const { promptGuidanceForClass } = require("./subject-context-engine");

function clampText(s, max) {
  const t = String(s || "");
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n…（已截断）";
}

function evidenceCorpusFromCtx(ctx) {
  return [
    ctx.subjectRenderedText || "",
    ctx.attachmentText || "",
    ctx.goal || "",
    ctx.constraints || "",
  ].join("\n");
}

function contextBlock(ctx) {
  const contextClass = ctx.contextClass || "execution";
  const policy = (ctx.subjectAssembly && ctx.subjectAssembly.assemblyPolicy) || {
    allowAiExplorationBlock: !!ctx.allowAiExplorationBlock,
  };
  const claimPosturePresentation =
    ctx.claimPosturePresentation ||
    (policy && policy.claimPosturePresentation) ||
    "natural";
  const guidance = promptGuidanceForClass(contextClass, policy, {
    claimPosturePresentation,
  });

  const subjectBlock = (() => {
    if (ctx.subjectRenderedText && String(ctx.subjectRenderedText).trim()) {
      return (
        "Digital Me 主体背景（须参考；仅 subject_owned 内容可代表本人；不得编造未给出的隐私）：\n" +
        ctx.subjectRenderedText
      );
    }
    const reason =
      (ctx.subjectAssembly && ctx.subjectAssembly.emptyReason) || "no_active_assets";
    return `（本次未装配到已确认主体资产；emptyReason=${reason}。不要声称已了解用户本人。）`;
  })();

  const exploreHint = ctx.allowAiExplorationBlock
    ? "若需要推演，请用自然语言写出分析或待验证方案（例如「未来可考虑」「一种待验证的方案是」），不要写入方括号内部标签。"
    : "本次不展开开放探索块；不要把无依据内容写成已确认事实。必要时可用自然语言作少量推断。";

  return [
    `任务情境（contextClass=${contextClass}；claimPosturePresentation=${claimPosturePresentation}）：${guidance}`,
    `任务目标：${ctx.goal || "（缺少任务目标，请勿编造无关业务）"}`,
    ctx.audience ? `受众：${ctx.audience}` : "",
    ctx.usage ? `用途：${ctx.usage}` : "",
    ctx.constraints ? `约束：${ctx.constraints}` : "",
    ctx.summary ? `理解摘要：${ctx.summary}` : "",
    `成果标题：${ctx.title}`,
    ctx.purpose ? `该成果目的：${ctx.purpose}` : "",
    subjectBlock,
    ctx.attachmentText
      ? "参考材料（必须依据；evidenceKind=task_material；ownership=task_owned；可写「根据本次材料」；不得升格为主体已确认事实）：\n" +
        ctx.attachmentText
      : "（本次未提供参考材料正文。禁止写「根据公开报告/数据显示/研究表明」等无来源归因套话。）",
    exploreHint,
    "要求：紧扣上述 Digital Me / 任务上下文；正式正文禁止方括号元标签；禁止输出与任务无关的虚构公司或融资故事当作已确认事实；禁止占位符如「项目名称」「CEO 姓名」「XX%」「功能一」。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDocumentMessages(ctx) {
  return [
    {
      role: "system",
      content:
        "你是 Digital Me 的成果写作者。根据任务理解、成果说明与参考材料，输出完整 Markdown 文档。" +
        "使用中文。包含标题与若干小节。不要输出代码围栏包裹整篇。不要编造未给出的隐私事实。" +
        "若材料不足，基于已给目标做结构化表达，不得换成其他行业或无关产品。",
    },
    {
      role: "user",
      content: clampText(contextBlock(ctx) + "\n请直接输出 Markdown 正文。", 24000),
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
        " 不要 markdown 代码围栏。使用中文。8-12 页为宜。内容必须服务给定任务，禁止无关行业模板。",
    },
    {
      role: "user",
      content: clampText(contextBlock(ctx), 22000),
    },
  ];
}

function buildWebpageMessages(ctx) {
  return [
    {
      role: "system",
      content:
        "你撰写单页介绍内容。输出 Markdown（将转为独立 HTML）。使用中文，结构清晰，含标题与要点列表。" +
        "禁止「项目名称」「功能一」等占位符；必须使用任务与参考材料中的真实名称与表述。",
    },
    {
      role: "user",
      content: clampText(contextBlock(ctx), 22000),
    },
  ];
}

function requireUsableGoal(ctx) {
  const g = String(ctx.goal || "").trim();
  if (!g || g === "[object Object]" || /\[object Object\]/i.test(g)) {
    const e = new Error("任务目标无效，无法生成成果。请重新填写目标后再试。");
    e.code = "invalid_generation_goal";
    throw e;
  }
}

async function generateDocument({ pkg, deliverable, task, referenceMaterials, subjectAssembly, callModel }) {
  const ctx = buildGenerationContext({
    pkg,
    deliverable,
    task,
    referenceMaterials,
    subjectAssembly,
  });
  requireUsableGoal(ctx);
  let md;
  if (typeof callModel === "function") {
    md = String(await callModel(buildDocumentMessages(ctx), { taskType: "artifact", temperature: 0.4 }));
  } else {
    md =
      `# ${ctx.title}\n\n## 概述\n\n${ctx.goal}\n\n` +
      (ctx.subjectRenderedText
        ? `## 主体背景摘要\n\n${ctx.subjectRenderedText.slice(0, 2000)}\n\n`
        : "") +
      (ctx.attachmentText ? `## 材料要点\n\n${ctx.attachmentText.slice(0, 2000)}\n\n` : "") +
      `## 说明\n\n面向：${ctx.audience || "目标读者"}。用途：${ctx.usage || ctx.purpose || "介绍"}。\n`;
  }
  md = String(md || "").trim();
  assertGeneratedContentUsable(md, {
    kind: "document",
    goal: ctx.goal,
    contextClass: ctx.contextClass,
    evidenceCorpus: evidenceCorpusFromCtx(ctx),
  });
  if (md.length > 80000) md = md.slice(0, 80000);
  const html = markdownToHtml(md, { title: ctx.title });
  const files = {
    "artifact.md": md,
    "artifact.html": html,
  };
  try {
    files["artifact.docx"] = buildDocxFromMarkdown(md, ctx.title);
  } catch {
    /* DOCX optional */
  }
  return {
    kind: "document",
    displayFormats: Object.keys(files).map((n) => n.replace(/^artifact\./, "")),
    primaryFile: "artifact.md",
    files,
    contentLabel: "文档",
    generationContext: ctx,
    promptMessages: buildDocumentMessages(ctx),
  };
}

async function generatePresentation({ pkg, deliverable, task, referenceMaterials, subjectAssembly, callModel }) {
  const ctx = buildGenerationContext({
    pkg,
    deliverable,
    task,
    referenceMaterials,
    subjectAssembly,
  });
  requireUsableGoal(ctx);
  let raw;
  if (typeof callModel === "function") {
    raw = String(await callModel(buildSlideMessages(ctx), { taskType: "artifact", temperature: 0.35 }));
  } else {
    raw = JSON.stringify({
      title: ctx.title,
      subtitle: ctx.goal.slice(0, 120),
      closing: "谢谢",
      slides: [
        { title: "背景与目标", bullets: [ctx.goal] },
        {
          title: "要点",
          bullets: [ctx.purpose || "核心信息", ctx.audience || "目标受众"].filter(Boolean),
        },
        { title: "材料依据", bullets: [ctx.attachmentText ? "已参考本人提供的项目材料" : "基于任务目标整理"] },
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
  const planText = JSON.stringify(plan);
  assertGeneratedContentUsable(planText + "\n" + (plan.title || ""), {
    kind: "presentation",
    goal: ctx.goal,
    contextClass: ctx.contextClass,
    evidenceCorpus: evidenceCorpusFromCtx(ctx),
  });
  const files = {};
  let usedPptx = false;
  try {
    files["artifact.pptx"] = await buildPptx(plan);
    usedPptx = true;
  } catch {
    /* HTML deck fallback */
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
    generationContext: ctx,
    promptMessages: buildSlideMessages(ctx),
  };
}

async function generateWebpage({ pkg, deliverable, task, referenceMaterials, subjectAssembly, callModel }) {
  const ctx = buildGenerationContext({
    pkg,
    deliverable,
    task,
    referenceMaterials,
    subjectAssembly,
  });
  requireUsableGoal(ctx);
  let md;
  if (typeof callModel === "function") {
    md = String(await callModel(buildWebpageMessages(ctx), { taskType: "artifact", temperature: 0.4 }));
  } else {
    md = `# ${ctx.title}\n\n${ctx.goal}\n\n- ${ctx.purpose || "介绍要点"}\n`;
    if (ctx.attachmentText) md += `\n## 依据材料摘要\n\n${ctx.attachmentText.slice(0, 1500)}\n`;
  }
  md = String(md || "").trim();
  assertGeneratedContentUsable(md, {
    kind: "webpage",
    goal: ctx.goal,
    contextClass: ctx.contextClass,
    evidenceCorpus: evidenceCorpusFromCtx(ctx),
  });
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
    generationContext: ctx,
    promptMessages: buildWebpageMessages(ctx),
  };
}

async function generateImage({
  pkg,
  deliverable,
  task,
  referenceMaterials,
  subjectAssembly,
  callModel,
  imageMode,
}) {
  void callModel;
  const ctx = buildGenerationContext({
    pkg,
    deliverable,
    task,
    referenceMaterials,
    subjectAssembly,
  });
  requireUsableGoal(ctx);
  if (imageMode === "mock") {
    return {
      kind: "image",
      displayFormats: ["png"],
      primaryFile: "artifact.png",
      files: { "artifact.png": minimalPngBuffer() },
      contentLabel: "图片",
      mock: true,
      generationContext: ctx,
      promptMessages: [],
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
  buildDocumentMessages,
  buildSlideMessages,
  buildWebpageMessages,
};

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
  buildRepairIssueLines,
} = require("./deliverable-context");
const { promptGuidanceForClass } = require("./subject-context-engine");
const {
  REPAIR_MODES,
  needsGroundedRebuild,
  isGroundingFailure,
  buildGroundedRebuildMessages,
  buildCleanRegenerationMessages,
  groundedRebuildStructureGuidance,
  summarizeForbiddenProblems,
} = require("./grounded-generation");
const { generateDocumentBySemanticBlocks } = require("./semantic-generation");
const { RECOVERY_ACTIONS, appendRecoveryAction } = require("./attempt-recovery");

const STRUCTURED_DOC_TEMPERATURE = 0.3;
const STRUCTURED_DOC_REPAIR_TEMPERATURE = 0.25;
const MAX_INLINE_REPAIR_PASSES = 0;

/** Convert authority / fabrication gate errors into local-repair issues (no new permanent fields). */
function authorityConflictRepairIssues(err) {
  const hits = (err && Array.isArray(err.hits) ? err.hits : []).slice(0, 8);
  if (!hits.length) {
    return [
      {
        ruleId: (err && err.code) || "project_authority_conflict",
        message:
          (err && err.message) ||
          "内容与项目权威事实冲突或含无来源数字，请删除冲突主张并依据当前系统事实重写。",
        lineNumber: 1,
      },
    ];
  }
  return hits.map((h, i) => ({
    ruleId: String((h && h.id) || (err && err.code) || "project_authority_conflict"),
    message: `请删除或改写无依据表述：「${String((h && h.snippet) || "").slice(0, 80)}」；不得编造团队规模、预算或未验证主线。`,
    lineNumber: i + 1,
    matchedText: h && h.snippet,
  }));
}

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

function structuredDocumentRequirements() {
  return [
    "结构化成果输出要求：",
    "- 必须输出完整正文，不得保留空白模板或仅标题无内容的章节；",
    "- 不得出现「待填写」「待补充」「功能一/功能二」等未展开模板项；",
    "- 字段标签（如项目名称、负责人）后必须填写与当前任务相关的具体内容；",
    "- 缺少事实时可写「待 Owner 决策」或「尚未确定」，并简要说明原因；",
    "- 不得输出仅含占位符的表格行或列表项。",
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
    isDigitalMeProject: ctx.isDigitalMeProject,
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

  const outcomeLines = (() => {
    const c = ctx.outcomeCriteria;
    if (!c || typeof c !== "object") return [];
    const lines = [`成果要求（任务模式=${c.taskMode || "current_implementation"}）：${ctx.modeGuidance || ""}`];
    if (Array.isArray(c.requiredSemanticCoverage) && c.requiredSemanticCoverage.length) {
      const { semanticLabel } = require("./semantic-contract");
      lines.push(
        `必须实质回答的问题（标题可自定）：${c.requiredSemanticCoverage.map(semanticLabel).join("、")}。`
      );
    } else if (Array.isArray(c.requiredSections) && c.requiredSections.length) {
      lines.push(`成果应包含的关键内容：${c.requiredSections.join("、")}。`);
    }
    if (c.expectedQuality) {
      lines.push(`质量要求：${c.expectedQuality}`);
    }
    return lines;
  })();

  const systemFactsBlock = (() => {
    if (ctx.authoritativeFactsText && String(ctx.authoritativeFactsText).trim()) {
      return String(ctx.authoritativeFactsText).trim();
    }
    if (ctx.systemFactsText && String(ctx.systemFactsText).trim()) {
      return (
        "当前系统现状（权威事实，必须准确反映；不得声称这些能力不存在或处于初级阶段；不得假设未列出的基础设施已存在）：\n" +
        ctx.systemFactsText
      );
    }
    return "";
  })();

  const gapBlock =
    ctx.gapStatementText && String(ctx.gapStatementText).trim()
      ? String(ctx.gapStatementText).trim()
      : "";

  return [
    `任务情境（contextClass=${contextClass}；claimPosturePresentation=${claimPosturePresentation}）：${guidance}`,
    `任务目标：${ctx.goal || "（缺少任务目标，请勿编造无关业务）"}`,
    ctx.audience ? `受众：${ctx.audience}` : "",
    ctx.usage ? `用途：${ctx.usage}` : "",
    ctx.constraints ? `约束：${ctx.constraints}` : "",
    ctx.summary ? `理解摘要：${ctx.summary}` : "",
    `成果标题：${ctx.title}`,
    ctx.purpose ? `该成果目的：${ctx.purpose}` : "",
    systemFactsBlock,
    gapBlock,
    subjectBlock,
    ctx.attachmentText
      ? "参考材料（必须依据；若与 CURRENT SYSTEM FACTS 冲突，以系统事实为准；evidenceKind=task_material；ownership=task_owned；可写「根据本次材料」；不得升格为主体已确认事实）：\n" +
        ctx.attachmentText
      : "（本次未提供参考材料正文。禁止写「根据公开报告/数据显示/研究表明」等无来源归因套话。）",
    exploreHint,
    ...outcomeLines,
    structuredDocumentRequirements(),
    "要求：紧扣上述 Digital Me / 任务上下文；正式正文禁止方括号元标签；禁止输出与任务无关的虚构公司或融资故事当作已确认事实。",
    "若任务模式为 current_implementation：必须以权威系统事实为现状基线；不得把历史「未开始/待实现」表述写成当前状态。",
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
        "若材料不足，基于已给目标做结构化表达，不得换成其他行业或无关产品。" +
        "所有字段必须填实；不得保留模板占位。",
    },
    {
      role: "user",
      content: clampText(contextBlock(ctx) + "\n请直接输出 Markdown 正文。", 24000),
    },
  ];
}

function buildDocumentRepairMessages(ctx, priorDraft, issues) {
  const issueLines = buildRepairIssueLines(issues).join("\n");
  return [
    {
      role: "system",
      content:
        "你是 Digital Me 的成果修订写作者。请在不改变整体结构的前提下，修正草稿中的质量问题（含未填写模板内容、缺失章节、与项目事实冲突、远期内容挤占主体等）。" +
        "保留已有有效正文，仅修正被指出的问题。使用中文 Markdown。" +
        "若问题与当前系统事实冲突，以权威系统事实为准。",
    },
    {
      role: "user",
      content: clampText(
        [
          contextBlock(ctx),
          "以下是需要修订的草稿：",
          priorDraft,
          "",
          "检测到的问题：",
          issueLines,
          "",
          "请保留正文结构，逐项修正上述问题；占位内容替换为当前任务的真实内容；缺少事实时使用「待 Owner 决策」并说明原因。",
          "请直接输出修订后的完整 Markdown 正文。",
        ].join("\n"),
        28000
      ),
    },
  ];
}

function messagesForDraft(ctx, repairContext) {
  const mode = (repairContext && repairContext.mode) || null;
  if (mode === REPAIR_MODES.CLEAN_REGENERATION) {
    return buildCleanRegenerationMessages(ctx);
  }
  if (mode === REPAIR_MODES.GROUNDED_REBUILD) {
    return buildGroundedRebuildMessages(ctx, (repairContext && repairContext.issues) || []);
  }
  if (repairContext && repairContext.priorDraft) {
    return buildDocumentRepairMessages(
      ctx,
      repairContext.priorDraft,
      repairContext.issues || []
    );
  }
  return null;
}

function buildSlideMessages(ctx) {
  return [
    {
      role: "system",
      content:
        "你规划演示文稿结构。只输出 JSON：" +
        '{"title":"...","subtitle":"...","closing":"...","slides":[{"title":"...","bullets":["..."]}]}' +
        " 不要 markdown 代码围栏。使用中文。8-12 页为宜。内容必须服务给定任务，禁止无关行业模板。" +
        " bullets 必须是完整句子，不得使用待填写或功能一等占位。",
    },
    {
      role: "user",
      content: clampText(contextBlock(ctx), 22000),
    },
  ];
}

function buildSlideRepairMessages(ctx, priorRaw, issues) {
  const issueLines = buildRepairIssueLines(issues).join("\n");
  return [
    {
      role: "system",
      content:
        "你修订演示文稿 JSON 结构。只输出 JSON，不要 markdown 代码围栏。修正占位内容，保留有效结构。",
    },
    {
      role: "user",
      content: clampText(
        [
          contextBlock(ctx),
          "原 JSON：",
          priorRaw,
          "问题：",
          issueLines,
          "请输出修订后的完整 JSON。",
        ].join("\n"),
        24000
      ),
    },
  ];
}

function buildWebpageMessages(ctx) {
  return [
    {
      role: "system",
      content:
        "你撰写单页介绍内容。输出 Markdown（将转为独立 HTML）。使用中文，结构清晰，含标题与要点列表。" +
        "必须使用任务与参考材料中的真实名称与表述；不得保留未填写字段或模板项。",
    },
    {
      role: "user",
      content: clampText(contextBlock(ctx), 22000),
    },
  ];
}

function buildWebpageRepairMessages(ctx, priorDraft, issues) {
  return buildDocumentRepairMessages(ctx, priorDraft, issues);
}

function requireUsableGoal(ctx) {
  const g = String(ctx.goal || "").trim();
  if (!g || g === "[object Object]" || /\[object Object\]/i.test(g)) {
    const e = new Error("任务目标无效，无法生成成果。请重新填写目标后再试。");
    e.code = "invalid_generation_goal";
    throw e;
  }
}

function ctxFromDeps(deps, repairContext) {
  const cleanContext =
    !!(repairContext && repairContext.mode === REPAIR_MODES.CLEAN_REGENERATION) ||
    !!deps.cleanContext;
  return buildGenerationContext({
    pkg: deps.pkg,
    deliverable: deps.deliverable,
    task: deps.task,
    referenceMaterials: deps.referenceMaterials,
    subjectAssembly: deps.subjectAssembly,
    isDigitalMeProject: deps.isDigitalMeProject,
    projectRetrieval: deps.projectRetrieval,
    projectResolved: deps.projectResolved,
    outcomeCriteria: deps.outcomeCriteria,
    systemFactsText: deps.systemFactsText,
    authoritativeFactsText: deps.authoritativeFactsText,
    gapStatementText: deps.gapStatementText,
    gapStatement: deps.gapStatement,
    cleanContext,
  });
}

function reviewOptsFromCtx(ctx) {
  return {
    kind: ctx.kind,
    goal: ctx.goal,
    contextClass: ctx.contextClass,
    evidenceCorpus: evidenceCorpusFromCtx(ctx),
    isDigitalMeProject: ctx.isDigitalMeProject,
    projectContextEmpty: !ctx.projectContextId,
  };
}

async function callStructuredModel(callModel, messages, { repair = false } = {}) {
  return String(
    await callModel(messages, {
      taskType: "artifact",
      temperature: repair ? STRUCTURED_DOC_REPAIR_TEMPERATURE : STRUCTURED_DOC_TEMPERATURE,
    })
  ).trim();
}

function documentFilesFromMarkdown(md, ctx) {
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
  return files;
}

async function draftDocument(deps, repairContext) {
  const ctx = ctxFromDeps(deps, repairContext);
  requireUsableGoal(ctx);
  const callModel = deps.callModel;
  let md;
  const mode = repairContext && repairContext.mode;
  let messages;
  let semanticMeta = null;

  // 01.2: outline→blocks path. Opt-in via deps.useSemanticBlocks so whole-doc
  // fixtures and adapters remain stable; production may enable per task.
  const useSemanticBlocks =
    !repairContext &&
    deps.useSemanticBlocks === true &&
    !deps.disableSemanticBlocks &&
    deps.outcomeCriteria &&
    Array.isArray(deps.outcomeCriteria.requiredSemanticCoverage) &&
    deps.outcomeCriteria.requiredSemanticCoverage.length > 0;

  if (useSemanticBlocks) {
    try {
      const produced = await generateDocumentBySemanticBlocks({
        callModel,
        ctx,
        outcomeCriteria: deps.outcomeCriteria,
        isDigitalMeProject: deps.isDigitalMeProject,
        authoritativeFactsText: deps.authoritativeFactsText || ctx.authoritativeFactsText,
        gapStatementText: deps.gapStatementText || ctx.gapStatementText,
        maxBlockRetries: 1,
      });
      if (produced && produced.md) {
        md = produced.md;
        messages = [];
        semanticMeta = {
          outline: produced.outline,
          blocks: produced.blocks,
          recoveryActions: produced.recoveryActions || [],
          contractDigest: produced.contract && produced.contract.contractDigest,
          coverage: produced.coverage,
        };
        return {
          md: String(md || "").trim(),
          ctx,
          messages,
          repairMode: mode || null,
          semanticMeta,
        };
      }
    } catch (err) {
      // 01.2-FIX-01: do not unconditionally fall back to free whole-document generation.
      // Only allow one bounded whole-result fallback when no draft body was produced.
      const reason = (err && err.code) || "semantic_blocks_failed";
      semanticMeta = {
        fallbackToWholeDoc: false,
        reason,
      };
      const partial = err && err.partialMd ? String(err.partialMd).trim() : "";
      if (partial.length >= 80) {
        return {
          md: partial,
          ctx,
          messages: [],
          repairMode: mode || null,
          semanticMeta: {
            ...semanticMeta,
            partialBlocksPreserved: true,
            recoveryActions: [{ action: "block_local_repair", at: new Date().toISOString(), note: reason }],
          },
        };
      }
      // Bounded whole-doc fallback once — recorded as recovery action, not silent bypass.
      semanticMeta = {
        fallbackToWholeDoc: true,
        reason,
        recoveryActions: [
          {
            action: "whole_document_fallback",
            at: new Date().toISOString(),
            note: reason,
          },
        ],
      };
    }
  }

  if (mode === REPAIR_MODES.CLEAN_REGENERATION || mode === REPAIR_MODES.GROUNDED_REBUILD) {
    messages = messagesForDraft(ctx, repairContext);
  } else if (repairContext && repairContext.priorDraft) {
    messages = buildDocumentRepairMessages(ctx, repairContext.priorDraft, repairContext.issues || []);
  } else {
    messages = buildDocumentMessages(ctx);
  }
  // Guard: grounded rebuild / clean regen must not re-inject the full failed draft.
  if (
    (mode === REPAIR_MODES.GROUNDED_REBUILD || mode === REPAIR_MODES.CLEAN_REGENERATION) &&
    repairContext &&
    repairContext.priorDraft
  ) {
    const joined = JSON.stringify(messages);
    if (joined.includes(String(repairContext.priorDraft).slice(0, 200))) {
      const e = new Error("grounded rebuild must not carry full failed draft");
      e.code = "grounded_rebuild_context_violation";
      throw e;
    }
  }
  if (typeof callModel === "function") {
    md = await callStructuredModel(callModel, messages, {
      repair: !!repairContext && mode !== REPAIR_MODES.CLEAN_REGENERATION,
    });
  } else {
    md =
      `# ${ctx.title}\n\n## 概述\n\n${ctx.goal}\n\n` +
      (ctx.subjectRenderedText
        ? `## 主体背景摘要\n\n${ctx.subjectRenderedText.slice(0, 2000)}\n\n`
        : "") +
      (ctx.attachmentText ? `## 材料要点\n\n${ctx.attachmentText.slice(0, 2000)}\n\n` : "") +
      `## 说明\n\n面向：${ctx.audience || "目标读者"}。用途：${ctx.usage || ctx.purpose || "介绍"}。\n`;
  }
  return { md: String(md || "").trim(), ctx, messages, repairMode: mode || null, semanticMeta };
}

function finalizeDocument(md, ctx, extra) {
  assertGeneratedContentUsable(md, reviewOptsFromCtx(ctx));
  const files = documentFilesFromMarkdown(md, ctx);
  return {
    kind: "document",
    displayFormats: Object.keys(files).map((n) => n.replace(/^artifact\./, "")),
    primaryFile: "artifact.md",
    files,
    contentLabel: "文档",
    generationContext: ctx,
    promptMessages: buildDocumentMessages(ctx),
    semanticMeta: (extra && extra.semanticMeta) || null,
  };
}

async function generateDocument(deps) {
  const { md, ctx } = await draftDocument(deps, null);
  return finalizeDocument(md, ctx);
}

async function draftPresentation(deps, repairContext) {
  const ctx = ctxFromDeps(deps, repairContext);
  const callModel = deps.callModel;
  requireUsableGoal(ctx);
  const mode = repairContext && repairContext.mode;
  let messages;
  if (mode === REPAIR_MODES.CLEAN_REGENERATION) {
    // Slides: clean regen uses base slide messages with clean context.
    messages = buildSlideMessages(ctx);
  } else if (mode === REPAIR_MODES.GROUNDED_REBUILD) {
    const issueLines = summarizeForbiddenProblems(repairContext.issues || []);
    messages = [
      {
        role: "system",
        content:
          "你规划演示文稿结构。只输出 JSON。上一次草稿与当前系统事实冲突，请基于权威事实重新规划，不要局部修补。" +
          '{"title":"...","subtitle":"...","closing":"...","slides":[{"title":"...","bullets":["..."]}]}',
      },
      {
        role: "user",
        content: clampText(
          [
            contextBlock(ctx),
            groundedRebuildStructureGuidance(),
            "禁止再次出现的问题：",
            issueLines,
          ].join("\n"),
          22000
        ),
      },
    ];
  } else if (repairContext && repairContext.priorDraft) {
    messages = buildSlideRepairMessages(ctx, repairContext.priorDraft, repairContext.issues || []);
  } else {
    messages = buildSlideMessages(ctx);
  }
  let raw;
  if (typeof callModel === "function") {
    raw = await callStructuredModel(callModel, messages, {
      repair: !!repairContext && mode !== REPAIR_MODES.CLEAN_REGENERATION,
    });
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
  return { raw: String(raw || "").trim(), ctx, messages, repairMode: mode || null };
}

function finalizePresentation(raw, ctx) {
  let plan;
  try {
    plan = parsePlanJson(raw);
  } catch (err) {
    const e = new Error("模型未返回有效演示结构。");
    e.code = "invalid_slide_structure";
    e.cause = err;
    e.failureStage = "model_generation";
    throw e;
  }
  const planText = JSON.stringify(plan);
  assertGeneratedContentUsable(planText + "\n" + (plan.title || ""), reviewOptsFromCtx(ctx));
  const files = {};
  let usedPptx = false;
  try {
    files["artifact.pptx"] = buildPptx(plan);
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

async function generatePresentation(deps) {
  const { raw, ctx } = await draftPresentation(deps, null);
  return finalizePresentation(raw, ctx);
}

async function draftWebpage(deps, repairContext) {
  const ctx = ctxFromDeps(deps, repairContext);
  const callModel = deps.callModel;
  requireUsableGoal(ctx);
  const mode = repairContext && repairContext.mode;
  let messages;
  if (mode === REPAIR_MODES.CLEAN_REGENERATION || mode === REPAIR_MODES.GROUNDED_REBUILD) {
    messages = messagesForDraft(ctx, repairContext);
  } else if (repairContext && repairContext.priorDraft) {
    messages = buildWebpageRepairMessages(ctx, repairContext.priorDraft, repairContext.issues || []);
  } else {
    messages = buildWebpageMessages(ctx);
  }
  let md;
  if (typeof callModel === "function") {
    md = await callStructuredModel(callModel, messages, {
      repair: !!repairContext && mode !== REPAIR_MODES.CLEAN_REGENERATION,
    });
  } else {
    md = `# ${ctx.title}\n\n${ctx.goal}\n\n- ${ctx.purpose || "介绍要点"}\n`;
    if (ctx.attachmentText) md += `\n## 依据材料摘要\n\n${ctx.attachmentText.slice(0, 1500)}\n`;
  }
  return { md: String(md || "").trim(), ctx, messages, repairMode: mode || null };
}

function finalizeWebpage(md, ctx) {
  assertGeneratedContentUsable(md, reviewOptsFromCtx(ctx));
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

async function generateWebpage(deps) {
  const { md, ctx } = await draftWebpage(deps, null);
  return finalizeWebpage(md, ctx);
}

async function generateImage(deps) {
  void deps.callModel;
  const ctx = ctxFromDeps(deps);
  const imageMode = deps.imageMode;
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

const TEXT_KIND_DRAFTERS = {
  document: draftDocument,
  webpage: draftWebpage,
  presentation: draftPresentation,
};

const TEXT_KIND_FINALIZERS = {
  document: (payload, ctx) => finalizeDocument(payload.md, ctx, { semanticMeta: payload.semanticMeta }),
  webpage: (payload, ctx) => finalizeWebpage(payload.md, ctx),
  presentation: (payload, ctx) => finalizePresentation(payload.raw, ctx),
};

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

async function generateByKindWithRepair(kind, deps, hooks) {
  const k = String(kind || "");
  const drafter = TEXT_KIND_DRAFTERS[k];
  const finalizer = TEXT_KIND_FINALIZERS[k];
  if (!drafter || !finalizer) {
    return generateByKind(kind, deps);
  }

  let repairContext = null;
  const maxRepair = typeof hooks.maxRepairAttempts === "number" ? hooks.maxRepairAttempts : 2;
  const allowCleanRegen = hooks.allowCleanRegeneration !== false;
  const audit = {
    groundedRebuildUsed: false,
    groundedRebuildCount: 0,
    cleanRegenerationUsed: false,
    repairModes: [],
    recoveryActions: [],
  };
  // Passes: 0 = first draft; 1..maxRepair = repair/rebuild; optional +1 clean regen.
  const maxPass = allowCleanRegen ? maxRepair + 1 : maxRepair;

  for (let pass = 0; pass <= maxPass; pass++) {
    const isCleanRegenSlot = allowCleanRegen && pass === maxRepair + 1;
    if (isCleanRegenSlot) {
      if (audit.cleanRegenerationUsed) {
        // Hard guard: clean regeneration only once.
        break;
      }
      if (!repairContext || repairContext.mode !== REPAIR_MODES.CLEAN_REGENERATION) {
        break;
      }
      audit.cleanRegenerationUsed = true;
    }

    const payload = await drafter(deps, repairContext);
    const reviewCtx = payload.ctx;
    let body = payload.md || payload.raw || "";
    if (k === "presentation") {
      try {
        const plan = JSON.parse(payload.raw || "{}");
        body = JSON.stringify(plan) + "\n" + (plan.title || "");
      } catch {
        body = String(payload.raw || "");
      }
    }
    if (repairContext && repairContext.mode) {
      audit.repairModes.push(repairContext.mode);
      audit.recoveryActions = appendRecoveryAction(audit.recoveryActions, repairContext.mode);
      if (repairContext.mode === REPAIR_MODES.GROUNDED_REBUILD) {
        audit.groundedRebuildUsed = true;
        audit.groundedRebuildCount += 1;
      }
      if (repairContext.mode === REPAIR_MODES.CLEAN_REGENERATION) {
        audit.cleanRegenerationUsed = true;
      }
    }
    if (payload.semanticMeta && Array.isArray(payload.semanticMeta.recoveryActions)) {
      for (const a of payload.semanticMeta.recoveryActions) {
        audit.recoveryActions.push(a);
      }
    }
    try {
      assertGeneratedContentUsable(body, reviewOptsFromCtx(reviewCtx));
      if (hooks.onDraftValidated) {
        await hooks.onDraftValidated({
          pass,
          draft: body,
          ctx: reviewCtx,
          repairContext,
          audit: { ...audit },
        });
      }
      const finalized = finalizer(payload, reviewCtx);
      finalized.groundingAudit = { ...audit };
      return finalized;
    } catch (err) {
      const isRepairable =
        err &&
        (err.code === "placeholder_content_rejected" ||
          err.code === "review_content_rejected" ||
          err.code === "project_authority_conflict" ||
          err.code === "ungrounded_project_numbers" ||
          err.code === "internal_claim_tags_rejected");

      let nextRepairContext = null;
      if (isRepairable && pass < maxRepair) {
        const reviewResult = err.reviewResult;
        const useGroundedRebuild =
          err.code === "review_content_rejected" && needsGroundedRebuild(reviewResult);
        const authorityIssues = authorityConflictRepairIssues(err);
        if (useGroundedRebuild) {
          nextRepairContext = {
            mode: REPAIR_MODES.GROUNDED_REBUILD,
            priorDraft: null,
            failedDraftLength: body.length,
            issues: err.reviewIssues || authorityIssues,
            forbiddenSummary: summarizeForbiddenProblems(err.reviewIssues || authorityIssues),
          };
        } else {
          nextRepairContext = {
            mode: REPAIR_MODES.LOCAL_REPAIR,
            priorDraft: k === "presentation" ? payload.raw : payload.md,
            issues: err.placeholderIssues || err.reviewIssues || authorityIssues,
          };
        }
      } else if (
        isRepairable &&
        allowCleanRegen &&
        !audit.cleanRegenerationUsed &&
        pass === maxRepair &&
        (err.code === "review_content_rejected" ||
          err.code === "project_authority_conflict" ||
          err.code === "ungrounded_project_numbers") &&
        (err.code !== "review_content_rejected" || isGroundingFailure(err.reviewResult))
      ) {
        nextRepairContext = {
          mode: REPAIR_MODES.CLEAN_REGENERATION,
          priorDraft: null,
          issues:
            err.reviewIssues ||
            err.placeholderIssues ||
            authorityConflictRepairIssues(err),
          forbiddenSummary: summarizeForbiddenProblems(
            err.reviewIssues || authorityConflictRepairIssues(err)
          ),
        };
      }

      if (hooks.onDraftRejected) {
        await hooks.onDraftRejected({
          pass,
          draft: body,
          err,
          ctx: reviewCtx,
          repairable: isRepairable,
          repairContext,
          nextRepairContext,
          audit: { ...audit },
        });
      }
      if (!isRepairable) {
        throw err;
      }
      if (!nextRepairContext) {
        err.draft = body;
        err.groundingAudit = { ...audit };
        throw err;
      }
      repairContext = nextRepairContext;
    }
  }
  const e = new Error("生成的内容仍包含未填写部分，暂未保存。你可以重试，或补充更明确的要求。");
  e.code = "placeholder_content_rejected";
  e.groundingAudit = { ...audit };
  throw e;
}

module.exports = {
  generateByKind,
  generateByKindWithRepair,
  generateDocument,
  generatePresentation,
  generateWebpage,
  generateImage,
  draftDocument,
  draftWebpage,
  draftPresentation,
  finalizeDocument,
  finalizeWebpage,
  finalizePresentation,
  buildDocumentMessages,
  buildDocumentRepairMessages,
  buildSlideMessages,
  buildWebpageMessages,
  STRUCTURED_DOC_TEMPERATURE,
  MAX_INLINE_REPAIR_PASSES,
  REPAIR_MODES,
  needsGroundedRebuild,
  isGroundingFailure,
};

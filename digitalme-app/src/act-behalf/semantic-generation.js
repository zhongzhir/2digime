"use strict";

/**
 * TASK-QUALITY-LOOP-01.2 — Outline + block generation (runtime only).
 *
 * experimental_advanced_quality_pipeline — retained for tests / advanced_shadow.
 * Production default (stable_delivery) does NOT use this as a delivery gate.
 *
 * Intermediate outline/blocks are not permanent authority objects.
 * Final persisted artifacts remain markdown + quality summary + minimal evidence.
 */

const {
  deriveSemanticContract,
  defaultOutlinePlan,
  ensureOutlineCovers,
  validateOutlineCoverage,
  checkSemanticCoverage,
  findHollowSemanticHeadings,
  semanticLabel,
  SEMANTIC_IDS,
} = require("./semantic-contract");
const { RECOVERY_ACTIONS } = require("./attempt-recovery");

function clampText(s, max) {
  const t = String(s || "");
  if (t.length <= max) return t;
  return t.slice(0, max) + "\n…（已截断）";
}

async function proposeOutlinePlan({ callModel, contract, goal, title }) {
  const fallback = ensureOutlineCovers(defaultOutlinePlan(contract), contract.requiredSemanticCoverage);
  if (typeof callModel !== "function") return { outline: fallback, source: "rule" };

  const coverageLines = (contract.requiredSemanticCoverage || [])
    .map((id) => `- ${id}（${semanticLabel(id)}）`)
    .join("\n");
  const hint = contract.outlineHint || { minSections: 3, maxSections: 8 };
  try {
    const raw = await callModel(
      [
        {
          role: "system",
          content:
            "你为成果起草轻量内容结构。只输出 JSON：" +
            '{"sections":[{"provisionalTitle":"...","purpose":"...","coversSemanticItems":["semanticId"]}]}' +
            "。标题可自由命名；必须用 coversSemanticItems 覆盖全部必要语义；不要输出固定模板章节名。" +
            `部分数量建议 ${hint.minSections}–${hint.maxSections}。不要 markdown 围栏。`,
        },
        {
          role: "user",
          content: clampText(
            [`任务：${goal || title || ""}`, "必须覆盖的语义：", coverageLines].join("\n"),
            8000
          ),
        },
      ],
      { taskType: "artifact", temperature: 0.2 }
    );
    const parsed = parseOutlineJson(raw);
    if (!parsed) return { outline: fallback, source: "rule_fallback" };
    const ensured = ensureOutlineCovers(parsed, contract.requiredSemanticCoverage);
    const v = validateOutlineCoverage(ensured, contract.requiredSemanticCoverage);
    if (!v.ok) return { outline: fallback, source: "rule_fallback" };
    // Complexity guard: do not accept 13-section dumps by default.
    if ((ensured.sections || []).length > (hint.maxSections || 8) + 2) {
      return { outline: fallback, source: "rule_complexity_cap" };
    }
    return { outline: ensured, source: "model" };
  } catch {
    return { outline: fallback, source: "rule_error" };
  }
}

function parseOutlineJson(raw) {
  try {
    let t = String(raw || "").trim();
    if (t.startsWith("```")) {
      t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }
    const obj = JSON.parse(t);
    if (!obj || !Array.isArray(obj.sections)) return null;
    return {
      sections: obj.sections
        .map((s) => ({
          provisionalTitle: String((s && s.provisionalTitle) || "部分").slice(0, 80),
          purpose: String((s && s.purpose) || "").slice(0, 200),
          coversSemanticItems: Array.isArray(s && s.coversSemanticItems)
            ? s.coversSemanticItems.map(String)
            : [],
        }))
        .filter((s) => s.provisionalTitle),
    };
  } catch {
    return null;
  }
}

function buildBlockPrompt({ ctx, section, contract, authoritativeFactsText, gapStatementText }) {
  const items = (section.coversSemanticItems || [])
    .map((id) => `- ${id}（${semanticLabel(id)}）`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        "你撰写成果的一个内容块。输出该块的 Markdown 正文（可含二级标题）。" +
        "必须实质覆盖指定语义；标题可自定，不得只写空标题。" +
        "不得宣称已有能力缺失；不得新建第二套权威对象。使用中文。",
    },
    {
      role: "user",
      content: clampText(
        [
          authoritativeFactsText || ctx.authoritativeFactsText || "",
          gapStatementText || ctx.gapStatementText || "",
          `任务目标：${ctx.goal || ""}`,
          `成果标题：${ctx.title || ""}`,
          contract && contract.taskMode ? `任务模式：${contract.taskMode}` : "",
          `本块建议标题：${section.provisionalTitle}`,
          `本块目的：${section.purpose || ""}`,
          "本块必须覆盖的语义：",
          items,
          "",
          "请直接输出本块 Markdown。",
        ]
          .filter(Boolean)
          .join("\n"),
        16000
      ),
    },
  ];
}

function validateBlock(content, section) {
  const body = String(content || "").trim();
  const issues = [];
  if (!body || body.length < 40) {
    issues.push({ ruleId: "block_empty", message: "内容块过短或为空" });
  }
  if (/待填写|待补充|lorem ipsum/i.test(body)) {
    issues.push({ ruleId: "block_placeholder", message: "内容块含未填写模板" });
  }
  const cov = checkSemanticCoverage(body, section.coversSemanticItems || []);
  // Allow partial: if section claims multiple semantics, require at least one strong hit
  // OR full coverage when only 1–2 items.
  const need = section.coversSemanticItems || [];
  if (need.length <= 2 && !cov.ok) {
    issues.push({
      ruleId: "block_semantic_gap",
      message: `未覆盖语义：${cov.missing.map(semanticLabel).join("、")}`,
      missing: cov.missing,
    });
  } else if (need.length > 2 && cov.covered.length === 0) {
    issues.push({
      ruleId: "block_semantic_gap",
      message: "内容块未体现所声明的语义",
      missing: cov.missing,
    });
  }
  return { ok: issues.length === 0, issues, covered: cov.covered };
}

async function generateBlock({ callModel, ctx, section, contract, maxRetries }) {
  const retries = typeof maxRetries === "number" ? maxRetries : 2;
  let lastErr = null;
  let content = "";
  for (let i = 0; i <= retries; i++) {
    if (typeof callModel === "function") {
      content = String(
        await callModel(buildBlockPrompt({ ctx, section, contract }), {
          taskType: "artifact",
          temperature: i === 0 ? 0.3 : 0.25,
        })
      ).trim();
    } else {
      content = ruleBasedBlock(ctx, section);
    }
    const v = validateBlock(content, section);
    if (v.ok) {
      return {
        blockId: "blk_" + String(section.provisionalTitle || "x").slice(0, 12) + "_" + i,
        content,
        coveredSemanticItems: v.covered.length ? v.covered : section.coversSemanticItems || [],
        claims: [],
        sourceRefs: [],
        repairPasses: i,
      };
    }
    lastErr = v.issues;
  }
  const e = new Error("内容块未能可靠生成");
  e.code = "block_generation_failed";
  e.blockIssues = lastErr;
  e.section = section;
  e.draft = content;
  throw e;
}

function ruleBasedBlock(ctx, section) {
  const items = (section.coversSemanticItems || []).map(semanticLabel).join("、");
  const lines = [`## ${section.provisionalTitle}`, "", section.purpose || "", ""];
  for (const id of section.coversSemanticItems || []) {
    if (id === SEMANTIC_IDS.CURRENT_FOUNDATION) {
      lines.push(
        "当前系统已具备项目知识存储、Knowledge Resolver、来源可见与 supersede 学习闭环；不得从零重建。"
      );
    } else if (id === SEMANTIC_IDS.ACTUAL_USER_PROBLEM) {
      lines.push(`真实用户问题围绕：${ctx.goal || "任务目标"}。`);
    } else if (id === SEMANTIC_IDS.ACTUAL_GAP) {
      lines.push("实际缺口在于体验完善与跨面验证，而不是缺少基础能力。");
    } else if (id === SEMANTIC_IDS.PROPOSED_CHANGE) {
      lines.push("本轮仅做最小增量调整，复用现有权威对象。");
    } else if (id === SEMANTIC_IDS.AUTHORITY_RELATIONSHIPS) {
      lines.push("复用现有 ProjectKnowledge、Task、PlanRecord、ArtifactRef；不新建第二套。");
    } else if (id === SEMANTIC_IDS.USER_OUTCOME) {
      lines.push("用户路径应支持跨对话、跨任务正确调用项目知识。");
    } else if (id === SEMANTIC_IDS.ACCEPTANCE_EVIDENCE) {
      lines.push("验收：新对话调用更新后事实；被 supersede 的旧知识停止生效；不同项目不串用。");
    } else if (id === SEMANTIC_IDS.IMPLEMENTATION_BOUNDARY) {
      lines.push("不做事项：不引入既有 SQLite 后端；不把项目知识重做成项目管理系统。");
    } else {
      lines.push(`${semanticLabel(id)}：结合任务「${ctx.goal || ""}」展开。`);
    }
  }
  if (!section.coversSemanticItems || !section.coversSemanticItems.length) {
    lines.push(items || ctx.goal || "内容");
  }
  return lines.join("\n");
}

function assembleBlocks(blocks, title) {
  const parts = [`# ${title || "成果"}`, ""];
  for (const b of blocks || []) {
    parts.push(String(b.content || "").trim());
    parts.push("");
  }
  return parts.join("\n").trim() + "\n";
}

/**
 * Generate a document via outline → blocks → assemble → semantic coverage check.
 * Returns { md, outline, blocks, recoveryActions, contract } (runtime).
 */
async function generateDocumentBySemanticBlocks({
  callModel,
  ctx,
  outcomeCriteria,
  isDigitalMeProject,
  authoritativeFactsText,
  gapStatementText,
  maxBlockRetries,
}) {
  const contract = deriveSemanticContract({
    goal: ctx.goal,
    audience: ctx.audience,
    usage: ctx.usage,
    kind: ctx.kind || "document",
    title: ctx.title,
    isDigitalMeProject,
    outcomeCriteria,
  });
  const recoveryActions = [];

  if (!contract.requiredSemanticCoverage.length) {
    return null; // caller falls back to legacy whole-doc generation
  }

  const { outline } = await proposeOutlinePlan({
    callModel,
    contract,
    goal: ctx.goal,
    title: ctx.title,
  });
  const outlineCheck = validateOutlineCoverage(outline, contract.requiredSemanticCoverage);
  if (!outlineCheck.ok) {
    recoveryActions.push({
      action: RECOVERY_ACTIONS.OUTLINE_REPAIR,
      at: new Date().toISOString(),
    });
  }
  const finalOutline = ensureOutlineCovers(outline, contract.requiredSemanticCoverage);

  const blocks = [];
  for (const section of finalOutline.sections) {
    try {
      const block = await generateBlock({
        callModel,
        ctx: { ...ctx, authoritativeFactsText, gapStatementText },
        section,
        contract,
        maxRetries: maxBlockRetries,
      });
      blocks.push(block);
      if (block.repairPasses > 0) {
        recoveryActions.push({
          action: RECOVERY_ACTIONS.BLOCK_REPAIR,
          at: new Date().toISOString(),
          note: section.provisionalTitle,
        });
      }
    } catch (err) {
      // Local failure — do not regenerate successful prior blocks.
      throw err;
    }
  }

  let md = assembleBlocks(blocks, ctx.title);
  let coverage = checkSemanticCoverage(md, contract.requiredSemanticCoverage);
  const hollow = findHollowSemanticHeadings(md);

  // Semantic gap fill: only regenerate missing semantics as a focused block.
  if (!coverage.ok || hollow.length) {
    recoveryActions.push({
      action: RECOVERY_ACTIONS.SEMANTIC_GAP_FILL,
      at: new Date().toISOString(),
      note: (coverage.missing || []).join(","),
    });
    const gapSection = {
      provisionalTitle: "补充",
      purpose: "补齐缺失语义",
      coversSemanticItems: coverage.missing.length
        ? coverage.missing.slice()
        : contract.requiredSemanticCoverage.slice(0, 2),
    };
    const gapBlock = await generateBlock({
      callModel,
      ctx: { ...ctx, authoritativeFactsText, gapStatementText },
      section: gapSection,
      contract,
      maxRetries: maxBlockRetries,
    });
    blocks.push(gapBlock);
    md = assembleBlocks(blocks, ctx.title);
    coverage = checkSemanticCoverage(md, contract.requiredSemanticCoverage);
  }

  if (!coverage.ok) {
    const e = new Error("成果语义覆盖仍不完整，暂未保存。");
    e.code = "semantic_coverage_incomplete";
    e.missingSemantics = coverage.missing;
    e.draft = md;
    e.reviewIssues = coverage.missing.map((id) => ({
      ruleId: "missing_semantic_coverage",
      message: `成果尚未充分回答：${semanticLabel(id)}`,
      category: "semantic",
      severity: "high",
      affectedSemanticItems: [id],
      suggestedAction: RECOVERY_ACTIONS.SEMANTIC_GAP_FILL,
    }));
    throw e;
  }

  return {
    md,
    outline: finalOutline,
    blocks: blocks.map((b) => ({
      blockId: b.blockId,
      coveredSemanticItems: b.coveredSemanticItems,
      repairPasses: b.repairPasses,
      // content intentionally omitted from return for persistence callers
      contentLength: String(b.content || "").length,
    })),
    recoveryActions,
    contract,
    coverage,
  };
}

module.exports = {
  proposeOutlinePlan,
  parseOutlineJson,
  generateBlock,
  validateBlock,
  assembleBlocks,
  generateDocumentBySemanticBlocks,
  ruleBasedBlock,
};

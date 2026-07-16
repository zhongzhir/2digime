"use strict";

const { hasReplacementChar } = require("./builder");
const { PackageStore, readManifest } = require("./package-store");

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

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
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
    if (v > max) {
      max = v;
      best = k;
    }
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

/**
 * Map a write plan to PackageStore ops.
 */
function planToOps(plan) {
  if (!plan || typeof plan !== "object") return [];
  if (plan.category === "memory") {
    const entry = plan.memoryEntry || {};
    return [
      {
        type: "append_jsonl",
        path: "memory/long-term-memory.jsonl",
        row: {
          type: "long_term",
          content: entry.content,
          theme: entry.theme || "用户反馈",
          confidence: entry.confidence || "high",
          sensitivity: "private",
          sourceRefs: ["feedback"],
          expiresAt: null,
        },
      },
    ];
  }
  return [
    {
      type: "ensure_section_append",
      path: plan.targetFile,
      section: plan.section,
      line: plan.appendLine || plan.proposedContent,
    },
  ];
}

function openStore(packageDir, storeHooks) {
  return new PackageStore({
    packageDir,
    hooks: storeHooks || {},
    ownerId: "owner:feedback",
  });
}

/**
 * Classify + build plan + create candidate change set. Does not modify package content.
 */
function previewFeedback(packageDir, payload, storeHooks) {
  const classified = classifyFeedback(payload || {});
  const plan = buildWritePlan({ ...(payload || {}), category: classified.category });
  const dataKinds = ["owner_assertion"];
  const ops = planToOps(plan);

  const store = openStore(packageDir, storeHooks);
  store.recover();

  const cs = store.createChangeSet({
    actor: "owner:feedback",
    reason: plan.summary || "用户确认的反馈修正",
    sourceRefs: ["feedback"],
    dataKinds,
    ops,
  });

  const storePreview = store.preview(cs.id);

  return {
    ...plan,
    scores: classified.scores,
    changeSetId: cs.id,
    baseRevision: cs.baseRevision,
    storePreview,
    dataKinds,
  };
}

/**
 * Commit a previously previewed change set. Requires confirmation + changeSetId.
 */
function applyFeedback(packageDir, payload, storeHooks) {
  const body = payload || {};
  const changeSetId = typeof body.changeSetId === "string" ? body.changeSetId.trim() : "";
  if (!changeSetId) {
    throw err("changeset_required", "请先预览并确认后再写入；不能直接提交未经预览的写入计划。");
  }

  const confirmed =
    body.confirmed === true ||
    (body.confirmation && body.confirmation.confirmed === true);
  if (!confirmed) {
    throw err("confirmation_required", "需要明确确认后才能写入。");
  }

  const store = openStore(packageDir, storeHooks);
  store.recover();

  const committed = store.commit(changeSetId, { confirmed: true });
  const manifest = readManifest(packageDir);
  const updatedAt =
    (manifest && manifest.updatedAt) || new Date().toISOString();

  const affectedPaths = committed.affectedPaths || [];
  let targetFile = affectedPaths[0] || null;
  let category = body.category || null;
  if (!category && targetFile) {
    if (String(targetFile).includes("long-term-memory")) category = "memory";
    else if (targetFile === "style-guide.md") category = "style";
    else if (targetFile === "persona.md") category = "persona";
  }
  if (!targetFile && category && CATEGORIES[category]) {
    targetFile = CATEGORIES[category].file;
  }

  return {
    ok: true,
    changeSetId: committed.changeSetId,
    targetFile,
    category,
    revision: committed.revision,
    affectedPaths,
    rollbackVersion: committed.rollbackVersion,
    updatedAt,
    rootSha256: committed.rootSha256,
  };
}

module.exports = {
  classifyFeedback,
  buildWritePlan,
  previewFeedback,
  applyFeedback,
  planToOps,
  CATEGORIES,
};

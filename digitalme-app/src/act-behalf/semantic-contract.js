"use strict";

/**
 * TASK-QUALITY-LOOP-01.2 — Dynamic semantic deliverable contract.
 *
 * Runtime derivation from OutcomeCriteria inputs. Not a second permanent
 * authority object / store. requiredSemanticCoverage lists questions the
 * outcome must answer — never fixed chapter titles.
 */

const crypto = require("node:crypto");

// Local mode constants — avoid circular require with outcome-criteria.js.
const MODE = Object.freeze({
  CURRENT_IMPLEMENTATION: "current_implementation",
  SOLUTION_EXPLORATION: "solution_exploration",
  STRATEGIC_PLANNING: "strategic_planning",
});

const SEMANTIC_IDS = Object.freeze({
  CURRENT_FOUNDATION: "currentFoundation",
  ACTUAL_USER_PROBLEM: "actualUserProblem",
  ACTUAL_GAP: "actualGap",
  PROPOSED_CHANGE: "proposedChange",
  AUTHORITY_RELATIONSHIPS: "authorityRelationships",
  USER_OUTCOME: "userOutcome",
  IMPLEMENTATION_BOUNDARY: "implementationBoundary",
  ACCEPTANCE_EVIDENCE: "acceptanceEvidence",
  PROBLEM_STATEMENT: "problemStatement",
  EVIDENCE: "evidence",
  CONCLUSION: "conclusion",
  OPTIONS: "options",
  TRADEOFFS: "tradeoffs",
});

/** Markers that demonstrate a semantic item is substantively covered (not title-based). */
const SEMANTIC_MARKERS = Object.freeze({
  [SEMANTIC_IDS.CURRENT_FOUNDATION]:
    /(已具备|现有(能力|基础|系统|模块|对象)|当前系统|Knowledge Resolver|project-knowledge|项目知识存储|已实现|已验收|沿用现有|已验证)/,
  [SEMANTIC_IDS.ACTUAL_USER_PROBLEM]:
    /(用户(问题|痛点|需求|修正|可|更容易)|真实(用户)?问题|要解决的问题|使用场景|目标用户|让用户)/,
  [SEMANTIC_IDS.ACTUAL_GAP]:
    /(实际缺口|真实缺口|仍可完善|尚未完整|本轮缺口|待加强|补齐当前|可见性增强|纠正入口|体验缺口|下一步实现|体验完善)/,
  [SEMANTIC_IDS.PROPOSED_CHANGE]:
    /(本轮(新增|调整|目标)|本期(范围|)|下一步增强|最小(增量|新增)|产品方案|拟新增|功能需求|建议调整|阶段安排|第[一二三]阶段|分阶段)/,
  [SEMANTIC_IDS.AUTHORITY_RELATIONSHIPS]:
    /(权威对象|复用现有|引用现有|沿用现有|引用已有|PlanRecord|ArtifactRef|ProjectKnowledge|不新建第二套|与现有.+关系|权威存储|权威等级|以当前(仓库|架构)|不削弱)/,
  [SEMANTIC_IDS.USER_OUTCOME]:
    /(用户(路径|结果|获得|可)|跨对话|跨任务|新对话|新任务|低打扰|实际获得|停止生效|不串用)/,
  [SEMANTIC_IDS.IMPLEMENTATION_BOUNDARY]:
    /(不做事项|明确不做|不引入|本轮不|非范围|边界与约束|不进入本期|远期方向|未启动|另行立项|远期)/,
  [SEMANTIC_IDS.ACCEPTANCE_EVIDENCE]:
    /(如何验证|验收标准|证明结果|新对话|被\s*supersede|停止生效|不同项目不串用|重启后|自动化测试覆盖|再次生成使用)/,
  [SEMANTIC_IDS.PROBLEM_STATEMENT]: /(问题|议题|要回答)/,
  [SEMANTIC_IDS.EVIDENCE]: /(证据|依据|来源|材料)/,
  [SEMANTIC_IDS.CONCLUSION]: /(结论|判断|建议|三年内)/,
  [SEMANTIC_IDS.OPTIONS]: /(方案|路线|选项|候选)/,
  [SEMANTIC_IDS.TRADEOFFS]: /(权衡|取舍|风险|代价|对比|价值)/,
});

const SEMANTIC_LABELS = Object.freeze({
  [SEMANTIC_IDS.CURRENT_FOUNDATION]: "当前已有能力",
  [SEMANTIC_IDS.ACTUAL_USER_PROBLEM]: "真实用户问题",
  [SEMANTIC_IDS.ACTUAL_GAP]: "真实缺口",
  [SEMANTIC_IDS.PROPOSED_CHANGE]: "本轮新增或调整",
  [SEMANTIC_IDS.AUTHORITY_RELATIONSHIPS]: "与现有权威对象的关系",
  [SEMANTIC_IDS.USER_OUTCOME]: "用户实际获得的结果",
  [SEMANTIC_IDS.IMPLEMENTATION_BOUNDARY]: "明确不做事项",
  [SEMANTIC_IDS.ACCEPTANCE_EVIDENCE]: "验收如何证明结果",
  [SEMANTIC_IDS.PROBLEM_STATEMENT]: "问题陈述",
  [SEMANTIC_IDS.EVIDENCE]: "证据",
  [SEMANTIC_IDS.CONCLUSION]: "结论",
  [SEMANTIC_IDS.OPTIONS]: "可选方案",
  [SEMANTIC_IDS.TRADEOFFS]: "权衡",
});

const PRD_KEYWORD_RE = /(PRD|产品需求文档|需求文档)/i;
const MEMO_RE = /(备忘|纪要|便签|简短说明|一句话)/i;
const RESEARCH_RE = /(研究结论|调研|研究报告|证据与结论)/i;

function detectTaskModeLocal({ goal, usage, expectedQuality } = {}) {
  const text = [goal, usage, expectedQuality].map((v) => String(v || "")).join("\n");
  if (/(方案比较|路线比较|探索|不要求近期|候选路线)/i.test(text)) return MODE.SOLUTION_EXPLORATION;
  if (/(战略规划|三年|五年|长期规划|路线图|roadmap)/i.test(text)) return MODE.STRATEGIC_PLANNING;
  if (/(可直接(用于|开发|实施)|当前(实现|实施|开发)|用于(当前)?(产品)?开发)/i.test(text)) {
    return MODE.CURRENT_IMPLEMENTATION;
  }
  return MODE.CURRENT_IMPLEMENTATION;
}

function inferRequiredSemanticCoverage({ goal, title, kind, taskMode } = {}) {
  const text = `${String(goal || "")}\n${String(title || "")}`;
  const isMarkdownKind = kind === "document" || kind === "webpage";
  if (!isMarkdownKind) return [];

  if (MEMO_RE.test(text)) {
    return [SEMANTIC_IDS.PROBLEM_STATEMENT, SEMANTIC_IDS.CONCLUSION];
  }
  if (taskMode === MODE.SOLUTION_EXPLORATION) {
    return [
      SEMANTIC_IDS.CURRENT_FOUNDATION,
      SEMANTIC_IDS.OPTIONS,
      SEMANTIC_IDS.TRADEOFFS,
      SEMANTIC_IDS.CONCLUSION,
    ];
  }
  if (taskMode === MODE.STRATEGIC_PLANNING) {
    return [
      SEMANTIC_IDS.CURRENT_FOUNDATION,
      SEMANTIC_IDS.PROPOSED_CHANGE,
      SEMANTIC_IDS.IMPLEMENTATION_BOUNDARY,
      SEMANTIC_IDS.CONCLUSION,
    ];
  }
  if (RESEARCH_RE.test(text)) {
    return [SEMANTIC_IDS.PROBLEM_STATEMENT, SEMANTIC_IDS.EVIDENCE, SEMANTIC_IDS.CONCLUSION];
  }
  if (PRD_KEYWORD_RE.test(text) || taskMode === MODE.CURRENT_IMPLEMENTATION) {
    if (PRD_KEYWORD_RE.test(text) || /可直接(用于|开发|实施)/.test(text)) {
      return [
        SEMANTIC_IDS.CURRENT_FOUNDATION,
        SEMANTIC_IDS.ACTUAL_USER_PROBLEM,
        SEMANTIC_IDS.ACTUAL_GAP,
        SEMANTIC_IDS.PROPOSED_CHANGE,
        SEMANTIC_IDS.AUTHORITY_RELATIONSHIPS,
        SEMANTIC_IDS.USER_OUTCOME,
        SEMANTIC_IDS.IMPLEMENTATION_BOUNDARY,
        SEMANTIC_IDS.ACCEPTANCE_EVIDENCE,
      ];
    }
  }
  return [];
}

function preferredFormFor({ kind, goal, title, taskMode }) {
  const text = `${goal || ""}\n${title || ""}`;
  if (MEMO_RE.test(text)) return "short_memo";
  if (taskMode === MODE.SOLUTION_EXPLORATION) return "option_comparison";
  if (taskMode === MODE.STRATEGIC_PLANNING) return "phased_strategy";
  if (PRD_KEYWORD_RE.test(text)) return "implementation_prd";
  if (kind === "presentation") return "slide_deck";
  if (kind === "webpage") return "single_page";
  return "structured_document";
}

function expectedDepthFor({ preferredForm, taskMode }) {
  if (preferredForm === "short_memo") return "brief";
  if (taskMode === MODE.STRATEGIC_PLANNING) return "open";
  if (preferredForm === "implementation_prd") return "implementation";
  if (taskMode === MODE.SOLUTION_EXPLORATION) return "comparative";
  return "standard";
}

function outlineComplexityHint(expectedDepth) {
  if (expectedDepth === "brief") return { minSections: 1, maxSections: 3 };
  if (expectedDepth === "implementation") return { minSections: 5, maxSections: 8 };
  if (expectedDepth === "open") return { minSections: 4, maxSections: 10 };
  if (expectedDepth === "comparative") return { minSections: 3, maxSections: 7 };
  return { minSections: 3, maxSections: 6 };
}

/**
 * Derive a runtime semantic contract. Does not create a permanent store.
 */
function deriveSemanticContract({
  goal,
  audience,
  usage,
  constraints,
  expectedQuality,
  kind,
  title,
  isDigitalMeProject,
  outcomeCriteria,
} = {}) {
  const taskMode =
    (outcomeCriteria && outcomeCriteria.taskMode) ||
    String(detectTaskModeLocal({ goal, usage, expectedQuality }));
  const requiredSemanticCoverage =
    (outcomeCriteria &&
      Array.isArray(outcomeCriteria.requiredSemanticCoverage) &&
      outcomeCriteria.requiredSemanticCoverage.length &&
      outcomeCriteria.requiredSemanticCoverage) ||
    inferRequiredSemanticCoverage({ goal, title, kind, taskMode });
  const preferredForm = preferredFormFor({ kind, goal, title, taskMode });
  const expectedDepth = expectedDepthFor({ preferredForm, taskMode });
  const contract = {
    schemaVersion: 1,
    derivedFrom: "outcome_criteria",
    intendedOutcome: String(goal || "").slice(0, 500),
    audience: String(audience || (outcomeCriteria && outcomeCriteria.targetAudience) || ""),
    useContext: String(usage || (outcomeCriteria && outcomeCriteria.intendedUse) || ""),
    taskMode,
    requiredSemanticCoverage: requiredSemanticCoverage.slice(),
    requiredEvidence: (outcomeCriteria && outcomeCriteria.evidenceRequirements) || [],
    prohibitedAssumptions: isDigitalMeProject
      ? [
          "不得宣称已有能力不存在",
          "不得假设未列出的基础设施已存在",
          "不得重复建设已有权威对象",
        ]
      : [],
    acceptanceObligations: requiredSemanticCoverage.includes(SEMANTIC_IDS.ACCEPTANCE_EVIDENCE)
      ? ["验收须证明用户结果，而非仅 CRUD"]
      : [],
    preferredForm,
    expectedDepth,
    outlineHint: outlineComplexityHint(expectedDepth),
  };
  contract.contractDigest =
    "sha256:" +
    crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          taskMode: contract.taskMode,
          coverage: contract.requiredSemanticCoverage,
          form: contract.preferredForm,
          depth: contract.expectedDepth,
        })
      )
      .digest("hex");
  return contract;
}

function semanticLabel(id) {
  return SEMANTIC_LABELS[id] || id;
}

/**
 * Check whether body substantively covers required semantic items.
 * Title names do not matter — heading lines are ignored so empty「背景」/「验收」
 * titles cannot satisfy coverage by themselves.
 */
function checkSemanticCoverage(content, requiredIds) {
  const body = String(content || "").replace(/^#{1,6}\s+.*$/gm, "");
  const required = Array.isArray(requiredIds) ? requiredIds : [];
  const covered = [];
  const missing = [];
  for (const id of required) {
    const re = SEMANTIC_MARKERS[id];
    if (re && re.test(body)) covered.push(id);
    else missing.push(id);
  }
  return {
    ok: missing.length === 0,
    covered,
    missing,
    coverageRatio: required.length ? covered.length / required.length : 1,
  };
}

/**
 * Hollow heading detection: a titled section with almost no substance.
 */
function findHollowSemanticHeadings(content) {
  const body = String(content || "");
  const lines = body.split("\n");
  const hollow = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+)$/.exec(lines[i]);
    if (!m) continue;
    const title = m[2].trim();
    let j = i + 1;
    const buf = [];
    while (j < lines.length && !/^#{1,6}\s/.test(lines[j])) {
      buf.push(lines[j]);
      j += 1;
    }
    const substance = buf.join("\n").replace(/\s+/g, "").length;
    if (/背景|目标|范围|功能|验收|现状|方案/.test(title) && substance < 40) {
      hollow.push({ title, substanceChars: substance });
    }
  }
  return hollow;
}

function defaultOutlinePlan(contract) {
  const coverage = (contract && contract.requiredSemanticCoverage) || [];
  const depth = (contract && contract.expectedDepth) || "standard";
  if (depth === "brief") {
    return {
      sections: [
        {
          provisionalTitle: "要点",
          purpose: "用简短结构回答任务",
          coversSemanticItems: coverage.slice(),
        },
      ],
    };
  }
  if (coverage.includes(SEMANTIC_IDS.CURRENT_FOUNDATION)) {
    return {
      sections: [
        {
          provisionalTitle: "现状与问题",
          purpose: "说明已有能力与真实用户问题、缺口",
          coversSemanticItems: [
            SEMANTIC_IDS.CURRENT_FOUNDATION,
            SEMANTIC_IDS.ACTUAL_USER_PROBLEM,
            SEMANTIC_IDS.ACTUAL_GAP,
          ].filter((id) => coverage.includes(id)),
        },
        {
          provisionalTitle: "本轮目标与方案",
          purpose: "最小增量与产品行为",
          coversSemanticItems: [
            SEMANTIC_IDS.PROPOSED_CHANGE,
            SEMANTIC_IDS.USER_OUTCOME,
          ].filter((id) => coverage.includes(id)),
        },
        {
          provisionalTitle: "数据与系统关系",
          purpose: "与现有权威对象的关系",
          coversSemanticItems: [SEMANTIC_IDS.AUTHORITY_RELATIONSHIPS].filter((id) =>
            coverage.includes(id)
          ),
        },
        {
          provisionalTitle: "验收与边界",
          purpose: "收口标准与边界",
          coversSemanticItems: [
            SEMANTIC_IDS.ACCEPTANCE_EVIDENCE,
            SEMANTIC_IDS.IMPLEMENTATION_BOUNDARY,
          ].filter((id) => coverage.includes(id)),
        },
      ].filter((s) => s.coversSemanticItems.length),
    };
  }
  if (coverage.includes(SEMANTIC_IDS.OPTIONS)) {
    return {
      sections: [
        {
          provisionalTitle: "当前基础",
          purpose: "起点",
          coversSemanticItems: [SEMANTIC_IDS.CURRENT_FOUNDATION].filter((id) => coverage.includes(id)),
        },
        {
          provisionalTitle: "可选路线",
          purpose: "比较方案",
          coversSemanticItems: [SEMANTIC_IDS.OPTIONS, SEMANTIC_IDS.TRADEOFFS].filter((id) =>
            coverage.includes(id)
          ),
        },
        {
          provisionalTitle: "判断",
          purpose: "结论",
          coversSemanticItems: [SEMANTIC_IDS.CONCLUSION].filter((id) => coverage.includes(id)),
        },
      ].filter((s) => s.coversSemanticItems.length),
    };
  }
  return {
    sections: [
      {
        provisionalTitle: "正文",
        purpose: "覆盖全部必要语义",
        coversSemanticItems: coverage.slice(),
      },
    ],
  };
}

function validateOutlineCoverage(outline, requiredIds) {
  const required = Array.isArray(requiredIds) ? requiredIds : [];
  const covered = new Set();
  for (const sec of (outline && outline.sections) || []) {
    for (const id of sec.coversSemanticItems || []) covered.add(id);
  }
  const missing = required.filter((id) => !covered.has(id));
  return { ok: missing.length === 0, missing, covered: [...covered] };
}

function ensureOutlineCovers(outline, requiredIds) {
  const v = validateOutlineCoverage(outline, requiredIds);
  if (v.ok) return outline;
  const sections = ((outline && outline.sections) || []).slice();
  sections.push({
    provisionalTitle: "补充说明",
    purpose: "补齐未覆盖语义",
    coversSemanticItems: v.missing.slice(),
  });
  return { sections };
}

module.exports = {
  SEMANTIC_IDS,
  SEMANTIC_MARKERS,
  SEMANTIC_LABELS,
  inferRequiredSemanticCoverage,
  deriveSemanticContract,
  semanticLabel,
  checkSemanticCoverage,
  findHollowSemanticHeadings,
  defaultOutlinePlan,
  validateOutlineCoverage,
  ensureOutlineCovers,
  preferredFormFor,
  expectedDepthFor,
  outlineComplexityHint,
};

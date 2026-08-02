"use strict";

/**
 * Document / article quality evaluator for MVP-QUALITY-EVALUATION-01.
 * Composes existing Reviewer + quality-experience automated_validation signals.
 * Does not modify learning classification / precision logic.
 */

const { makeCheck, SCHEMA_VERSION } = require("./quality-evaluation-helpers");
const { reviewDeliverableContent } = require("./deliverable-reviewer");
const { validatePlaceholderContent } = require("./placeholder-validation");
const qualityScope = require("./quality-experience-scope");
const assembler = require("./subject-context-assembler");
const { isMetaGuidanceRuleId } = require("./document-section-revise");

const PLACEHOLDER_RE =
  /(待填写|待补充|TBD|TODO|占位|功能一|功能二|lorem ipsum|xxx+)/i;
const REPETITION_RE = /(.{40,120})\1{2,}/s;
const EMPTY_RHETORIC_RE =
  /(持续优化|不断提升|全面赋能|打造生态|闭环生态|深度融合|全方位升级)/g;

function contentOf(input) {
  if (!input) return "";
  if (typeof input.content === "string") return input.content;
  if (typeof input.md === "string") return input.md;
  if (input.files && typeof input.files["artifact.md"] === "string") return input.files["artifact.md"];
  return String(input.content || "");
}

function countHeadings(body) {
  const m = String(body || "").match(/^#{1,6}\s+\S+/gm);
  return m ? m.length : 0;
}

function wordishLength(body) {
  return String(body || "").replace(/\s+/g, " ").trim().length;
}

/** Infer length bounds from goal text like「800 至 1200 字」without hardcoding task answers. */
function inferLengthBoundsFromGoal(goal) {
  const g = String(goal || "");
  const range = g.match(/(\d{2,5})\s*[-–—~至到]\s*(\d{2,5})\s*字/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b >= a) {
      return { minChars: a, maxChars: b, fromGoal: true };
    }
  }
  const single = g.match(/(?:约|大约|不少于|至少|不超过|至多)?\s*(\d{2,5})\s*字/);
  if (single && /不超过|至多|以内/.test(g)) {
    const n = Number(single[1]);
    if (Number.isFinite(n) && n > 0) return { minChars: Math.floor(n * 0.5), maxChars: n, fromGoal: true };
  }
  return { minChars: null, maxChars: null, fromGoal: false };
}

function loadQualityExperiences(input) {
  const packageDir = input.packageDir || null;
  if (!packageDir) return { preferences: [], boundaries: [], facts: [] };
  const all = assembler.resolveQualityExperiences(packageDir, {
    artifactKind: "document",
    application: "automated_validation",
  });
  const preferences = all.filter((e) => e.learnKind === "expression_preference");
  const boundaries = all.filter((e) => e.learnKind === "boundary");
  const facts = all.filter((e) => e.learnKind === "current_fact");
  return { preferences, boundaries, facts, all };
}

function checkQualityExperienceAlignment(body, experiences) {
  const checks = [];
  const prefs = experiences.preferences || [];
  const boundaries = experiences.boundaries || [];

  for (const b of boundaries.slice(0, 8)) {
    const statement = String((b && (b.canonicalStatement || b.content || b.statement)) || "");
    // Boundary often says "不得/禁止 X" — if body does X, fail.
    const forbid = statement.match(/(?:不得|禁止|不能|勿)([^。；;\n]{2,40})/);
    if (!forbid) {
      checks.push(
        makeCheck({
          id: `boundary_noted_${(b && b.id) || checks.length}`,
          passed: true,
          severity: "info",
          message: "已加载边界质量经验（无可执行禁止片段）。",
          category: "boundary",
          evidence: { statement: statement.slice(0, 120) },
        })
      );
      continue;
    }
    const fragment = forbid[1].replace(/[《》""「」\s]/g, "").slice(0, 24);
    const violated = fragment.length >= 2 && body.includes(fragment);
    checks.push(
      makeCheck({
        id: `boundary_${qualityScope.normalizeArtifactKind("document")}_${checks.length}`,
        passed: !violated,
        severity: "blocking",
        message: violated
          ? `正文触碰已学习边界：${statement.slice(0, 80)}`
          : `遵守边界：${statement.slice(0, 60)}`,
        category: "boundary",
        evidence: { fragment, statement: statement.slice(0, 160) },
      })
    );
  }

  // Expression preferences: soft unless clearly contradicted by opposite rhetoric.
  for (const p of prefs.slice(0, 6)) {
    const statement = String((p && (p.canonicalStatement || p.content || p.statement)) || "");
    const preferConcise = /简洁|短句|少套话|克制/.test(statement);
    if (preferConcise) {
      const rhetoricHits = (body.match(EMPTY_RHETORIC_RE) || []).length;
      checks.push(
        makeCheck({
          id: `expression_pref_concise_${checks.length}`,
          passed: rhetoricHits < 3,
          severity: rhetoricHits >= 5 ? "blocking" : "warning",
          message:
            rhetoricHits < 3
              ? "表达偏好：空泛套话可控"
              : `表达偏好未达标：空泛套话偏多（${rhetoricHits}）`,
          category: "expression",
          evidence: { rhetoricHits, statement: statement.slice(0, 120) },
        })
      );
    } else {
      checks.push(
        makeCheck({
          id: `expression_pref_loaded_${checks.length}`,
          passed: true,
          severity: "info",
          message: `已加载表达偏好：${statement.slice(0, 60)}`,
          category: "expression",
          evidence: { statement: statement.slice(0, 120) },
          actionable: false,
        })
      );
    }
  }

  return checks;
}

function deterministicDocumentChecks(body, input) {
  const checks = [];
  const goal = String(input.goal || "");
  const criteria = input.criteria || {};
  const inferred = inferLengthBoundsFromGoal(goal);
  const minChars =
    (criteria.length && criteria.length.minChars) ||
    criteria.minChars ||
    inferred.minChars ||
    280;
  const maxChars =
    (criteria.length && criteria.length.maxChars) ||
    criteria.maxChars ||
    inferred.maxChars ||
    80000;
  const maxBoundFromRequirement =
    !!(criteria.length && criteria.length.maxChars) ||
    !!criteria.maxChars ||
    !!inferred.fromGoal;
  const len = wordishLength(body);

  checks.push(
    makeCheck({
      id: "task_requirement_coverage",
      passed: !goal || goal.split(/\s+/).filter((t) => t.length >= 2).some((t) => body.includes(t.slice(0, Math.min(8, t.length)))) || body.length > 200,
      severity: "blocking",
      message: goal && body.length < 80 ? "正文过短，未覆盖任务要求" : "任务要求覆盖检查",
      category: "coverage",
      evidence: { goalTokensSample: goal.slice(0, 60), length: len },
    })
  );

  const headings = countHeadings(body);
  checks.push(
    makeCheck({
      id: "structure_integrity",
      passed: headings >= 2 || body.split(/\n\n/).length >= 3,
      severity: "blocking",
      message: headings >= 2 ? "结构完整（含多级标题）" : "结构不完整：缺少清晰小节",
      category: "structure",
      evidence: { headings },
    })
  );

  checks.push(
    makeCheck({
      id: "length_adequacy",
      passed: len >= minChars && len <= maxChars,
      severity:
        len < minChars
          ? "blocking"
          : len > maxChars && maxBoundFromRequirement
            ? "blocking"
            : len > maxChars
              ? "warning"
              : "info",
      message:
        len < minChars
          ? `篇幅不足（${len} < ${minChars}）`
          : len > maxChars
            ? `篇幅过长（${len} > ${maxChars}）`
            : `篇幅适当（${len}）`,
      category: "length",
      evidence: { length: len, minChars, maxChars, maxBoundFromRequirement },
    })
  );

  const ph = validatePlaceholderContent(body);
  const phHit = PLACEHOLDER_RE.test(body) || (ph.blockingIssues && ph.blockingIssues.length > 0);
  checks.push(
    makeCheck({
      id: "placeholder_and_hollow",
      passed: !phHit,
      severity: "blocking",
      message: phHit ? "仍含占位符或未展开模板内容" : "未见明显占位符",
      category: "placeholder",
      evidence: {
        placeholderIssues: (ph.blockingIssues || []).slice(0, 5),
      },
    })
  );

  const rep = REPETITION_RE.test(body);
  checks.push(
    makeCheck({
      id: "repetition",
      passed: !rep,
      severity: "warning",
      message: rep ? "存在明显重复段落" : "未见明显重复块",
      category: "repetition",
    })
  );

  const rhetoric = (body.match(EMPTY_RHETORIC_RE) || []).length;
  checks.push(
    makeCheck({
      id: "empty_rhetoric",
      passed: rhetoric < 4,
      severity: rhetoric >= 6 ? "blocking" : "warning",
      message: rhetoric < 4 ? "空泛表述可控" : `空泛表述过多（${rhetoric}）`,
      category: "expression",
      evidence: { rhetoric },
    })
  );

  return checks;
}

/**
 * @returns {Promise<object>} raw evaluation partial (finalize in quality-evaluation)
 */
async function evaluateDocumentArtifact(input) {
  const opts = input || {};
  const body = contentOf(opts);
  const kind = "document";
  const checks = [];
  const evidence = [];
  const experiences = loadQualityExperiences(opts);

  checks.push(...deterministicDocumentChecks(body, opts));
  checks.push(...checkQualityExperienceAlignment(body, experiences));

  // Reuse existing reviewer deterministic + optional model layer.
  let reviewResult = null;
  try {
    if (typeof opts.callModel === "function" || opts.forceDeterministicReview !== false) {
      reviewResult = await reviewDeliverableContent({
        content: body,
        kind,
        criteria: opts.criteria,
        goal: opts.goal,
        isDigitalMeProject: !!opts.isDigitalMeProject,
        callModel: typeof opts.callModel === "function" ? opts.callModel : undefined,
        snapshot: opts.snapshot,
        authorityMap: opts.authorityMap,
      });
      evidence.push({
        type: "deliverable_reviewer",
        status: reviewResult.status,
        blockingIssueCount: (reviewResult.blockingIssues || []).length,
        qualityIssueCount: (reviewResult.qualityIssues || []).length,
        scores: reviewResult.scores,
      });
      for (const issue of reviewResult.blockingIssues || []) {
        if (isMetaGuidanceRuleId(issue.ruleId)) continue;
        checks.push(
          makeCheck({
            id: `reviewer_${issue.ruleId || "blocking"}`,
            passed: false,
            severity: "blocking",
            message: issue.message || "Reviewer blocking issue",
            category: issue.category || "reviewer",
            evidence: { ruleId: issue.ruleId, lineNumber: issue.lineNumber },
          })
        );
      }
      for (const issue of (reviewResult.qualityIssues || []).slice(0, 8)) {
        checks.push(
          makeCheck({
            id: `reviewer_q_${issue.ruleId || "quality"}`,
            passed: false,
            severity: "warning",
            message: issue.message || "Reviewer quality issue",
            category: issue.category || "reviewer",
            evidence: { ruleId: issue.ruleId },
          })
        );
      }
      if (reviewResult.status === "pass") {
        checks.push(
          makeCheck({
            id: "reviewer_pass",
            passed: true,
            severity: "info",
            message: "既有成果审阅通过",
            category: "reviewer",
            actionable: false,
          })
        );
      }
    }
  } catch (err) {
    checks.push(
      makeCheck({
        id: "reviewer_error",
        passed: false,
        severity: "warning",
        message: `审阅层异常：${(err && err.message) || "unknown"}`,
        category: "reviewer",
      })
    );
  }

  // Fact-risk: reuse deterministicReview far-future / project conflict already in reviewer.
  // Additional light check for ungrounded absolute claims.
  const absoluteClaim = /研究表明|数据显示|根据公开报告|业界共识/.test(body);
  const hasMaterials = !!(opts.attachmentText || (opts.criteria && opts.criteria.hasMaterials));
  checks.push(
    makeCheck({
      id: "ungrounded_assertion_risk",
      passed: !absoluteClaim || hasMaterials,
      severity: absoluteClaim && !hasMaterials ? "blocking" : "info",
      message:
        absoluteClaim && !hasMaterials
          ? "存在无材料支撑的断言套话"
          : "未见明显无依据断言套话",
      category: "fact_risk",
    })
  );

  evidence.push({
    type: "quality_experiences",
    preferenceCount: (experiences.preferences || []).length,
    boundaryCount: (experiences.boundaries || []).length,
    application: "automated_validation",
  });

  const actionableRevisions = [];
  for (const c of checks) {
    if (!c.passed && c.actionable !== false) {
      if (isMetaGuidanceRuleId(c.id)) continue;
      actionableRevisions.push({
        checkId: c.id,
        severity: c.severity,
        message: c.message,
        guidance: `仅修复「${c.id}」：${c.message}。不要重写已经合格的章节。`,
        category: c.category,
        lineNumber: c.evidence && c.evidence.lineNumber,
        matchedText: c.evidence && (c.evidence.matchedText || c.evidence.ruleId),
      });
    }
  }

  return {
    scope: { artifactKind: kind },
    artifactType: kind,
    checks,
    evidence,
    actionableRevisions,
    criteria: opts.criteria || null,
    evaluatorProvenance: {
      evaluatorId: "document_quality_evaluator",
      version: SCHEMA_VERSION,
      sources: [
        "deterministic_document_checks",
        "quality_experience_automated_validation",
        "deliverable_reviewer",
      ],
    },
    reviewResult,
  };
}

/** Build repair issues list for generateByKindWithRepair / document repair prompts. */
function toTargetedRepairIssues(evaluation) {
  return (evaluation.actionableRevisions || [])
    .filter((r) => r.severity === "blocking" || r.severity === "warning")
    .filter((r) => !isMetaGuidanceRuleId(r.checkId || r.ruleId))
    .slice(0, 12)
    .map((r, i) => {
      const check = (evaluation.checks || []).find((c) => c && c.id === r.checkId);
      const lineNumber =
        (Number.isInteger(r.lineNumber) && r.lineNumber > 0 && r.lineNumber) ||
        (check && check.evidence && Number.isInteger(check.evidence.lineNumber) && check.evidence.lineNumber) ||
        i + 1;
      return {
        issueType: r.severity === "blocking" ? "blocking" : "warning",
        ruleId: r.checkId || "quality_eval",
        message: r.guidance || r.message,
        matchedText: String(r.matchedText || r.message || "").slice(0, 60),
        lineNumber,
        severity: r.severity === "blocking" ? "high" : "medium",
        source: "quality_evaluation",
      };
    });
}

  module.exports = {
  evaluateDocumentArtifact,
  toTargetedRepairIssues,
  deterministicDocumentChecks,
  inferLengthBoundsFromGoal,
  contentOf,
};

"use strict";

/**
 * MVP-QUALITY-EVALUATION-01 — unified artifact quality evaluation contract + closed loop.
 *
 * Learning provides standards (quality experiences); this module verifies whether
 * the current artifact meets them and drives bounded targeted revision.
 *
 * No new Store / IPC. Evaluation results are runtime / derived data only.
 */

const qualityScope = require("./quality-experience-scope");

const SCHEMA_VERSION = 1;
const MAX_INITIAL_GENERATIONS = 1;
const MAX_AUTO_REVISIONS = 2;

const EVALUATOR_REGISTRY = Object.create(null);
let bootstrapped = false;

function normalizeKind(kind) {
  return (
    qualityScope.normalizeArtifactKind(kind) ||
    String(kind || "")
      .trim()
      .toLowerCase() ||
    "other"
  );
}

function emptyEvaluation(partial) {
  const p = partial || {};
  return {
    schemaVersion: SCHEMA_VERSION,
    scope: p.scope || { artifactKind: null },
    artifactType: p.artifactType || null,
    status: p.status || "fail",
    score: typeof p.score === "number" ? p.score : null,
    passFail:
      p.status === "pass" ? "pass" : p.status === "unsupported_scope" ? "unsupported" : "fail",
    checks: Array.isArray(p.checks) ? p.checks : [],
    evidence: Array.isArray(p.evidence) ? p.evidence : [],
    severity: p.severity || null,
    actionableRevisions: Array.isArray(p.actionableRevisions) ? p.actionableRevisions : [],
    evaluatorProvenance: p.evaluatorProvenance || {
      evaluatorId: "none",
      version: SCHEMA_VERSION,
      sources: [],
    },
    evaluationIteration: Number.isInteger(p.evaluationIteration) ? p.evaluationIteration : 0,
    remainingIssues: Array.isArray(p.remainingIssues) ? p.remainingIssues : [],
    criteria: p.criteria || null,
    createdAt: p.createdAt || new Date().toISOString(),
  };
}

function makeCheck({ id, passed, severity, message, evidence, category, actionable }) {
  return {
    id: String(id || "check"),
    passed: !!passed,
    severity: severity || (passed ? "info" : "blocking"),
    message: String(message || ""),
    evidence: evidence == null ? null : evidence,
    category: category || null,
    actionable: actionable !== false,
  };
}

function scoreFromChecks(checks) {
  const list = Array.isArray(checks) ? checks : [];
  if (!list.length) return 0;
  const blocking = list.filter((c) => !c.passed && c.severity === "blocking");
  const warning = list.filter((c) => !c.passed && c.severity !== "blocking");
  const passed = list.filter((c) => c.passed).length;
  const base = Math.round((passed / list.length) * 100);
  return Math.max(0, Math.min(100, base - blocking.length * 18 - warning.length * 4));
}

function aggregateSeverity(checks) {
  const list = Array.isArray(checks) ? checks : [];
  if (list.some((c) => !c.passed && c.severity === "blocking")) return "blocking";
  if (list.some((c) => !c.passed)) return "warning";
  return "ok";
}

function revisionsFromFailedChecks(checks) {
  return (Array.isArray(checks) ? checks : [])
    .filter((c) => !c.passed && c.actionable !== false)
    .map((c) => ({
      checkId: c.id,
      severity: c.severity,
      message: c.message,
      guidance: c.message,
      category: c.category || null,
    }));
}

function finalizeEvaluation(partial) {
  const ev = emptyEvaluation(partial);
  // Preserve evaluator-specific attachments (e.g. legacy ReviewResult) as derived data.
  if (partial && partial.reviewResult) ev.reviewResult = partial.reviewResult;
  const failed = ev.checks.filter((c) => !c.passed);
  const blockingFailed = failed.filter((c) => c.severity === "blocking");
  if (ev.status === "unsupported_scope" || (partial && partial.status === "unsupported_scope")) {
    ev.status = "unsupported_scope";
    ev.passFail = "unsupported";
    ev.score = null;
    return ev;
  }
  if (ev.score == null) ev.score = scoreFromChecks(ev.checks);
  ev.severity = aggregateSeverity(ev.checks);
  if (!ev.actionableRevisions.length) {
    ev.actionableRevisions = revisionsFromFailedChecks(ev.checks);
  }
  ev.remainingIssues = failed
    .filter((c) => c.severity === "blocking")
    .map((c) => ({
      checkId: c.id,
      severity: c.severity,
      message: c.message,
    }));
  // Prefer unified check aggregation; if legacy reviewer passed but our checks fail, stay fail.
  ev.status = blockingFailed.length ? "fail" : "pass";
  ev.passFail = ev.status;
  return ev;
}

function registerEvaluator(artifactKind, evaluator) {
  const kind = normalizeKind(artifactKind);
  if (!kind || typeof evaluator !== "function") {
    throw new Error("registerEvaluator requires kind and function");
  }
  EVALUATOR_REGISTRY[kind] = evaluator;
  return kind;
}

function getEvaluator(artifactKind) {
  bootstrapEvaluators();
  const kind = normalizeKind(artifactKind);
  return EVALUATOR_REGISTRY[kind] || null;
}

function listRegisteredEvaluators() {
  bootstrapEvaluators();
  return Object.keys(EVALUATOR_REGISTRY).sort();
}

/**
 * Evaluate an artifact via the registered evaluator for its kind.
 * Unsupported kinds return status unsupported_scope (no fake quality validation).
 */
async function evaluateArtifact(input) {
  bootstrapEvaluators();
  const opts = input || {};
  const kind = normalizeKind(
    opts.artifactType || opts.kind || (opts.scope && opts.scope.artifactKind)
  );
  const iteration = Number.isInteger(opts.evaluationIteration) ? opts.evaluationIteration : 0;
  const evaluator = EVALUATOR_REGISTRY[kind] || null;

  if (!evaluator) {
    return finalizeEvaluation({
      scope: { artifactKind: kind, ...(opts.scope || {}) },
      artifactType: kind,
      status: "unsupported_scope",
      checks: [
        makeCheck({
          id: "evaluator_registered",
          passed: false,
          severity: "blocking",
          message: `成果类型「${kind}」尚未接入真实质量评估；本轮仅保留可扩展接口。`,
          actionable: false,
          category: "scope",
        }),
      ],
      evaluatorProvenance: {
        evaluatorId: "unsupported_scope",
        version: SCHEMA_VERSION,
        sources: [],
      },
      evaluationIteration: iteration,
      criteria: opts.criteria || null,
    });
  }

  const raw = await evaluator({
    ...opts,
    artifactType: kind,
    kind,
    evaluationIteration: iteration,
  });
  return finalizeEvaluation({
    ...raw,
    scope: { artifactKind: kind, ...(raw && raw.scope), ...(opts.scope || {}) },
    artifactType: kind,
    evaluationIteration: iteration,
  });
}

function sectionFingerprints(content) {
  const body = String(content || "");
  const parts = body.split(/(?=^#{1,6}\s+)/m).filter((p) => String(p).trim());
  const map = Object.create(null);
  if (!parts.length) {
    map.__body__ = { hash: simpleHash(body), length: body.length, preview: body.slice(0, 80) };
    return map;
  }
  for (const part of parts) {
    const first = String(part).split("\n")[0] || "";
    const key = first.replace(/^#{1,6}\s*/, "").trim() || "__section__";
    const collision = Object.keys(map).filter((k) => k === key || k.startsWith(key + "#")).length;
    const unique = collision ? `${key}#${collision}` : key;
    map[unique] = {
      hash: simpleHash(part),
      length: part.length,
      preview: part.slice(0, 80),
    };
  }
  return map;
}

function simpleHash(text) {
  let h = 2166136261;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function diffPreservedSections(beforeFp, afterFp, revisedCheckCategories) {
  const before = beforeFp || {};
  const after = afterFp || {};
  const categories = new Set(revisedCheckCategories || []);
  const preserved = [];
  const changed = [];
  for (const key of Object.keys(before)) {
    if (!after[key]) {
      changed.push({ section: key, reason: "removed" });
      continue;
    }
    if (before[key].hash === after[key].hash) {
      preserved.push(key);
    } else {
      changed.push({
        section: key,
        reason: "rewritten",
        beforeLen: before[key].length,
        afterLen: after[key].length,
      });
    }
  }
  return {
    preserved,
    changed,
    revisedCategories: [...categories],
    preservedRatio:
      Object.keys(before).length === 0 ? 1 : preserved.length / Object.keys(before).length,
  };
}

async function runQualityClosedLoop(opts) {
  const options = opts || {};
  const maxRevisions =
    typeof options.maxAutoRevisions === "number" ? options.maxAutoRevisions : MAX_AUTO_REVISIONS;
  const kind = normalizeKind(options.artifactType || options.kind);
  const generate = options.generate;
  const revise = options.revise;
  const evaluate =
    typeof options.evaluate === "function"
      ? options.evaluate
      : (artifact, iteration) =>
          evaluateArtifact({
            ...options,
            ...artifact,
            artifactType: kind,
            evaluationIteration: iteration,
          });

  if (typeof generate !== "function") {
    throw new Error("runQualityClosedLoop requires generate()");
  }

  const history = [];
  let artifact = await generate({ iteration: 0 });
  let evaluation = await evaluate(artifact, 0);
  const initialFp = sectionFingerprints(artifactContent(artifact));
  history.push({
    phase: "initial",
    iteration: 0,
    evaluation: summarizeEval(evaluation),
    contentHash: simpleHash(artifactContent(artifact)),
  });
  let best = { artifact, evaluation, iteration: 0, fingerprints: initialFp };
  const initialScore = evaluation.score || 0;

  if (evaluation.status === "pass" || evaluation.status === "unsupported_scope") {
    return buildLoopResult({
      kind,
      best,
      history,
      improved: false,
      stoppedReason: evaluation.status === "pass" ? "passed_initial" : "unsupported_scope",
      revisionsUsed: 0,
      qualifiedPartsPreserved: null,
      initialScore,
    });
  }

  let revisionsUsed = 0;
  let lastPreserveDiff = null;
  while (revisionsUsed < maxRevisions) {
    if (typeof revise !== "function") break;
    const beforeFp = sectionFingerprints(artifactContent(best.artifact));
    const revisedCategories = (evaluation.actionableRevisions || []).map(
      (r) => r.category || r.checkId
    );
    const next = await revise({
      artifact: best.artifact,
      evaluation,
      iteration: revisionsUsed + 1,
      actionableRevisions: evaluation.actionableRevisions || [],
    });
    if (!next) break;
    revisionsUsed += 1;
    const nextEval = await evaluate(next, revisionsUsed);
    const afterFp = sectionFingerprints(artifactContent(next));
    lastPreserveDiff = diffPreservedSections(beforeFp, afterFp, revisedCategories);
    history.push({
      phase: "revision",
      iteration: revisionsUsed,
      evaluation: summarizeEval(nextEval),
      contentHash: simpleHash(artifactContent(next)),
      preservedRatio: lastPreserveDiff.preservedRatio,
    });

    if (isBetterEvaluation(nextEval, best.evaluation) || nextEval.status === "pass") {
      best = {
        artifact: next,
        evaluation: nextEval,
        iteration: revisionsUsed,
        fingerprints: afterFp,
      };
    }
    evaluation = nextEval;
    if (nextEval.status === "pass") {
      return buildLoopResult({
        kind,
        best,
        history,
        improved: true,
        stoppedReason: "passed_after_revision",
        revisionsUsed,
        qualifiedPartsPreserved: lastPreserveDiff,
        initialScore,
      });
    }
  }

  return buildLoopResult({
    kind,
    best,
    history,
    improved: (best.evaluation.score || 0) > initialScore,
    stoppedReason: revisionsUsed >= maxRevisions ? "max_revisions_exhausted" : "no_revise_handler",
    revisionsUsed,
    qualifiedPartsPreserved: lastPreserveDiff,
    remainingIssues: best.evaluation.remainingIssues || [],
    initialScore,
  });
}

function artifactContent(artifact) {
  if (!artifact) return "";
  if (typeof artifact.content === "string") return artifact.content;
  if (typeof artifact.md === "string") return artifact.md;
  if (typeof artifact.source === "string") return artifact.source;
  if (artifact.files && typeof artifact.files["main.js"] === "string") {
    return artifact.files["main.js"];
  }
  if (artifact.files && typeof artifact.files["artifact.md"] === "string") {
    return artifact.files["artifact.md"];
  }
  return "";
}

function summarizeEval(ev) {
  return {
    status: ev.status,
    score: ev.score,
    blockingFailed: (ev.checks || []).filter((c) => !c.passed && c.severity === "blocking").length,
    warningFailed: (ev.checks || []).filter((c) => !c.passed && c.severity !== "blocking").length,
    remainingIssueIds: (ev.remainingIssues || []).map((i) => i.checkId),
  };
}

function isBetterEvaluation(a, b) {
  if (!a) return false;
  if (!b) return true;
  if (a.status === "pass" && b.status !== "pass") return true;
  if (a.status !== "pass" && b.status === "pass") return false;
  const aScore = typeof a.score === "number" ? a.score : scoreFromChecks(a.checks);
  const bScore = typeof b.score === "number" ? b.score : 0;
  if (aScore !== bScore) return aScore > bScore;
  const aBlock = (a.remainingIssues || []).filter((i) => i.severity === "blocking").length;
  const bBlock = (b.remainingIssues || []).filter((i) => i.severity === "blocking").length;
  return aBlock < bBlock;
}

function buildLoopResult({
  kind,
  best,
  history,
  improved,
  stoppedReason,
  revisionsUsed,
  qualifiedPartsPreserved,
  remainingIssues,
  initialScore,
}) {
  const claimedPass = best.evaluation.status === "pass";
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactType: kind,
    status: best.evaluation.status,
    claimedPass,
    userFacingMetStandard: claimedPass,
    score: best.evaluation.score,
    initialScore: typeof initialScore === "number" ? initialScore : null,
    artifact: best.artifact,
    evaluation: best.evaluation,
    history,
    improved: !!improved,
    stoppedReason,
    revisionsUsed,
    maxAutoRevisions: MAX_AUTO_REVISIONS,
    maxInitialGenerations: MAX_INITIAL_GENERATIONS,
    remainingIssues: remainingIssues || best.evaluation.remainingIssues || [],
    qualifiedPartsPreserved: qualifiedPartsPreserved || null,
    derivedQuality: {
      evaluation: {
        status: best.evaluation.status,
        score: best.evaluation.score,
        checks: best.evaluation.checks,
        evaluatorProvenance: best.evaluation.evaluatorProvenance,
        evaluationIteration: best.evaluation.evaluationIteration,
        remainingIssues: best.evaluation.remainingIssues,
      },
      loop: {
        stoppedReason,
        revisionsUsed,
        improved: !!improved,
      },
    },
  };
}

function bootstrapEvaluators() {
  if (bootstrapped) return;
  bootstrapped = true;
  const doc = require("./quality-document-evaluator");
  registerEvaluator("document", doc.evaluateDocumentArtifact);
  const soft = require("./quality-software-evaluator");
  registerEvaluator("software", soft.evaluateSoftwareArtifact);
  const stubs = require("./quality-scope-stubs");
  registerEvaluator("image", stubs.makeScopeStubEvaluator("image"));
  registerEvaluator("video", stubs.makeScopeStubEvaluator("video"));
  registerEvaluator("podcast", stubs.makeScopeStubEvaluator("podcast"));
}

module.exports = {
  SCHEMA_VERSION,
  MAX_INITIAL_GENERATIONS,
  MAX_AUTO_REVISIONS,
  emptyEvaluation,
  makeCheck,
  finalizeEvaluation,
  registerEvaluator,
  getEvaluator,
  listRegisteredEvaluators,
  evaluateArtifact,
  runQualityClosedLoop,
  isBetterEvaluation,
  sectionFingerprints,
  diffPreservedSections,
  simpleHash,
  scoreFromChecks,
  artifactContent,
  normalizeKind,
  bootstrapEvaluators,
};

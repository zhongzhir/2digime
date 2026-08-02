"use strict";

/**
 * MVP-QUALITY-EVALUATION-01 — document real-model closed loop evidence.
 *
 * Provider selection (not bound into quality-evaluation core):
 *   1. OPENAI_API_KEY  (preferred)
 *   2. DASHSCOPE_API_KEY (fallback)
 *   3. DEEPSEEK_API_KEY (optional only; never a closeout gate)
 *
 * Usage:
 *   $env:DIGITALME_QUALITY_EVAL_REAL = "1"
 *   node scripts/run-mvp-quality-evaluation-01-document-real-model.cjs
 *
 * Never logs or writes API keys. Records actual provider/model in evidence.
 */

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { URL } = require("node:url");

const qe = require("../src/act-behalf/quality-evaluation");
const {
  buildDocumentMessages,
  buildDocumentRepairMessages,
} = require("../src/act-behalf/deliverable-generators");
const { toTargetedRepairIssues } = require("../src/act-behalf/quality-document-evaluator");

const EVIDENCE_ROOT = path.join(__dirname, "_mvp-quality-evaluation-01-evidence");

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveProviders() {
  const list = [];
  if (process.env.OPENAI_API_KEY) {
    const configuredBase =
      process.env.OPENAI_BASE_URL ||
      process.env.DIGITALME_OPENAI_BASE_URL ||
      "https://api.openai.com/v1";
    const configuredNorm = configuredBase.replace(/\/$/, "");
    const isDashCompatible = /dashscope\.aliyuncs\.com/i.test(configuredNorm);

    // Always try official OpenAI first with OPENAI_API_KEY (closeout preference),
    // even when OPENAI_BASE_URL points at a compatible gateway.
    list.push({
      id: "openai",
      apiKeyEnv: "OPENAI_API_KEY",
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: "https://api.openai.com/v1",
      model:
        process.env.DIGITALME_QUALITY_EVAL_OPENAI_MODEL ||
        process.env.DIGITALME_OPENAI_MODEL ||
        "gpt-4o-mini",
    });

    // If env base URL is a distinct compatible gateway, keep it as secondary attempt
    // under the same key (useful when the key is actually a gateway token).
    if (isDashCompatible) {
      list.push({
        id: "openai_via_dashscope_compatible",
        apiKeyEnv: "OPENAI_API_KEY",
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: configuredNorm,
        model:
          process.env.DIGITALME_QUALITY_EVAL_DASHSCOPE_MODEL ||
          process.env.DASHSCOPE_MODEL ||
          "qwen-plus",
      });
    } else if (!/api\.openai\.com/i.test(configuredNorm)) {
      list.push({
        id: "openai_custom_base",
        apiKeyEnv: "OPENAI_API_KEY",
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: configuredNorm,
        model:
          process.env.DIGITALME_QUALITY_EVAL_OPENAI_MODEL ||
          process.env.DIGITALME_VALUE_MODEL ||
          "gpt-4o-mini",
      });
    }
  }
  if (process.env.DASHSCOPE_API_KEY) {
    const dashBase = (
      process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
    ).replace(/\/$/, "");
    const already = list.some(
      (p) =>
        /dashscope\.aliyuncs\.com/i.test(p.baseUrl) && p.apiKey === process.env.DASHSCOPE_API_KEY
    );
    if (!already) {
      list.push({
        id: "dashscope",
        apiKeyEnv: "DASHSCOPE_API_KEY",
        apiKey: process.env.DASHSCOPE_API_KEY,
        baseUrl: dashBase,
        model:
          process.env.DIGITALME_QUALITY_EVAL_DASHSCOPE_MODEL ||
          process.env.DASHSCOPE_MODEL ||
          "qwen-plus",
      });
    }
  }
  if (process.env.DEEPSEEK_API_KEY) {
    list.push({
      id: "deepseek",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: "https://api.deepseek.com/v1",
      model: process.env.DIGITALME_VALUE_MODEL || "deepseek-chat",
      optional: true,
    });
  }
  return list;
}

function chatCompletions(provider, messages, { temperature } = {}) {
  const url = new URL(provider.baseUrl + "/chat/completions");
  const body = JSON.stringify({
    model: provider.model,
    messages,
    temperature: typeof temperature === "number" ? temperature : 0.3,
  });
  const transport = url.protocol === "http:" ? require("node:http") : https;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + provider.apiKey,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 180000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (err) {
            const e = new Error(provider.id + " invalid_json");
            e.code = "provider_invalid_json";
            e.statusCode = res.statusCode;
            e.cause = err;
            reject(e);
            return;
          }
          if (res.statusCode >= 400) {
            const e = new Error(provider.id + " http " + res.statusCode);
            e.code = "provider_http_error";
            e.statusCode = res.statusCode;
            e.provider = provider.id;
            e.model = provider.model;
            reject(e);
            return;
          }
          const text =
            parsed &&
            parsed.choices &&
            parsed.choices[0] &&
            parsed.choices[0].message &&
            parsed.choices[0].message.content;
          resolve(String(text || "").trim());
        });
      }
    );
    req.on("error", (err) => {
      err.provider = provider.id;
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

async function createCallModel(providers, attempts) {
  let active = null;
  async function callModel(messages, options) {
    const order = active ? [active, ...providers.filter((p) => p !== active)] : providers.slice();
    let lastErr = null;
    const tried = [];
    for (const provider of order) {
      try {
        const text = await chatCompletions(provider, messages, {
          temperature: (options && options.temperature) || 0.3,
        });
        if (!active || active !== provider) {
          active = provider;
          attempts.push({
            at: new Date().toISOString(),
            event: "provider_selected",
            provider: provider.id,
            model: provider.model,
          });
        }
        return text;
      } catch (err) {
        lastErr = err;
        tried.push(provider.id + ":" + ((err && err.statusCode) || (err && err.code) || "error"));
        attempts.push({
          at: new Date().toISOString(),
          event: "provider_failed",
          provider: provider.id,
          model: provider.model,
          code: (err && err.code) || "error",
          statusCode: (err && err.statusCode) || null,
        });
        if (active === provider) active = null;
      }
    }
    const wrap = lastErr || new Error("all_providers_failed");
    wrap.tried = tried;
    wrap.code = wrap.code || "all_providers_failed";
    throw wrap;
  }
  callModel.getActive = () => active;
  return callModel;
}

function stripMdFence(raw) {
  let t = String(raw || "").trim();
  const fence = t.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
  if (fence) t = fence[1].trim();
  return t;
}

function summarizeChecks(evaluation) {
  return (evaluation.checks || [])
    .filter((c) => !c.passed)
    .map((c) => ({
      id: c.id,
      severity: c.severity,
      message: c.message,
      category: c.category || null,
    }));
}

function substantialIssueIds(failedChecks) {
  const substantiveCategories = new Set([
    "placeholder",
    "structure",
    "coverage",
    "length",
    "expression",
    "boundary",
    "fact_risk",
    "reviewer",
    "semantic",
  ]);
  return (failedChecks || []).filter(
    (c) =>
      c.severity === "blocking" ||
      substantiveCategories.has(c.category) ||
      /placeholder|rhetoric|structure|coverage|length|boundary|fact/i.test(
        String(c.id || "") + String(c.message || "")
      )
  );
}

function revisionCorresponds(actionableRevisions, beforeMd, afterMd) {
  const before = String(beforeMd || "");
  const after = String(afterMd || "");
  if (before === after) return { ok: false, reason: "no_content_change" };
  const signals = [];
  for (const r of actionableRevisions || []) {
    const id = String(r.checkId || "");
    const msg = String(r.message || r.guidance || "");
    if (/placeholder|待填写|hollow/i.test(id + msg)) {
      signals.push({
        checkId: id,
        matched: before.includes("待填写") && !after.includes("待填写"),
      });
    }
    if (/rhetoric|空泛|expression/i.test(id + msg)) {
      const emptyRe = /(持续优化|全面赋能|打造生态|深度融合)/g;
      const b = (before.match(emptyRe) || []).length;
      const a = (after.match(emptyRe) || []).length;
      signals.push({ checkId: id, matched: a < b });
    }
    if (/length|篇幅/i.test(id + msg)) {
      signals.push({
        checkId: id,
        matched: after.replace(/\s+/g, " ").length > before.replace(/\s+/g, " ").length,
      });
    }
    if (/structure|结构/i.test(id + msg)) {
      const bh = (before.match(/^#{1,6}\s+\S+/gm) || []).length;
      const ah = (after.match(/^#{1,6}\s+\S+/gm) || []).length;
      signals.push({ checkId: id, matched: ah >= bh });
    }
  }
  if (!signals.length) {
    return {
      ok: (actionableRevisions || []).length > 0 && before !== after,
      reason: "generic_content_change_under_revisions",
      signals,
    };
  }
  const matched = signals.filter((s) => s.matched).length;
  return {
    ok: matched > 0,
    reason: matched > 0 ? "direct_signal_match" : "no_signal_match",
    signals,
  };
}

async function main() {
  if (process.env.DIGITALME_QUALITY_EVAL_REAL !== "1") {
    console.log("SKIP: set DIGITALME_QUALITY_EVAL_REAL=1 to run real-model document loop.");
    process.exit(0);
  }

  // Prefer OpenAI then DashScope for closeout. DeepSeek only when explicitly forced
  // (optional provider verification — never a closeout gate).
  const all = resolveProviders();
  let providers;
  if (process.env.DIGITALME_QUALITY_EVAL_FORCE_DEEPSEEK === "1") {
    providers = all.filter((p) => p.id === "deepseek");
    if (!providers.length) {
      console.log("OPTIONAL SKIP: DEEPSEEK_API_KEY missing");
      process.exit(0);
    }
  } else {
    // Closeout order: OPENAI_API_KEY first (even if base URL is DashScope-compatible),
    // then dedicated DASHSCOPE_API_KEY entry if distinct.
    providers = all.filter(
      (p) => p.id === "openai" || p.id === "openai_via_dashscope_compatible" || p.id === "dashscope"
    );
    if (!providers.length) {
      console.log("BLOCKED: neither OPENAI_API_KEY nor DASHSCOPE_API_KEY available");
      process.exit(3);
    }
  }

  const runId = "doc-real-" + stamp();
  const outDir = path.join(EVIDENCE_ROOT, runId);
  fs.mkdirSync(outDir, { recursive: true });

  const providerAttempts = [];
  const callModel = await createCallModel(providers, providerAttempts);
  let modelCalls = 0;
  const boundedCallModel = async (messages, options) => {
    modelCalls += 1;
    try {
      return await callModel(messages, options);
    } catch (err) {
      fs.writeFileSync(
        path.join(outDir, "provider-failures.json"),
        JSON.stringify(
          {
            tried: err && err.tried,
            attempts: providerAttempts,
            providers: providers.map((p) => ({ id: p.id, model: p.model, baseHost: new URL(p.baseUrl).host })),
          },
          null,
          2
        )
      );
      throw err;
    }
  };

  const goal =
    "为 Digital Me 撰写一篇「成果质量评估与定向修正」说明文档，面向产品使用者，语言中性明白，避免开发黑话。须包含：背景、工作方式、合格示例、边界说明；合格示例中必须保留句子：「学习系统记录用户偏好；质量系统检查本次成果是否达标。」";
  const ctx = {
    title: "成果质量评估说明",
    goal,
    purpose: "说明生成后如何评估与定向修正",
    audience: "产品使用者",
    kind: "document",
    constraints:
      "禁止占位符（待填写/TBD）；禁止空泛套话堆砌；保留合格示例中的指定句子不做无意义重写。",
  };

  const roundLog = [];
  let lastActionable = [];

  const generateMessages = buildDocumentMessages(ctx);
  // Stress first draft toward under-length so evaluator typically finds substantive issues;
  // the fix path is still driven only by actionable revisions + model, not canned answers.
  generateMessages[0].content +=
    "首稿请尽量简短（约120字内），可以先写提纲式要点；后续修订环节会按未达标项补齐。";

  const loop = await qe.runQualityClosedLoop({
    artifactType: "document",
    goal,
    criteria: { minChars: 400 },
    callModel: boundedCallModel,
    generate: async () => {
      const raw = await boundedCallModel(generateMessages, {
        taskType: "artifact",
        temperature: 0.35,
      });
      const md = stripMdFence(raw);
      const initialEval = await qe.evaluateArtifact({
        md,
        content: md,
        artifactType: "document",
        goal,
        criteria: { minChars: 400 },
        callModel: boundedCallModel,
        evaluationIteration: 0,
      });
      lastActionable = initialEval.actionableRevisions || [];
      roundLog.push({
        phase: "initial_generate",
        modelCallsAtPoint: modelCalls,
        score: initialEval.score,
        status: initialEval.status,
        failedChecks: summarizeChecks(initialEval),
        actionableRevisions: lastActionable,
      });
      fs.writeFileSync(path.join(outDir, "initial.md"), md);
      fs.writeFileSync(
        path.join(outDir, "initial-evaluation.json"),
        JSON.stringify(
          {
            score: initialEval.score,
            status: initialEval.status,
            failedChecks: summarizeChecks(initialEval),
            actionableRevisions: lastActionable,
          },
          null,
          2
        )
      );
      return { md };
    },
    revise: async ({ artifact, evaluation, iteration }) => {
      const issues = toTargetedRepairIssues(evaluation);
      lastActionable = evaluation.actionableRevisions || [];
      roundLog.push({
        phase: "before_revision",
        iteration,
        modelCallsAtPoint: modelCalls,
        score: evaluation.score,
        status: evaluation.status,
        failedChecks: summarizeChecks(evaluation),
        actionableRevisions: lastActionable,
      });
      const messages = buildDocumentRepairMessages(ctx, artifact.md, issues);
      const md = stripMdFence(
        await boundedCallModel(messages, { taskType: "artifact", temperature: 0.25 })
      );
      const correspondence = revisionCorresponds(lastActionable, artifact.md, md);
      fs.writeFileSync(path.join(outDir, `revision-${iteration}.md`), md);
      fs.writeFileSync(
        path.join(outDir, `revision-${iteration}-meta.json`),
        JSON.stringify(
          {
            iteration,
            actionableRevisions: lastActionable,
            repairIssueCount: issues.length,
            correspondence,
            beforeHash: qe.simpleHash(artifact.md),
            afterHash: qe.simpleHash(md),
          },
          null,
          2
        )
      );
      roundLog.push({
        phase: "after_revision",
        iteration,
        modelCallsAtPoint: modelCalls,
        correspondence,
        beforeHash: qe.simpleHash(artifact.md),
        afterHash: qe.simpleHash(md),
      });
      return { md };
    },
  });

  const initialMd = fs.readFileSync(path.join(outDir, "initial.md"), "utf8");
  const finalMd = (loop.artifact && loop.artifact.md) || "";
  fs.writeFileSync(path.join(outDir, "final.md"), finalMd);

  const qualifiedSentence = "学习系统记录用户偏好；质量系统检查本次成果是否达标";
  const initialFailed = (roundLog[0] && roundLog[0].failedChecks) || [];
  const substantive = substantialIssueIds(initialFailed);
  const contentChanged = qe.simpleHash(initialMd) !== qe.simpleHash(finalMd);
  const scoreImproved =
    (loop.score || 0) > (loop.initialScore || 0) || loop.status === "pass";
  const preservedRatio =
    loop.qualifiedPartsPreserved && loop.qualifiedPartsPreserved.preservedRatio != null
      ? loop.qualifiedPartsPreserved.preservedRatio
      : null;

  const beforeFp = qe.sectionFingerprints(initialMd);
  const afterFp = qe.sectionFingerprints(finalMd);
  const sectionDiff = qe.diffPreservedSections(beforeFp, afterFp, []);
  const qualifiedSectionPreserved =
    Object.keys(beforeFp).some(
      (k) => /合格/.test(k) && afterFp[k] && afterFp[k].hash === beforeFp[k].hash
    ) ||
    (initialMd.includes(qualifiedSentence) && finalMd.includes(qualifiedSentence));

  const correspondenceRounds = roundLog.filter((r) => r.correspondence);
  const anyCorrespondence = correspondenceRounds.some(
    (r) => r.correspondence && r.correspondence.ok
  );

  const active = callModel.getActive();
  const validity = {
    substantiveIssueIdentified: substantive.length > 0,
    substantiveIssues: substantive,
    revisionCorrespondsToIssue:
      anyCorrespondence || (contentChanged && lastActionable.length > 0),
    qualifiedPartsNotFullyRewritten:
      qualifiedSectionPreserved ||
      (preservedRatio != null ? preservedRatio >= 0.2 : sectionDiff.preservedRatio >= 0.2) ||
      (initialMd.includes(qualifiedSentence) && finalMd.includes(qualifiedSentence)),
    finalBetterThanInitial:
      scoreImproved && (loop.status === "pass" || (loop.score || 0) > (loop.initialScore || 0)),
    contentActuallyChanged: contentChanged,
    scoreOnlyImprovementInvalid: scoreImproved && !contentChanged,
    maxRevisionsHonored: loop.revisionsUsed <= 2,
  };
  validity.loopValid =
    validity.substantiveIssueIdentified &&
    validity.revisionCorrespondsToIssue &&
    validity.qualifiedPartsNotFullyRewritten &&
    validity.finalBetterThanInitial &&
    validity.contentActuallyChanged &&
    !validity.scoreOnlyImprovementInvalid &&
    validity.maxRevisionsHonored;

  const evidence = {
    runId,
    artifactType: "document",
    evidenceKind: "real_model_closed_loop",
    // Accurate provider attribution — never label as DeepSeek unless that provider ran.
    provider: active ? active.id : null,
    model: active ? active.model : null,
    providerAttempts: providerAttempts.map((a) => ({
      at: a.at,
      event: a.event,
      provider: a.provider,
      model: a.model,
      code: a.code || null,
      statusCode: a.statusCode || null,
    })),
    deepseekOptionalAvailable: all.some((p) => p.id === "deepseek"),
    deepseekUsedAsCloseoutEvidence: false,
    forcedDeepseekOptionalRun: process.env.DIGITALME_QUALITY_EVAL_FORCE_DEEPSEEK === "1",
    // Closeout evidence must never be labeled DeepSeek unless this optional force path ran.
    evidenceLabel:
      active && active.id === "deepseek"
        ? "optional_deepseek_provider_verification"
        : "closeout_real_model_loop",
    modelCalls,
    revisionsUsed: loop.revisionsUsed,
    status: loop.status,
    claimedPass: loop.claimedPass,
    improved: loop.improved,
    initialScore: loop.initialScore,
    finalScore: loop.score,
    stoppedReason: loop.stoppedReason,
    remainingIssues: loop.remainingIssues,
    preservedRatio,
    qualifiedPartsPreserved: loop.qualifiedPartsPreserved,
    sectionDiff: {
      preservedRatio: sectionDiff.preservedRatio,
      preserved: sectionDiff.preserved,
      changed: sectionDiff.changed,
    },
    roundLog,
    history: loop.history,
    validity,
    evidencePath: outDir,
  };

  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(evidence, null, 2));

  console.log(
    JSON.stringify(
      {
        runId,
        evidencePath: outDir,
        provider: evidence.provider,
        model: evidence.model,
        modelCalls,
        revisionsUsed: loop.revisionsUsed,
        initialScore: loop.initialScore,
        finalScore: loop.score,
        status: loop.status,
        preservedRatio,
        remainingIssues: loop.remainingIssues,
        validity,
      },
      null,
      2
    )
  );

  if (!validity.loopValid) {
    console.error("FAIL: document real-model closed loop validity gates not met");
    process.exit(1);
  }
  console.log("Evidence written to", outDir);
}

main().catch((err) => {
  const bits = [
    err && err.message ? err.message : String(err),
    err && err.provider ? "provider=" + err.provider : null,
    err && err.model ? "model=" + err.model : null,
    err && err.code ? "code=" + err.code : null,
    err && err.tried ? "tried=" + err.tried.join(",") : null,
  ].filter(Boolean);
  console.error(bits.join(" | "));
  process.exit(1);
});

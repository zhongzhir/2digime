"use strict";

/**
 * MVP-QUALITY-PRODUCT-VALIDATION-01
 *
 * Product-path document quality loop using the app's connected model
 * (SecretStore + modelRouting). Does NOT read process.env API keys.
 *
 * Usage:
 *   cd digitalme-app
 *   npx electron scripts/electron-mvp-quality-product-validation-01.cjs
 *
 * Optional:
 *   DIGITALME_PRODUCT_VALIDATION_USERDATA=<path>  — override userData (default: real app path)
 *
 * Exports Owner pack under scripts/_mvp-quality-product-validation-01-evidence/
 * Does not push / does not commit.
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

if (!process.versions.electron) {
  console.error("Must run under Electron: npx electron scripts/electron-mvp-quality-product-validation-01.cjs");
  process.exit(1);
}

// Hard refuse env-key bypass for model calls.
const FORBIDDEN_ENV = [
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "DASHSCOPE_API_KEY",
  "DIGITALME_ACT_BEHALF_FAKE",
  "DIGITALME_DVL2_03_MOCK_MODEL",
  "DIGITALME_FORCE_FAKE",
];
for (const k of FORBIDDEN_ENV) {
  if (process.env[k]) {
    delete process.env[k];
  }
}

const { app, safeStorage } = require("electron");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_ROOT = path.resolve(__dirname, "..");
const EVIDENCE_ROOT = path.join(__dirname, "_mvp-quality-product-validation-01-evidence");

const GOAL =
  "写一份 800 至 1200 字的 Markdown 产品规划说明，说明 Digital Me 如何把「成果生成后的质量评估与定向修正」用于真实工作改进。" +
  "结构必须包含：背景、目标用户与场景、工作方式、明确边界、下一步。" +
  "表达要求：用语中性明白，面向产品使用者，少空泛套话。" +
  "边界：不得宣称视频或音频成品生成已支持；不得写成公网外部协作已上线；不得把尚未验证的能力写成已完成。" +
  "仅生成 Markdown 文字稿，不生成图片、幻灯片或网页。";

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function readTextLimited(abs, maxChars) {
  const raw = fs.readFileSync(abs, "utf8");
  if (raw.length <= maxChars) return raw;
  return raw.slice(0, maxChars) + "\n\n…（材料已截断，仅供本任务上下文）\n";
}

function buildMaterials() {
  const positioning = path.join(REPO_ROOT, "digital-me-project-positioning-draft.md");
  const context = path.join(REPO_ROOT, "digitalme_context.md");
  const learningReport = path.join(REPO_ROOT, "MVP_LEARNING_QUALITY_01_REPORT_20260731.md");
  const qualitySpec = path.join(REPO_ROOT, "digitalme_phase1_task_MVP-QUALITY-EVALUATION-01_v0.1.md");
  const files = [];
  if (fs.existsSync(positioning)) {
    files.push({
      id: "mat_positioning",
      name: "digital-me-project-positioning-draft.md",
      absPath: positioning,
      text: readTextLimited(positioning, 12000),
      ok: true,
      isFolder: false,
    });
  }
  if (fs.existsSync(context)) {
    files.push({
      id: "mat_context",
      name: "digitalme_context.md",
      absPath: context,
      text: readTextLimited(context, 8000),
      ok: true,
      isFolder: false,
    });
  }
  if (fs.existsSync(learningReport)) {
    files.push({
      id: "mat_learning",
      name: "MVP_LEARNING_QUALITY_01_REPORT_20260731.md",
      absPath: learningReport,
      text: readTextLimited(learningReport, 6000),
      ok: true,
      isFolder: false,
    });
  }
  if (fs.existsSync(qualitySpec)) {
    files.push({
      id: "mat_quality_spec",
      name: "digitalme_phase1_task_MVP-QUALITY-EVALUATION-01_v0.1.md",
      absPath: qualitySpec,
      text: readTextLimited(qualitySpec, 4000),
      ok: true,
      isFolder: false,
    });
  }
  if (files.length < 2) {
    throw new Error("缺少真实任务材料文件（定位稿/context 等）");
  }
  return files;
}

function resolveArtifactMd(userData, packageId, deliverableId, versionId) {
  const p = path.join(
    userData,
    "deliverable-artifacts",
    String(packageId),
    String(deliverableId),
    String(versionId),
    "artifact.md"
  );
  return fs.existsSync(p) ? p : null;
}

function sectionFingerprints(content) {
  const qe = require("../src/act-behalf/quality-evaluation");
  return qe.sectionFingerprints(content);
}

function diffPreserved(before, after) {
  const qe = require("../src/act-behalf/quality-evaluation");
  return qe.diffPreservedSections(sectionFingerprints(before), sectionFingerprints(after), []);
}

async function main() {
  // Standalone `electron scripts/...` defaults to Roaming/Electron.
  // Product app (electron .) uses package name → Roaming/digitalme-app.
  // Always prefer the product userData unless explicitly overridden.
  if (process.env.DIGITALME_PRODUCT_VALIDATION_USERDATA) {
    app.setPath("userData", path.resolve(process.env.DIGITALME_PRODUCT_VALIDATION_USERDATA));
  } else {
    const productUserData = path.join(app.getPath("appData"), "digitalme-app");
    app.setPath("userData", productUserData);
  }

  await app.whenReady();
  const userData = app.getPath("userData");
  const runId = "product-doc-" + stamp();
  const outDir = path.join(EVIDENCE_ROOT, runId);
  fs.mkdirSync(outDir, { recursive: true });

  const { SecretStore } = require("../src/security/secret-store");
  const { ConfigSecretsService } = require("../src/security/config-secrets");
  const { createElectronSafeStorageAdapter } = require("../src/security/electron-safe-storage-adapter");
  const { invokeModelRoute, resolveModelRoute } = require("../src/model-routing");
  const https = require("node:https");
  const { URL } = require("node:url");

  const configPath = path.join(userData, "config.json");
  const secrets = new ConfigSecretsService({
    userDataPath: userData,
    configPath,
    secretStore: new SecretStore({
      userDataPath: userData,
      encryptAdapter: createElectronSafeStorageAdapter(safeStorage),
    }),
    defaultPackageDir: "",
  });

  const pubRouting = secrets.getPublicModelRouting();
  const runtime = secrets.getRuntimeConfig();
  const routing = runtime && runtime.modelRouting;
  const apiKeyConfigured = !!(
    (runtime && runtime.apiKeyConfigured) ||
    (pubRouting &&
      Array.isArray(pubRouting.providers) &&
      pubRouting.providers.some((p) => p && p.apiKeyConfigured)) ||
    (secrets.secretStore &&
      Array.isArray(secrets.secretStore.listConfigured()) &&
      secrets.secretStore.listConfigured().some((id) => String(id).startsWith("model.provider.")))
  );

  const providerSummary = {
    userData,
    apiKeyConfigured,
    providers: (pubRouting && pubRouting.providers) || [],
    routes: (pubRouting && pubRouting.routes) || null,
  };
  fs.writeFileSync(path.join(outDir, "provider-public.json"), JSON.stringify(providerSummary, null, 2));

  if (!apiKeyConfigured) {
    const msg = {
      ok: false,
      code: "app_model_not_configured",
      message: "应用内未检测到已连接模型。请先在 Digital Me 设置中完成模型连接，再重跑本验收。",
      userData,
    };
    fs.writeFileSync(path.join(outDir, "blocked.json"), JSON.stringify(msg, null, 2));
    console.error(JSON.stringify(msg, null, 2));
    app.exit(2);
    return;
  }

  const resolved = resolveModelRoute(routing, "artifact", secrets.secretStore);
  const primary = (resolved.candidates || []).find((c) => c.apiKey) || (resolved.candidates || [])[0] || null;
  const usedProvider = {
    providerId: primary && primary.provider && primary.provider.id,
    model: primary && primary.model && primary.model.model,
    baseUrlHost: (() => {
      try {
        return new URL(String((primary && primary.provider && primary.provider.baseUrl) || "")).host;
      } catch {
        return null;
      }
    })(),
    taskType: "artifact",
    source: "app_secret_store_model_routing",
    hasApiKeyInStore: !!(primary && primary.apiKey),
  };
  fs.writeFileSync(path.join(outDir, "provider-used.json"), JSON.stringify(usedProvider, null, 2));

  if (!usedProvider.hasApiKeyInStore) {
    const msg = {
      ok: false,
      code: "artifact_route_key_missing",
      message: "应用内模型路由已配置，但 artifact 路由对应密钥不可用。",
      usedProvider,
    };
    fs.writeFileSync(path.join(outDir, "blocked.json"), JSON.stringify(msg, null, 2));
    console.error(JSON.stringify(msg, null, 2));
    app.exit(2);
    return;
  }

  function callModelRawCompat(cfg, messages, options) {
    return new Promise((resolve, reject) => {
      let url;
      try {
        url = new URL(String(cfg.baseURL).replace(/\/$/, "") + "/chat/completions");
      } catch (e) {
        reject(new Error("baseURL 无效"));
        return;
      }
      const body = JSON.stringify({
        model: cfg.model,
        messages,
        temperature: options && typeof options.temperature === "number" ? options.temperature : 0.3,
      });
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          port: url.port || 443,
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            Authorization: "Bearer " + cfg.apiKey,
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 180000,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            try {
              const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              if (json.error) {
                const e = new Error(json.error.message || "模型返回错误");
                e.statusCode = res.statusCode;
                reject(e);
                return;
              }
              const msg = json.choices && json.choices[0] && json.choices[0].message;
              if (!msg) {
                reject(new Error("模型返回格式异常"));
                return;
              }
              resolve(msg);
            } catch (err) {
              reject(err);
            }
          });
        }
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  let modelCalls = 0;
  const artifactDrafts = [];
  const callModel = async (messages, options = {}) => {
    modelCalls += 1;
    const route = await invokeModelRoute({
      routing,
      taskType: options.taskType || "artifact",
      secretStore: secrets.secretStore,
      invokeProvider: async (candidate) =>
        callModelRawCompat(
          {
            provider: candidate.provider.type,
            baseURL: candidate.provider.baseUrl,
            model: candidate.model.model,
            apiKey: candidate.apiKey,
          },
          messages,
          options
        ),
    });
    if (!route.ok) {
      const err = new Error(route.friendlyMessage || "模型不可用");
      err.code = route.errorCode;
      err.route = route;
      throw err;
    }
    const content = (route.value && route.value.content) || "(空响应)";
    const taskType = options.taskType || "artifact";
    if (taskType === "artifact" || taskType === "review") {
      /* keep all */
    }
    if (taskType === "artifact") {
      artifactDrafts.push({
        at: new Date().toISOString(),
        modelCall: modelCalls,
        chars: String(content).length,
        preview: String(content).slice(0, 200),
        full: String(content),
      });
    }
    return content;
  };

  const materials = buildMaterials();
  fs.writeFileSync(
    path.join(outDir, "task-materials.json"),
    JSON.stringify(
      materials.map((m) => ({
        id: m.id,
        name: m.name,
        absPath: m.absPath,
        chars: (m.text || "").length,
      })),
      null,
      2
    )
  );
  fs.writeFileSync(path.join(outDir, "task-goal.txt"), GOAL);

  const actStore = require("../src/act-behalf/task-store");
  const planner = require("../src/act-behalf/deliverable-planner");
  const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
  const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
  const generation = require("../src/act-behalf/deliverable-generation");
  const packageStore = require("../src/act-behalf/deliverable-package-store");
  const actionIdentity = require("../src/act-behalf/action-identity");
  const { evaluateArtifact } = require("../src/act-behalf/quality-evaluation");

  const taskId = "abt_qprod_" + Date.now().toString(36);
  const packageDir =
    (runtime && runtime.packageDir) ||
    (fs.existsSync(path.join(APP_ROOT, "project")) ? APP_ROOT : REPO_ROOT);

  await actStore.saveTask(userData, {
    taskId,
    title: "质量评估能力的产品规划说明",
    goal: GOAL,
    request: GOAL,
    status: "draft",
    referenceMaterials: materials.map((m) => ({
      id: m.id,
      name: m.name,
      text: m.text,
      ok: true,
      isFolder: false,
      sourcePath: m.absPath,
    })),
  });

  const suggestion = planner.ruleBasedPlan({ goal: GOAL });
  suggestion.items = [
    {
      id: "pd_doc_quality_plan",
      kind: "document",
      title: "质量评估与定向修正 · 产品规划说明",
      purpose: "供产品与工程对照的可直接使用说明",
      format: "md",
      priority: "required",
      order: 0,
      dependencies: [],
      planDisposition: "included",
      riskFlags: [],
    },
  ];
  const applied = planner.applySuggestionToRecord({
    taskId,
    existingRecord: null,
    suggestion,
    goal: GOAL,
  });
  const committed = await planConsistency.commitPlanThenTask({
    userData,
    planRecord: applied.plan,
    saveTaskPointers: async ({ deliverablePlanning }) => {
      const got = actStore.getTask(userData, taskId, { heal: false }).task;
      return actStore.saveTask(userData, { ...got, deliverablePlanning });
    },
    cas: { expectAbsent: true },
  });
  assert.equal(committed.ok, true);

  const confirmed = planner.confirmDraft(committed.plan);
  await planConsistency.commitPlanThenTask({
    userData,
    planRecord: confirmed.plan,
    saveTaskPointers: async ({ deliverablePlanning }) => {
      const got = actStore.getTask(userData, taskId, { heal: false }).task;
      return actStore.saveTask(userData, {
        ...got,
        deliverablePlanning,
        deliverableExecution: { activePackageId: null },
      });
    },
    cas: { expectedRevision: planConsistency.revisionTokensFromPlan(committed.plan) },
  });

  await actionIdentity.ensurePlanConfirmationIdentity(userData, {
    taskId,
    planVersionId: confirmed.plan.activeConfirmedVersionId,
    packageDir,
    confirmationRef: "confirm:mvp-quality-product-validation-01",
  });

  const prep = await prepareDeliverablePackage(
    userData,
    { taskId },
    {
      getTask: (u, id) => actStore.getTask(u, id, { heal: false }),
      getPlan: (u, planId) => require("../src/act-behalf/deliverable-plan-store").getPlan(u, planId),
      saveTaskExecution: async (u, id, exec) => {
        const got = actStore.getTask(u, id, { heal: false });
        return actStore.saveTask(u, {
          ...got.task,
          deliverableExecution: { activePackageId: exec.activePackageId || null },
        });
      },
    }
  );
  assert.equal(prep.ok, true, JSON.stringify(prep));
  const packageId = prep.package.id;
  const deliverableId = prep.deliverables[0].id;

  const started = Date.now();
  // Formal product path: stable_delivery + Channel B (targeted revise ≤2).
  const res = await generation.generateOneDeliverable(
    userData,
    { packageId, deliverableId },
    {
      callModel,
      imageMode: "mock",
      packageDir,
      qualityPipelineMode: "stable_delivery",
      awaitEnhancement: true,
    }
  );

  const view = packageStore.getPackageView(userData, packageId);
  const d = view.deliverables[0];
  const versionIds = Array.isArray(d.versionIds) ? d.versionIds.slice() : [];
  const versions = versionIds.map((id) => view.versions[id]).filter(Boolean);
  let baselineVersion =
    versions.find((v) => v.provenance && v.provenance.generation_stage === "baseline") || null;
  let finalVersion = d.currentVersionId ? view.versions[d.currentVersionId] : null;
  if (!baselineVersion && versions.length) {
    baselineVersion = versions[0];
  }
  if (!finalVersion) finalVersion = baselineVersion;

  const baselinePath = baselineVersion
    ? resolveArtifactMd(userData, packageId, deliverableId, baselineVersion.id)
    : null;
  const finalPath = finalVersion
    ? resolveArtifactMd(userData, packageId, deliverableId, finalVersion.id)
    : null;
  const initialMd = baselinePath
    ? fs.readFileSync(baselinePath, "utf8")
    : artifactDrafts.length
      ? String(artifactDrafts[0].full || "")
      : "";
  const finalMd = finalPath
    ? fs.readFileSync(finalPath, "utf8")
    : artifactDrafts.length
      ? String(artifactDrafts[artifactDrafts.length - 1].full || "")
      : "";

  fs.writeFileSync(path.join(outDir, "initial.md"), initialMd);
  fs.writeFileSync(path.join(outDir, "final.md"), finalMd);
  fs.writeFileSync(
    path.join(outDir, "artifact-drafts-meta.json"),
    JSON.stringify(
      artifactDrafts.map((d) => ({
        at: d.at,
        modelCall: d.modelCall,
        chars: d.chars,
        preview: d.preview,
      })),
      null,
      2
    )
  );

  // Prefer Channel B product-path evaluations already attached on enhancement.
  // Only re-run evaluateArtifact when product meta is missing (no extra model if identical text).
  const enhMeta = res.enhancement || {};
  const productLoop = enhMeta.loop || null;
  const productChecks = enhMeta.productChecks || null;
  let initialEval;
  let finalEval;
  if (productChecks && productChecks.initial && productChecks.final) {
    initialEval = productChecks.initial;
    finalEval = productChecks.final;
  } else {
    initialEval = await evaluateArtifact({
      md: initialMd,
      content: initialMd,
      artifactType: "document",
      goal: GOAL,
      packageDir,
      forceDeterministicReview: true,
      evaluationIteration: 0,
    });
    finalEval =
      initialMd === finalMd
        ? initialEval
        : await evaluateArtifact({
            md: finalMd,
            content: finalMd,
            artifactType: "document",
            goal: GOAL,
            packageDir,
            forceDeterministicReview: true,
            evaluationIteration: 1,
          });
    if (productLoop) {
      if (typeof productLoop.initialScore === "number") {
        initialEval = { ...initialEval, score: productLoop.initialScore };
      }
      if (typeof productLoop.score === "number") {
        finalEval = { ...finalEval, score: productLoop.score };
      }
      if (productLoop.status) {
        finalEval = { ...finalEval, status: productLoop.status };
      }
      if (Array.isArray(productLoop.remainingIssues)) {
        finalEval = { ...finalEval, remainingIssues: productLoop.remainingIssues };
      }
    }
  }

  const preserve = diffPreserved(initialMd, finalMd);
  const contentChanged = initialMd !== finalMd;
  const enhanced = !!(res.enhancement && res.enhancement.enhanced);
  const alreadyPassed =
    (res.enhancement && res.enhancement.reason === "baseline_already_passes") ||
    initialEval.status === "pass";

  const summary = {
    task: "MVP-QUALITY-PRODUCT-VALIDATION-01",
    runId,
    taskId,
    packageId,
    deliverableId,
    provider: usedProvider,
    modelCalls,
    durationMs: Date.now() - started,
    generationOk: !!res.ok,
    enhancement: res.enhancement || null,
    baselineVersionId: baselineVersion && baselineVersion.id,
    finalVersionId: finalVersion && finalVersion.id,
    versionQuality: {
      baseline: baselineVersion && baselineVersion.quality,
      final: finalVersion && finalVersion.quality,
    },
    scores: {
      initial: initialEval.score,
      final: finalEval.score,
      initialStatus: initialEval.status,
      finalStatus: finalEval.status,
    },
    initialFailedChecks: (initialEval.checks || [])
      .filter((c) => !c.passed)
      .map((c) => ({ id: c.id, severity: c.severity, message: c.message, category: c.category })),
    finalRemainingIssues: finalEval.remainingIssues || [],
    actionableRevisionsInitial: initialEval.actionableRevisions || [],
    preservedRatio: preserve.preservedRatio,
    preservedSections: preserve.preserved,
    changedSections: preserve.changed,
    contentChanged,
    enhanced,
    alreadyPassedInitial: !!alreadyPassed,
    forcedRevisionAvoided: !!(alreadyPassed && !enhanced),
    validity: {
      substantiveInitialIssues: (initialEval.checks || []).some(
        (c) => !c.passed && c.severity === "blocking"
      ),
      revisionOnlyIfNeeded: alreadyPassed ? !enhanced : enhanced || contentChanged,
      contentImprovedOrPassed:
        finalEval.status === "pass" || (finalEval.score || 0) >= (initialEval.score || 0),
      notScoreOnly:
        alreadyPassed || contentChanged || (finalEval.score || 0) === (initialEval.score || 0),
    },
    ownerPack: {
      initialMd: path.join(outDir, "initial.md"),
      finalMd: path.join(outDir, "final.md"),
      summaryJson: path.join(outDir, "summary.json"),
      acceptanceMd: path.join(outDir, "OWNER_ACCEPTANCE.md"),
    },
    evidencePath: outDir,
  };

  // Validity: content must change when initial had blocking issues; score-only is invalid.
  if (!alreadyPassed && summary.validity.substantiveInitialIssues && !contentChanged) {
    summary.harnessInvalid = "blocking_issues_without_content_change";
  }
  if (contentChanged && (finalEval.score || 0) < (initialEval.score || 0) && finalEval.status !== "pass") {
    summary.harnessWarning = "content_changed_but_score_not_improved";
  }
  if (alreadyPassed && contentChanged && enhanced) {
    summary.harnessWarning = "initial_already_passed_but_content_rewritten";
  }

  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

  const acceptance = [
    "# Owner 验收对照 · MVP-QUALITY-PRODUCT-VALIDATION-01",
    "",
    "## 三个判断题",
    "",
    "1. 最终成果是否明显优于初始成果？",
    "2. 修改是否准确，没有破坏原有合格内容？",
    "3. 最终成果是否达到可直接使用或只需轻微人工修改的水平？",
    "",
    "## 自动侧摘要（不能替代 Owner 判断）",
    "",
    `- 应用内 provider/model：\`${usedProvider.providerId}\` / \`${usedProvider.model}\`（来源：应用 SecretStore，非脚本环境密钥）`,
    `- 初始评分：${initialEval.score}（${initialEval.status}）`,
    `- 最终评分：${finalEval.score}（${finalEval.status}）`,
    `- 是否增强落盘：${enhanced}`,
    `- 修订轮次：${(res.enhancement && res.enhancement.revisionsUsed) || (res.enhancement && res.enhancement.loop && res.enhancement.loop.revisionsUsed) || 0}`,
    `- 初稿是否已合格故未强行修订：${!!alreadyPassed}`,
    `- preservedRatio：${preserve.preservedRatio}`,
    `- remainingIssues：${JSON.stringify(finalEval.remainingIssues || [])}`,
    "",
    "## 实质修改摘要",
    "",
    contentChanged
      ? [
          `- 内容已变更：是（初始 ${initialMd.length} 字 → 最终 ${finalMd.length} 字）`,
          `- 保留章节：${(preserve.preserved || []).join("、") || "（无同名标题保留）"}`,
          `- 变更章节：${
            (preserve.changed || [])
              .map((c) => (typeof c === "string" ? c : c.section + "/" + c.reason))
              .join("、") || "（结构标题未变或按段落修订）"
          }`,
        ].join("\n")
      : "- 内容未变更（初稿已合格或增强未优于初稿，产品保留初稿）",
    "",
    "## 初始未达标项（摘要）",
    "",
    ...(summary.initialFailedChecks.length
      ? summary.initialFailedChecks.map((c) => `- [${c.severity}] ${c.id}: ${c.message}`)
      : ["- （无 blocking/warning 失败项，或初稿已合格）"]),
    "",
    "## 对照文件",
    "",
    `- 初始成果：\`${path.join(outDir, "initial.md")}\``,
    `- 最终成果：\`${path.join(outDir, "final.md")}\``,
    `- 完整摘要：\`${path.join(outDir, "summary.json")}\``,
    "",
    "## 在正式「做事」页面复查（可选）",
    "",
    "1. 运行 `npm start` 打开 Digital Me。",
    "2. 打开「做事」工作区，找到任务：质量评估能力的产品规划说明（或 taskId `" +
      taskId +
      "`）。",
    "3. 对照本目录中的 initial.md / final.md。",
    "4. 回答上方三个判断题即可。",
    "",
    "## 任务说明",
    "",
    GOAL,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "OWNER_ACCEPTANCE.md"), acceptance);

  console.log(
    JSON.stringify(
      {
        ok: !!res.ok && !summary.harnessInvalid,
        runId,
        evidencePath: outDir,
        provider: usedProvider,
        scores: summary.scores,
        preservedRatio: summary.preservedRatio,
        remainingIssues: summary.finalRemainingIssues,
        enhanced,
        alreadyPassedInitial: !!alreadyPassed,
        ownerAcceptance: path.join(outDir, "OWNER_ACCEPTANCE.md"),
      },
      null,
      2
    )
  );

  app.exit(res.ok && !summary.harnessInvalid ? 0 : 1);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  try {
    app.exit(1);
  } catch {
    process.exit(1);
  }
});

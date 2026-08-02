"use strict";

/**
 * MVP-RELEASE-REGRESSION-02 — one path (A create | B import).
 *
 * Uses isolated userData + app SecretStore model cloned from product userData.
 * Does NOT read process.env API keys. Does NOT rebuild portable.
 *
 *   DIGITALME_REGRESSION_PATH=A|B npx electron scripts/electron-mvp-release-regression-02.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const assert = require("node:assert/strict");
const { URL } = require("node:url");

if (!process.versions.electron) {
  console.error("Must run under Electron");
  process.exit(1);
}

const FORBIDDEN_ENV = [
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "DASHSCOPE_API_KEY",
  "DIGITALME_ACT_BEHALF_FAKE",
  "DIGITALME_DVL2_03_MOCK_MODEL",
  "DIGITALME_FORCE_FAKE",
];
for (const k of FORBIDDEN_ENV) {
  if (process.env[k]) delete process.env[k];
}

const PATH_ID = String(process.env.DIGITALME_REGRESSION_PATH || "A").toUpperCase() === "B" ? "B" : "A";
const { app, safeStorage } = require("electron");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_ROOT = path.resolve(__dirname, "..");
const EVIDENCE_ROOT = path.join(__dirname, "_mvp-release-regression-02-evidence");

// Bind Electron userData to the real app profile BEFORE ready so SecretStore decrypt works.
{
  const productUdEarly = path.join(app.getPath("appData"), "digitalme-app");
  app.setPath("userData", productUdEarly);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function readTextLimited(abs, maxChars) {
  const raw = fs.readFileSync(abs, "utf8");
  if (raw.length <= maxChars) return raw;
  return raw.slice(0, maxChars) + "\n\n…（材料已截断）\n";
}

function materialFile(id, name, abs, maxChars, isFolder) {
  return {
    id,
    name,
    text: readTextLimited(abs, maxChars),
    ok: true,
    isFolder: !!isFolder,
    sourcePath: abs,
    fileCount: isFolder ? 3 : undefined,
  };
}

function buildMaterialsA() {
  const out = [];
  const positioning = path.join(REPO_ROOT, "digital-me-project-positioning-draft.md");
  const context = path.join(REPO_ROOT, "digitalme_context.md");
  const learning = path.join(REPO_ROOT, "MVP_LEARNING_QUALITY_01_REPORT_20260731.md");
  if (fs.existsSync(positioning)) out.push(materialFile("f_pos", "digital-me-project-positioning-draft.md", positioning, 10000, false));
  if (fs.existsSync(context)) out.push(materialFile("f_ctx", "digitalme_context.md", context, 7000, false));
  if (fs.existsSync(learning)) out.push(materialFile("f_learn", "学习质量报告文件夹", learning, 5000, true));
  return out;
}

function buildMaterialsB() {
  const out = [];
  const report = path.join(REPO_ROOT, "MVP_QUALITY_PRODUCT_VALIDATION_01_REPORT_20260802.md");
  const designDir = path.join(REPO_ROOT, "docs", "design");
  const principles = path.join(designDir, "digitalme_mvp_value_chain_operating_principles_v0.1_20260730.md");
  if (fs.existsSync(report)) out.push(materialFile("b_rep", "MVP_QUALITY_PRODUCT_VALIDATION_01_REPORT_20260802.md", report, 8000, false));
  if (fs.existsSync(principles)) {
    out.push(materialFile("b_folder", "docs/design（文件夹上下文）", principles, 8000, true));
  } else if (fs.existsSync(designDir)) {
    const first = fs.readdirSync(designDir).find((n) => n.endsWith(".md"));
    if (first) out.push(materialFile("b_folder", "docs/design", path.join(designDir, first), 8000, true));
  }
  return out;
}

const GOAL_A =
  "根据所附材料，写一份 800 至 1100 字的 Markdown 产品进展说明，说明 Digital Me 当前如何通过「做事」主路径完成成果生成、质量评估与采用回流。" +
  "结构必须包含：背景、当前能力、工作方式、明确边界、下一步。" +
  "表达要求：中性明白，面向产品使用者。" +
  "边界：不得宣称视频或音频成品已支持；不得写成公网协作已上线；不得把尚未验证的能力写成已完成。";

const GOAL_B =
  "根据所附文件与文件夹材料，写一份 700 至 1000 字的 Markdown 工作备忘，说明质量评估闭环在发布回归中应核对哪些用户可见结果。" +
  "结构必须包含：回归目的、核对清单、风险关注、明确边界、建议动作。" +
  "表达要求：短句、可执行、少空话。" +
  "边界：不得宣称 portable 本轮已重建；不得写内部评估提示词；不得把实验能力写成正式上线。";

function callModelRawCompat(cfg, messages, options) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(String(cfg.baseURL).replace(/\/$/, "") + "/chat/completions");
    } catch {
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

async function main() {
  await app.whenReady();
  const runId = `path-${PATH_ID}-${stamp()}`;
  const outDir = path.join(EVIDENCE_ROOT, runId);
  fs.mkdirSync(outDir, { recursive: true });

  const { SecretStore } = require("../src/security/secret-store");
  const { ConfigSecretsService } = require("../src/security/config-secrets");
  const { createElectronSafeStorageAdapter } = require("../src/security/electron-safe-storage-adapter");
  const { invokeModelRoute, resolveModelRoute } = require("../src/model-routing");
  const lifecycle = require("../src/digital-me-lifecycle");
  const encryptAdapter = createElectronSafeStorageAdapter(safeStorage);

  // Keep Electron userData on the real app profile so SecretStore decrypt works.
  // Act-behalf stores use a separate isolated directory (not the live Owner config).
  const productUd = path.join(app.getPath("appData"), "digitalme-app");
  const storeUd = fs.mkdtempSync(path.join(os.tmpdir(), `dm-reg02-store-${PATH_ID.toLowerCase()}-`));
  fs.writeFileSync(
    path.join(outDir, "paths.json"),
    JSON.stringify({ productUd, storeUd, electronUserData: app.getPath("userData") }, null, 2)
  );

  const productSecrets = new ConfigSecretsService({
    userDataPath: productUd,
    configPath: path.join(productUd, "config.json"),
    secretStore: new SecretStore({ userDataPath: productUd, encryptAdapter }),
    defaultPackageDir: "",
  });
  const productRuntime = productSecrets.getRuntimeConfig();
  const routing = (productRuntime && productRuntime.modelRouting) || null;
  const modelSecretStore = productSecrets.secretStore;
  const resolved = resolveModelRoute(routing, "artifact", modelSecretStore);
  const primary = (resolved.candidates || []).find((c) => c.apiKey) || null;
  const usedProvider = {
    providerId: primary && primary.provider && primary.provider.id,
    model: primary && primary.model && primary.model.model,
    source: "app_secret_store_model_routing",
    hasApiKeyInStore: !!(primary && primary.apiKey),
  };
  fs.writeFileSync(path.join(outDir, "provider-used.json"), JSON.stringify(usedProvider, null, 2));
  if (!usedProvider.hasApiKeyInStore) {
    const msg = {
      ok: false,
      code: "app_model_not_configured",
      path: PATH_ID,
      message: "应用内未检测到已连接模型（SecretStore）。请先在正式应用中完成模型连接。",
    };
    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(msg, null, 2));
    console.error(JSON.stringify(msg, null, 2));
    app.exit(2);
    return;
  }

  const userData = storeUd;

  let packageDir;
  let createOrImport;
  if (PATH_ID === "A") {
    const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dm-reg02-docs-a-"));
    const created = lifecycle.createDigitalMePackage({
      documentsRoot: docsRoot,
      displayName: "发布回归创建主体",
      roleSummary: "用于 MVP-RELEASE-REGRESSION-02 创建路径",
    });
    packageDir = created.packageDir;
    createOrImport = { mode: "create", packageDir, copied: null, docsRoot };
  } else {
    const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dm-reg02-docs-b-src-"));
    const source = lifecycle.createDigitalMePackage({
      documentsRoot: docsRoot,
      displayName: "发布回归导入源",
      roleSummary: "用于 MVP-RELEASE-REGRESSION-02 导入路径",
    });
    const inspected = lifecycle.inspectImportCandidate(source.packageDir);
    assert.equal(inspected.ok, true, "import candidate valid");
    // Import = reference activation (no copy), mirrored by isolating storeUd + pointing packageDir.
    packageDir = source.packageDir;
    createOrImport = {
      mode: "import",
      packageDir,
      copied: false,
      inspectedOk: !!(inspected && inspected.ok),
      inspectedStatus: inspected.status,
      sourcePackageDir: source.packageDir,
    };
  }
  fs.writeFileSync(
    path.join(userData, "config.json"),
    JSON.stringify({ packageDir, regressionPath: PATH_ID }, null, 2)
  );
  fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify(createOrImport, null, 2));

  const goal = PATH_ID === "A" ? GOAL_A : GOAL_B;
  const materials = PATH_ID === "A" ? buildMaterialsA() : buildMaterialsB();
  assert.ok(materials.length >= 2, "need file + folder-like materials");
  assert.ok(materials.some((m) => m.isFolder), "need folder material");
  assert.ok(materials.some((m) => !m.isFolder), "need file material");
  fs.writeFileSync(path.join(outDir, "goal.txt"), goal);
  fs.writeFileSync(
    path.join(outDir, "materials.json"),
    JSON.stringify(materials.map((m) => ({ id: m.id, name: m.name, isFolder: !!m.isFolder, chars: (m.text || "").length })), null, 2)
  );

  let modelCalls = 0;
  const callModel = async (messages, options = {}) => {
    modelCalls += 1;
    const route = await invokeModelRoute({
      routing,
      taskType: options.taskType || "artifact",
      secretStore: modelSecretStore,
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
      throw err;
    }
    return (route.value && route.value.content) || "(空响应)";
  };

  const actStore = require("../src/act-behalf/task-store");
  const planner = require("../src/act-behalf/deliverable-planner");
  const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
  const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
  const generation = require("../src/act-behalf/deliverable-generation");
  const packageStore = require("../src/act-behalf/deliverable-package-store");
  const actionIdentity = require("../src/act-behalf/action-identity");
  const autoLearn = require("../src/act-behalf/deliverable-auto-learn");
  const artifactOpen = require("../src/act-behalf/deliverable-artifact-open");
  const {
    runStartupInterruptRecovery,
    healInterruptedGeneration,
  } = require("../src/act-behalf/runtime-interrupt-heal");
  const { stripInternalRevisionResidue } = require("../src/act-behalf/document-section-revise");

  const taskId = `abt_reg02_${PATH_ID.toLowerCase()}_` + Date.now().toString(36);
  await actStore.saveTask(userData, {
    taskId,
    title: PATH_ID === "A" ? "发布回归·产品进展说明" : "发布回归·质量核对备忘",
    goal,
    request: goal,
    status: "draft",
    referenceMaterials: materials,
  });

  const suggestion = planner.ruleBasedPlan({ goal });
  suggestion.items = [
    {
      id: "reg02_doc",
      kind: "document",
      title: PATH_ID === "A" ? "产品进展说明" : "质量核对备忘",
      purpose: "发布回归真实文档成果",
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
    goal,
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
    confirmationRef: "confirm:mvp-release-regression-02",
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

  const genStarted = Date.now();
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
  assert.equal(res.ok, true, "generation failed: " + JSON.stringify(res && { code: res.code, message: res.message }));

  const view = packageStore.getPackageView(userData, packageId);
  const d = view.deliverables[0];
  const versionId = d.currentVersionId;
  assert.ok(versionId, "currentVersionId");
  const version = view.versions[versionId];
  const artifactId =
    (version.artifactRef && version.artifactRef.id) ||
    (Array.isArray(version.artifactRefs) && version.artifactRefs[0] && version.artifactRefs[0].id);
  assert.ok(artifactId, "artifactId");

  const openRes = artifactOpen.resolveOpenableArtifact(userData, {
    artifactId,
    versionId,
    deliverableId,
    taskId,
  });
  assert.equal(openRes.ok, true, "open resolve: " + JSON.stringify(openRes));
  assert.ok(fs.existsSync(openRes.abs), "artifact file missing: " + openRes.abs);
  const body = fs.readFileSync(openRes.abs, "utf8");
  assert.ok(body.trim().length > 200, "artifact too short");
  assert.ok(!/修订方向[：:]|仅修复「|不得仅删除错误句子/.test(body), "internal residue leaked");
  const cleaned = stripInternalRevisionResidue(body);
  assert.ok(cleaned.trim().length > 100);

  const reviewed = await generation.reviewDeliverableVersion(userData, {
    versionId,
    decision: "accepted",
    packageDir,
  });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));

  const enq = await autoLearn.enqueueAfterAccept(userData, versionId, {
    packageDir,
    sync: true,
  });
  assert.equal(enq.ok, true, "learn enqueue: " + JSON.stringify(enq && { code: enq.code, message: enq.message }));
  const learnStatus = enq.job && enq.job.status;
  assert.ok(
    learnStatus === "committed" ||
      learnStatus === "completed" ||
      learnStatus === "pending_conflict" ||
      learnStatus === "queued",
    "learn status=" + learnStatus
  );
  // Accept must never roll back because of learn conflict/pending.
  packageStore.invalidateStoreCache();
  assert.equal(
    packageStore.getPackageView(userData, packageId).versions[versionId].reviewStatus,
    "accepted",
    "accept preserved after learn"
  );

  // Simulate stuck generating attempt then heal (startup recovery).
  const interruptAttemptId = "gatt_reg02_interrupt_" + Date.now().toString(36);
  await packageStore.mutateStore(userData, (s) => {
    const del = s.deliverables[deliverableId];
    if (!del) return false;
    del.generationStatus = "generating";
    del.latestGenerationAttemptId = interruptAttemptId;
    del.updatedAt = new Date().toISOString();
    s.generationAttempts = s.generationAttempts || {};
    s.generationAttempts[interruptAttemptId] = {
      id: interruptAttemptId,
      packageId,
      deliverableId,
      status: "generating",
      producedVersionId: versionId,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    return true;
  });
  const heal = await runStartupInterruptRecovery(userData, {});
  packageStore.invalidateStoreCache();
  const viewAfterHeal = packageStore.getPackageView(userData, packageId);
  const delAfter = viewAfterHeal.deliverables[0];
  assert.notEqual(delAfter.generationStatus, "generating", "must not stay generating");
  assert.equal(viewAfterHeal.versions[versionId].reviewStatus, "accepted", "accept preserved across heal");

  // Soft restart: invalidate caches and reload.
  packageStore.invalidateStoreCache();
  actStore.invalidateStoreCache();
  const taskReload = actStore.getTask(userData, taskId, { heal: true });
  const viewReload = packageStore.getPackageView(userData, packageId);
  assert.ok(taskReload && taskReload.task, "task restore");
  assert.equal(viewReload.versions[versionId].reviewStatus, "accepted");
  assert.ok(fs.existsSync(openRes.abs), "artifact still on disk after restore");

  const cfgReload = JSON.parse(fs.readFileSync(path.join(userData, "config.json"), "utf8"));
  assert.equal(path.resolve(cfgReload.packageDir), path.resolve(packageDir), "packageDir restored");

  const summary = {
    ok: true,
    path: PATH_ID,
    runId,
    userData,
    packageDir,
    createOrImport,
    provider: usedProvider,
    taskId,
    packageId,
    deliverableId,
    versionId,
    artifactId,
    generationOk: !!res.ok,
    enhancement: res.enhancement || null,
    generationMs: Date.now() - genStarted,
    modelCalls,
    open: { ok: openRes.ok, absExists: fs.existsSync(openRes.abs), bytes: fs.statSync(openRes.abs).size },
    bodyChars: body.replace(/\s+/g, " ").trim().length,
    residueFree: !/修订方向[：:]|仅修复「|不得仅删除错误句子/.test(body),
    accept: { ok: reviewed.ok, reviewStatus: reviewed.reviewStatus },
    learn: {
      ok: enq.ok,
      status: enq.job && enq.job.status,
      changeSetId: enq.job && enq.job.commit && enq.job.commit.changeSetId,
    },
    heal: {
      generationStatusAfter: delAfter.generationStatus,
      acceptPreserved: viewAfterHeal.versions[versionId].reviewStatus === "accepted",
      healResult: heal && { ok: heal.ok, actions: heal.actions || heal.summary || null },
    },
    restart: {
      taskPresent: !!(taskReload && taskReload.task),
      acceptPreserved: viewReload.versions[versionId].reviewStatus === "accepted",
      packageDirMatch: path.resolve(cfgReload.packageDir) === path.resolve(packageDir),
      artifactPresent: fs.existsSync(openRes.abs),
    },
    evidencePath: outDir,
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outDir, "final-artifact.md"), body);
  console.log(JSON.stringify(summary, null, 2));
  app.exit(summary.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  try {
    app.exit(1);
  } catch {
    process.exit(1);
  }
});

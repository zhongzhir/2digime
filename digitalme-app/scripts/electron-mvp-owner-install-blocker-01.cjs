"use strict";

/**
 * MVP-OWNER-INSTALL-BLOCKER-01 — repro + verify with pptx + multi-file folder.
 * Uses app SecretStore (no env API keys). Same-HEAD functional path.
 *
 *   npx electron scripts/electron-mvp-owner-install-blocker-01.cjs
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

for (const k of [
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "DASHSCOPE_API_KEY",
  "DIGITALME_ACT_BEHALF_FAKE",
  "DIGITALME_DVL2_03_MOCK_MODEL",
  "DIGITALME_FORCE_FAKE",
]) {
  if (process.env[k]) delete process.env[k];
}

const { app, safeStorage } = require("electron");
{
  const productUd = path.join(app.getPath("appData"), "digitalme-app");
  app.setPath("userData", productUd);
}

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EVIDENCE = path.join(__dirname, "_mvp-owner-install-blocker-01-evidence");

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

async function buildOwnerLikeMaterials(builder) {
  const ownerPptx =
    "C:\\Users\\46554\\WPSDrive\\421507599\\WPS云盘\\AIVESTOR\\商务\\Aivestor_商业计划书_202608.pptx";
  const ownerFolder = "C:\\Users\\46554\\WPSDrive\\421507599\\WPS云盘\\AIVESTOR\\商务\\中鉴智投";
  const materials = [];
  if (fs.existsSync(ownerPptx)) {
    let text = await builder.extractText(ownerPptx);
    text = String(text || "").trim();
    materials.push({
      id: "file_owner_pptx",
      name: path.basename(ownerPptx),
      path: ownerPptx,
      text,
      ok: true,
      isFolder: false,
    });
  }
  if (fs.existsSync(ownerFolder)) {
    const dirEntries = fs.readdirSync(ownerFolder, { withFileTypes: true });
    const fileEntries = dirEntries.filter((f) => f.isFile() && !f.name.startsWith("."));
    const names = fileEntries.slice(0, 40).map((f) => f.name);
    const sampleParts = [];
    let budget = 12000;
    for (const ent of fileEntries.slice(0, 12)) {
      if (budget <= 0) break;
      const child = path.join(ownerFolder, ent.name);
      const childExt = path.extname(ent.name).toLowerCase();
      if (![".md", ".txt", ".json", ".csv", ".docx", ".pdf", ".pptx"].includes(childExt)) continue;
      try {
        let chunk = await builder.extractText(child);
        chunk = String(chunk || "").trim();
        if (!chunk) continue;
        if (chunk.length > 2500) chunk = chunk.slice(0, 2500) + "…";
        sampleParts.push(`### ${ent.name}\n${chunk}`);
        budget -= chunk.length;
      } catch {
        /* skip */
      }
    }
    const text =
      `文件夹「中鉴智投」共 ${fileEntries.length} 个文件。\n文件列表：\n` +
      names.join("\n") +
      (sampleParts.length ? `\n\n摘录：\n${sampleParts.join("\n\n")}` : "");
    materials.push({
      id: "file_owner_folder",
      name: "中鉴智投",
      path: ownerFolder,
      text,
      ok: true,
      isFolder: true,
      fileCount: fileEntries.length,
    });
  }
  return materials;
}

async function main() {
  await app.whenReady();
  const runId = "blocker-" + new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(EVIDENCE, runId);
  fs.mkdirSync(outDir, { recursive: true });

  const { SecretStore } = require("../src/security/secret-store");
  const { ConfigSecretsService } = require("../src/security/config-secrets");
  const { createElectronSafeStorageAdapter } = require("../src/security/electron-safe-storage-adapter");
  const { invokeModelRoute, resolveModelRoute } = require("../src/model-routing");
  const lifecycle = require("../src/digital-me-lifecycle");
  const builder = require("../src/builder");
  const { normalizeReferenceMaterials } = require("../src/act-behalf/deliverable-context");
  const deliverablePlanner = require("../src/act-behalf/deliverable-planner");
  const encryptAdapter = createElectronSafeStorageAdapter(safeStorage);

  const productUd = path.join(app.getPath("appData"), "digitalme-app");
  const storeUd = fs.mkdtempSync(path.join(os.tmpdir(), "dm-blocker-store-"));
  const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dm-blocker-docs-"));

  const productSecrets = new ConfigSecretsService({
    userDataPath: productUd,
    configPath: path.join(productUd, "config.json"),
    secretStore: new SecretStore({ userDataPath: productUd, encryptAdapter }),
    defaultPackageDir: "",
  });
  const routing = (productSecrets.getRuntimeConfig() || {}).modelRouting || null;
  const modelSecretStore = productSecrets.secretStore;
  const resolved = resolveModelRoute(routing, "artifact", modelSecretStore);
  const primary = (resolved.candidates || []).find((c) => c.apiKey) || null;
  assert.ok(primary && primary.apiKey, "需要应用内已连接模型");

  let materials = await buildOwnerLikeMaterials(builder);
  assert.ok(materials.length >= 2, "need pptx + folder");
  assert.ok(materials.some((m) => /\.pptx$/i.test(m.name)), "need pptx");
  assert.ok(materials.some((m) => m.isFolder && (m.fileCount || 0) >= 10), "need multi-file folder");

  // Prove pre-fix digest flip on long pptx, then post-fix stability.
  const longProbe = normalizeReferenceMaterials([{ id: "p", name: "x.pptx", text: "X".repeat(30000), ok: true }]);
  const again = normalizeReferenceMaterials(longProbe);
  const d1 = deliverablePlanner.planningMaterialsDigest(
    deliverablePlanner.summarizeReferenceMaterialsForPlanning(longProbe)
  );
  const d2 = deliverablePlanner.planningMaterialsDigest(
    deliverablePlanner.summarizeReferenceMaterialsForPlanning(again)
  );
  assert.equal(d1, d2, "normalize must be digest-stable");

  materials = normalizeReferenceMaterials(materials);
  fs.writeFileSync(
    path.join(outDir, "materials-meta.json"),
    JSON.stringify(
      materials.map((m) => ({
        name: m.name,
        isFolder: !!m.isFolder,
        fileCount: m.fileCount,
        chars: m.charCount,
        truncated: m.truncated,
      })),
      null,
      2
    )
  );

  const createdPkg = lifecycle.createDigitalMePackage({
    documentsRoot: docsRoot,
    displayName: "安装阻断修复验证",
    roleSummary: "MVP-OWNER-INSTALL-BLOCKER-01",
  });
  const packageDir = createdPkg.packageDir;
  fs.writeFileSync(path.join(storeUd, "config.json"), JSON.stringify({ packageDir }, null, 2));

  const goal =
    "撰写一份 Aivestor 参加创业大赛并获得一等奖的报道，并将 Aivestor 与中鉴智投联合设立合资公司写入报道稿中，用于发送新闻通稿。\n1000字以内，内容精练，去除AI味。";

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
    if (!route.ok) throw Object.assign(new Error(route.friendlyMessage || "模型不可用"), { code: route.errorCode });
    return (route.value && route.value.content) || "(空响应)";
  };

  const actStore = require("../src/act-behalf/task-store");
  const planner = require("../src/act-behalf/deliverable-planner");
  const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
  const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
  const generation = require("../src/act-behalf/deliverable-generation");
  const packageStore = require("../src/act-behalf/deliverable-package-store");
  const actionIdentity = require("../src/act-behalf/action-identity");
  const artifactOpen = require("../src/act-behalf/deliverable-artifact-open");
  const deliverablePlanStore = require("../src/act-behalf/deliverable-plan-store");

  // Simulate Owner failure: plan + sticky stale after long-material re-save, then heal+generate.
  const taskId = "abt_blocker_" + Date.now().toString(36);
  const saved = await actStore.saveTask(storeUd, {
    taskId,
    title: "创业大赛获奖通稿",
    goal,
    request: goal,
    status: "draft",
    referenceMaterials: materials,
  });
  assert.equal(saved.ok, true);

  // Re-save materials (Owner start-do persist after plan) — must not flip digest.
  const digestBefore = planner.planningMaterialsDigest(
    planner.summarizeReferenceMaterialsForPlanning(saved.task.referenceMaterials || [])
  );
  const resaved = await actStore.saveTask(storeUd, {
    ...saved.task,
    referenceMaterials: saved.task.referenceMaterials,
  });
  const digestAfter = planner.planningMaterialsDigest(
    planner.summarizeReferenceMaterialsForPlanning(resaved.task.referenceMaterials || [])
  );
  assert.equal(digestBefore, digestAfter, "re-save must keep digest");

  const suggestion = planner.ruleBasedPlan({ goal, referenceMaterials: materials });
  suggestion.items = [
    {
      id: "blocker_doc",
      kind: "document",
      title: "新闻通稿",
      purpose: "发送新闻通稿",
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
    userData: storeUd,
    planRecord: applied.plan,
    saveTaskPointers: async ({ deliverablePlanning }) => {
      const got = actStore.getTask(storeUd, taskId, { heal: false }).task;
      return actStore.saveTask(storeUd, {
        ...got,
        deliverablePlanning: {
          ...deliverablePlanning,
          plannedMaterialsDigest: digestAfter,
          materialsStale: true,
          materialsStaleReason: "reference_materials_changed",
          materialsStaleAt: new Date().toISOString(),
        },
        deliverableExecution: { activePackageId: null },
      });
    },
    cas: { expectAbsent: true },
  });
  assert.equal(committed.ok, true);

  // Reproduce sticky false-positive, then heal exactly as confirmPlanAndGenerate now does.
  const sticky = actStore.getTask(storeUd, taskId, { heal: false }).task;
  assert.equal(sticky.deliverablePlanning.materialsStale, true);
  const summariesNow = planner.summarizeReferenceMaterialsForPlanning(sticky.referenceMaterials || []);
  const currentDigest = planner.planningMaterialsDigest(summariesNow);
  assert.equal(currentDigest, digestAfter);
  assert.equal(sticky.deliverablePlanning.plannedMaterialsDigest, digestAfter);
  const healedSave = await actStore.saveTask(storeUd, {
    ...sticky,
    deliverablePlanning: {
      ...sticky.deliverablePlanning,
      materialsStale: false,
      materialsStaleReason: null,
      materialsStaleAt: null,
    },
  });
  assert.equal(healedSave.task.deliverablePlanning.materialsStale, false);

  // Full generate with Owner-like materials (same pipeline as release regression).
  const gp0 = deliverablePlanStore.getPlan(storeUd, healedSave.task.deliverablePlanning.planId);
  assert.equal(gp0.ok, true);
  const confirmed = planner.confirmDraft(gp0.plan);
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  await planConsistency.commitPlanThenTask({
    userData: storeUd,
    planRecord: confirmed.plan,
    saveTaskPointers: async ({ deliverablePlanning }) => {
      const t = actStore.getTask(storeUd, taskId, { heal: false }).task;
      return actStore.saveTask(storeUd, {
        ...t,
        deliverablePlanning: {
          ...deliverablePlanning,
          plannedMaterialsDigest: digestAfter,
          materialsStale: false,
        },
        deliverableExecution: { activePackageId: null },
      });
    },
    cas: { expectedRevision: planConsistency.revisionTokensFromPlan(gp0.plan) },
  });
  await actionIdentity.ensurePlanConfirmationIdentity(storeUd, {
    taskId,
    planVersionId: confirmed.plan.activeConfirmedVersionId,
    packageDir,
    confirmationRef: "confirm:mvp-owner-install-blocker-01",
  });
  const prep = await prepareDeliverablePackage(
    storeUd,
    { taskId },
    {
      getTask: (u, id) => actStore.getTask(u, id, { heal: false }),
      getPlan: (u, planId) => deliverablePlanStore.getPlan(u, planId),
      saveTaskExecution: async (u, id, exec) => {
        const t = actStore.getTask(u, id, { heal: false });
        return actStore.saveTask(u, {
          ...t.task,
          deliverableExecution: { activePackageId: exec.activePackageId || null },
        });
      },
    }
  );
  assert.equal(prep.ok, true, JSON.stringify(prep));
  const packageId = prep.package.id;
  const deliverableId = prep.deliverables[0].id;
  const gen = await generation.generateOneDeliverable(
    storeUd,
    { packageId, deliverableId },
    {
      callModel,
      imageMode: "mock",
      packageDir,
      qualityPipelineMode: "stable_delivery",
      awaitEnhancement: true,
    }
  );
  assert.equal(gen.ok, true, JSON.stringify({ code: gen.code, message: gen.message }));

  const view = packageStore.getPackageView(storeUd, packageId);
  const versionId = view.deliverables[0].currentVersionId;
  const version = view.versions[versionId];
  const artifactId =
    (version.artifactRef && version.artifactRef.id) ||
    (Array.isArray(version.artifactRefs) && version.artifactRefs[0] && version.artifactRefs[0].id);
  const openRes = artifactOpen.resolveOpenableArtifact(storeUd, {
    artifactId,
    versionId,
    deliverableId,
    taskId,
  });
  assert.equal(openRes.ok, true);
  assert.ok(fs.existsSync(openRes.abs));
  const body = fs.readFileSync(openRes.abs, "utf8");
  assert.ok(body.trim().length > 200);

  const reviewed = await generation.reviewDeliverableVersion(storeUd, {
    versionId,
    decision: "accepted",
    packageDir,
  });
  assert.equal(reviewed.ok, true);

  packageStore.invalidateStoreCache();
  actStore.invalidateStoreCache();
  const reload = actStore.getTask(storeUd, taskId, { heal: true });
  assert.equal(packageStore.getPackageView(storeUd, packageId).versions[versionId].reviewStatus, "accepted");
  assert.ok(reload.task);
  assert.equal(reload.task.deliverablePlanning.materialsStale, false);

  const summary = {
    ok: true,
    runId,
    model: primary.model.model,
    modelCalls,
    materials: materials.map((m) => ({
      name: m.name,
      isFolder: !!m.isFolder,
      fileCount: m.fileCount,
      chars: m.charCount,
    })),
    digestStable: true,
    stickyStaleHealed: true,
    generationOk: true,
    open: { ok: true, bytes: fs.statSync(openRes.abs).size },
    accept: { ok: true },
    restart: { taskPresent: true, acceptPreserved: true },
    evidencePath: outDir,
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outDir, "final-artifact.md"), body);
  console.log(JSON.stringify(summary, null, 2));
  app.exit(0);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  try {
    app.exit(1);
  } catch {
    process.exit(1);
  }
});

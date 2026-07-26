"use strict";

const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const https = require("node:https");
const builder = require("./builder");
const builderPackageWrite = require("./builder/package-write");
const lifePackageWrite = require("./life/package-write");
const materials = require("./materials");
const life = require("./life");
const policies = require("./policies");
const inbox = require("./inbox");
const retrieval = require("./retrieval");
const feedback = require("./feedback");
const { PackageStore, buildVersionPanelInfo } = require("./package-store");
const { buildSubjectOverviewV1 } = require("./subject-overview");
const { summarizeInboxForOverview } = require("./subject-overview/panorama");

const { createMinimalFixture } = require("./package-store/fixture");
const pptxOutput = require("./outputs/pptx");
const documentOutput = require("./outputs/document");
const library = require("./outputs/library");
const researchProjects = require("./research/projects");
const researchWebSearch = require("./research/web-search");
const researchAgentLoop = require("./research/agent-loop");
const researchGrounded = require("./research/grounded");
const personalSkills = require("./skills/personal");
const sessions = require("./sessions");
const actBehalfStore = require("./act-behalf/task-store");
const deliverablePlanStore = require("./act-behalf/deliverable-plan-store");
const deliverablePlanConsistency = require("./act-behalf/deliverable-plan-consistency");
const deliverablePlanner = require("./act-behalf/deliverable-planner");
const { recomputeExecutionReadiness } = require("./act-behalf/deliverable-plan-readiness");
const { validateDependencyGraph } = require("./act-behalf/deliverable-plan-schema");
const deliverablePackageStore = require("./act-behalf/deliverable-package-store");
const { prepareDeliverablePackage } = require("./act-behalf/deliverable-package-prepare");
const { recomputeCurrentPreparationReadiness } = require("./act-behalf/deliverable-package-readiness");
const { reconcileTaskPackages } = require("./act-behalf/deliverable-package-recovery");
const deliverableGeneration = require("./act-behalf/deliverable-generation");
const deliverableArtifactFs = require("./act-behalf/deliverable-artifact-fs");
const { confirmPlanAndGenerate } = require("./act-behalf/deliverable-confirm-and-generate");
const { parseActBehalfOutput, buildActBehalfMessages, parseEmailOutput, buildEmailMessages, parseVideoAudioOutput, buildVideoAudioMessages, buildVideoAudioExport } = require("./act-behalf/parse-output");
const { normalizeTaskIntent, assertTaskIntentMinimal, detectTaskType, TASK_TYPES } = require("./act-behalf/task-intent");
const {
  assembleSubjectContextCandidates,
  confirmSubjectContextWithUserActions,
  autoSelectCandidates,
} = require("./act-behalf/subject-context-assembly");
const {
  runReadonlyExternalResearch,
  ALLOWED_SKILL_ID,
  isResearchResultCurrent,
} = require("./act-behalf/research-run");
const {
  saveDraftFromRenderer,
  withAuthoritativeResearchFields,
} = require("./act-behalf/task-save-boundary");
const {
  generateResearchExpressionResult,
  saveResultDraftFromRenderer,
  decideResultFromRenderer,
  latestCurrentResult,
  isResultCurrent,
  requestEmailSend,
} = require("./act-behalf/result-generation");
const {
  createExperienceProposal,
  saveExperienceProposalReview,
  previewExperienceProposal,
  applyExperienceProposal,
  rejectExperienceProposal,
} = require("./act-behalf/experience-proposal");
const researchPresets = require("./skills/research-presets");
const chatMessages = require("./chat-message-model");
const catalog = require("./capabilities/catalog");
const capabilitySurface = require("./capabilities/surface");
const l0Orchestration = require("./orchestration/l0");
const l0Audit = require("./orchestration/audit-store");
const l0Agents = require("./orchestration/agents");
const externalAgentFlow = require("./orchestration/external-agent-flow");
const delegateRuntime = require("./orchestration/delegate-runtime");
const decisionAudit = require("./decision-audit");
const { SecretStore } = require("./security/secret-store");
const { createElectronSafeStorageAdapter } = require("./security/electron-safe-storage-adapter");
const { ConfigSecretsService, extensionSecretId } = require("./security/config-secrets");
const { invokeModelRoute, normalizeModelError } = require("./model-routing");
const distillMe = require("./distill-me");
const { assembleDoingContext, renderDoingContextForModel, appendAudit, readAudit: readDoingContextAudit } = require("./doing-context");
const { buildRuntimeStamp, stampIsPostOwnerFixes } = require("./runtime-stamp");
const sandboxPackageState = require("./sandbox-package-state");
const { createRendererEntryRuntime } = require("./renderer-entry-runtime");
const { createActiveRequestRegistry } = require("./r2/active-request");
const { createAttachmentTokenVault } = require("./r2/attachment-tokens");
const { loadOrCreateIdentity, signWithIdentity, verifyWithIdentity } = require("./identity");
const { loadRoleView, getCurrentRole, setCurrentRole, getRoleContext } = require("./identity/role-view");
const { issueCredential, verifyCredential, createPresentation } = require("./identity/vc");
const {
  presentCredential,
  revokeCredential,
  verifyCredentialStatus,
  listCredentials,
} = require("./identity/credential-flow");
const {
  createCollaboration,
  addInteraction,
  addDeliverable,
  approveDeliverable,
  addFeedback,
  confirmFeedbackWriteBack,
  revokeCollaboration,
  listCollaborations,
} = require("./collaboration");
const { createLegacyHandoff } = require("./r2/legacy-handoff");
const { createR2ChatLifecycle } = require("./r2/chat-lifecycle");

const r2ActiveRequest = createActiveRequestRegistry();
const r2AttachmentTokens = createAttachmentTokenVault();
r2AttachmentTokens.startSweeper(15_000);

app.on("will-quit", () => {
  try {
    r2AttachmentTokens.stopSweeper();
    r2AttachmentTokens.clearAll();
  } catch {
    /* ignore */
  }
});
const r2LegacyHandoff = createLegacyHandoff();

/** Set after r2Chat is constructed — used by R1 fallback path. */
let r2AbortOnFallback = async () => ({ ok: true, aborted: false });

const rendererEntryRuntime = createRendererEntryRuntime({
  readyTimeoutMs: Number(process.env.DIGITALME_R1_READY_TIMEOUT_MS || 8000),
  onBeforeFallback: async (failure) => r2AbortOnFallback(failure),
});

// Digital Me Package lives one level up from the app folder by default.
const DEFAULT_PACKAGE_DIR = path.join(__dirname, "..", "..", "digital-me-package");
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

let configSecrets = null;

function getConfigSecrets() {
  if (configSecrets) return configSecrets;
  const userDataPath = app.getPath("userData");
  const store = new SecretStore({
    userDataPath,
    encryptAdapter: createElectronSafeStorageAdapter(safeStorage),
  });
  configSecrets = new ConfigSecretsService({
    userDataPath,
    configPath: CONFIG_PATH,
    secretStore: store,
    defaultPackageDir: DEFAULT_PACKAGE_DIR,
  });
  return configSecrets;
}

function buildAppMenu() {
  const template = [
    {
      label: "文件",
      submenu: [{ role: "quit", label: "退出 Digital Me" }],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "重置缩放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "close", label: "关闭窗口" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于 Digital Me",
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: "关于 Digital Me",
              message: "Digital Me v0.1",
              detail: "本地优先 · 平台中立 · 可迁移的个人数字主体系统。",
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 1024,
    minHeight: 680,
    title: "Digital Me",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  rendererEntryRuntime.bindWindow(win);
  // R1: default remains legacy; next only via harness/dev gate inside runtime.
  void rendererEntryRuntime.applyInitialEntry().catch((err) => {
    console.error("[renderer-entry] initial load failed", err && err.stack ? err.stack : err);
  });
  if (process.argv.includes("--dev")) win.webContents.openDevTools();
  const senderId = String(win.webContents.id);
  const webContentsId = win.webContents.id;
  win.webContents.on("destroyed", () => {
    try {
      delegateRuntime.abortForSender(senderId);
    } catch {
      /* ignore */
    }
    try {
      rendererEntryRuntime.controller.clearReadyTimer();
    } catch {
      /* ignore */
    }
    try {
      r2AttachmentTokens.clearForWebContents(webContentsId);
    } catch {
      /* ignore */
    }
  });
}

app.whenReady().then(() => {
  buildAppMenu();
  const migration = getConfigSecrets().migrateLegacySecrets();
  if (migration && (migration.status === "blocked" || migration.status === "failed") && migration.warning) {
    const title =
      migration.code === "config_json_corrupt" ||
      migration.code === "config_permission_denied" ||
      migration.code === "config_read_failed" ||
      migration.code === "config_not_a_file"
        ? "配置文件无法安全读取"
        : migration.code === "plaintext_backup_cleanup_failed"
          ? "明文配置备份未能安全清除"
          : "密钥未能迁入本机安全存储";
    dialog.showMessageBox({
      type: "warning",
      title,
      message: title,
      detail: migration.warning,
    });
  }
  // Recover interrupted PackageStore journal only — never auto-migrate schema.
  tryRecoverConfiguredPackageStore();
  try {
    reconcileAllDeliverablePackagePointers(app.getPath("userData")).catch(() => {});
  } catch {
    /* ignore startup package reconcile failures */
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  if (process.env.DIGITALME_OWNER_RUNTIME_TEST === "1") {
    const harness =
      process.env.DIGITALME_BUG1_P1_5 === "1"
        ? require("../scripts/bug1-p1-5-acceptance-harness.cjs")
        : process.env.DIGITALME_BUG1_P1_4 === "1"
        ? require("../scripts/bug1-p1-4-acceptance-harness.cjs")
        : process.env.DIGITALME_BUG1_P1_3 === "1"
        ? require("../scripts/bug1-p1-3-acceptance-harness.cjs")
        : process.env.DIGITALME_BUG1_P1_2 === "1"
        ? require("../scripts/bug1-p1-2-acceptance-harness.cjs")
        : process.env.DIGITALME_BUG1_P1_1 === "1"
        ? require("../scripts/bug1-p1-1-acceptance-harness.cjs")
        : process.env.DIGITALME_BUG1_P0_3 === "1"
        ? require("../scripts/bug1-p0-3-acceptance-harness.cjs")
        : process.env.DIGITALME_BUG1_P0_2 === "1"
        ? require("../scripts/bug1-p0-2-acceptance-harness.cjs")
        : process.env.DIGITALME_BUG1_P0_1 === "1"
        ? require("../scripts/bug1-p0-1-acceptance-harness.cjs")
        : process.env.DIGITALME_DOING_CONTEXT_ACCEPTANCE === "1"
        ? require("../scripts/doing-context-acceptance-harness.cjs")
        : process.env.DIGITALME_DISTILL_ME_ACCEPTANCE === "1"
        ? require("../scripts/distill-me-acceptance-harness.cjs")
        : process.env.DIGITALME_MODEL_ROUTING_ACCEPTANCE === "1"
        ? require("../scripts/model-routing-acceptance-harness.cjs")
        : process.env.DIGITALME_CAPABILITY_ACCEPTANCE === "1"
        ? require("../scripts/capability-acceptance-harness.cjs")
        : process.env.DIGITALME_DVL2_01_PLANNER_ACCEPTANCE === "1"
        ? require("../scripts/dvl2-01-planner-acceptance-harness.cjs")
        : process.env.DIGITALME_DVL2_02_PACKAGE_ACCEPTANCE === "1"
        ? require("../scripts/dvl2-02-package-acceptance-harness.cjs")
        : process.env.DIGITALME_DVL2_03_GENERATION_ACCEPTANCE === "1"
        ? require("../scripts/dvl2-03-generation-acceptance-harness.cjs")
        : process.env.DIGITALME_VISUAL_ACCEPTANCE === "1"
        ? require("../scripts/visual-acceptance-harness.cjs")
        : process.env.DIGITALME_P107_OWNER_RUNTIME === "1"
        ? require("../scripts/p1-07-owner-runtime-harness.cjs")
        : process.env.DIGITALME_PAN01R_OWNER_RUNTIME === "1"
          ? require("../scripts/pan-01r-owner-runtime-harness.cjs")
          : process.env.DIGITALME_PAN01S_OWNER_RUNTIME === "1"
            ? require("../scripts/pan-01s-owner-runtime-harness.cjs")
            : process.env.DIGITALME_PAN01_OWNER_RUNTIME === "1"
              ? require("../scripts/pan-01-owner-runtime-harness.cjs")
              : require("../scripts/owner-runtime-harness.cjs");
    const run =
      process.env.DIGITALME_BUG1_P1_5 === "1"
        ? harness.runBug1P15AcceptanceHarness
        : process.env.DIGITALME_BUG1_P1_4 === "1"
        ? harness.runBug1P14AcceptanceHarness
        : process.env.DIGITALME_BUG1_P1_3 === "1"
        ? harness.runBug1P13AcceptanceHarness
        : process.env.DIGITALME_BUG1_P1_2 === "1"
        ? harness.runBug1P12AcceptanceHarness
        : process.env.DIGITALME_BUG1_P1_1 === "1"
        ? harness.runBug1P11AcceptanceHarness
        : process.env.DIGITALME_BUG1_P0_3 === "1"
        ? harness.runBug1P03AcceptanceHarness
        : process.env.DIGITALME_BUG1_P0_2 === "1"
        ? harness.runBug1P02AcceptanceHarness
        : process.env.DIGITALME_BUG1_P0_1 === "1"
        ? harness.runBug1P01AcceptanceHarness
        : process.env.DIGITALME_DOING_CONTEXT_ACCEPTANCE === "1"
        ? harness.runDoingContextAcceptanceHarness
        : process.env.DIGITALME_DISTILL_ME_ACCEPTANCE === "1"
        ? harness.runDistillMeAcceptanceHarness
        : process.env.DIGITALME_MODEL_ROUTING_ACCEPTANCE === "1"
        ? harness.runModelRoutingAcceptanceHarness
        : process.env.DIGITALME_CAPABILITY_ACCEPTANCE === "1"
        ? harness.runCapabilityAcceptanceHarness
        : process.env.DIGITALME_DVL2_01_PLANNER_ACCEPTANCE === "1"
        ? harness.runDvl201PlannerAcceptanceHarness
        : process.env.DIGITALME_DVL2_02_PACKAGE_ACCEPTANCE === "1"
        ? harness.runDvl202PackageAcceptanceHarness
        : process.env.DIGITALME_DVL2_03_GENERATION_ACCEPTANCE === "1"
        ? harness.runDvl203GenerationAcceptanceHarness
        : process.env.DIGITALME_VISUAL_ACCEPTANCE === "1"
        ? harness.runVisualAcceptanceHarness
        : process.env.DIGITALME_P107_OWNER_RUNTIME === "1"
        ? harness.runP107OwnerRuntimeHarness
        : process.env.DIGITALME_PAN01R_OWNER_RUNTIME === "1"
          ? harness.runPan01rOwnerRuntimeHarness
          : process.env.DIGITALME_PAN01S_OWNER_RUNTIME === "1"
            ? harness.runPan01sOwnerRuntimeHarness
            : process.env.DIGITALME_PAN01_OWNER_RUNTIME === "1"
              ? harness.runPan01OwnerRuntimeHarness
              : harness.runOwnerRuntimeHarness;
    Promise.resolve()
      .then(() => run({ BrowserWindow, app }))
      .then((code) => {
        quitting = true;
        quitForceConfirmed = true;
        app.exit(typeof code === "number" ? code : 0);
      })
      .catch((err) => {
        console.error("[owner-runtime] harness failed", err && err.stack ? err.stack : err);
        quitting = true;
        quitForceConfirmed = true;
        app.exit(1);
      });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitting = false;
let quitForceConfirmed = false;
app.on("before-quit", (event) => {
  if (quitting && quitForceConfirmed) return;
  if (quitting && !quitForceConfirmed) {
    // Nested quit while dialog pending — keep blocked.
    event.preventDefault();
    return;
  }
  event.preventDefault();
  quitting = true;
  (async () => {
    let waitResult = { ok: true, remaining: 0, timedOut: false, orphanRisk: false };
    try {
      waitResult = await delegateRuntime.abortAllAndWait(delegateRuntime.DEFAULT_QUIT_WAIT_MS);
    } catch {
      waitResult = { ok: false, remaining: -1, timedOut: true, orphanRisk: true };
    }

    const risky =
      !waitResult.ok ||
      !!waitResult.timedOut ||
      (waitResult.remaining && waitResult.remaining > 0) ||
      !!waitResult.orphanRisk;

    if (risky) {
      const detail = [
        waitResult.timedOut ? "等待外部程序结束已超时。" : "",
        waitResult.remaining > 0 ? `仍有 ${waitResult.remaining} 个委派未确认结束。` : "",
        waitResult.orphanRisk ? "可能仍有残留外部进程。" : "",
        "可选择继续退出（不保证外部进程已终止），或取消以留在应用内手动处理。",
      ]
        .filter(Boolean)
        .join("\n");
      let response;
      try {
        response = await dialog.showMessageBox({
          type: "warning",
          title: "外部程序可能仍在运行",
          message: "退出前未能确认外部程序已全部终止",
          detail,
          buttons: ["取消退出", "仍要退出"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
      } catch {
        response = { response: 0 };
      }
      if (!response || response.response !== 1) {
        quitting = false;
        quitForceConfirmed = false;
        return;
      }
      quitForceConfirmed = true;
    }

    try {
      const em = await getExtensionManager();
      await em.disconnectAll();
    } catch {}
    app.exit(0);
  })();
});

// ---------- Capability extensions (MCP Client) ----------
let extensionManager = null;
async function getExtensionManager() {
  if (!extensionManager) {
    extensionManager = await import("./capabilities/extension-manager.mjs");
  }
  return extensionManager;
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function defaultWorkspaceRoot() {
  const root = path.join(app.getPath("documents"), "DigitalMe");
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch {}
  return root;
}

function draftsDir() {
  const dir = path.join(defaultWorkspaceRoot(), "成稿");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
}

function safeFileStem(title) {
  return String(title || "成稿")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "成稿";
}

/** Persist artifact to Documents/DigitalMe/成稿 — real disk write (.md + .docx for WPS). */
function saveArtifactToDisk(artifact) {
  if (!artifact || !artifact.content) return null;
  if (documentOutput.isMetaNoise(artifact.content)) return null;
  const dir = draftsDir();
  const stamp = new Date().toISOString().slice(0, 10);
  const stem = safeFileStem(artifact.title);
  let base = path.join(dir, `${stem}_${stamp}`);
  let n = 2;
  while (fs.existsSync(base + ".md") || fs.existsSync(base + ".docx")) {
    base = path.join(dir, `${stem}_${stamp}_${n}`);
    n += 1;
  }
  const header =
    "<!-- Digital Me 成稿 · 自动保存 · " + new Date().toLocaleString("zh-CN") + " -->\n\n";
  const mdPath = base + ".md";
  const docxPath = base + ".docx";
  fs.writeFileSync(mdPath, header + artifact.content, "utf8");
  try {
    const buf = documentOutput.buildDocxFromMarkdown(artifact.content, artifact.title || "成稿");
    fs.writeFileSync(docxPath, buf);
  } catch {}
  return { mdPath, docxPath, dir };
}

/**
 * Strip model tool-call leakage (DeepSeek DSML uses fullwidth ｜ U+FF5C).
 * Never show raw protocol to users.
 */
function stripToolLeakage(text) {
  let t = String(text || "");
  // DeepSeek V4 / V3.2 DSML blocks (fullwidth pipe U+FF5C)
  t = t.replace(/<｜DSML｜tool_calls>[\s\S]*?<\/｜DSML｜tool_calls>/gi, "");
  t = t.replace(/<｜DSML｜function_calls>[\s\S]*?<\/｜DSML｜function_calls>/gi, "");
  t = t.replace(/<｜DSML｜invoke\b[^>]*>[\s\S]*?<\/｜DSML｜invoke>/gi, "");
  t = t.replace(/<｜DSML｜parameter\b[^>]*>[\s\S]*?<\/｜DSML｜parameter>/gi, "");
  t = t.replace(/<｜DSML｜tool_calls>[\s\S]*$/gi, "");
  t = t.replace(/<｜DSML｜function_calls>[\s\S]*$/gi, "");
  t = t.replace(/<｜DSML｜invoke\b[^>]*>[\s\S]*$/gi, "");
  // ASCII-pipe / spaced / broken fragments
  t = t.replace(/<\|\s*DSML\s*\|[^>\n]*>[\s\S]*?(?:<\/\|\s*DSML\s*\|[^>\n]*>|$)/gi, "");
  t = t.replace(/<\/?\|\s*DSML\s*\|[^>\n]*>/gi, "");
  t = t.replace(/<\/?｜DSML｜[^>\n]*>/gi, "");
  t = t.replace(/<\|tool_calls?\|?>[\s\S]*?(?:<\/\|tool_calls?\|?>|$)/gi, "");
  t = t.replace(/```(?:xml|json|dsml)?\s*[\s\S]*?tool_calls[\s\S]*?```/gi, "");
  t = t.replace(/^\s*invoke\s+name\s*=\s*"[^"]+"\s*$/gim, "");
  t = t.replace(/^\s*parameter\s+\w+\s+is\s+.+$/gim, "");
  t = t.replace(/invoke\s+name\s*=\s*"[^"]+"[\s\S]{0,800}?(?=\n\n|$)/gi, "");
  t = t.replace(/<\/?tool_result[^>]*>/gi, "");
  t = t.replace(/<｜end▁of▁sentence｜>/g, "");
  // Drop any remaining line that still looks like protocol markup
  t = t
    .split(/\n/)
    .filter((line) => !/DSML|tool_calls|<\/?\s*[|｜]/i.test(line))
    .join("\n");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  if (!t && /DSML|tool_calls/i.test(String(text || ""))) {
    return "";
  }
  return t;
}

/** Detect DSML (or ASCII lookalike) tool markup in assistant content. */
function hasDsmlToolMarkup(text) {
  const s = String(text || "");
  return (
    /<｜DSML｜(?:tool_calls|function_calls|invoke)/i.test(s) ||
    /<\|\s*DSML\s*\|/i.test(s) ||
    (/tool_calls/i.test(s) && /invoke\s+name\s*=/i.test(s))
  );
}

/**
 * Parse DeepSeek DSML tool calls from assistant content into OpenAI-shaped tool_calls.
 */
function parseDsmlToolCalls(text) {
  const s = String(text || "");
  if (!hasDsmlToolMarkup(s) && !/<｜DSML｜/i.test(s)) return [];
  const calls = [];
  const pushCall = (name, args) => {
    if (!name) return;
    calls.push({
      id: "dsml_" + Date.now().toString(36) + "_" + calls.length,
      type: "function",
      function: { name: String(name), arguments: JSON.stringify(args || {}) },
    });
  };

  const blocks = [];
  const blockRe =
    /<(?:｜|\|)\s*DSML\s*(?:｜|\|)\s*(?:tool_calls|function_calls)\s*>([\s\S]*?)<\/(?:｜|\|)\s*DSML\s*(?:｜|\|)\s*(?:tool_calls|function_calls)\s*>/gi;
  let bm;
  while ((bm = blockRe.exec(s))) blocks.push(bm[1]);
  if (!blocks.length) blocks.push(s);

  for (const block of blocks) {
    const invRe =
      /<(?:｜|\|)\s*DSML\s*(?:｜|\|)\s*invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:｜|\|)\s*DSML\s*(?:｜|\|)\s*invoke\s*>/gi;
    let im;
    let foundTagged = false;
    while ((im = invRe.exec(block))) {
      foundTagged = true;
      const name = im[1];
      const body = im[2] || "";
      const args = {};
      const pRe =
        /<(?:｜|\|)\s*DSML\s*(?:｜|\|)\s*parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:｜|\|)\s*DSML\s*(?:｜|\|)\s*parameter\s*>/gi;
      let pm;
      while ((pm = pRe.exec(body))) {
        args[pm[1]] = String(pm[2] || "").trim();
      }
      if (!Object.keys(args).length) {
        const trimmed = body.trim();
        if (trimmed.startsWith("{")) {
          try {
            Object.assign(args, JSON.parse(trimmed));
          } catch {}
        }
        const lineRe = /parameter\s+(\w+)\s+is\s+(.+)$/gim;
        let lm;
        while ((lm = lineRe.exec(body))) {
          args[lm[1]] = String(lm[2] || "")
            .trim()
            .replace(/^["']|["']$/g, "");
        }
      }
      pushCall(name, args);
    }
    if (foundTagged) continue;

    const looseRe = /invoke\s+name\s*=\s*"([^"]+)"([\s\S]*?)(?=invoke\s+name\s*=\s*"|$)/gi;
    let lm;
    while ((lm = looseRe.exec(block))) {
      const name = lm[1];
      const body = lm[2] || "";
      const args = {};
      const lineRe = /parameter\s+(\w+)\s+is\s+(.+)$/gim;
      let pm;
      while ((pm = lineRe.exec(body))) {
        args[pm[1]] = String(pm[2] || "")
          .trim()
          .replace(/^["']|["']$/g, "");
      }
      pushCall(name, args);
    }
  }
  return calls;
}

/** Only recover disk drafts when the user clearly asked for that kind of doc. */
function shouldRecoverFromWorkspace(userQuestion, reply) {
  const q = String(userQuestion || "");
  const r = String(reply || "");
  // Non-resume writing tasks must never pull old 简历 files
  if (/报告|请示|方案|备忘录|提纲|大纲|降雨|气候|分析|研究/.test(q) && !/简历/.test(q)) {
    return false;
  }
  if (/简历/.test(q)) return true;
  if (/简历[^\n\r|]{0,60}\.md/.test(r)) return true;
  return false;
}

/**
 * Recover draft body from workspace ONLY for matching resume requests,
 * and only when reply names a file or user asked for 简历.
 */
function recoverArtifactFromWorkspace(replyText, userQuestion) {
  if (!shouldRecoverFromWorkspace(userQuestion, replyText)) return null;

  const root = defaultWorkspaceRoot();
  const names = [];
  const re = /([^\s|`「」【】]+简历[^\s|`「」【】]*\.md)/g;
  let m;
  const blob = String(replyText || "");
  while ((m = re.exec(blob))) names.push(path.basename(m[1]));

  const candidates = [];
  function walk(d, depth) {
    if (depth > 2) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.md$/i.test(e.name) && /简历/.test(e.name)) {
        try {
          const st = fs.statSync(p);
          candidates.push({ p, mtime: st.mtimeMs, name: e.name });
        } catch {}
      }
    }
  }
  walk(root, 0);
  candidates.sort((a, b) => b.mtime - a.mtime);

  // Prefer explicitly named files; otherwise do not guess from "any recent resume"
  const prefer = names.length
    ? candidates.filter((c) => names.some((n) => c.name === n || c.name.includes(n.replace(/\.md$/i, "").slice(0, 12))))
    : [];
  if (!prefer.length && !/简历/.test(String(userQuestion || ""))) return null;
  const pool = prefer.length ? prefer : candidates.slice(0, 1);

  for (const c of pool) {
    try {
      let text = fs.readFileSync(c.p, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
      if (documentOutput.looksLikeResumeBody(text) && !documentOutput.isMetaNoise(text)) {
        const titleMatch = /^(?:#\s+)?(.+)$/m.exec(text);
        return {
          id: "art_" + Date.now().toString(36),
          type: "markdown",
          title: (titleMatch && titleMatch[1].slice(0, 48)) || c.name.replace(/\.md$/i, ""),
          content: text,
          createdAt: new Date().toISOString(),
          recoveredFrom: c.p,
        };
      }
    } catch {}
  }
  return null;
}

function resolveTemplateArgs(argsTemplate, params) {
  const map = {
    workspaceRoot: params.workspaceRoot || defaultWorkspaceRoot(),
    dbPath: params.dbPath || "",
  };
  return (argsTemplate || []).map((a) =>
    String(a).replace(/\{\{(\w+)\}\}/g, (_, key) => map[key] != null ? String(map[key]) : "")
  );
}

function buildExtensionFromCatalog(item, options = {}) {
  const params = options.params || {};
  const env = {};
  for (const ek of item.envKeys || []) {
    const val = (options.env && options.env[ek.key]) || "";
    if (val) env[ek.key] = String(val);
  }
  if (item.needsKey) {
    for (const ek of item.envKeys || []) {
      if (!env[ek.key]) throw new Error(`请先填写 ${ek.label || ek.key}`);
    }
  }
  if (item.pathParam?.required) {
    const key = item.pathParam.key;
    if (!params[key] || !String(params[key]).trim()) {
      throw new Error(`请填写 ${item.pathParam.label || key}`);
    }
  }
  if (item.id === "filesystem" || item.pathParam?.key === "workspaceRoot") {
    const root = params.workspaceRoot || defaultWorkspaceRoot();
    fs.mkdirSync(root, { recursive: true });
    params.workspaceRoot = root;
  }
  if (params.dbPath) {
    if (!fs.existsSync(params.dbPath)) throw new Error("数据库文件不存在：" + params.dbPath);
  }

  return {
    id: item.id,
    name: item.name,
    catalogId: item.id,
    command: item.command || npxCommand(),
    args: resolveTemplateArgs(item.argsTemplate, params),
    env: Object.keys(env).length ? env : undefined,
    note: item.tagline,
    params: {
      workspaceRoot: params.workspaceRoot || undefined,
      dbPath: params.dbPath || undefined,
    },
  };
}

function getCapabilityExtensions() {
  const svc = getConfigSecrets();
  const loaded = svc.loadRawConfig();
  if (loaded.status === "error") return [];
  const cfg = loaded.config;
  let list = Array.isArray(cfg.capabilityExtensions) ? cfg.capabilityExtensions : [];
  // 迁移旧版示例 id / 高摩擦启动方式
  let changed = false;
  list = list.map((ext) => {
    if (ext.id === "filesystem-demo") {
      changed = true;
      return { ...ext, id: "filesystem", catalogId: "filesystem", name: ext.name || "本地文件读写" };
    }
    // 网页抓取：从 uvx 迁到 npx，消除 Python/uv 门槛
    if (
      ext.id === "fetch" &&
      (ext.command === "uvx" || (ext.args || []).some((a) => String(a).includes("mcp-server-fetch")))
    ) {
      changed = true;
      return {
        ...ext,
        name: ext.name || "网页抓取",
        catalogId: "fetch",
        command: npxCommand(),
        args: ["-y", "mcp-fetch-server"],
        note: ext.note || "按 URL 拉取网页正文（npx，无需 uv）",
      };
    }
    return ext;
  });
  if (changed) {
    try {
      cfg.capabilityExtensions = list.map((e) => svc.sanitizeExtension(e, svc.secretStore));
      delete cfg.apiKey;
      svc.writeRawConfig(cfg);
    } catch {
      /* keep in-memory list; do not overwrite unreadable/corrupt configs */
    }
  }
  return list.map((e) => svc.sanitizeExtension(e, svc.secretStore));
}

function saveCapabilityExtensions(list) {
  return getConfigSecrets().saveExtensionsList(list);
}

function findExtensionById(id) {
  const ext = getCapabilityExtensions().find((e) => e.id === id);
  if (!ext) throw new Error("未找到已启用的扩展：" + id + "。请先在商店中启用。");
  return ext;
}

function findExtensionForConnect(id) {
  const publicExt = findExtensionById(id);
  return getConfigSecrets().hydrateExtensionEnv(publicExt);
}

function enrichCatalogForUi() {
  const enabled = new Set(getCapabilityExtensions().map((e) => e.id));
  const mapItem = (item) => ({
    ...item,
    enabled: enabled.has(item.id),
    defaultWorkspaceRoot: item.pathParam?.key === "workspaceRoot" ? defaultWorkspaceRoot() : undefined,
  });
  return {
    guide: catalog.GUIDE,
    categories: catalog.CATEGORIES,
    generalItems: catalog.CATALOG.filter(catalog.isGeneralItem).map(mapItem),
    advancedItems: catalog.CATALOG.filter(catalog.isAdvancedItem).map(mapItem),
    items: catalog.CATALOG.map(mapItem),
  };
}

// ---------- Config (PublicConfig for renderer; RuntimeConfig only in main) ----------
function readConfig() {
  // Legacy name kept for internal call sites that need runtime secrets.
  return getConfigSecrets().getRuntimeConfig();
}

function readPublicConfig() {
  return getConfigSecrets().readPublicConfig();
}

function writeConfig(cfg) {
  // Internal writes must not reintroduce plaintext apiKey.
  const svc = getConfigSecrets();
  const loaded = svc.loadRawConfig();
  if (loaded.status === "error") {
    const err = new Error(loaded.message || "config_unreadable");
    err.code = loaded.code || "config_unreadable";
    throw err;
  }
  const next = { ...cfg };
  delete next.apiKey;
  if (Array.isArray(next.capabilityExtensions)) {
    next.capabilityExtensions = next.capabilityExtensions.map((e) =>
      svc.sanitizeExtension(e, svc.secretStore)
    );
  }
  const raw = loaded.config;
  svc.writeRawConfig({
    ...raw,
    ...next,
    secretsMigration: next.secretsMigration || raw.secretsMigration,
  });
}

ipcMain.handle("config:get", () => readPublicConfig());
ipcMain.handle("distillMe:get", () => distillMe.summary(distillMe.read(packageDirFromConfig())));
ipcMain.handle("distillMe:createInput", (_e, input) => distillMe.createDraft(packageDirFromConfig(), input));
ipcMain.handle("distillMe:generate", async (_e, draftId) => {
  const dir=packageDirFromConfig(), data=distillMe.read(dir), draft=data.drafts.find((item)=>item.id===draftId); if(!draft) throw new Error("未找到输入草稿");
  const cfg=readConfig(); let parsed;
  try { const raw=await callModel(cfg,[{role:"system",content:"只返回 JSON：{identity:[{statement,confidence}],experience:[{statement,confidence}],fact:[{statement,confidence}]}。仅提取明确陈述，不要猜测。"},{role:"user",content:draft.text}],{taskType:"artifact",temperature:0.1}); parsed=JSON.parse(raw); await callModel(cfg,[{role:"system",content:"检查以下 JSON 是否仅包含 identity、experience、fact 数组；不改写内容，只返回 OK。"},{role:"user",content:JSON.stringify(parsed).slice(0,12000)}],{taskType:"review",temperature:0}); } catch(err) { const e=new Error("当前模型不可用。可以检查模型设置，或切换到备用模型。"); e.code=err.code||"PROVIDER_ERROR"; throw e; }
  return distillMe.materialize(dir,draftId,parsed);
});
ipcMain.handle("distillMe:transition", (_e,payload) => distillMe.transition(packageDirFromConfig(),payload?.itemId,payload?.action,payload?.patch));
ipcMain.handle("distillMe:evidence", (_e,itemId) => { const item=distillMe.read(packageDirFromConfig()).items.find((x)=>x.id===itemId); return item?{sourceRefs:item.sourceRefs,evidenceRefs:item.evidenceRefs}:null; });
ipcMain.handle("distillMe:export", () => distillMe.exportSnapshot(packageDirFromConfig()));
ipcMain.handle("distillMe:audit", () => distillMe.read(packageDirFromConfig()).audit.map(({id,action,itemId,at})=>({id,action,itemId,at})));
ipcMain.handle("doingContext:listAudit", () => readDoingContextAudit(app.getPath("userData")).entries);
ipcMain.handle("modelRouting:get", () => getConfigSecrets().getPublicModelRouting());
ipcMain.handle("modelRouting:save", (_e, payload) => getConfigSecrets().setModelRoutingFromRenderer(payload));
const modelRoutingAudit = [];
function recordModelRoutingAttempt(entry) {
  modelRoutingAudit.unshift({ ...entry, at: new Date().toISOString() });
  if (modelRoutingAudit.length > 40) modelRoutingAudit.length = 40;
}
ipcMain.handle("modelRouting:recent", () => modelRoutingAudit.slice(0, 20));
ipcMain.handle("modelRouting:test", async (_e, payload) => {
  const cfg = readConfig();
  const taskType = payload?.taskType || "chat";
  const result = await invokeModelRoute({
    routing: cfg.modelRouting,
    taskType,
    secretStore: getConfigSecrets().secretStore,
    recordAttempt: recordModelRoutingAttempt,
    invokeProvider: async (candidate) => {
      if (candidate.provider.type === "fake") {
        if (candidate.model.model.includes("fail")) { const err = new Error("fake provider failure"); err.code = "fake_failure"; throw err; }
        return { content: "fake provider connected" };
      }
      return callModelRaw({ provider: candidate.provider.type, baseURL: candidate.provider.baseUrl, model: candidate.model.model, apiKey: candidate.apiKey }, [{ role: "user", content: "连接测试：仅返回 OK。" }], { timeout: 12000 });
    },
  });
  return result.ok ? { ok: true, provider: result.provider, model: result.model, fallbackUsed: result.fallbackUsed, attempts: result.attempts } : { ok: false, errorCode: result.errorCode, friendlyMessage: result.friendlyMessage, settingsAction: result.settingsAction, attempts: result.attempts };
});
ipcMain.handle("runtime:getStamp", () => {
  const stamp = buildRuntimeStamp();
  return {
    ...stamp,
    apiVersion: 1,
    postOwnerFixes: stampIsPostOwnerFixes(stamp),
    ownerRuntimeTest: process.env.DIGITALME_OWNER_RUNTIME_TEST === "1",
  };
});

ipcMain.handle("runtime:getRendererEntry", () => rendererEntryRuntime.getPublicEntryState());

ipcMain.handle("runtime:getBoundGeneration", () => rendererEntryRuntime.getBoundGeneration());

ipcMain.handle("runtime:requestRendererEntry", (_e, entry, reason) => {
  const target = String(entry || "");
  const why = String(reason || "");
  if (target === "legacy" && (why === "user_return" || why === "user_return_legacy")) {
    const gate = r2ActiveRequest.assertIdle();
    if (!gate.ok) {
      return {
        ok: false,
        code: "request_in_progress",
        message: "请先停止当前回复，再返回经典界面。",
        activeRequest: gate.activeRequest,
      };
    }
  }
  return rendererEntryRuntime.handleRequestFromRenderer(entry, reason);
});

ipcMain.handle("runtime:signalReady", (event, payload) => {
  return rendererEntryRuntime.handleSignalReady({
    generation: payload ? payload.generation : undefined,
    webContentsId: event && event.sender ? event.sender.id : null,
  });
});

// Harness/dev only — not exposed on ordinary preload facade.
ipcMain.handle("runtime:testRequestNext", (_e, reason) => {
  if (!rendererEntryRuntime.controller.isSpikeHarnessEnabled()) {
    return { ok: false, code: "harness_required" };
  }
  return rendererEntryRuntime.handleHarnessRequestNext(reason || "test_harness");
});

ipcMain.handle("runtime:testGetEntrySnapshot", () => {
  if (!rendererEntryRuntime.controller.isSpikeHarnessEnabled()) {
    return { ok: false, code: "harness_required" };
  }
  return { ok: true, ...rendererEntryRuntime.controller.snapshot() };
});
ipcMain.handle("config:set", (_e, cfg) => {
  getConfigSecrets().setConfigFromRenderer(cfg || {});
  return readPublicConfig();
});
ipcMain.handle("config:clearApiKey", () => {
  return getConfigSecrets().clearModelApiKey();
});
ipcMain.handle("secrets:clearExtensionEnv", (_e, payload) => {
  const extensionId = String(payload?.extensionId || "").trim();
  const envKey = String(payload?.envKey || "").trim();
  if (!extensionId || !envKey) throw new Error("请指定扩展与密钥名称");
  getConfigSecrets().clearExtensionSecret(extensionId, envKey);
  // Refresh sanitized list on disk
  const list = getCapabilityExtensions();
  saveCapabilityExtensions(list);
  return {
    ok: true,
    extensionId,
    envKey,
    configured: getConfigSecrets().secretStore.has(extensionSecretId(extensionId, envKey)),
  };
});

// ---------- Digital Me Package loading ----------
function safeRead(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function packageDirFromConfig() {
  return readPublicConfig().packageDir || DEFAULT_PACKAGE_DIR;
}

function isUnderTmpDir(dir) {
  const resolved = path.resolve(String(dir || ""));
  const tmp = path.resolve(os.tmpdir());
  return resolved === tmp || resolved.startsWith(tmp + path.sep);
}

function assertPackageStoreDirAllowed(packageDir) {
  const resolved = path.resolve(String(packageDir || ""));
  const cfgDir = path.resolve(packageDirFromConfig());
  if (resolved === cfgDir) return resolved;
  if (isUnderTmpDir(resolved)) return resolved;
  const e = new Error("仅允许操作当前配置的资料目录，或系统临时目录下的演示资料。");
  e.code = "package_dir_not_allowed";
  throw e;
}

function tryRecoverConfiguredPackageStore() {
  try {
    const dir = packageDirFromConfig();
    if (!dir || !fs.existsSync(dir)) return null;
    const store = new PackageStore({ packageDir: dir, ownerId: "app:recover" });
    return store.recover();
  } catch (e) {
    console.warn("[package-store] recover skipped:", e && (e.code || e.message));
    return null;
  }
}

ipcMain.handle("package:load", () => {
  const dir = packageDirFromConfig();
  tryRecoverConfiguredPackageStore();
  life.ensureLifeScaffold(dir);
  policies.ensureBoundariesScaffold(dir);
  const manifestRaw = safeRead(path.join(dir, "manifest.json"));
  let manifest = {};
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {}
  return {
    dir,
    exists: !!manifestRaw,
    manifest,
    persona: safeRead(path.join(dir, "persona.md")),
    styleGuide: safeRead(path.join(dir, "style-guide.md")),
    systemPrompt: safeRead(path.join(dir, "prompts", "system-prompt.md")),
    decisionFrameworks: safeRead(path.join(dir, "decision-frameworks.json")),
    preferences: safeRead(path.join(dir, "preferences.json")),
    longTermMemory: safeRead(path.join(dir, "memory", "long-term-memory.jsonl")),
    lifeSummary: life.summarizeLifeForPrompt(dir),
    boundariesSummary: policies.summarizeBoundariesForPrompt(dir),
  };
});

function loadPackageForActBehalf() {
  const dir = packageDirFromConfig();
  tryRecoverConfiguredPackageStore();
  life.ensureLifeScaffold(dir);
  policies.ensureBoundariesScaffold(dir);
  const manifestRaw = safeRead(path.join(dir, "manifest.json"));
  let manifest = {};
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    /* ignore */
  }
  let identitySummary = "";
  try {
    const idRaw = safeRead(path.join(dir, "identity.json"));
    if (idRaw) {
      const idObj = JSON.parse(idRaw);
      const claims = Array.isArray(idObj.identityClaims)
        ? idObj.identityClaims
        : Array.isArray(idObj.claims)
          ? idObj.claims
          : [];
      identitySummary = claims
        .map((c) => String((c && (c.text || c.content || c.summary)) || "").trim())
        .filter(Boolean)
        .slice(0, 20)
        .join("\n\n");
      if (!identitySummary && idObj.summary) identitySummary = String(idObj.summary);
    }
  } catch {
    /* optional */
  }
  return {
    dir,
    exists: !!manifestRaw,
    manifest,
    persona: safeRead(path.join(dir, "persona.md")),
    styleGuide: safeRead(path.join(dir, "style-guide.md")),
    systemPrompt: safeRead(path.join(dir, "prompts", "system-prompt.md")),
    decisionFrameworks: safeRead(path.join(dir, "decision-frameworks.json")),
    preferences: safeRead(path.join(dir, "preferences.json")),
    longTermMemory: safeRead(path.join(dir, "memory", "long-term-memory.jsonl")),
    lifeSummary: life.summarizeLifeForPrompt(dir),
    boundariesSummary: policies.summarizeBoundariesForPrompt(dir),
    identitySummary,
  };
}

function fakeActBehalfModelOutput(request) {
  return (
    "## 使用的本人信息\n\n- （测试）已读取本次确认的本人信息摘录\n\n" +
    "## 本人已有事实或观点\n\n- （测试）根据摘录整理的既有立场\n\n" +
    "## Digital Me 的新分析或建议\n\n- （测试）针对「" +
    String(request || "").slice(0, 80) +
    "」给出的新建议\n\n" +
    "## 完整结果\n\n（测试）这是一份结合本人信息生成的完整结果草稿，可直接修改后使用。"
  );
}

function fakeEmailModelOutput(request) {
  return JSON.stringify({
    to: "",
    subject: "（测试）关于「" + String(request || "").slice(0, 40) + "」的邮件",
    body:
      "（测试）您好，\n\n这是一封结合本人信息起草的测试邮件正文，可直接修改后使用。\n\n此致",
    attachments: [],
    needsConfirmation: ["收件人地址缺失，需要用户填写确认。"],
  });
}

function fakeVideoAudioModelOutput(request) {
  return JSON.stringify({
    title: "（测试）" + String(request || "").slice(0, 40),
    duration: "60s",
    scenes: [
      {
        scene: "场景 1",
        visuals: "（测试）开场画面，结合本人信息描述的画面。",
        narration: "（测试）这是一段结合本人信息生成的旁白。",
        duration: "15s",
      },
      {
        scene: "场景 2",
        visuals: "（测试）主体内容画面。",
        narration: "（测试）主体内容旁白，可直接修改后使用。",
        duration: "45s",
      },
    ],
    creativeDirection: "（测试）创意方向与风格基调。",
    productionTips: ["（测试）在剪映/Descript 等外部工具中完成制作。"],
    needsConfirmation: ["（测试）实际素材与出镜形式需要用户确认。"],
  });
}

ipcMain.handle("actBehalf:previewContext", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const goal = String((payload && (payload.goal || payload.request)) || "").trim();
    if (!goal) {
      return { ok: false, code: "empty_goal", message: "请先填写研究与表达目标。" };
    }
    const pkg = loadPackageForActBehalf();
    const assembled = assembleSubjectContextCandidates(pkg, { goal });

    let existing = null;
    if (payload && payload.taskId) {
      const got = actBehalfStore.getTask(userData, payload.taskId);
      if (got.ok) existing = got.task;
    }

    const title =
      String((payload && payload.title) || "").trim() ||
      (existing && existing.title) ||
      goal.slice(0, 40) + (goal.length > 40 ? "…" : "");

    const taskIntent = normalizeTaskIntent(
      {
        ...(existing && existing.taskIntent),
        goal,
        role: (payload && payload.role) || (existing && existing.taskIntent && existing.taskIntent.role),
        expectedOutcome:
          (payload && payload.expectedOutcome) ||
          (existing && existing.taskIntent && existing.taskIntent.expectedOutcome),
        constraints:
          (payload && payload.constraints) ||
          (existing && existing.taskIntent && existing.taskIntent.constraints),
      },
      (payload && payload.taskId) || (existing && existing.taskId),
      packageDirFromConfig()
    );

    let priorSubjectContext = (existing && existing.priorSubjectContext) || null;
    if (existing && existing.subjectContext && existing.subjectContext.confirmationState === "confirmed") {
      priorSubjectContext = existing.subjectContext;
    }

    const saved = await actBehalfStore.saveTask(
      userData,
      withAuthoritativeResearchFields(existing, {
        taskId: (payload && payload.taskId) || (existing && existing.taskId) || undefined,
        title,
        request: goal,
        goal,
        status: "draft",
        taskIntent,
        subjectContextCandidates: assembled.subjectContextDraft,
        subjectContext: null,
        priorSubjectContext,
      })
    );

    return {
      ok: true,
      packageExists: !!pkg.exists,
      goal,
      taskId: saved.task.taskId,
      subjectContextDraft: assembled.subjectContextDraft,
      selectedSelfContext: assembled.selectedSelfContext,
      note: assembled.note,
      rankingMeta: assembled.subjectContextDraft && assembled.subjectContextDraft.rankingMeta,
    };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "preview_failed",
      message: err && err.message ? err.message : "无法准备本人信息。",
    };
  }
});

ipcMain.handle("actBehalf:confirmContext", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const goal = String((payload && (payload.goal || payload.request)) || "").trim();
    if (!goal) {
      return { ok: false, code: "empty_goal", message: "请先填写研究与表达目标。" };
    }
    const title =
      String((payload && payload.title) || "").trim() ||
      goal.slice(0, 40) + (goal.length > 40 ? "…" : "");
    const pkg = loadPackageForActBehalf();

    // Never trust payload.subjectContextDraft — only user actions below.
    let existing = null;
    if (payload && payload.taskId) {
      const got = actBehalfStore.getTask(userData, payload.taskId);
      if (!got.ok) {
        return { ok: false, code: got.code || "not_found", message: got.message || "找不到该任务。" };
      }
      existing = got.task;
    }

    let draft =
      existing && existing.subjectContextCandidates && Array.isArray(existing.subjectContextCandidates.claims)
        ? existing.subjectContextCandidates
        : null;

    if (!draft) {
      // No saved candidates yet: re-assemble on main. keepClaimIds must match this set.
      const assembled = assembleSubjectContextCandidates(pkg, { goal });
      draft = assembled.subjectContextDraft;
    }

    const outcome = confirmSubjectContextWithUserActions(draft, {
      goal,
      keepClaimIds: payload && payload.keepClaimIds,
      supplements: payload && payload.supplements,
      supplementText: payload && payload.supplementText,
    });
    if (!outcome.ok) {
      return {
        ok: false,
        code: outcome.code || "confirm_failed",
        message: outcome.message || "无法确认本人上下文。",
        unknownClaimIds: outcome.unknownClaimIds,
      };
    }
    const confirmed = outcome.confirmed;

    const taskIntent = normalizeTaskIntent(
      {
        ...(existing && existing.taskIntent),
        goal,
        role: (payload && payload.role) || undefined,
        expectedOutcome: (payload && payload.expectedOutcome) || undefined,
        constraints: (payload && payload.constraints) || undefined,
      },
      (payload && payload.taskId) || (existing && existing.taskId),
      packageDirFromConfig()
    );

    const contextAudit = {
      assembledAt: new Date().toISOString(),
      packagePaths: (draft.rankingMeta && draft.rankingMeta.packagePaths) || [],
      displayedClaimIds: (draft.claims || []).map((c) => c.id),
      deletedClaimIds: outcome.deletedClaimIds || [],
      supplementedCount: (
        []
          .concat((payload && payload.supplements) || [])
          .concat((payload && payload.supplementText) || [])
      ).filter((s) => String(s || "").trim()).length,
      rankingMeta: draft.rankingMeta || null,
      confirmedClaimIds: (confirmed.claims || []).map((c) => c.id),
      authority: "main_process_candidates",
    };

    const saved = await actBehalfStore.saveTask(
      userData,
      withAuthoritativeResearchFields(existing, {
        taskId: (payload && payload.taskId) || (existing && existing.taskId) || undefined,
        title,
        request: goal,
        goal,
        status: "context_confirmed",
        taskIntent,
        subjectContextCandidates: draft,
        subjectContext: confirmed,
        priorSubjectContext: (existing && existing.priorSubjectContext) || null,
        contextAudit,
        selectedSelfContext: {
          items: confirmed.claims.map((c) => ({
            source: (c.sourceRefs[0] && c.sourceRefs[0].source) || "unknown",
            label: c.label,
            text: c.text,
          })),
          combinedText: confirmed.claims.map((c) => "### " + c.label + "\n" + c.text).join("\n\n"),
          userEdited: true,
        },
      })
    );

    const intentCheck = assertTaskIntentMinimal({
      ...saved.task.taskIntent,
      taskId: saved.task.taskId,
    });
    if (!intentCheck.ok) {
      return {
        ok: false,
        code: "intent_incomplete",
        message: "任务意图字段不完整：" + intentCheck.missing.join(", "),
      };
    }

    return {
      ok: true,
      task: saved.task,
      subjectContext: confirmed,
      taskIntent: saved.task.taskIntent,
      message: "已确认并保存本次本人上下文快照。研究执行将在下一块开放。",
    };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "confirm_failed",
      message: err && err.message ? err.message : "无法确认本人上下文。",
    };
  }
});

ipcMain.handle("actBehalf:autoGenerate", async (_e, payload) => {
  try {
    const goal = String((payload && payload.goal) || "").trim();
    if (!goal) {
      return { ok: false, code: "empty_goal", message: "请输入要完成的目标。" };
    }

    const pkg = loadPackageForActBehalf();
    const assembled = autoSelectCandidates(pkg, { goal });
    const autoClaims = assembled.autoSelectedClaims || [];

    const title = String((payload && payload.title) || "").trim() ||
      goal.slice(0, 40) + (goal.length > 40 ? "…" : "");

    const taskIntent = normalizeTaskIntent({
      goal,
      role: (payload && payload.role) || "",
      expectedOutcome: (payload && payload.expectedOutcome) || "",
      constraints: (payload && payload.constraints) || [],
    }, undefined, packageDirFromConfig());
    const taskType = detectTaskType(goal);
    taskIntent.taskType = taskType;

    const userData = app.getPath("userData");
    const doingContext = assembleDoingContext({
      packageDir: packageDirFromConfig(),
      pkg,
      taskIntent: goal,
      scene: "act_behalf",
    });
    const selectedClaimText = autoClaims
      .map(c => `[${c.label || c.type || ""}] ${c.text}`)
      .join("\n\n");
    const selfContextText = [selectedClaimText, renderDoingContextForModel(doingContext)].filter(Boolean).join("\n\n");

    // Auto-confirm context (no user selection needed)
    const confirmed = confirmSubjectContextWithUserActions(
      assembled.subjectContextDraft,
      {
        goal,
        keepClaimIds: autoClaims.map(c => c.id),
      }
    );
    const confirmedClaims = (confirmed.ok && confirmed.subjectContext && confirmed.subjectContext.claims) || [];

    const saveStep1 = await actBehalfStore.saveTask(userData, {
      taskId: (payload && payload.taskId) || undefined,
      title,
      request: goal,
      goal,
      status: "context_confirmed",
      taskIntent,
      subjectContextCandidates: assembled.subjectContextDraft,
      subjectContext: {
        ...confirmed.subjectContext,
        confirmationState: confirmed.ok ? "confirmed" : "auto_failed",
      },
      autoSelectedClaims: autoClaims,
      doingContext,
    });
    const taskId = saveStep1.task.taskId;

    // Build messages and call model directly (skip research for now in auto mode)
    const isEmailTask = taskType === TASK_TYPES.email;
    const isVideoAudioTask = taskType === TASK_TYPES.videoAudio;
    const messages = isEmailTask
      ? buildEmailMessages({
          request: goal,
          title,
          selectedSelfContextText: selfContextText,
        })
      : isVideoAudioTask
        ? buildVideoAudioMessages({
            request: goal,
            title,
            selectedSelfContextText: selfContextText,
          })
        : buildActBehalfMessages({
            request: goal,
            title,
            selectedSelfContextText: selfContextText,
          });

    let raw = "";
    let modelMeta = { fake: false };
    if (process.env.DIGITALME_ACT_BEHALF_FAKE === "1") {
      raw = isEmailTask
        ? fakeEmailModelOutput(goal)
        : isVideoAudioTask
          ? fakeVideoAudioModelOutput(goal)
          : fakeActBehalfModelOutput(goal);
      modelMeta = { fake: true };
    } else {
      const cfg = readConfig();
      if (!cfg || !cfg.apiKey) {
        return {
          ok: false,
          code: "no_api_key",
          message: "请先在设置中配置可用的模型。",
        };
      }
      raw = await callModel(cfg, messages, { temperature: 0.4 });
      modelMeta = { fake: false, model: cfg.model || "" };
    }

    const parsed = isEmailTask
      ? parseEmailOutput(raw)
      : isVideoAudioTask
        ? parseVideoAudioOutput(raw)
        : parseActBehalfOutput(raw);
    modelMeta.parseOk = parsed.parseOk;
    modelMeta.usedSelfInfo = parsed.usedSelfInfo || "";
    modelMeta.taskType = taskType;

    const emailDraft = isEmailTask
      ? {
          to: parsed.to,
          subject: parsed.subject,
          body: parsed.body,
          attachments: parsed.attachments,
          needsConfirmation: parsed.needsConfirmation,
        }
      : null;

    const videoAudioScript = isVideoAudioTask
      ? {
          title: parsed.title,
          duration: parsed.duration,
          scenes: parsed.scenes,
          creativeDirection: parsed.creativeDirection,
          productionTips: parsed.productionTips,
          needsConfirmation: parsed.needsConfirmation,
        }
      : null;

    const saved = await actBehalfStore.saveTask(userData, {
      taskId,
      title,
      request: goal,
      status: "completed",
      taskIntent,
      selectedSelfContext: {
        items: autoClaims.map(c => ({ id: c.id, label: c.label, text: c.text })),
        combinedText: selfContextText,
        userEdited: false,
      },
      existingUserPositions: isEmailTask || isVideoAudioTask ? "" : parsed.existingUserPositions,
      digitalMeInferences: isEmailTask || isVideoAudioTask ? "" : parsed.digitalMeInferences,
      result: isEmailTask || isVideoAudioTask ? parsed.plainText : parsed.result,
      emailDraft: emailDraft || undefined,
      videoAudioScript: videoAudioScript || undefined,
      modelMeta,
      doingContext,
    });

    const auditEntry = appendAudit(userData, {
      auditRef: doingContext.auditRef,
      requestId: doingContext.requestId,
      taskIntent: goal,
      scene: doingContext.task.scene,
      confirmedIdentityIds: doingContext.confirmedContext.map((item) => item.id),
      excludedCount: doingContext.policy.excludedCount,
      usedConfirmedContextCount: doingContext.confirmedContext.length,
      at: new Date().toISOString(),
      result: "completed",
      // Final model request: confirmed statements only, never raw evidence excerpts.
      modelRequest: messages.map((message) => ({ role: message.role, content: message.content })),
    });

    return {
      ok: true,
      task: saved.task,
      taskId,
      goal,
      taskType,
      emailDraft: emailDraft || undefined,
      videoAudioScript: videoAudioScript || undefined,
      autoSelectedCount: autoClaims.length,
      sensitiveCount: (assembled.sensitiveClaims || []).length,
      packageExists: !!pkg.exists,
      usedSelfInfo: parsed.usedSelfInfo || "",
      confirmedClaimsCount: confirmedClaims.length,
      doingContext: { usedCount: doingContext.confirmedContext.length, applied: doingContext.policy.applied },
      auditRef: auditEntry.auditRef,
    };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "auto_generate_failed",
      message: err && err.message ? err.message : "自动生成失败，请稍后再试。",
    };
  }
})

// File/folder selection for act-behalf tasks
ipcMain.handle("actBehalf:selectFiles", async (_e, payload) => {
  try {
    const mode = String((payload && payload.mode) || "files").trim(); // "files" or "folder"
    const res = await dialog.showOpenDialog({
      title: mode === "folder" ? "选择文件夹" : "添加文件",
      properties: mode === "folder" ? ["openDirectory"] : ["openFile", "multiSelections"],
      filters: mode === "folder" ? [] : [
        {
          name: "常用文件",
          extensions: ["txt", "md", "markdown", "docx", "pdf", "pptx", "js", "ts", "py", "java", "c", "cpp", "h", "json", "xml", "html", "css", "csv", "xlsx"],
        },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (res.canceled || !res.filePaths.length) {
      return { ok: true, canceled: true, files: [] };
    }

    const files = [];
    for (const filePath of res.filePaths.slice(0, 10)) {
      const name = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      let text = "";
      let note = "";
      let ok = false;
      let chars = 0;
      try {
        if (mode === "folder") {
          // For folder, list files in directory
          const dirFiles = fs.readdirSync(filePath, { withFileTypes: true })
            .filter((f) => f.isFile())
            .slice(0, 20)
            .map((f) => f.name);
          text = "文件夹内容：\n" + dirFiles.join("\n");
          note = "已列出 " + dirFiles.length + " 个文件";
          ok = true;
          chars = text.length;
        } else {
          // For files, extract text
          const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext);
          if (isImage) {
            note = "图片已附上（请用文字说明要点）";
            text = "[图片附件] " + name;
            ok = true;
          } else {
            text = await builder.extractText(filePath);
            text = String(text || "")
              .replace(/\n--\s*\d+\s+of\s+\d+\s*--\n/gi, "\n")
              .trim();
            if (!text) throw new Error("未提取到可读文字");
            chars = text.length;
            if (text.length > 40000) {
              text = text.slice(0, 40000) + "\n\n…（后文已省略，共约 " + chars + " 字）";
            }
            note = "已读入约 " + chars + " 字";
            ok = true;
          }
        }
      } catch (err) {
        note = "未能读入：" + (err.message || "未知原因");
        text = "";
        ok = false;
      }
      files.push({
        id: "file_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1000),
        name,
        path: filePath,
        ext,
        text,
        note,
        ok,
        chars,
        isFolder: mode === "folder",
      });
    }
    return { ok: true, canceled: false, files };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "select_files_failed",
      message: err && err.message ? err.message : "选择文件失败。",
    };
  }
});;

ipcMain.handle("actBehalf:sendEmail", async (_e, payload) => {
  try {
    // R3 对外动作：占位实现。confirmed 校验与发送门控在 requestEmailSend 内完成，
    // 渲染进程无法绕过用户确认。实际发送待邮件服务集成。
    return requestEmailSend(payload || {});
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "email_send_failed",
      message: err && err.message ? err.message : "邮件发送处理失败。",
      sent: false,
    };
  }
});

ipcMain.handle("actBehalf:exportVideoAudioScript", async (_e, payload) => {
  try {
    const taskId = payload && payload.taskId;
    if (!taskId) {
      return { ok: false, code: "invalid_payload", message: "缺少任务标识。" };
    }
    const got = actBehalfStore.getTask(app.getPath("userData"), taskId);
    if (!got.ok) {
      return { ok: false, code: got.code || "task_not_found", message: got.message || "找不到该任务。" };
    }
    const script = got.task && got.task.videoAudioScript;
    if (!script) {
      return { ok: false, code: "script_not_found", message: "该任务没有可导出的视频/音频脚本。" };
    }
    const artifact = buildVideoAudioExport(script, payload && payload.format);
    if (!artifact.ok) return artifact;
    const safe = safeFileStem(script.title || got.task.title || "video-audio-script");
    const res = await dialog.showSaveDialog({
      title: "导出视频/音频脚本（" + artifact.filterName + "）",
      defaultPath: path.join(draftsDir(), safe + "." + artifact.ext),
      filters: [{ name: artifact.filterName, extensions: [artifact.ext] }],
    });
    if (res.canceled || !res.filePath) return { ok: true, canceled: true };
    fs.writeFileSync(res.filePath, artifact.content, "utf8");
    return { ok: true, canceled: false, filePath: res.filePath, format: artifact.format };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "export_failed",
      message: err && err.message ? err.message : "导出脚本失败。",
    };
  }
});

ipcMain.handle("actBehalf:list", async () => {
  try {
    return actBehalfStore.listTasks(app.getPath("userData"));
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "list_failed",
      message: err && err.message ? err.message : "无法列出任务。",
      tasks: [],
    };
  }
});

ipcMain.handle("actBehalf:get", async (_e, taskId) => {
  try {
    const userData = app.getPath("userData");
    let packageDir = null;
    try {
      packageDir = packageDirFromConfig();
    } catch {
      packageDir = null;
    }
    const got = actBehalfStore.getTask(userData, taskId, { packageDir });
    if (got.ok && (got.invocationsHealed || got.resultsHealed || got.proposalsHealed)) {
      await actBehalfStore.saveTask(userData, got.task);
      return actBehalfStore.getTask(userData, taskId, { packageDir });
    }
    return got;
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "get_failed",
      message: err && err.message ? err.message : "无法读取任务。",
    };
  }
});

ipcMain.handle("actBehalf:startResearch", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId;
    if (!taskId) {
      return { ok: false, code: "task_not_found", message: "请先保存并确认任务后再开始调研。" };
    }
    // Renderer may only submit taskId + allowed skill id; never trust results/sources.
    if (payload && (payload.discoveredSources || payload.resultRefs || payload.invocations || payload.toolInvocation)) {
      return {
        ok: false,
        code: "untrusted_renderer_result",
        message: "不允许由界面提交调研结果。",
      };
    }

    personalSkills.ensurePresetResearchSkills(userData);

    // Prepare recommended extensions when possible; DuckDuckGo remains the no-key fallback.
    try {
      await ensureExtensionConnected("brave-search");
    } catch {
      /* optional */
    }

    const result = await runReadonlyExternalResearch({
      userData,
      taskId: String(taskId),
      skillId: (payload && payload.skillId) || ALLOWED_SKILL_ID,
      store: actBehalfStore,
      skills: personalSkills,
      searchWeb: async (em, query) => researchWebSearch.searchWeb(em, query),
      getExtensionManager,
      // Production path never sets forceFake
    });
    return {
      ...result,
      researchCurrent: result.task ? isResearchResultCurrent(result.task) : false,
    };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "research_failed",
      message: err && err.message ? err.message : "外部调研失败。",
    };
  }
});

ipcMain.handle("actBehalf:getResearchSkill", async () => {
  try {
    const userData = app.getPath("userData");
    personalSkills.ensurePresetResearchSkills(userData);
    let skill = personalSkills.getSkill(userData, ALLOWED_SKILL_ID);
    if (!skill) {
      skill = researchPresets.PRESET_RESEARCH_SKILLS.find((s) => s.id === ALLOWED_SKILL_ID) || null;
    }
    if (!skill) {
      return { ok: false, code: "skill_not_found", message: "无法加载通用调研 Skill。" };
    }
    return {
      ok: true,
      skill: {
        id: skill.id,
        title: skill.title,
        blurb: skill.blurb,
        steps: skill.steps || [],
        recommendedExtensions: skill.recommendedExtensions || [],
        permissionScope: ["readonly_external_research"],
      },
    };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "skill_failed",
      message: err && err.message ? err.message : "无法读取 Skill。",
    };
  }
});

ipcMain.handle("actBehalf:generateResult", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId;
    if (!taskId) {
      return { ok: false, code: "task_not_found", message: "请先保存任务后再生成成果。" };
    }
    if (
      payload &&
      (payload.sections ||
        payload.results ||
        payload.subjectEvidence ||
        payload.externalEvidence ||
        payload.inferences ||
        payload.finalDraft ||
        payload.invocations ||
        payload.discoveredSources ||
        payload.subjectContext)
    ) {
      return {
        ok: false,
        code: "untrusted_renderer_result",
        message: "不允许由界面提交成果或证据内容。",
      };
    }

    const cfg = readConfig();
    const result = await generateResearchExpressionResult({
      userData,
      taskId: String(taskId),
      store: actBehalfStore,
      skills: personalSkills,
      continueWithoutExternalSources: !!(payload && payload.continueWithoutExternalSources),
      callModel: async (messages, options = {}) => {
        if (!cfg || !cfg.apiKey) {
          const err = new Error("请先在设置中配置可用的模型，再生成研究与表达成果。");
          err.code = "no_api_key";
          throw err;
        }
        const content = await callModel(cfg, messages, {
          temperature: options.temperature != null ? options.temperature : 0.3,
        });
        return {
          content,
          provider: "configured_model",
          model: cfg.model || null,
          usedFake: false,
        };
      },
    });
    if (result.ok && result.task) {
      const cur = latestCurrentResult(result.task);
      return {
        ...result,
        resultCurrent: cur ? isResultCurrent(result.task, cur) : false,
      };
    }
    return result;
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "generate_failed",
      message: err && err.message ? err.message : "无法生成成果。",
    };
  }
});

ipcMain.handle("actBehalf:saveResultDraft", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    if (
      payload &&
      (payload.sections ||
        payload.revisions ||
        payload.subjectEvidence ||
        payload.externalEvidence ||
        payload.invocations)
    ) {
      return {
        ok: false,
        code: "untrusted_renderer_result",
        message: "不允许由界面提交证据或修订历史。",
      };
    }
    return await saveResultDraftFromRenderer(actBehalfStore, userData, payload || {});
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "save_result_failed",
      message: err && err.message ? err.message : "无法保存成果修改。",
    };
  }
});

// Auto-route tasks keep a lightweight `result` string instead of the evidence
// result schema.  Save it through the same main-process boundary so "copy" is
// never mistaken for persistence and the task remains reopenable after restart.
ipcMain.handle("actBehalf:saveAutoResult", async (_e, payload) => {
  try {
    const taskId = String((payload && payload.taskId) || "");
    const currentText = String((payload && payload.currentText) || "").trim();
    if (!taskId || !currentText) return { ok: false, code: "invalid_result", message: "没有可保存的成果正文。" };
    const userData = app.getPath("userData");
    const got = actBehalfStore.getTask(userData, taskId, { heal: false });
    if (!got.ok) return got;
    const adopted = payload && payload.decision === "adopted";
    const task = { ...got.task, result: currentText, status: adopted ? "result_adopted" : "result_saved", resultSavedAt: new Date().toISOString(), ownerDecision: adopted ? "adopted" : got.task.ownerDecision || "pending" };
    const saved = await actBehalfStore.saveTask(userData, task);
    return { ...saved, entry: "做事 > 任务列表" };
  } catch (err) {
    return { ok: false, code: "save_result_failed", message: err && err.message ? err.message : "无法保存成果。" };
  }
});

ipcMain.handle("actBehalf:decideResult", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    return await decideResultFromRenderer(actBehalfStore, userData, payload || {});
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "decide_failed",
      message: err && err.message ? err.message : "无法保存处置决定。",
    };
  }
});

ipcMain.handle("actBehalf:createExperienceProposal", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId;
    const resultId = payload && payload.resultId;
    if (!taskId || !resultId) {
      return { ok: false, code: "invalid_payload", message: "缺少任务或成果标识。" };
    }
    if (
      payload &&
      (payload.candidates ||
        payload.proposals ||
        payload.packageBaseRef ||
        payload.modelInvocation ||
        payload.preview ||
        payload.apply ||
        payload.sections ||
        payload.results)
    ) {
      return {
        ok: false,
        code: "untrusted_renderer_proposal",
        message: "不允许由界面提交学习建议或资料包字段。",
      };
    }
    const pkgDir = packageDirFromConfig();
    const cfg = readConfig();
    return await createExperienceProposal({
      userData,
      taskId: String(taskId),
      resultId: String(resultId),
      store: actBehalfStore,
      packageDir: pkgDir,
      loadPackage: loadPackageForActBehalf,
      callModel: async (messages, options = {}) => {
        const content = await callModel(cfg, messages, {
          temperature: options.temperature != null ? options.temperature : 0.2,
          taskType: "review",
        });
        return {
          content,
          provider: "configured_model",
          model: cfg.model || null,
          usedFake: false,
        };
      },
    });
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "proposal_failed",
      message: err && err.message ? err.message : "无法生成学习建议。",
    };
  }
});

ipcMain.handle("actBehalf:saveExperienceProposalReview", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    if (
      payload &&
      (payload.packageBaseRef ||
        payload.modelInvocation ||
        payload.preview ||
        payload.apply ||
        payload.status ||
        payload.originalProposedText)
    ) {
      return {
        ok: false,
        code: "untrusted_renderer_proposal",
        message: "审阅保存仅接受候选项的采用/修改/排除。",
      };
    }
    return await saveExperienceProposalReview(actBehalfStore, userData, payload || {});
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "review_failed",
      message: err && err.message ? err.message : "无法保存审阅。",
    };
  }
});

ipcMain.handle("actBehalf:previewExperienceProposal", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    return await previewExperienceProposal({
      userData,
      store: actBehalfStore,
      packageDir: packageDirFromConfig(),
      payload: payload || {},
    });
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "preview_failed",
      message: err && err.message ? err.message : "无法生成变更预览。",
    };
  }
});

ipcMain.handle("actBehalf:applyExperienceProposal", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    return await applyExperienceProposal({
      userData,
      store: actBehalfStore,
      packageDir: packageDirFromConfig(),
      payload: payload || {},
    });
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "apply_failed",
      message: err && err.message ? err.message : "无法写入主体资料包。",
    };
  }
});

ipcMain.handle("actBehalf:rejectExperienceProposal", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    return await rejectExperienceProposal(actBehalfStore, userData, payload || {});
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "reject_failed",
      message: err && err.message ? err.message : "无法拒绝学习建议。",
    };
  }
});

ipcMain.handle("actBehalf:save", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    // Production boundary helper: ignores renderer invocations / selectedSkillId / sources.
    return await saveDraftFromRenderer(actBehalfStore, userData, payload || {});
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "save_failed",
      message: err && err.message ? err.message : "无法保存任务。",
    };
  }
});

/** DVL2-01: narrow plan IPC (prefix actBehalf:plan*). */
function newPlanningAuditId() {
  return "plaudit_" + Date.now().toString(36) + "_" + require("node:crypto").randomBytes(3).toString("hex");
}

function planningInputDigest(fields) {
  const names = Object.keys(fields || {})
    .filter((k) => fields[k] != null && String(fields[k]).trim() !== "")
    .sort();
  return { fieldNames: names, fieldCount: names.length };
}

function mapPlanningPurposeToTaskType(purpose) {
  if (purpose === "deliverable_planning") return "artifact";
  return purpose || "artifact";
}

function buildDeliverablePlanView(plan, task, consistencyExtra) {
  const version = deliverablePlanConsistency.pickDisplayVersion(plan);
  const readiness = recomputeExecutionReadiness(version);
  const confirmed =
    plan && plan.activeConfirmedVersionId && plan.versions
      ? plan.versions[plan.activeConfirmedVersionId]
      : null;
  const draft =
    plan && plan.currentDraftVersionId && plan.versions ? plan.versions[plan.currentDraftVersionId] : null;
  const items = ((version && version.items) || []).map((it) => ({
    ...it,
    supportStatusLabel: deliverablePlanConsistency.supportStatusLabel(it),
  }));
  let statusBanner = "";
  if (consistencyExtra && consistencyExtra.failClosed) {
    statusBanner =
      (consistencyExtra && consistencyExtra.message) ||
      "成果计划一致性异常，已暂停编辑与确认，请先修复。";
  } else if (confirmed && !draft) {
    statusBanner = "成果计划已准备，尚未开始执行。";
  } else if (confirmed && draft) {
    statusBanner = "已有确认计划；当前草稿尚未确认，确认前仍以已确认计划为准。";
  } else if (draft) {
    statusBanner = "成果计划草稿可编辑，尚未确认。";
  }
  const revision = deliverablePlanConsistency.revisionTokensFromPlan(plan);
  return {
    ok: !(consistencyExtra && consistencyExtra.failClosed),
    taskId: task && task.taskId,
    deliverablePlanning:
      (consistencyExtra && consistencyExtra.deliverablePlanning) ||
      (task && task.deliverablePlanning) ||
      deliverablePlanConsistency.pointersFromRecord(plan),
    plan,
    version: version
      ? {
          ...version,
          items,
        }
      : null,
    readiness,
    statusBanner,
    revision,
    consistency: consistencyExtra || { status: "ok" },
  };
}

async function saveTaskPlanPointers(userData, taskId, { deliverablePlanning, auditEvent, planningInvocation, extraPatch }) {
  const got = actBehalfStore.getTask(userData, taskId, { heal: false });
  if (!got.ok) return got;
  let audit = got.task.audit;
  if (auditEvent) {
    audit = deliverablePlanConsistency.appendAudit({ audit }, auditEvent);
  }
  if (planningInvocation) {
    audit = deliverablePlanConsistency.appendPlanningInvocation({ audit }, planningInvocation);
  }
  const next = {
    ...got.task,
    ...(extraPatch || {}),
    deliverablePlanning,
    audit,
  };
  return actBehalfStore.saveTask(userData, next);
}

function assertPlanMutable(task, plan) {
  if (deliverablePlanConsistency.isInactiveLifecycle(task && task.lifecycleStatus)) {
    return { ok: false, code: "task_inactive", message: "已归档或已删除的任务不可继续规划。" };
  }
  if (plan && deliverablePlanConsistency.isInactiveLifecycle(plan.lifecycleStatus)) {
    return { ok: false, code: "plan_inactive", message: "已归档或已删除的成果计划不可编辑或确认。" };
  }
  return { ok: true };
}

async function reconcileDeliverablePlanForTask(userData, taskId) {
  const got = actBehalfStore.getTask(userData, taskId, { heal: false });
  if (!got.ok) return got;
  const plans = deliverablePlanStore.findPlanByTaskId(userData, taskId);
  // Also check pointer planId directly (may differ from taskId index if rebind attempted)
  const ptr = got.task.deliverablePlanning || {};
  if (ptr.planId && !plans.some((p) => p.planId === ptr.planId)) {
    const byId = deliverablePlanStore.getPlan(userData, ptr.planId);
    if (!byId.ok) {
      const result = deliverablePlanConsistency.reconcileTaskAndPlans({
        task: got.task,
        plansForTask: [],
      });
      const view = buildDeliverablePlanView(null, got.task, {
        failClosed: true,
        status: "fail_closed",
        code: result.code,
        message: result.message,
        conflicts: result.conflicts,
        audits: result.audits,
        deliverablePlanning: result.deliverablePlanning,
      });
      return {
        ...view,
        ok: false,
        failClosed: true,
        code: result.code || "plan_missing_for_task_pointer",
        message: result.message,
        conflicts: result.conflicts,
        audits: result.audits,
      };
    }
  }

  const result = deliverablePlanConsistency.reconcileTaskAndPlans({
    task: got.task,
    plansForTask: plans,
  });

  // failClosed: never persist patches
  if (!result.failClosed) {
    if (result.safePlanPatch) {
      await deliverablePlanStore.savePlanRecord(userData, result.safePlanPatch, {
        expectedRevision: result.casExpectedRevision,
      });
    }
    if (result.safeTaskPatch && Object.keys(result.safeTaskPatch).length) {
      let audit = got.task.audit;
      for (const ev of result.audits || []) {
        audit = deliverablePlanConsistency.appendAudit({ audit }, ev);
      }
      await actBehalfStore.saveTask(userData, {
        ...got.task,
        ...result.safeTaskPatch,
        audit,
      });
    }
  }

  const refreshed = actBehalfStore.getTask(userData, taskId, { heal: false });
  const plan =
    (result.plans && result.plans[0]) ||
    (refreshed.ok && refreshed.task.deliverablePlanning && refreshed.task.deliverablePlanning.planId
      ? (() => {
          const g = deliverablePlanStore.getPlan(userData, refreshed.task.deliverablePlanning.planId);
          return g.ok ? g.plan : null;
        })()
      : null);
  const view = buildDeliverablePlanView(plan, refreshed.task, {
    failClosed: !!result.failClosed,
    status: result.failClosed ? "fail_closed" : "ok",
    code: result.code,
    message: result.message,
    conflicts: result.conflicts || [],
    audits: result.audits || [],
    deliverablePlanning: result.deliverablePlanning,
  });
  return {
    ...view,
    ok: !result.failClosed,
    failClosed: !!result.failClosed,
    code: result.failClosed ? result.code || "fail_closed" : undefined,
    message: result.failClosed
      ? result.message ||
        ((result.conflicts && result.conflicts[0] && result.conflicts[0].message) ||
          "计划一致性冲突，已停止自动修复。")
      : undefined,
    conflicts: result.conflicts,
    audits: result.audits,
  };
}

async function loadPlanForTaskOrFail(userData, taskId) {
  const got = actBehalfStore.getTask(userData, taskId, { heal: false });
  if (!got.ok) return { ...got, task: null, plan: null };
  const mutable = assertPlanMutable(got.task, null);
  if (!mutable.ok) return { ...mutable, task: got.task, plan: null };

  const ptr = got.task.deliverablePlanning || {};
  if (ptr.planId) {
    const byId = deliverablePlanStore.getPlan(userData, ptr.planId);
    if (!byId.ok) {
      const rec = await reconcileDeliverablePlanForTask(userData, taskId);
      return { ok: false, code: rec.code || "plan_missing_for_task_pointer", message: rec.message, task: got.task, plan: null, reconcile: rec };
    }
  }

  const plans = deliverablePlanStore.findPlanByTaskId(userData, taskId);
  if (plans.length > 1) {
    const rec = await reconcileDeliverablePlanForTask(userData, taskId);
    return { ok: false, code: rec.code || "multiple_plan_records", message: rec.message, task: got.task, plan: null, reconcile: rec };
  }
  const plan = plans[0] || null;
  const inactive = assertPlanMutable(got.task, plan);
  if (!inactive.ok) return { ...inactive, task: got.task, plan };
  return { ok: true, task: got.task, plan };
}

function extractRevisionExpected(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (
    payload.expectedPlanUpdatedAt != null ||
    payload.expectedCurrentDraftVersionId != null ||
    payload.expectedActiveConfirmedVersionId != null
  ) {
    return {
      expectedPlanUpdatedAt: payload.expectedPlanUpdatedAt ?? null,
      expectedCurrentDraftVersionId: payload.expectedCurrentDraftVersionId ?? null,
      expectedActiveConfirmedVersionId: payload.expectedActiveConfirmedVersionId ?? null,
    };
  }
  if (payload.revision && typeof payload.revision === "object") {
    return {
      expectedPlanUpdatedAt: payload.revision.expectedPlanUpdatedAt ?? null,
      expectedCurrentDraftVersionId: payload.revision.expectedCurrentDraftVersionId ?? null,
      expectedActiveConfirmedVersionId: payload.revision.expectedActiveConfirmedVersionId ?? null,
    };
  }
  return null;
}

async function assertFreshPlan(userData, planId, expected) {
  if (!planId) return { ok: true, plan: null };
  const fresh = deliverablePlanStore.getPlan(userData, planId);
  if (!fresh.ok) return fresh;
  const match = deliverablePlanConsistency.assertRevisionMatch(fresh.plan, expected);
  if (!match.ok) return match;
  return { ok: true, plan: fresh.plan };
}

ipcMain.handle("actBehalf:planEnsure", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    let taskId = payload && payload.taskId ? String(payload.taskId) : "";
    const goal = String((payload && (payload.goal || payload.request)) || "").trim();
    if (!taskId) {
      if (!goal) return { ok: false, code: "empty_goal", message: "请先填写任务目标。" };
      const saved = await saveDraftFromRenderer(actBehalfStore, userData, payload || {});
      if (!saved.ok) return saved;
      taskId = saved.task.taskId;
    }
    const got = actBehalfStore.getTask(userData, taskId, { heal: false });
    if (!got.ok) return got;
    const inactive = assertPlanMutable(got.task, null);
    if (!inactive.ok) return inactive;

    const ptr = got.task.deliverablePlanning || {};
    if (ptr.planId) {
      const existing = deliverablePlanStore.getPlan(userData, ptr.planId);
      if (!existing.ok) {
        return reconcileDeliverablePlanForTask(userData, taskId);
      }
      return buildDeliverablePlanView(existing.plan, got.task, { status: "ok" });
    }

    let plans = deliverablePlanStore.findPlanByTaskId(userData, taskId);
    if (plans.length > 1) {
      return reconcileDeliverablePlanForTask(userData, taskId);
    }
    if (plans[0]) {
      return buildDeliverablePlanView(plans[0], got.task, { status: "ok" });
    }

    // No pointers and no plan — create shell via rule-based suggestion
    const g = goal || String((got.task.taskIntent && got.task.taskIntent.goal) || got.task.goal || "").trim();
    const suggestion = deliverablePlanner.ruleBasedPlan({ goal: g || "未命名目标" });
    const applied = deliverablePlanner.applySuggestionToRecord({
      taskId,
      existingRecord: null,
      suggestion: suggestion.ok
        ? suggestion
        : {
            ok: true,
            understanding: require("./act-behalf/deliverable-plan-schema").emptyUnderstanding(g),
            items: [],
          },
      goal: g,
    });
    const committed = await deliverablePlanConsistency.commitPlanThenTask({
      userData,
      planRecord: applied.plan,
      saveTaskPointers: (args) => saveTaskPlanPointers(userData, taskId, args),
      auditEvent: { action: "plan_ensure_created" },
      cas: { expectAbsent: true },
    });
    if (!committed.ok) {
      return {
        ...committed,
        ...buildDeliverablePlanView(committed.plan || applied.plan, got.task, {
          status: committed.consistency || "failed",
        }),
      };
    }
    return buildDeliverablePlanView(committed.plan, committed.task, { status: "ok" });
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "plan_ensure_failed",
      message: err && err.message ? err.message : "无法准备成果计划。",
    };
  }
});

ipcMain.handle("actBehalf:planGenerate", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    let taskId = payload && payload.taskId ? String(payload.taskId) : "";
    const goal = String((payload && (payload.goal || payload.request)) || "").trim();
    if (!goal) return { ok: false, code: "empty_goal", message: "请先填写任务目标。" };
    if (!taskId) {
      const saved = await saveDraftFromRenderer(actBehalfStore, userData, payload || {});
      if (!saved.ok) return saved;
      taskId = saved.task.taskId;
    } else {
      await saveDraftFromRenderer(actBehalfStore, userData, { ...(payload || {}), taskId, goal });
    }

    const loaded = await loadPlanForTaskOrFail(userData, taskId);
    if (!loaded.ok) return loaded.reconcile || loaded;

    if (loaded.plan) {
      const expected = extractRevisionExpected(payload);
      const fresh = await assertFreshPlan(userData, loaded.plan.planId, expected);
      if (!fresh.ok) return fresh;
      loaded.plan = fresh.plan;
    }

    const planningAuditId = newPlanningAuditId();
    const inputFields = {
      goal,
      audience: payload && payload.audience,
      usage: payload && payload.usage,
      constraints: payload && payload.constraints,
      deadline: payload && payload.deadline,
      expectedQuality: payload && payload.expectedQuality,
    };
    const digest = planningInputDigest(inputFields);

    const forceRule =
      process.env.DIGITALME_PLANNER_FORCE_RULE === "1" ||
      process.env.DIGITALME_ACT_BEHALF_FAKE === "1" ||
      !!(payload && payload.forceRule);

    let routeUsed = null;
    const callModelFn = forceRule
      ? null
      : async (messages, options) => {
          const cfg = readConfig();
          const purpose = (options && options.purpose) || "deliverable_planning";
          const taskType = mapPlanningPurposeToTaskType(purpose);
          try {
            const content = await callModel(cfg, messages, { ...(options || {}), taskType });
            routeUsed = { purpose, mappedTaskType: taskType, ok: true };
            // Frozen adapter contract: return string only (route meta via closure).
            return String(content == null ? "" : content);
          } catch (err) {
            routeUsed = {
              purpose,
              mappedTaskType: taskType,
              ok: false,
              errorCode: err && err.code,
            };
            throw err;
          }
        };

    const suggestion = await deliverablePlanner.generatePlanSuggestion(inputFields, {
      callModel: callModelFn,
      forceRule,
    });

    const planningInvocationBase = {
      id: planningAuditId,
      taskId,
      planId: loaded.plan ? loaded.plan.planId : null,
      versionId: null,
      mode: suggestion.mode || (forceRule ? "rule_based" : "model_assisted"),
      purpose: "deliverable_planning",
      route: routeUsed || (forceRule ? { purpose: "deliverable_planning", mappedTaskType: "artifact", forcedRule: true } : null),
      ok: !!suggestion.ok,
      errorCode: suggestion.ok ? null : suggestion.code || null,
      modelError: suggestion.modelError || null,
      at: new Date().toISOString(),
      inputDigest: digest,
    };

    if (!suggestion.ok) {
      await saveTaskPlanPointers(userData, taskId, {
        deliverablePlanning: loaded.task.deliverablePlanning,
        planningInvocation: planningInvocationBase,
      });
      return suggestion;
    }

    suggestion.planningInvocationRef = planningAuditId;

    const applied = deliverablePlanner.applySuggestionToRecord({
      taskId,
      existingRecord: loaded.plan,
      suggestion,
      goal,
    });
    if (!applied.ok) return applied;

    planningInvocationBase.planId = applied.plan.planId;
    planningInvocationBase.versionId = applied.version && applied.version.versionId;
    planningInvocationBase.mode = suggestion.mode;

    const cas = loaded.plan
      ? { expectedRevision: extractRevisionExpected(payload) || deliverablePlanConsistency.revisionTokensFromPlan(loaded.plan) }
      : { expectAbsent: true };

    const committed = await deliverablePlanConsistency.commitPlanThenTask({
      userData,
      planRecord: applied.plan,
      saveTaskPointers: (args) =>
        saveTaskPlanPointers(userData, taskId, {
          ...args,
          planningInvocation: planningInvocationBase,
        }),
      auditEvent: {
        action: "plan_generate",
        mode: suggestion.mode,
        planningInvocationRef: planningAuditId,
      },
      cas,
    });
    const view = buildDeliverablePlanView(committed.plan || applied.plan, committed.task || loaded.task, {
      status: committed.consistency || (committed.ok ? "ok" : "failed"),
    });
    return {
      ...view,
      ok: committed.ok,
      code: committed.code,
      message: committed.message,
      consistency: committed.consistency,
      planningMode: suggestion.mode,
      planningInvocationRef: planningAuditId,
      modelError: suggestion.modelError || null,
      needsReconcile: committed.needsReconcile || false,
    };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "plan_generate_failed",
      message: err && err.message ? err.message : "无法形成预计交付。",
    };
  }
});

ipcMain.handle("actBehalf:planSaveDraft", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId ? String(payload.taskId) : "";
    if (!taskId) return { ok: false, code: "task_required", message: "请先保存任务后再保存成果计划草稿。" };
    const loaded = await loadPlanForTaskOrFail(userData, taskId);
    if (!loaded.ok) return loaded.reconcile || loaded;
    if (!loaded.plan) return { ok: false, code: "plan_not_found", message: "尚未形成成果计划。" };

    const expected = extractRevisionExpected(payload);
    const fresh = await assertFreshPlan(userData, loaded.plan.planId, expected);
    if (!fresh.ok) return fresh;

    if (payload && payload.items) {
      const graph = validateDependencyGraph(payload.items);
      if (!graph.ok) {
        return {
          ok: false,
          code: "graph_invalid",
          message: "预计交付依赖关系无效，请先修正。",
          errors: graph.errors,
        };
      }
    }

    const edited = deliverablePlanner.saveDraftEdits(fresh.plan, {
      understanding: payload && payload.understanding,
      items: payload && payload.items,
    });
    if (!edited.ok) return edited;

    const committed = await deliverablePlanConsistency.commitPlanThenTask({
      userData,
      planRecord: edited.plan,
      saveTaskPointers: (args) => saveTaskPlanPointers(userData, taskId, args),
      auditEvent: { action: "plan_save_draft" },
      cas: {
        expectedRevision:
          extractRevisionExpected(payload) || deliverablePlanConsistency.revisionTokensFromPlan(fresh.plan),
      },
    });
    const view = buildDeliverablePlanView(committed.plan || edited.plan, committed.task || loaded.task, {
      status: committed.consistency || (committed.ok ? "ok" : "failed"),
    });
    return {
      ...view,
      ok: committed.ok,
      code: committed.code,
      message: committed.message || (committed.ok ? "草稿已保存。" : undefined),
      consistency: committed.consistency,
      needsReconcile: committed.needsReconcile || false,
    };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "plan_save_failed",
      message: err && err.message ? err.message : "无法保存成果计划草稿。",
    };
  }
});

ipcMain.handle("actBehalf:planConfirm", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId ? String(payload.taskId) : "";
    if (!taskId) return { ok: false, code: "task_required", message: "请先保存任务后再确认成果计划。" };
    const loaded = await loadPlanForTaskOrFail(userData, taskId);
    if (!loaded.ok) return loaded.reconcile || loaded;
    if (!loaded.plan) return { ok: false, code: "plan_not_found", message: "尚未形成成果计划。" };

    const expected = extractRevisionExpected(payload);
    const fresh = await assertFreshPlan(userData, loaded.plan.planId, expected);
    if (!fresh.ok) return fresh;

    const confirmed = deliverablePlanner.confirmDraft(fresh.plan);
    if (!confirmed.ok) return confirmed;

    const committed = await deliverablePlanConsistency.commitPlanThenTask({
      userData,
      planRecord: confirmed.plan,
      saveTaskPointers: (args) =>
        saveTaskPlanPointers(userData, taskId, {
          ...args,
          extraPatch: {
            status: "plan_confirmed",
            // DVL2-02: new confirmed plan version clears package pointer; old packages retained.
            deliverableExecution: { activePackageId: null },
          },
        }),
      auditEvent: { action: "plan_confirm", versionId: confirmed.version.versionId },
      cas: {
        expectedRevision:
          extractRevisionExpected(payload) || deliverablePlanConsistency.revisionTokensFromPlan(fresh.plan),
      },
    });
    const view = buildDeliverablePlanView(committed.plan || confirmed.plan, committed.task || loaded.task, {
      status: committed.consistency || (committed.ok ? "ok" : "failed"),
    });
    return {
      ...view,
      ok: committed.ok,
      code: committed.code,
      message: committed.ok ? "成果计划已准备，尚未开始执行。" : committed.message,
      consistency: committed.consistency,
      needsReconcile: committed.needsReconcile || false,
    };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "plan_confirm_failed",
      message: err && err.message ? err.message : "无法确认成果计划。",
    };
  }
});

ipcMain.handle("actBehalf:planCancelDraft", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId ? String(payload.taskId) : "";
    if (!taskId) return { ok: false, code: "task_required", message: "缺少任务。" };
    const loaded = await loadPlanForTaskOrFail(userData, taskId);
    if (!loaded.ok) return loaded.reconcile || loaded;
    if (!loaded.plan) return { ok: false, code: "plan_not_found", message: "尚未形成成果计划。" };

    const expected = extractRevisionExpected(payload);
    const fresh = await assertFreshPlan(userData, loaded.plan.planId, expected);
    if (!fresh.ok) return fresh;

    const cancelled = deliverablePlanner.cancelDraft(fresh.plan);
    if (!cancelled.ok) return cancelled;

    const committed = await deliverablePlanConsistency.commitPlanThenTask({
      userData,
      planRecord: cancelled.plan,
      saveTaskPointers: (args) => saveTaskPlanPointers(userData, taskId, args),
      auditEvent: { action: "plan_cancel_draft" },
      cas: {
        expectedRevision:
          extractRevisionExpected(payload) || deliverablePlanConsistency.revisionTokensFromPlan(fresh.plan),
      },
    });
    const view = buildDeliverablePlanView(committed.plan || cancelled.plan, committed.task || loaded.task, {
      status: committed.consistency || (committed.ok ? "ok" : "failed"),
    });
    return {
      ...view,
      ok: committed.ok,
      code: committed.code,
      message: committed.message || (committed.ok ? "已取消当前草稿。" : undefined),
      consistency: committed.consistency,
      needsReconcile: committed.needsReconcile || false,
    };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "plan_cancel_failed",
      message: err && err.message ? err.message : "无法取消草稿。",
    };
  }
});

async function syncPlanTaskLifecycle(userData, taskId, lifecycleStatus, expectedRevision) {
  const got = actBehalfStore.getTask(userData, taskId, { heal: false });
  if (!got.ok) return got;
  const plans = deliverablePlanStore.findPlanByTaskId(userData, taskId);
  const ptr = got.task.deliverablePlanning || {};
  let plan = plans[0] || null;
  if (!plan && ptr.planId) {
    const byId = deliverablePlanStore.getPlan(userData, ptr.planId);
    if (byId.ok) plan = byId.plan;
  }
  if (!plan) {
    return { ok: false, code: "plan_not_found", message: "该任务没有可同步的成果计划。" };
  }

  const expected =
    expectedRevision || deliverablePlanConsistency.revisionTokensFromPlan(plan);
  const nextPlan = deliverablePlanConsistency.applyLifecycleToPlan(plan, lifecycleStatus);
  let planResult;
  try {
    planResult = await deliverablePlanStore.savePlanRecord(userData, nextPlan, {
      expectedRevision: expected,
    });
  } catch (err) {
    return {
      ok: false,
      code: (err && err.code) || "plan_store_write_failed",
      message: (err && err.message) || "无法更新成果计划生命周期。",
      current: err && err.current,
    };
  }

  try {
    const taskSaved = await actBehalfStore.saveTask(userData, {
      ...got.task,
      lifecycleStatus,
      status: lifecycleStatus,
      deliverablePlanning: deliverablePlanConsistency.pointersFromRecord(planResult.plan),
      audit: deliverablePlanConsistency.appendAudit(got.task, {
        action: "lifecycle_" + lifecycleStatus,
        planId: planResult.plan.planId,
      }),
    });
    return {
      ok: true,
      consistency: "ok",
      plan: planResult.plan,
      task: taskSaved.task,
      ...buildDeliverablePlanView(planResult.plan, taskSaved.task, { status: "ok" }),
    };
  } catch (err) {
    return {
      ok: false,
      code: "degraded_consistency",
      message: "计划生命周期已写入，任务状态待同步。",
      consistency: "degraded_consistency",
      plan: planResult.plan,
      needsReconcile: true,
      taskError: {
        code: (err && err.code) || "task_store_write_failed",
        message: (err && err.message) || "任务生命周期写入失败。",
      },
    };
  }
}

ipcMain.handle("actBehalf:planArchive", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId ? String(payload.taskId) : "";
    if (!taskId) return { ok: false, code: "task_required", message: "缺少任务。" };
    const got = actBehalfStore.getTask(userData, taskId, { heal: false });
    if (!got.ok) return got;
    const plans = deliverablePlanStore.findPlanByTaskId(userData, taskId);
    if (!plans.length) {
      const ptr = got.task.deliverablePlanning || {};
      if (ptr.planId) return reconcileDeliverablePlanForTask(userData, taskId);
      return { ok: false, code: "plan_not_found", message: "尚未形成成果计划。" };
    }
    if (plans.length > 1) return reconcileDeliverablePlanForTask(userData, taskId);
    const expected = extractRevisionExpected(payload);
    return syncPlanTaskLifecycle(userData, taskId, "archived", expected);
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "plan_archive_failed",
      message: err && err.message ? err.message : "无法归档成果计划。",
    };
  }
});

ipcMain.handle("actBehalf:planSoftDelete", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId ? String(payload.taskId) : "";
    if (!taskId) return { ok: false, code: "task_required", message: "缺少任务。" };
    const got = actBehalfStore.getTask(userData, taskId, { heal: false });
    if (!got.ok) return got;
    const plans = deliverablePlanStore.findPlanByTaskId(userData, taskId);
    if (!plans.length) {
      const ptr = got.task.deliverablePlanning || {};
      if (ptr.planId) return reconcileDeliverablePlanForTask(userData, taskId);
      return { ok: false, code: "plan_not_found", message: "尚未形成成果计划。" };
    }
    if (plans.length > 1) return reconcileDeliverablePlanForTask(userData, taskId);
    const expected = extractRevisionExpected(payload);
    return syncPlanTaskLifecycle(userData, taskId, "soft_deleted", expected);
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "plan_soft_delete_failed",
      message: err && err.message ? err.message : "无法软删除成果计划。",
    };
  }
});

ipcMain.handle("actBehalf:planGet", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId ? String(payload.taskId) : "";
    if (!taskId) return { ok: false, code: "task_required", message: "缺少任务。" };
    return reconcileDeliverablePlanForTask(userData, taskId);
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "plan_get_failed",
      message: err && err.message ? err.message : "无法读取成果计划。",
    };
  }
});

/** DVL2-02: package prepare / read — renderer may only pass { taskId } to prepare. */
async function saveTaskPackageExecution(userData, taskId, deliverableExecution) {
  const got = actBehalfStore.getTask(userData, taskId, { heal: false });
  if (!got.ok) {
    const e = new Error(got.message || "找不到该任务。");
    e.code = got.code || "task_not_found";
    throw e;
  }
  return actBehalfStore.saveTask(userData, {
    ...got.task,
    deliverableExecution: {
      activePackageId:
        deliverableExecution && deliverableExecution.activePackageId
          ? String(deliverableExecution.activePackageId)
          : null,
    },
  });
}

async function reconcileDeliverablePackagesForTask(userData, taskId) {
  const got = actBehalfStore.getTask(userData, taskId, { heal: false });
  if (!got.ok) return got;
  let recon;
  try {
    recon = reconcileTaskPackages(userData, got.task);
  } catch (err) {
    return {
      ok: false,
      code: (err && err.code) || "package_reconcile_failed",
      message: (err && err.message) || "无法核对成果包一致性。",
      failClosed: true,
    };
  }
  const nextId =
    recon.deliverableExecution && recon.deliverableExecution.activePackageId != null
      ? String(recon.deliverableExecution.activePackageId)
      : null;
  const prevId =
    got.task.deliverableExecution && got.task.deliverableExecution.activePackageId
      ? String(got.task.deliverableExecution.activePackageId)
      : null;
  let task = got.task;
  if (recon.ok && nextId !== prevId) {
    const saved = await saveTaskPackageExecution(userData, taskId, {
      activePackageId: nextId,
    });
    task = saved.task;
  }
  const packages = deliverablePackageStore.listPackagesForTask(userData, taskId);
  const activePackageId =
    task.deliverableExecution && task.deliverableExecution.activePackageId
      ? String(task.deliverableExecution.activePackageId)
      : null;
  let pkg = null;
  let deliverables = [];
  let readiness = null;
  if (activePackageId) {
    const gotPkg = deliverablePackageStore.getPackage(userData, activePackageId);
    if (gotPkg.ok) {
      pkg = gotPkg.package;
      deliverables = deliverablePackageStore.getDeliverablesForPackage(userData, activePackageId);
      readiness = recomputeCurrentPreparationReadiness(pkg, deliverables);
    }
  }
  return {
    ok: !!recon.ok,
    code: recon.code,
    message: recon.message,
    failClosed: !!recon.failClosed,
    readonly: !!recon.readonly,
    events: recon.events || [],
    taskId,
    deliverableExecution: { activePackageId },
    package: pkg,
    deliverables,
    packages,
    readiness,
  };
}

async function reconcileAllDeliverablePackagePointers(userData) {
  const listed = actBehalfStore.listTasks(userData);
  const tasks = (listed && listed.tasks) || [];
  for (const t of tasks) {
    if (!t || !t.taskId) continue;
    try {
      await reconcileDeliverablePackagesForTask(userData, t.taskId);
    } catch {
      /* fail-closed per task; do not abort startup */
    }
  }
}

ipcMain.handle("actBehalf:prepareDeliverablePackage", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId ? String(payload.taskId) : "";
    if (!taskId) return { ok: false, code: "task_required", message: "缺少任务。" };
    if (payload && Object.keys(payload).some((k) => k !== "taskId")) {
      return {
        ok: false,
        code: "invalid_prepare_input",
        message: "准备成果包只能传入任务标识。",
      };
    }
    // Degraded / pointer drift: reconcile before prepare so we do not create a second package.
    await reconcileDeliverablePackagesForTask(userData, taskId);
    return await prepareDeliverablePackage(
      userData,
      { taskId },
      {
        getTask: (ud, id) => actBehalfStore.getTask(ud, id, { heal: false }),
        getPlan: (ud, planId) => deliverablePlanStore.getPlan(ud, planId),
        saveTaskExecution: (ud, id, exec) => saveTaskPackageExecution(ud, id, exec),
      }
    );
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "prepare_package_failed",
      message: err && err.message ? err.message : "无法准备成果包。",
    };
  }
});

ipcMain.handle("actBehalf:getDeliverablePackage", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId ? String(payload.taskId) : "";
    const packageId = payload && payload.packageId ? String(payload.packageId) : "";
    if (packageId) {
      const got = deliverablePackageStore.getPackage(userData, packageId);
      if (!got.ok) return got;
      const deliverables = deliverablePackageStore.getDeliverablesForPackage(userData, packageId);
      const readiness = recomputeCurrentPreparationReadiness(got.package, deliverables);
      return {
        ok: true,
        package: got.package,
        deliverables,
        readiness,
        revision: got.revision,
      };
    }
    if (!taskId) return { ok: false, code: "task_required", message: "缺少任务或成果包标识。" };
    return reconcileDeliverablePackagesForTask(userData, taskId);
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "get_package_failed",
      message: err && err.message ? err.message : "无法读取成果包。",
    };
  }
});

ipcMain.handle("actBehalf:listDeliverablePackagesForTask", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId ? String(payload.taskId) : "";
    if (!taskId) return { ok: false, code: "task_required", message: "缺少任务。" };
    const view = await reconcileDeliverablePackagesForTask(userData, taskId);
    return {
      ok: view.ok !== false || !view.failClosed,
      code: view.code,
      message: view.message,
      failClosed: view.failClosed,
      taskId,
      deliverableExecution: view.deliverableExecution,
      packages: view.packages || [],
      package: view.package || null,
      deliverables: view.deliverables || [],
      readiness: view.readiness || null,
    };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "list_packages_failed",
      message: err && err.message ? err.message : "无法列出成果包。",
    };
  }
});

// Controlled test-only reconciliation entry (harness / contract injection).
if (
  process.env.DIGITALME_DVL2_02_PACKAGE_ACCEPTANCE === "1" ||
  process.env.DIGITALME_DVL2_02_TEST_RECONCILE === "1" ||
  process.env.DIGITALME_DVL2_03_GENERATION_ACCEPTANCE === "1"
) {
  ipcMain.handle("actBehalf:reconcileDeliverablePackages", async (_e, payload) => {
    try {
      const userData = app.getPath("userData");
      const taskId = payload && payload.taskId ? String(payload.taskId) : "";
      if (!taskId) return { ok: false, code: "task_required", message: "缺少任务。" };
      return reconcileDeliverablePackagesForTask(userData, taskId);
    } catch (err) {
      return {
        ok: false,
        code: err && err.code ? err.code : "package_reconcile_failed",
        message: err && err.message ? err.message : "无法核对成果包。",
      };
    }
  });
}

function buildGenerationCallModel() {
  if (process.env.DIGITALME_DVL2_03_MOCK_MODEL === "1" || process.env.DIGITALME_ACT_BEHALF_FAKE === "1") {
    return null; // generators use deterministic local fallback content
  }
  return async (messages, options = {}) => {
    const cfg = readConfig();
    return callModel(cfg, messages, { ...(options || {}), taskType: options.taskType || "artifact" });
  };
}

function generationImageMode() {
  if (process.env.DIGITALME_DVL2_03_MOCK_IMAGE === "1") return "mock";
  return "real";
}

ipcMain.handle("actBehalf:generateDeliverablePackage", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const packageId = payload && payload.packageId ? String(payload.packageId) : "";
    if (!packageId) return { ok: false, code: "package_required", message: "缺少成果包标识。" };
    if (payload && Object.keys(payload).some((k) => k !== "packageId")) {
      return { ok: false, code: "invalid_generate_input", message: "生成成果包只能传入成果包标识。" };
    }
    return await deliverableGeneration.generateDeliverablePackage(
      userData,
      { packageId },
      { callModel: buildGenerationCallModel(), imageMode: generationImageMode() }
    );
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "generate_package_failed",
      message: err && err.message ? err.message : "无法生成成果。",
    };
  }
});

ipcMain.handle("actBehalf:generateDeliverable", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const packageId = payload && payload.packageId ? String(payload.packageId) : "";
    const deliverableId = payload && payload.deliverableId ? String(payload.deliverableId) : "";
    if (!packageId || !deliverableId) {
      return { ok: false, code: "ids_required", message: "缺少成果包或成果标识。" };
    }
    return await deliverableGeneration.generateOneDeliverable(
      userData,
      { packageId, deliverableId },
      { callModel: buildGenerationCallModel(), imageMode: generationImageMode() }
    );
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "generate_deliverable_failed",
      message: err && err.message ? err.message : "无法生成该项成果。",
    };
  }
});

ipcMain.handle("actBehalf:getDeliverablePackageById", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const packageId = payload && payload.packageId ? String(payload.packageId) : "";
    if (!packageId) return { ok: false, code: "package_required", message: "缺少成果包标识。" };
    return deliverablePackageStore.getPackageView(userData, packageId);
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "get_package_failed",
      message: err && err.message ? err.message : "无法读取成果包。",
    };
  }
});

ipcMain.handle("actBehalf:listDeliverableVersions", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const deliverableId = payload && payload.deliverableId ? String(payload.deliverableId) : "";
    if (!deliverableId) return { ok: false, code: "deliverable_required", message: "缺少成果标识。" };
    return deliverablePackageStore.listVersionsForDeliverable(userData, deliverableId);
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "list_versions_failed",
      message: err && err.message ? err.message : "无法列出版本。",
    };
  }
});

ipcMain.handle("actBehalf:openArtifact", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const artifactRefId = payload && payload.artifactRefId ? String(payload.artifactRefId) : "";
    if (!artifactRefId) return { ok: false, code: "artifact_required", message: "缺少文件引用。" };
    const got = deliverablePackageStore.getArtifact(userData, artifactRefId);
    if (!got.ok) return got;
    const abs = deliverableArtifactFs.resolveAbsolute(userData, got.artifact.relativePath);
    const { shell } = require("electron");
    const err = await shell.openPath(abs);
    if (err) return { ok: false, code: "open_failed", message: err || "无法打开文件。" };
    return { ok: true, relativePath: got.artifact.relativePath };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "open_failed",
      message: err && err.message ? err.message : "无法打开文件。",
    };
  }
});

ipcMain.handle("actBehalf:revealArtifact", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const artifactRefId = payload && payload.artifactRefId ? String(payload.artifactRefId) : "";
    if (!artifactRefId) return { ok: false, code: "artifact_required", message: "缺少文件引用。" };
    const got = deliverablePackageStore.getArtifact(userData, artifactRefId);
    if (!got.ok) return got;
    const abs = deliverableArtifactFs.resolveAbsolute(userData, got.artifact.relativePath);
    const { shell } = require("electron");
    shell.showItemInFolder(abs);
    return { ok: true, relativePath: got.artifact.relativePath };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "reveal_failed",
      message: err && err.message ? err.message : "无法打开所在目录。",
    };
  }
});

ipcMain.handle("actBehalf:reviewDeliverableVersion", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const versionId = payload && payload.versionId ? String(payload.versionId) : "";
    const decision = payload && payload.decision ? String(payload.decision) : "";
    return await deliverableGeneration.reviewDeliverableVersion(userData, { versionId, decision });
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "review_failed",
      message: err && err.message ? err.message : "无法更新审阅状态。",
    };
  }
});

ipcMain.handle("actBehalf:confirmPlanAndGenerate", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId ? String(payload.taskId) : "";
    if (!taskId) return { ok: false, code: "task_required", message: "缺少任务。" };
    return await confirmPlanAndGenerate({
      userData,
      taskId,
      understanding: payload && payload.understanding,
      items: payload && payload.items,
      revisionExpected: payload || {},
      loadPlanForTaskOrFail,
      assertFreshPlan,
      extractRevisionExpected,
      saveTaskPlanPointers,
      buildDeliverablePlanView,
      getTask: (ud, id) => actBehalfStore.getTask(ud, id, { heal: false }),
      getPlan: (ud, planId) => deliverablePlanStore.getPlan(ud, planId),
      saveTaskExecution: (ud, id, exec) => saveTaskPackageExecution(ud, id, exec),
      reconcilePackagesForTask: reconcileDeliverablePackagesForTask,
      callModel: buildGenerationCallModel(),
      imageMode: generationImageMode(),
    });
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "confirm_and_generate_failed",
      message: err && err.message ? err.message : "无法生成成果。",
    };
  }
});

ipcMain.handle("actBehalf:planRecomputeReadiness", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId ? String(payload.taskId) : "";
    if (!taskId) return { ok: false, code: "task_required", message: "缺少任务。" };
    const view = await reconcileDeliverablePlanForTask(userData, taskId);
    if (!view.ok && view.failClosed) return view;
    const readiness = recomputeExecutionReadiness(view.version);
    return { ...view, readiness, ok: true };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "readiness_failed",
      message: err && err.message ? err.message : "无法重新评估执行条件。",
    };
  }
});

ipcMain.handle("actBehalf:planReconcile", async (_e, payload) => {
  try {
    const userData = app.getPath("userData");
    const taskId = payload && payload.taskId ? String(payload.taskId) : "";
    if (!taskId) return { ok: false, code: "task_required", message: "缺少任务。" };
    return reconcileDeliverablePlanForTask(userData, taskId);
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "plan_reconcile_failed",
      message: err && err.message ? err.message : "无法核对成果计划一致性。",
    };
  }
});

ipcMain.handle("actBehalf:run", async (_e, payload) => {
  try {
    const request = String((payload && payload.request) || "").trim();
    if (!request) {
      return { ok: false, code: "empty_request", message: "请输入要完成的任务。" };
    }
    const title =
      String((payload && payload.title) || "").trim() ||
      request.slice(0, 40) + (request.length > 40 ? "…" : "");
    const combinedText = String((payload && payload.selectedSelfContextText) || "").trim();
    const userEdited = !!(payload && payload.userEdited);
    const items = Array.isArray(payload && payload.selectedSelfContextItems)
      ? payload.selectedSelfContextItems
      : [];

    const messages = buildActBehalfMessages({
      request,
      title,
      selectedSelfContextText: combinedText,
    });

    let raw = "";
    let modelMeta = { fake: false };
    if (process.env.DIGITALME_ACT_BEHALF_FAKE === "1") {
      raw = fakeActBehalfModelOutput(request);
      modelMeta = { fake: true };
    } else {
      const cfg = readConfig();
      if (!cfg || !cfg.apiKey) {
        return {
          ok: false,
          code: "no_api_key",
          message: "请先在设置中配置可用的模型，再代表本人完成任务。",
        };
      }
      raw = await callModel(cfg, messages, { temperature: 0.4 });
      modelMeta = {
        fake: false,
        model: cfg.model || "",
      };
    }

    const parsed = parseActBehalfOutput(raw);
    modelMeta.parseOk = parsed.parseOk;
    modelMeta.usedSelfInfo = parsed.usedSelfInfo;

    const saved = await actBehalfStore.saveTask(app.getPath("userData"), {
      taskId: payload && payload.taskId ? payload.taskId : undefined,
      title,
      request,
      status: "completed",
      selectedSelfContext: {
        items,
        combinedText,
        userEdited,
      },
      existingUserPositions: parsed.existingUserPositions,
      digitalMeInferences: parsed.digitalMeInferences,
      result: parsed.result,
      modelMeta,
    });

    return {
      ok: true,
      task: saved.task,
      usedSelfInfo: parsed.usedSelfInfo,
    };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "run_failed",
      message: err && err.message ? err.message : "任务未能完成，请稍后再试。",
    };
  }
});

ipcMain.handle("life:getGraph", (_e, opts) => {
  const dir = packageDirFromConfig();
  return life.getLifeGraph(dir, opts || {});
});

ipcMain.handle("life:getCognition", () => {
  const dir = packageDirFromConfig();
  const pkg = {
    persona: safeRead(path.join(dir, "persona.md")),
    decisionFrameworks: safeRead(path.join(dir, "decision-frameworks.json")),
    longTermMemory: safeRead(path.join(dir, "memory", "long-term-memory.jsonl")),
  };
  const snap = life.getCognitionSnapshot(dir, pkg);
  const boundaries = policies.readBoundaries(dir);
  snap.boundaries = (boundaries.items || []).filter((b) => b.enabled !== false).slice(0, 20);
  snap.gaps = life.buildCoverageGaps(dir, {
    ...pkg,
    boundariesCount: snap.boundaries.length,
  });
  return snap;
});

ipcMain.handle("life:updateInference", (_e, payload) => {
  const dir = packageDirFromConfig();
  return life.updateInference(dir, payload || {});
});

ipcMain.handle("life:updatePerson", (_e, payload) => {
  const dir = packageDirFromConfig();
  return life.updatePerson(dir, payload || {});
});

ipcMain.handle("life:updateMindHook", (_e, payload) => {
  const dir = packageDirFromConfig();
  return life.updateMindHook(dir, payload || {});
});

ipcMain.handle("life:distillMindHooks", async (e) => {
  const dir = packageDirFromConfig();
  const hooks = life.listPendingMindHooks(dir);
  if (!hooks.length) throw new Error("没有待蒸馏的观念线索。可先从材料提取，或去「观念与表达」直接导入。");
  const text =
    "以下是从本人材料中抽出的观念/原则线索，请据此蒸馏人格与判断相关条目：\n\n" +
    hooks.map((h, i) => `${i + 1}. ${h.text}`).join("\n");
  life.markMindHooksStatus(
    dir,
    hooks.map((h) => h.id),
    "in_review"
  );
  const res = await distillFromText(e, text, null, {
    fileName: "观念线索合集",
    skipFinalDone: false,
  });
  return {
    materialKind: "persona",
    agg: res.agg,
    meta: {
      ...(res.meta || {}),
      fileName: "观念线索合集",
      hookIds: hooks.map((h) => h.id),
      fromMindHooks: true,
    },
  };
});

/** Distill mind hooks and write all results without extra review (少决策). */
ipcMain.handle("life:applyMindHooks", async (e) => {
  const dir = packageDirFromConfig();
  const hooks = life.listPendingMindHooks(dir);
  if (!hooks.length) return { ok: false, error: "没有待写入的观念线索" };
  const text =
    "以下是从本人材料中抽出的观念/原则线索，请据此蒸馏人格与判断相关条目：\n\n" +
    hooks.map((h, i) => `${i + 1}. ${h.text}`).join("\n");
  life.markMindHooksStatus(
    dir,
    hooks.map((h) => h.id),
    "in_review"
  );
  const res = await distillFromText(e, text, null, {
    fileName: "观念线索合集",
    skipFinalDone: true,
  });
  const agg = res.agg || {};
  const sourceMeta = {
    id: "src_mindhooks_" + Date.now().toString(36),
    type: "mind_hooks",
    title: "观念线索合集",
    author: "",
    createdAt: new Date().toISOString(),
    location: "",
    sensitivity: "private",
    usedFor: ["style-guide", "persona", "decision-frameworks", "long-term-memory"],
    materialKind: "persona",
  };
  // Owner clicked「写入观念线索」— preview then confirm via PackageStore (P1-06).
  const preview = builderPackageWrite.previewPersonaWrite(dir, {
    agg,
    sourceMeta,
    reason: "观念线索确认写入",
  });
  const written = builderPackageWrite.commitPersonaWrite(dir, {
    changeSetId: preview.changeSetId,
    confirmed: true,
  });
  life.markMindHooksStatus(
    dir,
    hooks.map((h) => h.id),
    "distilled"
  );
  e.sender.send("builder:progress", { phase: "done", agg, materialKind: "persona" });
  return { ok: true, written, hookCount: hooks.length, revision: written.revision };
});

ipcMain.handle("life:markMindHooksDistilled", (_e, ids) => {
  const dir = packageDirFromConfig();
  const n = life.markMindHooksStatus(dir, ids || [], "distilled");
  return { ok: true, count: n };
});

ipcMain.handle("life:generateCognitionReport", async () => {
  const cfg = readConfig();
  if (!cfg.apiKey) throw new Error("还没有连接智能引擎。请打开设置，填好密钥后再试。");
  const dir = packageDirFromConfig();
  const pkg = {
    persona: safeRead(path.join(dir, "persona.md")),
    decisionFrameworks: safeRead(path.join(dir, "decision-frameworks.json")),
    longTermMemory: safeRead(path.join(dir, "memory", "long-term-memory.jsonl")),
  };
  const snap = life.getCognitionSnapshot(dir, pkg);
  const boundaries = policies.readBoundaries(dir);
  snap.boundaries = (boundaries.items || []).filter((b) => b.enabled !== false).slice(0, 20);
  const content = await callModel(cfg, life.buildCognitionReportPrompt(snap), { temperature: 0.35 });
  const item = library.upsertDeliverable(app.getPath("userData"), {
    type: "report",
    title: "自我认知简报 · " + new Date().toISOString().slice(0, 10),
    status: "draft",
    content: String(content || "").trim(),
    formats: ["md", "docx"],
    evidenceRefs: ["life/cognition"],
  });
  return { ok: true, item };
});

ipcMain.handle("life:upsertPerson", (_e, payload) => {
  const dir = packageDirFromConfig();
  const added = life.appendPeople(dir, [payload || {}], "manual");
  return { ok: added > 0, people: life.readSlice(dir, "people") };
});

ipcMain.handle("life:upsertEvent", (_e, payload) => {
  const dir = packageDirFromConfig();
  return life.upsertEvent(dir, payload || {});
});

ipcMain.handle("life:deleteEvent", (_e, id) => {
  const dir = packageDirFromConfig();
  return life.deleteEvent(dir, id);
});

ipcMain.handle("policies:getBoundaries", () => {
  const dir = packageDirFromConfig();
  return policies.readBoundaries(dir);
});

ipcMain.handle("policies:addBoundary", (_e, payload) => {
  const dir = packageDirFromConfig();
  return policies.addBoundary(dir, payload || {});
});

ipcMain.handle("policies:updateBoundary", (_e, payload) => {
  const dir = packageDirFromConfig();
  return policies.updateBoundary(dir, payload || {});
});

ipcMain.handle("policies:removeBoundary", (_e, payload) => {
  const dir = packageDirFromConfig();
  const id = typeof payload === "string" ? payload : payload && payload.id;
  const confirmed = typeof payload === "object" && payload && payload.confirmed;
  return policies.removeBoundary(dir, id, { confirmed });
});

ipcMain.handle("policies:restoreDefaults", (_e, payload) => {
  const dir = packageDirFromConfig();
  return policies.restoreSystemDefaults(dir, payload || {});
});

// Assemble the "像我" system prompt from the package.
function buildSystemPrompt(pkg) {
  const parts = [];
  const now = new Date();
  const dateLine = now.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  parts.push(
    "## 时间基准\n\n今天是 " +
      dateLine +
      "（" +
      now.toISOString().slice(0, 10) +
      "）。凡涉及「今年 / 未来 N 个月 / 近期 / 最新」等时间推断，一律以此日期为准，不要臆测或沿用训练数据里的旧日期。"
  );
  if (pkg.systemPrompt) parts.push(pkg.systemPrompt);
  if (pkg.persona) parts.push("## 人格卡\n\n" + pkg.persona);
  if (pkg.styleGuide) parts.push("## 表达风格\n\n" + pkg.styleGuide);
  if (pkg.boundariesSummary) parts.push(pkg.boundariesSummary);
  if (pkg.lifeSummary) parts.push(pkg.lifeSummary);
  if (pkg.decisionFrameworks)
    parts.push("## 判断框架（JSON）\n\n" + pkg.decisionFrameworks);
  if (pkg.longTermMemory)
    parts.push("## 长期记忆（每行一条 JSON）\n\n" + pkg.longTermMemory);
  return parts.join("\n\n---\n\n");
}

// ---------- Model gateway (OpenAI-compatible chat completions) ----------
const REPLACEMENT_CHAR = "\uFFFD";

function hasBadChars(text) {
  return String(text || "").includes(REPLACEMENT_CHAR);
}

async function callModel(cfg, messages, options = {}) {
  const route = await invokeModelRoute({
    routing: cfg.modelRouting,
    taskType: options.taskType || "artifact",
    secretStore: getConfigSecrets().secretStore,
    recordAttempt: recordModelRoutingAttempt,
    invokeProvider: async (candidate) => {
      if (candidate.provider.type === "fake") {
        if (candidate.model.model.includes("fail")) throw new Error("fake provider failure");
        const system = String(messages?.[0]?.content || "");
        if (system.includes("identity") && system.includes("experience") && system.includes("fact")) return { content: JSON.stringify({ identity:[{statement:"（测试）李明是产品负责人",confidence:"high"}], experience:[{statement:"（测试）2022 年加入星河团队",confidence:"high"}], fact:[{statement:"（测试）当前负责产品工作",confidence:"high"}] }) };
        return { content: "（测试）fake provider response" };
      }
      return callModelRaw({ provider: candidate.provider.type, baseURL: candidate.provider.baseUrl, model: candidate.model.model, apiKey: candidate.apiKey }, messages, options);
    },
  });
  if (!route.ok) {
    const err = new Error(route.friendlyMessage); err.code = route.errorCode; err.route = route; throw err;
  }
  return route.value.content || "(空响应)";
}

/** Streaming chat completions; onDelta(textChunk); returns full content. Supports AbortSignal via options.signal. */
function callModelStreamRaw(cfg, messages, onDelta, options = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(cfg.baseURL.replace(/\/$/, "") + "/chat/completions");
    } catch (e) {
      return reject(new Error("连接地址无效，请在设置里检查。"));
    }
    const bodyObj = {
      model: cfg.model,
      messages,
      temperature: options.temperature ?? 0.7,
      stream: true,
    };
    const body = JSON.stringify(bodyObj);
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
      },
      (res) => {
        let buf = "";
        let full = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (options.signal?.aborted) {
            req.destroy();
            return;
          }
          buf += chunk;
          const parts = buf.split("\n");
          buf = parts.pop() || "";
          for (const line of parts) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const data = t.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content || "";
              if (delta) {
                full += delta;
                onDelta(delta, full);
              }
            } catch {}
          }
        });
        res.on("end", () => {
          if (options.signal?.aborted) return reject(Object.assign(new Error("已停止"), { aborted: true }));
          if (!full) return reject(new Error("没有收到回复，请稍后再试。"));
          resolve(full);
        });
      }
    );
    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        req.destroy();
        reject(Object.assign(new Error("已停止"), { aborted: true }));
      });
    }
    req.on("error", (err) => {
      if (options.signal?.aborted) reject(Object.assign(new Error("已停止"), { aborted: true }));
      else reject(err);
    });
    req.write(body);
    req.end();
  });
}

async function callModelStream(cfg, messages, onDelta, options = {}) {
  const route = await invokeModelRoute({
    routing: cfg.modelRouting,
    taskType: options.taskType || "chat",
    secretStore: getConfigSecrets().secretStore,
    recordAttempt: recordModelRoutingAttempt,
    invokeProvider: async (candidate) => {
      if (candidate.provider.type === "fake") {
        if (candidate.model.model.includes("fail")) throw new Error("fake provider failure");
        const text = "（测试）fake provider response";
        onDelta(text, text);
        return text;
      }
      return callModelStreamRaw({ provider: candidate.provider.type, baseURL: candidate.provider.baseUrl, model: candidate.model.model, apiKey: candidate.apiKey }, messages, onDelta, options);
    },
  });
  if (!route.ok) { const err = new Error(route.friendlyMessage); err.code = route.errorCode; err.route = route; throw err; }
  return route.value;
}

const activeChatAborts = new Map();

function friendlyToolLabel(toolName, extId) {
  const n = String(toolName || "").toLowerCase();
  const e = String(extId || "").toLowerCase();
  if (n.includes("fetch") || e === "fetch") return "正在阅读网页";
  if (n.includes("read") || n.includes("file") || e === "filesystem") return "正在查阅本地文件";
  if (n.includes("search") || e.includes("brave")) return "正在检索信息";
  if (e === "memory") return "正在查阅知识记忆";
  return "正在使用已连接的能力";
}

function callModelRaw(cfg, messages, options = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(cfg.baseURL.replace(/\/$/, "") + "/chat/completions");
    } catch (e) {
      return reject(new Error("baseURL 无效：" + cfg.baseURL));
    }
    const bodyObj = {
      model: cfg.model,
      messages,
      temperature: options.temperature ?? 0.7,
    };
    if (options.tools?.length) {
      bodyObj.tools = options.tools.map((t) => ({
        type: t.type,
        function: t.function,
      }));
      bodyObj.tool_choice = options.tool_choice || "auto";
    }
    const body = JSON.stringify(bodyObj);
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
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = Buffer.concat(chunks).toString("utf8");
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || "模型返回错误"));
            const msg = json.choices?.[0]?.message;
            if (!msg) return reject(new Error("模型返回格式异常"));
            resolve(msg);
          } catch (e) {
            const raw = Buffer.concat(chunks).toString("utf8");
            reject(new Error("解析响应失败：" + raw.slice(0, 300)));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function getChatToolsModule() {
  return import("./capabilities/chat-tools.mjs");
}

async function runChatWithConnectedTools(cfg, system, history, em, progressFn) {
  const chatTools = await getChatToolsModule();
  const enabled = getCapabilityExtensions();
  await chatTools.ensureEnabledExtensionsConnected(em, enabled);
  const toolEntries = await chatTools.collectConnectedToolEntries(em, enabled);
  if (!toolEntries.length) {
    return { reply: null, toolEntries, usedTools: false, messages: null };
  }

  system += chatTools.buildCapabilitiesSystemAppend(toolEntries);
  const openAiTools = toolEntries.map((t) => chatTools.mcpToolToOpenAI(t.extensionId, t));
  const toolMap = new Map(openAiTools.map((t) => [t.function.name, t._meta]));

  let messages = [{ role: "system", content: system }, ...history];
  const maxRounds = 6;
  const notify = typeof progressFn === "function" ? progressFn : () => {};

  for (let round = 0; round < maxRounds; round++) {
    let msg;
    try {
      msg = await callModelRaw(cfg, messages, { tools: openAiTools });
    } catch (e) {
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      const fallback = await tryHeuristicFetch(cfg, system, history, em, lastUser?.content);
      if (fallback) return { reply: fallback, toolEntries, usedTools: true, fallback: true, messages: null };
      throw e;
    }

    const openAiToolCalls = msg.tool_calls || [];
    const dsmlCalls = !openAiToolCalls.length && msg.content ? parseDsmlToolCalls(msg.content) : [];
    const toolCalls = openAiToolCalls.length ? openAiToolCalls : dsmlCalls;
    if (!toolCalls.length) {
      const cleaned = stripToolLeakage(msg.content || "");
      return {
        reply: cleaned || "(空响应)",
        toolEntries,
        usedTools: round > 0,
        messages: round > 0 ? messages.concat([{ role: "assistant", content: cleaned || "" }]) : null,
        finalMessages: messages,
        needsStream: false,
        assistantContent: cleaned || "",
      };
    }

    // If model leaked DSML in content, keep a short note only (not the protocol)
    const visibleNote = stripToolLeakage(msg.content || "") || null;
    messages.push({
      role: "assistant",
      content: openAiToolCalls.length ? msg.content || null : visibleNote,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      const fn = tc.function || {};
      const meta = toolMap.get(fn.name);
      let args = {};
      try {
        args = JSON.parse(fn.arguments || "{}");
      } catch {}
      notify({
        phase: "tool",
        label: friendlyToolLabel(meta?.toolName || fn.name, meta?.extensionId),
        detail: meta?.toolName || fn.name,
      });
      let resultText;
      try {
        if (!meta) throw new Error("未知工具：" + fn.name);
        const result = await em.callTool(meta.extensionId, meta.toolName, args);
        resultText = chatTools.formatToolResult(result).slice(0, 14000);
      } catch (err) {
        resultText = "未能完成：" + err.message;
      }
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: resultText,
      });
    }
  }

  // After tool rounds, let caller stream the final answer
  return {
    reply: null,
    toolEntries,
    usedTools: true,
    finalMessages: messages,
    needsStream: true,
  };
}

async function tryHeuristicFetch(cfg, system, history, em, userText) {
  const chatTools = await getChatToolsModule();
  const urls = chatTools.extractUrls(userText);
  if (!urls.length) return null;
  const st = em.getSessionStatus().find((s) => s.id === "fetch" && s.status === "connected");
  if (!st) return null;

  const chunks = [];
  for (const url of urls.slice(0, 2)) {
    try {
      const result = await em.callTool("fetch", "fetch_markdown", { url });
      chunks.push(`### ${url}\n${chatTools.formatToolResult(result).slice(0, 8000)}`);
    } catch (e) {
      chunks.push(`### ${url}\n抓取失败：${e.message}`);
    }
  }
  if (!chunks.length) return null;

  const augmented = system + "\n\n---\n\n## 已抓取的网页内容\n\n" + chunks.join("\n\n");
  const messages = [{ role: "system", content: augmented }, ...history];
  return callModel(cfg, messages);
}

ipcMain.handle("chat:send", async (e, { pkg, history, requestId, attachmentContext, scenarioHint }) => {
  const cfg = readConfig();
  let system = buildSystemPrompt(pkg);
  system +=
    "\n\n---\n\n## 产出方式（必须遵守）\n\n" +
    "1）普通问答、解释、澄清、追问：把完整回答写在对话里，不要只用「请看右侧」搪塞。\n" +
    "2）仅当用户明确要求撰写较长成稿（简历、报告、请示、方案、备忘录、提纲等）时：\n" +
    "   - 对话里先用几句话说明做了什么；\n" +
    "   - 再把完整成稿放在 ```markdown 代码块中（供右侧「成稿预览」导出）。\n" +
    "3）若用户附上了材料正文，必须基于材料作答；禁止声称无法打开或无法读取附件；禁止编造材料中没有的日期与事实。\n" +
    "4）禁止声称「已保存到某目录 / 已写入文件」——文件由应用自动保存或用户导出。\n" +
    "5）```markdown 代码块里必须是成稿正文（如简历全文），禁止把下载说明、文件列表、打开方式放进代码块或当成成稿。";
  if (scenarioHint && String(scenarioHint).trim()) {
    system += "\n\n---\n\n## 当前场景约定\n\n" + String(scenarioHint).trim();
  }
  // requestContent / attachmentContext: this-turn only; never from persisted history bodies
  if (attachmentContext) {
    system +=
      "\n\n---\n\n## 用户本轮附带的材料（正文已提取，请直接使用）\n\n" +
      String(attachmentContext).slice(0, 80000);
  }

  const dir = cfg.packageDir || DEFAULT_PACKAGE_DIR;
  // Only role/content for the model — strip displayText / attachmentRefs / DOM leftovers
  const modelHistory = chatMessages.toModelGatewayHistory(history || []);
  const lastUser = [...modelHistory].reverse().find((m) => m.role === "user");
  const evidence = [];
  if (lastUser && lastUser.content) {
    try {
      const result = retrieval.retrieve(dir, lastUser.content);
      const ctx = retrieval.renderContext(result);
      if (ctx) system += "\n\n---\n\n" + ctx;
      if (result?.memories?.length || result?.frameworks?.length) {
        for (const m of result.memories || []) {
          evidence.push({ type: "memory", summary: String(m.text || "").slice(0, 120) });
        }
        for (const f of result.frameworks || []) {
          evidence.push({ type: "framework", summary: String(f.name || f.text || "").slice(0, 120) });
        }
      }
    } catch {}
  }

  const rid = requestId || "req_" + Date.now();
  const ac = new AbortController();
  activeChatAborts.set(rid, ac);
  const sendProg = (payload) => {
    try {
      e.sender.send("chat:progress", { requestId: rid, ...payload });
    } catch {}
  };

  let reply = "";
  let meta = { capabilitiesUsed: [], usedTools: false, evidence, requestId: rid };
  let streamMessages = [{ role: "system", content: system }, ...modelHistory];

  try {
    sendProg({ phase: "thinking", label: "正在思考…" });
    try {
      const em = await getExtensionManager();
      const toolRun = await runChatWithConnectedTools(cfg, system, modelHistory, em, (p) =>
        sendProg(p)
      );
      if (toolRun.usedTools) meta.usedTools = true;
      meta.capabilitiesUsed = [...new Set((toolRun.toolEntries || []).map((t) => t.extensionId))];
      if (toolRun.needsStream && toolRun.finalMessages) {
        streamMessages = toolRun.finalMessages;
        sendProg({ phase: "writing", label: "正在整理回复…" });
        reply = await callModelStream(
          cfg,
          streamMessages,
          (delta, full) =>
            sendProg({ phase: "delta", delta, full: stripToolLeakage(full) }),
          { signal: ac.signal }
        );
      } else if (toolRun.reply != null) {
        reply = stripToolLeakage(toolRun.reply);
        // Simulate streaming for UI consistency when tools returned final text
        sendProg({ phase: "delta", delta: reply, full: reply });
      }
    } catch (toolErr) {
      if (toolErr.aborted) throw toolErr;
      // fall through to plain stream
    }

    if (!reply) {
      sendProg({ phase: "writing", label: "正在回复…" });
      reply = await callModelStream(
        cfg,
        streamMessages,
        (delta, full) =>
          sendProg({ phase: "delta", delta, full: stripToolLeakage(full) }),
        { signal: ac.signal }
      );
    }

    let rawReply = reply;
    reply = stripToolLeakage(reply);
    if (!reply && hasDsmlToolMarkup(rawReply)) {
      reply =
        "刚才尝试查阅外部网页，但没有整理成可读说明。请再试一次；或把链接手动添加到「参考材料」后再问。";
    }
    if (hasBadChars(reply)) throw new Error("回复里出现乱码，请再试一次，或在设置里换一个引擎。");
    const userQuestion = String(lastUser?.content || "").split("\n---\n")[0].trim();
    let split = documentOutput.splitReplyForCanvas(reply, { userQuestion });
    if (
      (!split.artifact || documentOutput.isMetaNoise(split.artifact.content)) &&
      shouldRecoverFromWorkspace(userQuestion, reply)
    ) {
      const recovered = recoverArtifactFromWorkspace(reply, userQuestion);
      if (recovered) {
        split = {
          chat:
            (documentOutput.isMetaNoise(split.chat) ? "" : split.chat) ||
            "已找到本机成稿正文，已放入右侧「成稿预览」。请用「导出 Word」在 WPS 中打开（宋体/雅黑）。",
          artifact: recovered,
        };
      } else if (split.artifact && documentOutput.isMetaNoise(split.artifact.content)) {
        split = { chat: reply, artifact: null };
      }
    }
    // Never keep a resume artifact for a non-resume writing task
    if (
      split.artifact &&
      documentOutput.looksLikeResumeBody(split.artifact.content) &&
      /报告|请示|方案|备忘录|提纲|降雨|气候/.test(userQuestion) &&
      !/简历/.test(userQuestion)
    ) {
      split = { chat: reply || split.chat, artifact: null };
    }
    let savedInfo = null;
    if (split.artifact) {
      try {
        savedInfo = saveArtifactToDisk(split.artifact);
        if (savedInfo) {
          split.artifact.savedPath = savedInfo.docxPath || savedInfo.mdPath;
          split.artifact.savedMdPath = savedInfo.mdPath;
          split.artifact.savedDocxPath = savedInfo.docxPath;
        }
      } catch {
        savedInfo = null;
      }
    }
    let chatOut = split.chat;
    if (savedInfo) {
      chatOut +=
        "\n\n——\n已自动保存到本机「成稿」文件夹：\n" +
        (savedInfo.docxPath ? "Word（推荐用 WPS 打开）：" + savedInfo.docxPath + "\n" : "") +
        (savedInfo.mdPath ? "Markdown：" + savedInfo.mdPath + "\n" : "") +
        "也可在右侧「成稿预览」再导出。";
    }
    sendProg({ phase: "done" });
    return {
      reply: chatOut,
      fullReply: reply,
      meta,
      artifact: split.artifact,
      savedPath: savedInfo && (savedInfo.docxPath || savedInfo.mdPath),
    };
  } catch (err) {
    if (err.aborted) {
      sendProg({ phase: "stopped" });
      const userQuestion = String(lastUser?.content || "").split("\n---\n")[0].trim();
      const split = documentOutput.splitReplyForCanvas(reply || "", { userQuestion });
      return {
        reply: split.chat || reply || "",
        fullReply: reply || "",
        meta: { ...meta, stopped: true },
        artifact: split.artifact,
      };
    }
    sendProg({ phase: "error", message: err.message });
    throw new Error(err.message || "暂时没办成，请稍后再试。");
  } finally {
    activeChatAborts.delete(rid);
  }
});

ipcMain.handle("chat:stop", async (_e, { requestId }) => {
  const ac = activeChatAborts.get(requestId);
  if (ac) ac.abort();
  return { ok: true };
});

ipcMain.handle("chat:pickAttachments", async () => {
  const res = await dialog.showOpenDialog({
    title: "添加材料",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "常用材料",
        extensions: ["docx", "pdf", "pptx", "txt", "md", "markdown", "png", "jpg", "jpeg", "webp", "gif"],
      },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return [];
  const out = [];
  for (const filePath of res.filePaths.slice(0, 5)) {
    const ext = path.extname(filePath).toLowerCase();
    const name = path.basename(filePath);
    const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext);
    let text = "";
    let note = "";
    let ok = false;
    let chars = 0;
    try {
      if (isImage) {
        note = "图片已附上（请用文字说明要点）";
        text = `[图片附件] ${name}\n路径：${filePath}`;
        ok = true;
      } else {
        text = await builder.extractText(filePath);
        text = String(text || "")
          .replace(/\n--\s*\d+\s+of\s+\d+\s*--\n/gi, "\n")
          .trim();
        if (!text) throw new Error("未提取到可读文字（若是扫描件，需先转成可选中文字的 PDF）");
        chars = text.length;
        if (text.length > 40000) {
          text = text.slice(0, 40000) + "\n\n…（后文已省略，共约 " + chars + " 字）";
        }
        note = "已读入约 " + chars + " 字";
        ok = true;
      }
    } catch (err) {
      note = "未能读入：" + (err.message || "未知原因");
      text = "";
      ok = false;
    }
    out.push({
      id: "att_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1000),
      name,
      path: filePath,
      ext,
      isImage,
      text,
      note,
      ok,
      chars,
    });
  }
  return out;
});

ipcMain.handle("sessions:list", async () => sessions.listSessions(app.getPath("userData")));
ipcMain.handle("sessions:get", async (_e, id) => sessions.getSession(app.getPath("userData"), id));
ipcMain.handle("sessions:create", async (_e, opts) => {
  if (sessions.isRecoveryLatched()) {
    throw Object.assign(new Error("会话存档当前无法安全写入。"), {
      code: "sessions_recovery_latched",
    });
  }
  const cfg = readConfig();
  return sessions.createSession(app.getPath("userData"), {
    title: opts?.title,
    packagePath: cfg.packageDir || DEFAULT_PACKAGE_DIR,
  });
});
ipcMain.handle("sessions:save", async (_e, session) => {
  if (sessions.isRecoveryLatched()) {
    throw Object.assign(new Error("会话存档当前无法安全写入。"), {
      code: "sessions_recovery_latched",
    });
  }
  return sessions.saveSession(app.getPath("userData"), session);
});
ipcMain.handle("sessions:rename", async (_e, { id, title }) => {
  if (sessions.isRecoveryLatched()) {
    throw Object.assign(new Error("会话存档当前无法安全写入。"), {
      code: "sessions_recovery_latched",
    });
  }
  return sessions.renameSession(app.getPath("userData"), id, title);
});
ipcMain.handle("sessions:delete", async (_e, id) => {
  if (sessions.isRecoveryLatched()) {
    throw Object.assign(new Error("会话存档当前无法安全写入。"), {
      code: "sessions_recovery_latched",
    });
  }
  return sessions.deleteSession(app.getPath("userData"), id);
});
ipcMain.handle("sessions:setActive", async (_e, id) => {
  if (sessions.isRecoveryLatched()) {
    throw Object.assign(new Error("会话存档当前无法安全写入。"), {
      code: "sessions_recovery_latched",
    });
  }
  return sessions.setActive(app.getPath("userData"), id);
});

// ---------- R2 narrow chat / sessions API (renderer-next) ----------
function loadPackageForR2Chat() {
  const dir = packageDirFromConfig();
  tryRecoverConfiguredPackageStore();
  life.ensureLifeScaffold(dir);
  policies.ensureBoundariesScaffold(dir);
  const manifestRaw = safeRead(path.join(dir, "manifest.json"));
  let manifest = {};
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    /* ignore */
  }
  return {
    dir,
    exists: !!manifestRaw,
    manifest,
    persona: safeRead(path.join(dir, "persona.md")),
    styleGuide: safeRead(path.join(dir, "style-guide.md")),
    systemPrompt: safeRead(path.join(dir, "prompts", "system-prompt.md")),
    decisionFrameworks: safeRead(path.join(dir, "decision-frameworks.json")),
    preferences: safeRead(path.join(dir, "preferences.json")),
    longTermMemory: safeRead(path.join(dir, "memory", "long-term-memory.jsonl")),
    lifeSummary: life.summarizeLifeForPrompt(dir),
    boundariesSummary: policies.summarizeBoundariesForPrompt(dir),
  };
}

const r2Chat = createR2ChatLifecycle({
  activeRequest: r2ActiveRequest,
  attachmentTokens: r2AttachmentTokens,
  getUserData: () => app.getPath("userData"),
  readConfig,
  buildSystemPrompt,
  loadPackageForChat: loadPackageForR2Chat,
  callModelStream,
  runChatWithConnectedTools,
  getExtensionManager,
  stripToolLeakage,
  hasBadChars,
  hasDsmlToolMarkup,
  retrieval,
  defaultPackageDir: DEFAULT_PACKAGE_DIR,
  sendToSender: (sender, channel, data) => {
    try {
      if (sender && !sender.isDestroyed()) sender.send(channel, data);
    } catch {
      /* ignore */
    }
  },
});
r2AbortOnFallback = async () => r2Chat.abortActiveForFallback();

ipcMain.handle("r2:listSessions", async () => r2Chat.listSessionsDto());
ipcMain.handle("r2:getSession", async (_e, id) => r2Chat.getSessionDto(id));
ipcMain.handle("r2:createSession", async (_e, opts) => r2Chat.createSession(opts || {}));
ipcMain.handle("r2:renameSession", async (_e, payload) =>
  r2Chat.renameSession(payload && payload.id, payload && payload.title)
);
ipcMain.handle("r2:deleteSession", async (_e, id) => r2Chat.deleteSession(id));
ipcMain.handle("r2:setCurrentSession", async (_e, id) => r2Chat.setCurrentSession(id));
ipcMain.handle("r2:sendChat", async (e, payload) =>
  r2Chat.sendChat(e.sender, payload || {}, e.sender.id)
);
ipcMain.handle("r2:stopChat", async (e, payload) =>
  r2Chat.stopChat(e.sender, payload && payload.requestId)
);
ipcMain.handle("r2:getActiveRequest", async () => r2Chat.getActiveRequest());
ipcMain.handle("r2:acknowledgeChat", async (e, payload) =>
  r2Chat.acknowledgeChat(e.sender, payload || {})
);
ipcMain.handle("r2:clearAttachmentToken", async (_e, payload) => {
  const token = payload && payload.token;
  if (!token) return { ok: false, code: "missing_token" };
  r2AttachmentTokens.clear(token);
  return { ok: true };
});
ipcMain.handle("r2:clearLinkedArtifact", async (_e, payload) =>
  r2Chat.clearLinkedArtifact(payload && payload.sessionId)
);
ipcMain.handle("r2:pickAttachments", async (e, payload) => {
  const busy = r2ActiveRequest.assertIdle();
  if (!busy.ok) {
    return { ok: false, code: busy.code, message: busy.message };
  }
  const sessionId = String((payload && payload.sessionId) || "");
  if (!sessionId) {
    return { ok: false, code: "missing_session", message: "请先选择对话。" };
  }
  const res = await dialog.showOpenDialog({
    title: "添加材料",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "常用材料",
        extensions: ["docx", "pdf", "pptx", "txt", "md", "markdown", "png", "jpg", "jpeg", "webp", "gif"],
      },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths.length) {
    return { ok: true, canceled: true, attachments: [], token: null };
  }
  const selection = [];
  for (const filePath of res.filePaths.slice(0, 5)) {
    const ext = path.extname(filePath).toLowerCase();
    const name = path.basename(filePath);
    const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext);
    let text = "";
    let note = "";
    let ok = false;
    let chars = 0;
    let size = 0;
    try {
      try {
        size = fs.statSync(filePath).size;
      } catch {
        size = 0;
      }
      if (isImage) {
        note = "图片已附上（请用文字说明要点）";
        text = `[图片附件] ${name}`;
        ok = true;
      } else {
        text = await builder.extractText(filePath);
        text = String(text || "")
          .replace(/\n--\s*\d+\s+of\s+\d+\s*--\n/gi, "\n")
          .trim();
        if (!text) throw new Error("未提取到可读文字");
        chars = text.length;
        if (text.length > 40000) {
          text = text.slice(0, 40000) + "\n\n…（后文已省略，共约 " + chars + " 字）";
        }
        note = "已读入约 " + chars + " 字";
        ok = true;
      }
    } catch (err) {
      note = "未能读入：" + (err.message || "未知原因");
      text = "";
      ok = false;
    }
    selection.push({
      id: "att_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1000),
      name,
      type: isImage ? "image" : "file",
      size,
      ext,
      isImage,
      text,
      note,
      ok,
      chars,
      // path kept only in main vault — never returned to renderer
      _path: filePath,
    });
  }
  const minted = r2AttachmentTokens.create({
    webContentsId: e.sender.id,
    sessionId,
    selection: selection.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      size: a.size,
      text: a.text,
      note: a.note,
      ok: a.ok,
      chars: a.chars,
    })),
  });
  return {
    ok: true,
    canceled: false,
    token: minted.token,
    attachments: minted.attachments,
  };
});

ipcMain.handle("r2:openLinkedArtifact", async (_e, payload) => {
  const busy = r2ActiveRequest.assertIdle();
  if (!busy.ok) {
    return {
      ok: false,
      code: busy.code,
      message: "请先停止当前回复，再打开关联文稿。",
    };
  }
  const sessionId = String((payload && payload.sessionId) || "");
  const libraryId = String((payload && payload.libraryId) || "");
  if (!sessionId || !libraryId) {
    return { ok: false, code: "invalid_args", message: "无法打开关联文稿。" };
  }
  try {
    const session = sessions.getSession(app.getPath("userData"), sessionId);
    if (!session) return { ok: false, code: "not_found", message: "找不到该对话。" };
    const linked =
      String(session.linkedLibraryId || "") === libraryId ||
      (session.artifacts || []).some(
        (a) => a && (String(a.libraryId) === libraryId || String(a.id) === libraryId)
      );
    if (!linked) {
      return { ok: false, code: "not_linked", message: "当前对话未关联该文稿。" };
    }
    r2LegacyHandoff.setOpenLibraryItem(libraryId, "library");
    const nav = await rendererEntryRuntime.handleRequestFromRenderer("legacy", "open_linked_artifact");
    if (!nav || !nav.ok) {
      r2LegacyHandoff.clear();
      return {
        ok: false,
        code: (nav && nav.code) || "handoff_failed",
        message: "未能切换到经典界面打开文稿，请稍后重试。",
      };
    }
    return { ok: true, deferred: !!nav.deferred };
  } catch (err) {
    r2LegacyHandoff.clear();
    return {
      ok: false,
      code: err && err.code ? err.code : "open_failed",
      message: err && err.message ? err.message : "未能打开关联文稿。",
    };
  }
});

ipcMain.handle("r2:consumeLegacyHandoff", async () => {
  return { ok: true, intent: r2LegacyHandoff.consume() };
});

// Test/harness helpers (only when fake model or spike harness)
function r2HarnessEnabled() {
  return (
    process.env.DIGITALME_R2_FAKE_MODEL === "1" ||
    process.env.DIGITALME_R1_SPIKE_HARNESS === "1"
  );
}

ipcMain.handle("r2:testSetAttachmentClock", async (_e, payload) => {
  if (!r2HarnessEnabled()) return { ok: false, code: "harness_required" };
  const ms = Number(payload && payload.nowMonotonicMs);
  if (!Number.isFinite(ms)) return { ok: false, code: "invalid_clock" };
  r2AttachmentTokens.setClock(() => ms);
  r2AttachmentTokens.expireStale();
  return { ok: true, size: r2AttachmentTokens.size() };
});
ipcMain.handle("r2:testAttachmentVaultSize", async () => {
  if (!r2HarnessEnabled()) return { ok: false, code: "harness_required" };
  return { ok: true, size: r2AttachmentTokens.size() };
});
ipcMain.handle("r2:testExpireAttachmentTokens", async () => {
  if (!r2HarnessEnabled()) return { ok: false, code: "harness_required" };
  r2AttachmentTokens.expireStale();
  return { ok: true, size: r2AttachmentTokens.size() };
});

ipcMain.handle("r2:testSeedSession", async (_e, payload) => {
  if (!r2HarnessEnabled()) return { ok: false, code: "harness_required" };
  try {
    const ud = app.getPath("userData");
    const title = String((payload && payload.title) || "测试对话");
    const s = await sessions.createSession(ud, { title });
    const messages = Array.isArray(payload && payload.messages) ? payload.messages : [];
    s.messages = messages.map((m) => chatMessages.toPersistableMessage(m));
    if (payload && payload.linkedLibraryId) {
      s.linkedLibraryId = String(payload.linkedLibraryId);
      s.artifacts = [
        {
          libraryId: String(payload.linkedLibraryId),
          title: String((payload && payload.linkedTitle) || "测试文稿"),
        },
      ];
    }
    await sessions.saveSession(ud, s);
    return { ok: true, sessionId: s.id };
  } catch (err) {
    return {
      ok: false,
      code: err && err.code ? err.code : "seed_failed",
      message: err && err.message ? err.message : "seed failed",
    };
  }
});

ipcMain.handle("r2:testCorruptSessionsFile", async () => {
  if (!r2HarnessEnabled()) return { ok: false, code: "harness_required" };
  const p = sessions.sessionsPath(app.getPath("userData"));
  fs.writeFileSync(p, "{not-json-corrupt", "utf8");
  try {
    sessions.loadStore(app.getPath("userData"));
  } catch {
    /* expected — sets latch */
  }
  return { ok: true, latched: sessions.isRecoveryLatched(), path: p };
});

ipcMain.handle("r2:testMintAttachmentToken", async (e, payload) => {
  if (!r2HarnessEnabled()) return { ok: false, code: "harness_required" };
  const sessionId = String((payload && payload.sessionId) || "");
  const body = String((payload && payload.body) || "SECRET_ATTACH_BODY_" + "X".repeat(100));
  const minted = r2AttachmentTokens.create({
    webContentsId: e.sender.id,
    sessionId,
    selection: [
      {
        id: "att_test",
        name: "secret.txt",
        type: "text/plain",
        size: body.length,
        text: body,
        ok: true,
        note: "test",
        chars: body.length,
      },
    ],
  });
  return { ok: true, token: minted.token, attachments: minted.attachments, bodyMarker: body.slice(0, 24) };
});

ipcMain.handle("output:exportMarkdown", async (_e, { title, content }) => {
  const safe = safeFileStem(title);
  const res = await dialog.showSaveDialog({
    title: "保存为 Markdown",
    defaultPath: path.join(draftsDir(), safe + ".md"),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  fs.writeFileSync(res.filePath, content || "", "utf8");
  return { canceled: false, filePath: res.filePath };
});

ipcMain.handle("output:exportDocx", async (_e, { title, content }) => {
  const safe = safeFileStem(title);
  const buf = documentOutput.buildDocxFromMarkdown(content || "", title || "成稿");
  const res = await dialog.showSaveDialog({
    title: "保存为 Word 文档",
    defaultPath: path.join(draftsDir(), safe + ".docx"),
    filters: [{ name: "Word", extensions: ["docx"] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  fs.writeFileSync(res.filePath, buf);
  return { canceled: false, filePath: res.filePath };
});

ipcMain.handle("output:openDraftsFolder", async () => {
  const dir = draftsDir();
  const { shell } = require("electron");
  await shell.openPath(dir);
  return { path: dir };
});

ipcMain.handle("output:getDraftsDir", async () => ({ path: draftsDir() }));

ipcMain.handle("library:list", async () => library.listDeliverables(app.getPath("userData")));
ipcMain.handle("library:get", async (_e, id) => library.getDeliverable(app.getPath("userData"), id));
ipcMain.handle("library:save", async (_e, item) =>
  library.upsertDeliverable(app.getPath("userData"), item || {})
);
ipcMain.handle("library:delete", async (_e, id) =>
  library.deleteDeliverable(app.getPath("userData"), id)
);
ipcMain.handle("library:templates", async () => library.getTemplates());
ipcMain.handle("library:scenarioPacks", async () => library.getScenarioPacks());

// Research notebooks (ResearchNotebook; legacy IPC names kept)
ipcMain.handle("research:list", async () => researchProjects.listProjects(app.getPath("userData")));
ipcMain.handle("research:get", async (_e, id) => researchProjects.getProject(app.getPath("userData"), id));
ipcMain.handle("research:active", async () => researchProjects.getActiveProject(app.getPath("userData")));
ipcMain.handle("research:create", async (_e, payload) => {
  const cfg = readConfig();
  return researchProjects.createProject(app.getPath("userData"), {
    ...(payload || {}),
    packageRef: cfg.packageDir || DEFAULT_PACKAGE_DIR,
  });
});
ipcMain.handle("research:save", async (_e, item) => researchProjects.saveProject(app.getPath("userData"), item || {}));
ipcMain.handle("research:delete", async (_e, id) => researchProjects.deleteProject(app.getPath("userData"), id));
ipcMain.handle("research:setActive", async (_e, id) => researchProjects.setActiveProject(app.getPath("userData"), id));
ipcMain.handle("research:setStage", async (_e, payload) => {
  const progress = payload.progress || payload.stage;
  return researchProjects.setProgress(app.getPath("userData"), payload.id, progress);
});
ipcMain.handle("research:setProgress", async (_e, payload) =>
  researchProjects.setProgress(app.getPath("userData"), payload.id, payload.progress)
);
ipcMain.handle("research:addMaterial", async (_e, payload) =>
  researchProjects.addSource(app.getPath("userData"), payload.id, payload.material || payload.source || {})
);
ipcMain.handle("research:addSource", async (_e, payload) =>
  researchProjects.addSource(app.getPath("userData"), payload.id, payload.source || {})
);
ipcMain.handle("research:removeMaterial", async (_e, payload) =>
  researchProjects.removeSource(app.getPath("userData"), payload.id, payload.materialId || payload.sourceId)
);
ipcMain.handle("research:removeSource", async (_e, payload) =>
  researchProjects.removeSource(app.getPath("userData"), payload.id, payload.sourceId)
);
ipcMain.handle("research:addArtifact", async (_e, payload) =>
  researchProjects.addArtifact(app.getPath("userData"), payload.id, payload.artifact || {})
);
ipcMain.handle("research:removeArtifact", async (_e, payload) =>
  researchProjects.removeArtifact(app.getPath("userData"), payload.id, payload.artifactId)
);
ipcMain.handle("research:runCheck", async (_e, payload) =>
  researchProjects.runChecks(app.getPath("userData"), payload.id, payload.kind)
);
ipcMain.handle("research:runClaimAudit", async (_e, payload) =>
  researchProjects.runClaimAudit(app.getPath("userData"), payload.id)
);
ipcMain.handle("research:stages", async () => researchProjects.getProgressSteps());
ipcMain.handle("research:progressSteps", async () => researchProjects.getProgressSteps());
ipcMain.handle("research:methodPacks", async () => researchProjects.getAllActions());
ipcMain.handle("research:sourceActions", async () => researchProjects.getAllActions());
ipcMain.handle("research:discoveryActions", async () => researchProjects.getDiscoveryActions());

async function ensureExtensionConnected(cid) {
  const item = catalog.getById(cid);
  if (!item) return { id: cid, ok: false, message: "目录中无此项" };
  const existing = getCapabilityExtensions().find((e) => e.id === cid);
  const hasConfiguredKey =
    existing &&
    existing.envConfigured &&
    Object.values(existing.envConfigured).some(Boolean);
  if (item.needsKey && !hasConfiguredKey) {
    return { id: cid, name: item.name, ok: false, skipped: true, message: "需在「能力」页配置密钥后启用" };
  }
  try {
    let ext = existing;
    if (!ext) {
      const built = buildExtensionFromCatalog(item, { params: {}, env: {} });
      const publicBuilt = getConfigSecrets().sanitizeExtension(
        { ...built, env: undefined, envKeyNames: (item.envKeys || []).map((ek) => ek.key) },
        getConfigSecrets().secretStore
      );
      const list = getCapabilityExtensions().filter((e) => e.id !== publicBuilt.id);
      list.push(publicBuilt);
      saveCapabilityExtensions(list);
      ext = publicBuilt;
    }
    const em = await getExtensionManager();
    await em.connectExtension(getConfigSecrets().hydrateExtensionEnv(ext));
    return { id: cid, name: item.name, ok: true, connected: true };
  } catch (e) {
    return { id: cid, name: item.name, ok: false, message: e.message || String(e) };
  }
}

async function enrichSearchHitsWithFetch(em, hits, limit = 3) {
  const st = em.getSessionStatus().find((s) => s.id === "fetch" && s.status === "connected");
  if (!st || !Array.isArray(hits)) return hits;
  const chatTools = await getChatToolsModule();
  const out = hits.map((h) => ({ ...h }));
  for (let i = 0; i < Math.min(limit, out.length); i++) {
    const url = String(out[i].url || "").trim();
    if (!url.startsWith("http")) continue;
    try {
      const result = await em.callTool("fetch", "fetch_markdown", { url });
      const text = researchProjects.sanitizeExcerpt(chatTools.formatToolResult(result), 3500);
      if (text && text.length > 80) out[i].snippet = text;
      out[i].fetched = true;
    } catch {
      // keep search snippet
    }
  }
  return out;
}

ipcMain.handle("research:prepareScene", async () => {
  personalSkills.ensurePresetResearchSkills(app.getPath("userData"));
  const results = [];
  for (const cid of researchWebSearch.RESEARCH_DEFAULT_EXTENSIONS) {
    results.push(await ensureExtensionConnected(cid));
  }
  const ready = results.filter((r) => r.ok).map((r) => r.name || r.id);
  const skipped = results.filter((r) => r.skipped);
  let message = ready.length ? "研究能力已就绪：" + ready.join("、") + "。" : "";
  if (skipped.length) {
    message +=
      (message ? " " : "") +
      "未配置联网搜索密钥时将使用内置搜索；" +
      "在「能力」启用 Brave 搜索可获得更好结果。";
  }
  if (!message) message = "将使用内置搜索；可在「能力」中启用网页抓取与联网搜索。";
  return { results, message, fallbackSearch: true };
});

ipcMain.handle("research:discoverSources", async (_e, payload) => {
  const id = payload && payload.id;
  const query = String((payload && payload.query) || "").trim();
  if (!id) throw new Error("请指定研究项。");
  if (!query) throw new Error("请提供搜索关键词。");
  const item = researchProjects.getProject(app.getPath("userData"), id);
  if (!item) throw new Error("研究空间不存在。");
  await ensureExtensionConnected("fetch");
  const bravePrep = await ensureExtensionConnected("brave-search");
  const em = await getExtensionManager();
  const { provider, results } = await researchWebSearch.searchWeb(em, query);
  const enriched = await enrichSearchHitsWithFetch(em, results, 3);
  const { project, added } = researchProjects.addSourcesFromSearch(app.getPath("userData"), id, enriched);
  return {
    query,
    provider,
    braveConfigured: !!bravePrep.ok,
    results: enriched,
    added,
    project,
    message:
      added > 0
        ? `已从${provider === "brave" ? "联网搜索" : "内置搜索"}添加 ${added} 条参考材料。`
        : "检索完成，未发现可添加的新材料（可能已存在或结果为空）。",
  };
});

ipcMain.handle("research:runAgentLoop", async (e, payload) => {
  const cfg = readConfig();
  if (!cfg.apiKey) throw new Error("还没有连接智能引擎。请打开设置，填好密钥后再试。");
  const id = payload && payload.id;
  const question = String((payload && payload.question) || "").trim();
  if (!id) throw new Error("请指定研究项。");
  if (!question) throw new Error("请提供研究问题。");
  const item = researchProjects.getProject(app.getPath("userData"), id);
  if (!item) throw new Error("研究空间不存在。");
  const rid = (payload && payload.requestId) || "rag_" + Date.now();
  const sendProg = (p) => {
    try {
      e.sender.send("research:progress", { requestId: rid, ...p });
    } catch {}
  };
  personalSkills.ensurePresetResearchSkills(app.getPath("userData"));
  let pkg = {};
  try {
    const dir = cfg.packageDir || DEFAULT_PACKAGE_DIR;
    pkg = {
      systemPrompt: safeRead(path.join(dir, "prompts", "system-prompt.md")),
      persona: safeRead(path.join(dir, "persona.md")),
      styleGuide: safeRead(path.join(dir, "style-guide.md")),
    };
  } catch {}
  const scenarioHint =
    String(payload.scenarioHint || "").trim() ||
    researchGrounded.buildGroundedSystemAppend(item) +
      " 当前执行四步调研：澄清→检索→读源→成果稿。";
  const chatTools = await getChatToolsModule();
  const result = await researchAgentLoop.runResearchAgentLoop({
    userData: app.getPath("userData"),
    projectId: id,
    question,
    onProgress: sendProg,
    callModel,
    cfg,
    projects: researchProjects,
    webSearch: researchWebSearch,
    ensureExtensionConnected,
    enrichSearchHitsWithFetch,
    getExtensionManager,
    formatToolResult: chatTools.formatToolResult,
    scenarioHint,
  });
  sendProg({ step: "done", phase: "done", label: "调研完成" });
  return { ...result, requestId: rid };
});

ipcMain.handle("research:addLocalSource", async (_e, payload) => {
  const id = payload && payload.id;
  if (!id) throw new Error("请指定研究项。");
  const res = await dialog.showOpenDialog({
    title: "选择本地文件作为参考材料",
    properties: ["openFile"],
    filters: [
      { name: "文档", extensions: ["docx", "txt", "md", "markdown", "pdf", "pptx"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  const filePath = res.filePaths[0];
  let excerpt = "";
  try {
    excerpt = await builder.extractText(filePath);
  } catch (err) {
    throw new Error("无法读取文件：" + (err.message || err));
  }
  if (!excerpt || excerpt.trim().length < 20) {
    throw new Error("文件内容过短或无法提取正文，请换文件或手动粘贴摘录。");
  }
  const project = researchProjects.addLocalFileSource(app.getPath("userData"), id, {
    filePath,
    fileName: path.basename(filePath),
    title: path.basename(filePath, path.extname(filePath)),
    excerpt,
  });
  return { canceled: false, project, title: path.basename(filePath) };
});

ipcMain.handle("research:validateGrounded", async (_e, payload) => {
  const item = researchProjects.getProject(app.getPath("userData"), payload.id);
  if (!item) throw new Error("研究空间不存在。");
  return researchGrounded.validateGroundedContent(item, payload.text || "");
});

ipcMain.handle("research:prepareMethod", async (_e, packId) => {
  const pack = researchProjects.getSourceAction(packId);
  if (!pack) throw new Error("未知来源动作：" + packId);
  const results = [];
  for (const cid of pack.recommendedExtensions || []) {
    const prep = await ensureExtensionConnected(cid);
    results.push(prep);
  }
  return {
    pack,
    systemHint: pack.systemHint || "",
    results,
    message:
      "已为「" +
      pack.title +
      "」准备：" +
      (results.filter((r) => r.ok).map((r) => r.name || r.id).join("、") || "可直接基于来源集提问"),
  };
});
function researchDeliverToWriting(payload) {
  const item = researchProjects.getProject(app.getPath("userData"), payload.id);
  if (!item) throw new Error("研究空间不存在。");
  const hasSources = !!(item.sources || []).length;
  const mode =
    payload && payload.mode === "plan" ? "plan" : payload && payload.mode === "final" ? "final" : hasSources ? "final" : "plan";
  if (mode === "final" && hasSources && payload.draftContent) {
    const check = researchGrounded.validateGroundedExport(item, payload.draftContent);
    if (!check.ok) throw new Error(check.message);
  }
  if (mode === "plan") researchProjects.assertCanSendPlanToWriting(item);
  else researchProjects.assertCanSendToWriting(item);
  const content = payload.draftContent
    ? researchProjects.buildExportDeliverable(item, payload.draftContent)
    : researchProjects.buildWritingPayload(item);
  const cfg = readConfig();
  const dl = library.importFromArtifact(app.getPath("userData"), {
    id: mode === "final" ? item.deliverableId || undefined : undefined,
    title: researchProjects.getWritingExportTitle(item, mode === "plan" ? "plan" : "final"),
    content,
    type: "report",
    status: mode === "plan" ? "draft" : "ready",
    packageRef: cfg.packageDir || DEFAULT_PACKAGE_DIR,
  });
  if (mode === "final") {
    item.deliverableId = dl.id;
    item.progress = "write";
  }
  const saved = researchProjects.saveProject(app.getPath("userData"), item);
  return { deliverable: dl, project: saved, mode };
}
ipcMain.handle("research:exportFinal", async (_e, payload) => researchDeliverToWriting({ ...payload, mode: "final" }));
ipcMain.handle("research:sendToWriting", async (_e, payload) =>
  researchDeliverToWriting({ ...payload, mode: payload && payload.mode === "plan" ? "plan" : "final" })
);
ipcMain.handle("research:exportDeliverable", async (_e, payload) => {
  const item = researchProjects.getProject(app.getPath("userData"), payload.id);
  if (!item) throw new Error("研究空间不存在。");
  const content = researchProjects.buildExportDeliverable(item, payload.draftContent);
  const draftOnly = String(payload.draftContent || "").trim();
  const check = researchGrounded.validateGroundedExport(item, draftOnly || content);
  if (!check.ok) throw new Error(check.message);
  const title = item.question || "研究答复";
  const safe = safeFileStem(title);
  if (payload.format === "docx") {
    const buf = documentOutput.buildDocxFromMarkdown(content, title);
    const res = await dialog.showSaveDialog({
      title: "导出 Word（WPS 可开）",
      defaultPath: path.join(draftsDir(), safe + ".docx"),
      filters: [{ name: "Word", extensions: ["docx"] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    fs.writeFileSync(res.filePath, buf);
    return { canceled: false, filePath: res.filePath };
  }
  const res = await dialog.showSaveDialog({
    title: "导出文本",
    defaultPath: path.join(draftsDir(), safe + ".md"),
    filters: [{ name: "文本", extensions: ["md", "txt"] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  fs.writeFileSync(res.filePath, content, "utf8");
  return { canceled: false, filePath: res.filePath };
});
ipcMain.handle("research:fetchSourceExcerpt", async (_e, payload) => {
  const url = String(payload.url || "").trim();
  if (!url) throw new Error("请提供链接。");
  const em = await getExtensionManager();
  const st = em.getSessionStatus().find((s) => s.id === "fetch" && s.status === "connected");
  if (!st) throw new Error("网页阅读能力尚未就绪。请先在「能力」中启用，或手动粘贴摘录。");
  const chatTools = await getChatToolsModule();
  const result = await em.callTool("fetch", "fetch_markdown", { url });
  const text = chatTools.formatToolResult(result).slice(0, 12000);
  if (!text || text.length < 20) throw new Error("未能读取该网页的有效内容。请手动添加材料。");
  return { excerpt: text, url };
});

// Personal skills
ipcMain.handle("skills:list", async (_e, scene) => personalSkills.listSkills(app.getPath("userData"), scene));
ipcMain.handle("skills:get", async (_e, id) => personalSkills.getSkill(app.getPath("userData"), id));
ipcMain.handle("skills:save", async (_e, skill) => personalSkills.saveSkill(app.getPath("userData"), skill || {}));
ipcMain.handle("skills:delete", async (_e, id) => personalSkills.deleteSkill(app.getPath("userData"), id));
ipcMain.handle("skills:setActive", async (_e, payload) => {
  const userData = app.getPath("userData");
  const scene = payload && payload.scene;
  const skillId = (payload && payload.skillId) || null;
  const result = personalSkills.setActiveSkill(userData, scene, skillId);
  const prepResults = [];
  if (skillId) {
    const skill = personalSkills.getSkill(userData, skillId);
    for (const cid of (skill && skill.recommendedExtensions) || []) {
      prepResults.push(await ensureExtensionConnected(cid));
    }
  }
  const ready = prepResults.filter((r) => r.ok).map((r) => r.name || r.id);
  const skipped = prepResults.filter((r) => r.skipped);
  const failed = prepResults.filter((r) => !r.ok && !r.skipped);
  let message = "";
  if (ready.length) message += "已为该 Skill 准备：" + ready.join("、") + "。";
  if (skipped.length) {
    message +=
      (message ? " " : "") +
      "需在「能力」配置后启用：" +
      skipped.map((s) => s.name || s.id).join("、") +
      "。";
  }
  if (failed.length) {
    message +=
      (message ? " " : "") +
      "未能就绪：" +
      failed.map((f) => (f.name || f.id) + "（" + (f.message || f.error || "失败") + "）").join("、") +
      "。";
  }
  return { ...result, prepResults, message };
});
ipcMain.handle("skills:getActive", async (_e, scene) => personalSkills.getActiveSkill(app.getPath("userData"), scene));
ipcMain.handle("skills:saveFromContext", async (_e, payload) =>
  personalSkills.saveFromContext(app.getPath("userData"), payload || {})
);

ipcMain.handle("code:prepareScene", async () => {
  personalSkills.ensurePresetCodeSkills(app.getPath("userData"));
  const results = [];
  for (const cid of ["filesystem"]) {
    results.push(await ensureExtensionConnected(cid));
  }
  const gh = await ensureExtensionConnected("github");
  results.push(gh);
  const ready = results.filter((r) => r.ok).map((r) => r.name || r.id);
  const skipped = results.filter((r) => r.skipped);
  let message = ready.length ? "编程能力已就绪：" + ready.join("、") + "。" : "";
  if (skipped.length) {
    message +=
      (message ? " " : "") +
      "GitHub 等需密钥的项请到「能力」配置；本地文件读写可先用于审阅与说明修改。";
  }
  if (!message) message = "请在「能力」启用本地文件读写后开始。";
  return { results, message };
});

ipcMain.handle("code:buildDelegationHint", async (_e, payload) => {
  const dir = packageDirFromConfig();
  const manifestRaw = (() => {
    try {
      return fs.existsSync(path.join(dir, "manifest.json"))
        ? fs.readFileSync(path.join(dir, "manifest.json"), "utf8")
        : "";
    } catch {
      return "";
    }
  })();
  let manifest = {};
  try {
    if (manifestRaw) manifest = JSON.parse(manifestRaw);
  } catch {
    manifest = {};
  }
  const pkg = { exists: !!manifestRaw, manifest };
  const writeAuthorized = !!(payload && payload.writeAuthorized);
  const workspaceLabel = (payload && payload.workspaceLabel) || "";
  const skill = personalSkills.getActiveSkill(app.getPath("userData"), "code");
  const ag = l0Agents.getActiveAgent(app.getPath("userData"));
  const control = l0Orchestration.buildControlBrief({
    writeAuthorized,
    workspaceLabel,
    scene: "code",
  });
  const persona = l0Orchestration.buildPersonaBrief(pkg);
  const sceneHint = l0Orchestration.buildCodeSceneHint({
    writeAuthorized,
    workspaceLabel,
    skillHint: (skill && skill.systemHint) || "",
    executorName: ag && ag.name,
  });
  return {
    scenarioHint: control + "\n" + persona + "\n\n" + sceneHint,
    trailHint: writeAuthorized ? "授权：可写" : "授权：只读",
    executor: ag ? { id: ag.id, name: ag.name, kind: ag.kind } : null,
  };
});

ipcMain.handle("l0:auditList", async (_e, opts) =>
  l0Audit.list(app.getPath("userData"), opts || {})
);

ipcMain.handle("decisionAudit:list", async (_e, opts) =>
  decisionAudit.list(app.getPath("userData"), opts || {})
);
ipcMain.handle("decisionAudit:verify", async () =>
  decisionAudit.verify(app.getPath("userData"))
);
ipcMain.handle("decisionAudit:requestRotate", async (e) =>
  externalAgentFlow.requestAuditRotate(app.getPath("userData"), e)
);
ipcMain.handle("decisionAudit:rotate", async (e, payload) =>
  externalAgentFlow.confirmAuditRotate(app.getPath("userData"), e, payload || {})
);

ipcMain.handle("l0:listAgents", async () => l0Agents.listAgents(app.getPath("userData")));
ipcMain.handle("l0:setActiveAgent", async (_e, agentId) =>
  l0Agents.setActiveAgent(app.getPath("userData"), agentId)
);
ipcMain.handle("l0:saveCliAgent", async (_e, payload) =>
  l0Agents.saveCliAgent(app.getPath("userData"), payload || {})
);
ipcMain.handle("l0:getCliAgentConfig", async () =>
  l0Agents.getCliAgentConfig(app.getPath("userData"))
);
ipcMain.handle("l0:buildControlBrief", async (_e, payload) => {
  const scene = (payload && payload.scene) || "write";
  return {
    brief: l0Orchestration.buildControlBrief({
      writeAuthorized: !!(payload && payload.writeAuthorized),
      workspaceLabel: (payload && payload.workspaceLabel) || "",
      scene,
    }),
  };
});

const activeDelegateAborts = new Map();

ipcMain.handle("l0:requestExternalAgent", async (e, payload) =>
  externalAgentFlow.requestExternalAgent(app.getPath("userData"), e, payload || {}, l0Agents)
);
ipcMain.handle("l0:cancelExternalAgentConfirmation", async (e, payload) =>
  externalAgentFlow.cancelExternalAgentConfirmation(app.getPath("userData"), e, payload || {})
);

ipcMain.handle("l0:runExternalAgent", async (e, payload) => {
  const userData = app.getPath("userData");
  const clientRequestId = String((payload && payload.requestId) || "").trim();
  const began = delegateRuntime.begin(e, clientRequestId);
  if (!began.ok) {
    if (began.reason === "duplicate_request_id") {
      throw new Error("相同请求编号的外部委派仍在进行，已拒绝重复启动。");
    }
    if (began.reason === "missing_sender") {
      throw new Error("无法识别请求来源窗口，已拒绝启动外部程序。");
    }
    throw new Error("无法登记外部委派请求。");
  }
  const { operationId, abort: ac, senderId } = began;
  activeDelegateAborts.set(operationId, ac);
  const progressRequestId = clientRequestId || operationId;
  // Expose operationId immediately — do not wait for the long-running invoke to resolve.
  try {
    e.sender.send("l0:external-agent-started", {
      requestId: clientRequestId || "",
      operationId,
      senderId,
    });
  } catch {
    /* ignore */
  }
  const sendProg = (p) => {
    try {
      e.sender.send("chat:progress", {
        requestId: progressRequestId,
        operationId,
        ...p,
      });
    } catch {
      /* ignore */
    }
  };
  sendProg({ phase: "thinking", label: "正在登记外部委派…" });
  const runPromise = externalAgentFlow
    .runExternalAgent(userData, e, payload || {}, l0Agents, {
      onProgress: sendProg,
      signal: ac.signal,
    })
    .then((result) => {
      if (result && typeof result === "object") {
        result.operationId = operationId;
        if (!result.meta) result.meta = {};
        result.meta.operationId = operationId;
        result.meta.senderId = senderId;
      }
      return result;
    });
  delegateRuntime.attachPromise(operationId, runPromise);
  try {
    return await runPromise;
  } finally {
    activeDelegateAborts.delete(operationId);
    delegateRuntime.end(operationId);
  }
});

ipcMain.handle("l0:stopExternalAgent", async (e, payload) => {
  const operationId = String((payload && payload.operationId) || "").trim();
  // Legacy requestId alone cannot stop another sender's task: require operationId.
  if (!operationId) {
    return { ok: false, reason: "missing_operation_id" };
  }
  const result = delegateRuntime.abortOne(e, operationId);
  if (result.ok && result.operationId) {
    const ac = activeDelegateAborts.get(result.operationId);
    if (ac) {
      try {
        ac.abort();
      } catch {
        /* ignore */
      }
    }
  }
  return result;
});

ipcMain.handle("scenarios:prepare", async (_e, packId) => {
  const pack = library.getScenarioPackById(packId);
  if (!pack) throw new Error("未知场景：" + packId);
  const em = await getExtensionManager();
  const results = [];
  for (const cid of pack.recommendedExtensions || []) {
    const item = catalog.getById(cid);
    if (!item) {
      results.push({ id: cid, ok: false, error: "目录中不存在" });
      continue;
    }
    if (item.needsKey) {
      results.push({
        id: cid,
        name: item.name,
        ok: false,
        skipped: true,
        reason: "需要密钥，请到「能力」页配置后启用",
      });
      continue;
    }
    try {
      const built = buildExtensionFromCatalog(item, { params: {}, env: {} });
      const publicBuilt = getConfigSecrets().sanitizeExtension(
        { ...built, env: undefined, envKeyNames: (item.envKeys || []).map((ek) => ek.key) },
        getConfigSecrets().secretStore
      );
      const list = getCapabilityExtensions().filter((e) => e.id !== publicBuilt.id);
      list.push(publicBuilt);
      saveCapabilityExtensions(list);
      await em.connectExtension(getConfigSecrets().hydrateExtensionEnv(publicBuilt));
      results.push({ id: cid, name: item.name, ok: true, connected: true });
    } catch (err) {
      results.push({ id: cid, name: item.name, ok: false, error: err.message || String(err) });
    }
  }
  const readyNames = results.filter((r) => r.ok).map((r) => r.name || r.id);
  const skipped = results.filter((r) => r.skipped);
  const failed = results.filter((r) => !r.ok && !r.skipped);
  let message = "";
  if (readyNames.length) message += "已为「" + pack.title + "」准备：" + readyNames.join("、") + "。";
  if (skipped.length) {
    message +=
      (message ? " " : "") +
      "以下需在「能力」页配置密钥：" +
      skipped.map((s) => s.name || s.id).join("、") +
      "。";
  }
  if (failed.length) {
    message +=
      (message ? " " : "") +
      "未能就绪：" +
      failed.map((f) => (f.name || f.id) + "（" + (f.error || "失败") + "）").join("、") +
      "。";
  }
  if (!message) message = "该场景暂无需要自动准备的能力。";
  return {
    pack,
    results,
    message,
    systemHint: pack.systemHint || "",
  };
});

ipcMain.handle("capabilities:surface", async (_e, payload) => {
  const em = await getExtensionManager();
  const statusList = em.getSessionStatus();
  return capabilitySurface.buildCapabilitySurface({
    catalogItems: catalog.listAll ? catalog.listAll() : catalog.CATALOG || [],
    enabledExtensions: getCapabilityExtensions(),
    statusList,
    scenarioPacks: library.getScenarioPacks(),
    templates: library.getTemplates(),
    activeScenario: (payload && payload.activeScenario) || null,
  });
});
ipcMain.handle("library:createFromTemplate", async (_e, payload) => {
  const cfg = readConfig();
  return library.createFromTemplate(app.getPath("userData"), {
    ...(payload || {}),
    packageRef: cfg.packageDir || DEFAULT_PACKAGE_DIR,
  });
});
ipcMain.handle("library:createBlank", async (_e, payload) => {
  const cfg = readConfig();
  return library.createBlank(app.getPath("userData"), {
    ...(payload || {}),
    packageRef: cfg.packageDir || DEFAULT_PACKAGE_DIR,
  });
});
ipcMain.handle("library:importArtifact", async (_e, payload) => {
  const cfg = readConfig();
  return library.importFromArtifact(app.getPath("userData"), {
    ...(payload || {}),
    packageRef: cfg.packageDir || DEFAULT_PACKAGE_DIR,
  });
});
ipcMain.handle("library:export", async (_e, { id, format }) => {
  const item = library.getDeliverable(app.getPath("userData"), id);
  if (!item) throw new Error("找不到该产物");
  const safe = safeFileStem(item.title);
  if (format === "csv") {
    const csv = library.markdownTableToCsv(item.content || "");
    const res = await dialog.showSaveDialog({
      title: "导出表格 CSV（WPS / Excel 可开）",
      defaultPath: path.join(draftsDir(), safe + ".csv"),
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    fs.writeFileSync(res.filePath, csv, "utf8");
    library.upsertDeliverable(app.getPath("userData"), { ...item, status: "exported" });
    return { canceled: false, filePath: res.filePath };
  }
  if (format === "docx") {
    const buf = documentOutput.buildDocxFromMarkdown(item.content || "", item.title || "成稿");
    const res = await dialog.showSaveDialog({
      title: "导出 Word（WPS 可开）",
      defaultPath: path.join(draftsDir(), safe + ".docx"),
      filters: [{ name: "Word", extensions: ["docx"] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    fs.writeFileSync(res.filePath, buf);
    library.upsertDeliverable(app.getPath("userData"), { ...item, status: "exported" });
    return { canceled: false, filePath: res.filePath };
  }
  const res = await dialog.showSaveDialog({
    title: "导出 Markdown",
    defaultPath: path.join(draftsDir(), safe + ".md"),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  fs.writeFileSync(res.filePath, item.content || "", "utf8");
  library.upsertDeliverable(app.getPath("userData"), { ...item, status: "exported" });
  return { canceled: false, filePath: res.filePath };
});

// ---------- Task outputs ----------
ipcMain.handle("output:planPpt", async (_e, { pkg, brief }) => {
  const cfg = readConfig();
  if (!cfg.apiKey) throw new Error("尚未配置 API Key，请在设置中填写。");
  if (!brief?.topic?.trim()) throw new Error("请填写演讲主题。");

  let system = buildSystemPrompt(pkg);
  const dir = cfg.packageDir || DEFAULT_PACKAGE_DIR;
  try {
    const result = retrieval.retrieve(dir, brief.topic);
    const ctx = retrieval.renderContext(result);
    if (ctx) system += "\n\n---\n\n" + ctx;
  } catch {}

  const messages = pptxOutput.buildPptPlanMessages({ systemPrompt: system }, brief);
  let raw = await callModel(cfg, messages);
  if (hasBadChars(raw)) raw = await callModel(cfg, messages);
  if (hasBadChars(raw)) throw new Error("模型返回含乱码，请重试。");
  const plan = pptxOutput.parsePlanJson(raw);
  const owner = (pkg.manifest && pkg.manifest.ownerDisplayName) || "本人";
  plan.author = owner;
  return plan;
});

ipcMain.handle("output:savePpt", async (_e, { plan }) => {
  if (!plan?.slides?.length) throw new Error("没有可导出的幻灯片内容。");
  const buf = await pptxOutput.buildPptx(plan);
  const safeName = (plan.title || "演讲").replace(/[<>:"/\\|?*]/g, "_").slice(0, 60);
  const res = await dialog.showSaveDialog({
    title: "保存演讲 PPT",
    defaultPath: safeName + ".pptx",
    filters: [{ name: "PowerPoint 演示文稿", extensions: ["pptx"] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  fs.writeFileSync(res.filePath, buf);
  return { canceled: false, filePath: res.filePath, slideCount: plan.slides.length };
});

// ---------- Builder ----------
ipcMain.handle("builder:pickFile", async () => {
  const res = await dialog.showOpenDialog({
    title: "选择要蒸馏的素材（可多选）",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "支持的素材", extensions: ["docx", "txt", "md", "markdown", "pptx", "pdf"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return [];
  return res.filePaths.slice(0, 20).map((filePath) => {
    const stat = fs.statSync(filePath);
    return { filePath, name: path.basename(filePath), size: stat.size };
  });
});

// Core distill pipeline shared by file import and questionnaire.
let distillCancelFlag = false;

function resetDistillCancel() {
  distillCancelFlag = false;
}

function throwIfDistillCanceled() {
  if (distillCancelFlag) {
    const err = new Error("已中断构建");
    err.code = "DISTILL_CANCELED";
    throw err;
  }
}

ipcMain.handle("builder:cancel", () => {
  distillCancelFlag = true;
  return { ok: true };
});

async function distillFromText(e, text, ownerName, progressExtra) {
  const cfg = readConfig();
  if (!cfg.apiKey) throw new Error("尚未配置 API Key，请在设置中填写。");
  const owner = ownerName || "本人";
  const send = (payload) => e.sender.send("builder:progress", { ...progressExtra, ...payload });

  const maxChars = progressExtra?.maxChars || 28000;
  const maxChunks = progressExtra?.maxChunks || 3;
  const prepared = builder.prepareTextForModel(text, { maxChars });
  if (prepared.skipped) {
    send({
      phase: "file",
      label: prepared.skipped,
      materialKind: progressExtra?.materialKind || "persona",
    });
    const agg = builder.aggregate([]);
    if (!progressExtra?.skipFinalDone) send({ phase: "done", agg });
    return {
      agg,
      results: [],
      meta: {
        chars: prepared.originalChars,
        chunks: 0,
        chunksAvailable: 0,
        skipped: true,
        truncated: true,
        truncateMode: prepared.truncateMode || "skipped",
        usedChars: 0,
      },
      sourceText: "",
    };
  }
  let chunks = builder.chunkText(prepared.text, 12000);
  const chunksAvailable = chunks.length;
  if (chunks.length > maxChunks) {
    send({
      phase: "file",
      label: `正文约 ${prepared.originalChars} 字，仅处理前 ${maxChunks} 段以加快（共可切 ${chunksAvailable} 段）`,
      materialKind: progressExtra?.materialKind || "persona",
    });
    chunks = chunks.slice(0, maxChunks);
  }
  const results = [];
  send({ phase: "start", chunks: chunks.length, chars: prepared.originalChars });

  for (let i = 0; i < chunks.length; i++) {
    throwIfDistillCanceled();
    send({ phase: "chunk", index: i + 1, total: chunks.length });
    let parsed = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      throwIfDistillCanceled();
      try {
        const raw = await callModel(cfg, builder.buildDistillMessages(chunks[i], owner));
        parsed = builder.parseDistillOutput(raw);
        if (!builder.distillResultEmpty(parsed)) break;
        if (attempt < 3) send({ phase: "chunk-retry", index: i + 1, attempt: attempt + 1, reason: "empty_or_corrupt" });
      } catch (err) {
        if (err && err.code === "DISTILL_CANCELED") throw err;
        if (attempt === 3) send({ phase: "chunk-error", index: i + 1, message: err.message });
        else send({ phase: "chunk-retry", index: i + 1, attempt: attempt + 1, reason: err.message });
      }
    }
    if (parsed && !builder.distillResultEmpty(parsed)) results.push(parsed);
  }
  let agg = builder.aggregate(results);
  const likeness = builder.filterLikelyFabricated(agg, prepared.text);
  agg = likeness.agg;
  if (likeness.dropped > 0) {
    send({
      phase: "file",
      label: `像我校验：已跳过 ${likeness.dropped} 条与原文重合过低的条目`,
      materialKind: progressExtra?.materialKind || "persona",
    });
  }
  if (!progressExtra?.skipFinalDone) send({ phase: "done", agg });
  return {
    agg,
    results,
    meta: {
      chars: prepared.originalChars,
      chunks: chunks.length,
      chunksAvailable,
      truncated: prepared.truncated || chunksAvailable > maxChunks,
      truncateMode: prepared.truncated
        ? prepared.truncateMode || "head_tail"
        : chunksAvailable > maxChunks
          ? "chunk_cap"
          : "",
      usedChars: prepared.usedChars || prepared.text.length,
      skipped: false,
      likenessDropped: likeness.dropped || 0,
    },
    sourceText: prepared.text,
  };
}

async function identityFromText(e, text, ownerName, progressExtra) {
  const cfg = readConfig();
  const owner = ownerName || "本人";
  const send = (payload) => e.sender.send("builder:progress", { ...progressExtra, ...payload });
  const fileName = progressExtra?.fileName || "";
  const maxChars = progressExtra?.maxChars || 28000;
  const maxChunks = progressExtra?.maxChunks || 3;

  let workingText = String(text || "");
  if (workingText.trim()) {
    const prepared = builder.prepareTextForModel(workingText, { maxChars });
    if (prepared.skipped) {
      send({
        phase: "file",
        label: prepared.skipped + "，改用文件名线索",
        materialKind: "identity",
      });
      workingText = "";
    } else {
      workingText = prepared.text;
      if (prepared.truncated) {
        send({
          phase: "file",
          label: `正文约 ${prepared.originalChars} 字，已取头尾约 ${prepared.usedChars || maxChars} 字`,
          materialKind: "identity",
        });
      }
    }
  }

  if (!workingText.trim()) {
    const provisional = builder.provisionalIdentityFromFilename(fileName, owner);
    send({
      phase: "start",
      chunks: cfg.apiKey ? 1 : 0,
      chars: 0,
      materialKind: "identity",
      label: "正文不可用，改从文件名建立线索与推断…",
    });
    const results = [provisional];
    if (cfg.apiKey) {
      throwIfDistillCanceled();
      send({ phase: "chunk", index: 1, total: 1, materialKind: "identity" });
      try {
        const raw = await callModel(
          cfg,
          builder.buildIdentityExtractMessages(
            `（仅文件名可用，正文未下载或无法读取）\n文件名：${fileName}\n请仅基于文件名做谨慎的事件与推断；置信度用 medium/low。`,
            owner
          ),
          { temperature: 0.2 }
        );
        const parsed = builder.parseIdentityOutput(raw);
        if (parsed && !builder.identityResultEmpty(parsed)) results.push(parsed);
      } catch (err) {
        if (err && err.code === "DISTILL_CANCELED") throw err;
        send({ phase: "chunk-error", index: 1, message: err.message });
      }
    }
    const identity = builder.aggregateIdentity(results);
    if (!progressExtra?.skipFinalDone) send({ phase: "done", identity, materialKind: "identity" });
    return {
      identity,
      results,
      meta: {
        chars: 0,
        chunks: results.length,
        chunksAvailable: results.length,
        bodyUnavailable: true,
        truncated: false,
        likenessDropped: 0,
      },
      sourceText: "",
    };
  }

  if (!cfg.apiKey) throw new Error("尚未配置 API Key，请在设置中填写。");
  let chunks = builder.chunkText(workingText, 12000);
  const chunksAvailable = chunks.length;
  if (chunks.length > maxChunks) {
    send({
      phase: "file",
      label: `仅处理前 ${maxChunks} 段以加快（可切 ${chunksAvailable} 段）`,
      materialKind: "identity",
    });
    chunks = chunks.slice(0, maxChunks);
  }
  const results = [];
  send({ phase: "start", chunks: chunks.length, chars: workingText.length, materialKind: "identity" });

  for (let i = 0; i < chunks.length; i++) {
    throwIfDistillCanceled();
    send({ phase: "chunk", index: i + 1, total: chunks.length, materialKind: "identity" });
    let parsed = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      throwIfDistillCanceled();
      try {
        const raw = await callModel(cfg, builder.buildIdentityExtractMessages(chunks[i], owner));
        parsed = builder.parseIdentityOutput(raw);
        if (!builder.identityResultEmpty(parsed)) break;
        if (attempt < 3) send({ phase: "chunk-retry", index: i + 1, attempt: attempt + 1, reason: "empty_or_corrupt" });
      } catch (err) {
        if (err && err.code === "DISTILL_CANCELED") throw err;
        if (attempt === 3) send({ phase: "chunk-error", index: i + 1, message: err.message });
        else send({ phase: "chunk-retry", index: i + 1, attempt: attempt + 1, reason: err.message });
      }
    }
    if (parsed && !builder.identityResultEmpty(parsed)) results.push(parsed);
  }
  let identity = builder.aggregateIdentity(results);
  const likeness = builder.filterLikelyFabricatedIdentity(identity, workingText);
  identity = likeness.identity;
  if (likeness.dropped > 0) {
    send({
      phase: "file",
      label: `像我校验：已跳过 ${likeness.dropped} 条与原文重合过低的条目`,
      materialKind: "identity",
    });
  }
  if (!progressExtra?.skipFinalDone) send({ phase: "done", identity, materialKind: "identity" });
  return {
    identity,
    results,
    meta: {
      chars: workingText.length,
      chunks: chunks.length,
      chunksAvailable,
      truncated: chunksAvailable > maxChunks,
      truncateMode: chunksAvailable > maxChunks ? "chunk_cap" : "",
      likenessDropped: likeness.dropped || 0,
    },
    sourceText: workingText,
  };
}

ipcMain.handle("materials:kinds", () => materials.MATERIAL_KINDS);

ipcMain.handle("materials:listCustody", () => materials.listCustody(app.getPath("userData")));

ipcMain.handle("inbox:list", () => inbox.listQueue(app.getPath("userData")));

ipcMain.handle("inbox:enqueue", (_e, files) =>
  inbox.enqueueFiles(app.getPath("userData"), files || [], "manual")
);

ipcMain.handle("inbox:remove", (_e, id) => inbox.removeItem(app.getPath("userData"), id));

ipcMain.handle("inbox:setKind", (_e, { id, kind }) => {
  const meta = inbox.LABEL_META[kind];
  if (!meta) return { ok: false, error: "无效归类" };
  return inbox.updateItem(app.getPath("userData"), id, {
    suggestedKind: kind,
    materialKind: meta.materialKind,
    status: "suggested",
    reason: "你已指定用途",
    confidence: "high",
    kindConflict: false,
  });
});

ipcMain.handle("inbox:organize", async (e) => {
  const userData = app.getPath("userData");
  const data = inbox.listQueue(userData);
  const cfg = readConfig();
  const targets = (data.items || []).filter(
    (it) => it.status === "queued" || it.status === "suggested"
  );
  const send = (payload) => e.sender.send("inbox:progress", payload);
  send({ phase: "start", total: targets.length });
  let i = 0;
  for (const it of targets) {
    i++;
    send({ phase: "item", index: i, total: targets.length, name: it.name });
    let text = "";
    let readError = "";
    const extracted = await builder.tryExtractText(it.filePath);
    if (extracted.ok) {
      text = extracted.text.slice(0, 12000);
    } else {
      readError = extracted.error;
    }
    let suggestion = inbox.classifyByRules(it.name, text);
    let modelSuggestion = null;
    // Filename-only is enough to call the model when rules are undecided / low
    if (cfg.apiKey && suggestion.confidence !== "high") {
      try {
        const raw = await callModel(
          cfg,
          inbox.buildClassifyMessages(it.name, text || "（正文不可读，仅根据文件名判断）"),
          { temperature: 0.2 }
        );
        modelSuggestion = inbox.parseClassifyOutput(raw);
      } catch {
        /* keep rules */
      }
    }
    suggestion = inbox.resolveClassifySuggestion(suggestion, modelSuggestion);
    const meta = inbox.LABEL_META[suggestion.suggestedKind] || inbox.LABEL_META.undecided;
    const reason = readError
      ? `${suggestion.reason}｜${readError}`
      : suggestion.reason;
    inbox.updateItem(userData, it.id, {
      status: "suggested",
      suggestedKind: suggestion.suggestedKind,
      materialKind: meta.materialKind,
      confidence: suggestion.confidence,
      reason,
      ruleKind: suggestion.ruleKind || null,
      modelKind: suggestion.modelKind || null,
      kindConflict: !!suggestion.kindConflict,
      bodyUnavailable: !extracted.ok,
      previewChars: text ? Math.min(text.length, 500) : 0,
    });
  }
  send({ phase: "done" });
  return inbox.listQueue(userData);
});

ipcMain.handle("inbox:markStatus", (_e, payload) => {
  const { id, status, processMeta } = payload || {};
  const patch = {};
  if (status) patch.status = status;
  if (processMeta && typeof processMeta === "object") patch.processMeta = processMeta;
  return inbox.updateItem(app.getPath("userData"), id, patch);
});

ipcMain.handle("access:list", () => inbox.listScopes(app.getPath("userData")));

ipcMain.handle("access:add", async () => {
  const res = await dialog.showOpenDialog({
    title: "选择可读文件夹（授权后仅扫描你允许的类型）",
    properties: ["openDirectory"],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  return inbox.addAccessScope(app.getPath("userData"), {
    dirPath: res.filePaths[0],
    recursive: true,
    extensions: Array.from(inbox.ALLOWED_EXT),
  });
});

ipcMain.handle("access:remove", (_e, id) =>
  inbox.removeAccessScope(app.getPath("userData"), id)
);

ipcMain.handle("access:scan", (_e, scopeId) =>
  inbox.scanAccessScopes(app.getPath("userData"), scopeId || null)
);

// Distill / identity extract / custody — routed by materialKind.
ipcMain.handle("builder:distill", async (e, { filePath, filePaths, materialKind, options }) => {
  resetDistillCancel();
  const kind = materialKind === "identity" || materialKind === "custody" ? materialKind : "persona";
  const paths = (Array.isArray(filePaths) && filePaths.length
    ? filePaths
    : filePath
      ? [filePath]
      : []
  ).filter(Boolean);
  if (!paths.length) throw new Error("请先选择要处理的素材文件。");

  const smart = !!(options && options.smart);
  const maxChars = (options && options.maxChars) || (smart ? 20000 : 28000);
  const maxChunks = (options && options.maxChunks) || (smart ? 2 : 3);
  const progressBase = { maxChars, maxChunks };

  const send = (payload) => e.sender.send("builder:progress", payload);
  const fileNames = paths.map((fp) => path.basename(fp));

  if (kind === "custody") {
    const vaultItems = [];
    for (let fi = 0; fi < paths.length; fi++) {
      throwIfDistillCanceled();
      const fp = paths[fi];
      const name = path.basename(fp);
      send({
        phase: "file",
        index: fi + 1,
        total: paths.length,
        name,
        label: `正在收入保管库 ${fi + 1}/${paths.length}：${name}`,
        materialKind: "custody",
      });
      let text = "";
      let chars = 0;
      try {
        text = await builder.extractText(fp);
        chars = text.length;
      } catch (err) {
        send({ phase: "chunk-error", index: fi + 1, message: "无法读取正文（仍登记文件路径）：" + err.message });
      }
      vaultItems.push({
        filePath: fp,
        title: name,
        chars,
        excerpt: text.slice(0, 800),
      });
    }
    const stored = materials.addCustodyItems(app.getPath("userData"), vaultItems);
    send({ phase: "done", materialKind: "custody", custody: stored });
    return {
      materialKind: "custody",
      custody: stored,
      meta: { fileCount: paths.length, fileNames, fileName: fileNames.join("、") },
    };
  }

  if (kind === "identity") {
    const allResults = [];
    const fileNotes = [];
    let totalChars = 0;
    let totalChunks = 0;
    let likenessDropped = 0;
    for (let fi = 0; fi < paths.length; fi++) {
      throwIfDistillCanceled();
      const fp = paths[fi];
      const name = path.basename(fp);
      send({
        phase: "file",
        index: fi + 1,
        total: paths.length,
        name,
        label: `正在登记社会事实 ${fi + 1}/${paths.length}：${name}`,
        materialKind: "identity",
      });
      const extracted = await builder.tryExtractText(fp);
      const text = extracted.ok ? extracted.text : "";
      if (!extracted.ok) {
        send({
          phase: "file",
          index: fi + 1,
          total: paths.length,
          name,
          label: `正文不可读，改用文件名线索：${extracted.error}`,
          materialKind: "identity",
        });
      }
      totalChars += text.length;
      const res = await identityFromText(e, text, null, {
        ...progressBase,
        fileIndex: fi + 1,
        fileTotal: paths.length,
        fileName: name,
        skipFinalDone: true,
        materialKind: "identity",
      });
      totalChunks += res.meta.chunks || 0;
      likenessDropped += res.meta.likenessDropped || 0;
      fileNotes.push({
        filePath: fp,
        name,
        truncated: !!res.meta.truncated || !!res.meta.bodyUnavailable,
        truncateMode: res.meta.truncateMode || (res.meta.bodyUnavailable ? "body_unavailable" : ""),
        originalChars: res.meta.chars || text.length,
        chunksUsed: res.meta.chunks || 0,
        chunksAvailable: res.meta.chunksAvailable || res.meta.chunks || 0,
        likenessDropped: res.meta.likenessDropped || 0,
        skipped: !!res.meta.bodyUnavailable,
      });
      if (res.identity && !builder.identityResultEmpty(res.identity)) allResults.push(res.identity);
    }
    const identity = builder.aggregateIdentity(allResults);
    send({ phase: "done", identity, materialKind: "identity" });
    return {
      materialKind: "identity",
      identity,
      meta: {
        chars: totalChars,
        chunks: totalChunks,
        fileCount: paths.length,
        fileNames,
        fileName: fileNames.join("、"),
        likenessDropped,
        fileNotes,
        truncated: fileNotes.some((n) => n.truncated),
      },
    };
  }

  const allResults = [];
  const fileNotes = [];
  let totalChars = 0;
  let totalChunks = 0;
  let likenessDropped = 0;

  for (let fi = 0; fi < paths.length; fi++) {
    throwIfDistillCanceled();
    const fp = paths[fi];
    const name = path.basename(fp);
    send({
      phase: "file",
      index: fi + 1,
      total: paths.length,
      name,
      label: `正在处理第 ${fi + 1}/${paths.length} 个文件：${name}`,
      materialKind: "persona",
    });
    let text = "";
    try {
      text = await builder.extractText(fp);
    } catch (err) {
      send({ phase: "chunk-error", index: fi + 1, message: err.message });
      fileNotes.push({
        filePath: fp,
        name,
        truncated: true,
        truncateMode: "read_error",
        originalChars: 0,
        chunksUsed: 0,
        chunksAvailable: 0,
        likenessDropped: 0,
        skipped: true,
        error: err.message,
      });
      continue;
    }
    totalChars += text.length;
    const res = await distillFromText(e, text, null, {
      ...progressBase,
      fileIndex: fi + 1,
      fileTotal: paths.length,
      fileName: name,
      skipFinalDone: true,
      materialKind: "persona",
    });
    totalChunks += res.meta.chunks || 0;
    likenessDropped += res.meta.likenessDropped || 0;
    fileNotes.push({
      filePath: fp,
      name,
      truncated: !!res.meta.truncated || !!res.meta.skipped,
      truncateMode: res.meta.truncateMode || "",
      originalChars: res.meta.chars || text.length,
      chunksUsed: res.meta.chunks || 0,
      chunksAvailable: res.meta.chunksAvailable || res.meta.chunks || 0,
      likenessDropped: res.meta.likenessDropped || 0,
      skipped: !!res.meta.skipped,
    });
    if (res.agg && !builder.distillResultEmpty(res.agg)) allResults.push(res.agg);
  }

  const agg = builder.aggregate(allResults);
  send({ phase: "done", agg, materialKind: "persona" });
  return {
    materialKind: "persona",
    agg,
    meta: {
      chars: totalChars,
      chunks: totalChunks,
      fileCount: paths.length,
      fileNames,
      fileName: fileNames.join("、"),
      likenessDropped,
      fileNotes,
      truncated: fileNotes.some((n) => n.truncated),
    },
  };
});

// Return the intake questionnaire bank.
ipcMain.handle("intake:questions", () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "intake-questions.json"), "utf8"));
  } catch (err) {
    throw new Error("读取问卷题库失败：" + err.message);
  }
});

// Distill from questionnaire answers: format Q&A -> shared pipeline.
ipcMain.handle("intake:distill", async (e, { answers }) => {
  const bank = JSON.parse(fs.readFileSync(path.join(__dirname, "intake-questions.json"), "utf8"));
  const lines = [
    "以下是本人填写的自我评测（含性格倾向、价值排序、情境判断、经历概要与表达边界）。",
    "请据此整理人格倾向、价值观、决策框架、表达风格与可核对记忆；经历概要请同时抽成可写入时间线的事件线索。",
    "优先保留带理由的判断，不要编造问卷未提及的机构与人名。\n",
  ];
  for (const sec of bank.sections || []) {
    lines.push("### " + sec.title);
    for (const q of sec.questions || []) {
      const a = (answers && answers[q.id]) || "";
      if (String(a).trim()) lines.push("问：" + q.text + "\n答：" + a + "\n");
      if (q.followupId) {
        const note = (answers && answers[q.followupId]) || "";
        if (String(note).trim()) {
          lines.push("补充（" + (q.followup || q.followupId) + "）：" + note + "\n");
        }
      }
    }
  }
  const text = lines.join("\n");
  if (text.length < 80) {
    throw new Error("评测回答过少：请至少完成性格倾向、价值排序与 3 道情境判断。");
  }
  const res = await distillFromText(e, text);
  res.meta.source = "intake-questionnaire-v0.3";
  return res;
});

// ---------- Feedback loop (via PackageStore change sets) ----------
ipcMain.handle("feedback:preview", (_e, payload) => {
  const pkgDir = packageDirFromConfig();
  return feedback.previewFeedback(pkgDir, payload || {});
});

ipcMain.handle("feedback:apply", (_e, payload) => {
  const pkgDir = packageDirFromConfig();
  const body = payload && typeof payload === "object" ? payload : {};
  // Only accept changeSetId + confirmation — never raw write plans.
  return feedback.applyFeedback(pkgDir, {
    changeSetId: body.changeSetId,
    confirmed: body.confirmed,
    confirmation: body.confirmation,
    category: body.category,
  });
});

// ---------- PackageStore sandbox (tmp demos only; never auto-touch real package) ----------
const SANDBOX_STATE_PATH = path.join(app.getPath("userData"), "sandbox-package-state.json");
let sandboxPackageBusy = false;

function readSandboxPackageState() {
  return sandboxPackageState.loadSandboxState(SANDBOX_STATE_PATH);
}

function writeSandboxPackageState(state) {
  return sandboxPackageState.saveSandboxState(SANDBOX_STATE_PATH, state);
}

function getSandboxPackageStatus() {
  const state = readSandboxPackageState();
  const current = path.resolve(packageDirFromConfig());
  return sandboxPackageState.buildSandboxStatus({
    currentPackageDir: current,
    regularPackageDir: state.regularPackageDir,
    defaultPackageDir: DEFAULT_PACKAGE_DIR,
  });
}

function applyPackageDirToConfig(packageDir) {
  const pub = readPublicConfig();
  return getConfigSecrets().setConfigFromRenderer({
    baseURL: pub.baseURL || "",
    model: pub.model || "",
    packageDir: String(packageDir || "").trim(),
    apiKey: "",
  });
}

ipcMain.handle("packageStore:createDemo", (_e, opts) => {
  const options = opts && typeof opts === "object" ? opts : {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), sandboxPackageState.TEMP_PREFIX));
  createMinimalFixture(dir, {
    schemaVersion: options.schemaVersion,
    withMemoryLine: !!options.withMemoryLine,
  });
  const store = new PackageStore({ packageDir: dir, ownerId: "sandbox:demo" });
  if (options.migrateToV02 === true) {
    store.migrateToV02({ actor: "sandbox:demo", toolVersion: "digitalme-app-sandbox" });
  }
  const inspect = store.inspect();
  return { packageDir: dir, inspect, isTemp: true };
});

ipcMain.handle("packageStore:getSandboxStatus", () => getSandboxPackageStatus());

ipcMain.handle("packageStore:activateTempDemo", (_e, opts) => {
  if (sandboxPackageBusy) {
    const err = new Error("正在切换资料目录，请稍候。");
    err.code = "sandbox_busy";
    throw err;
  }
  sandboxPackageBusy = true;
  try {
    const options = opts && typeof opts === "object" ? opts : {};
    const confirmed =
      options.confirmed === true ||
      (options.confirmation && options.confirmation.confirmed === true);
    if (!confirmed) {
      const err = new Error("需要明确确认后才能创建并切换到临时测试资料。");
      err.code = "confirmation_required";
      throw err;
    }

    const current = path.resolve(packageDirFromConfig());
    const prev = readSandboxPackageState();
    const regularPackageDir = sandboxPackageState.nextRegularPackageDir(
      current,
      prev.regularPackageDir,
      DEFAULT_PACKAGE_DIR
    );

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), sandboxPackageState.TEMP_PREFIX));
    createMinimalFixture(dir, {
      schemaVersion: options.schemaVersion,
      withMemoryLine: !!options.withMemoryLine,
    });
    const store = new PackageStore({ packageDir: dir, ownerId: "sandbox:demo" });
    if (options.migrateToV02 !== false) {
      store.migrateToV02({ actor: "sandbox:demo", toolVersion: "digitalme-app-sandbox" });
    }
    const inspect = store.inspect();

    writeSandboxPackageState({
      regularPackageDir,
      activeTempPackageDir: dir,
    });
    applyPackageDirToConfig(dir);

    return {
      ok: true,
      packageDir: dir,
      regularPackageDir,
      isUsingTemp: true,
      inspect,
    };
  } finally {
    sandboxPackageBusy = false;
  }
});

ipcMain.handle("packageStore:restoreRegularPackageDir", (_e, opts) => {
  if (sandboxPackageBusy) {
    const err = new Error("正在切换资料目录，请稍候。");
    err.code = "sandbox_busy";
    throw err;
  }
  sandboxPackageBusy = true;
  try {
    const options = opts && typeof opts === "object" ? opts : {};
    const confirmed =
      options.confirmed === true ||
      (options.confirmation && options.confirmation.confirmed === true);
    if (!confirmed) {
      const err = new Error("需要明确确认后才能恢复常规资料目录。");
      err.code = "confirmation_required";
      throw err;
    }

    const status = getSandboxPackageStatus();
    if (!status.isUsingTemp) {
      const err = new Error("当前已在使用常规资料目录。");
      err.code = "not_using_temp";
      throw err;
    }
    const target = path.resolve(status.regularPackageDir || DEFAULT_PACKAGE_DIR);
    if (sandboxPackageState.isTempDemoPackageDir(target)) {
      const err = new Error("常规资料目录无效，已拒绝恢复。");
      err.code = "regular_dir_invalid";
      throw err;
    }

    writeSandboxPackageState({
      regularPackageDir: target,
      activeTempPackageDir: "",
    });
    applyPackageDirToConfig(target);

    return {
      ok: true,
      packageDir: target,
      regularPackageDir: target,
      isUsingTemp: false,
    };
  } finally {
    sandboxPackageBusy = false;
  }
});

ipcMain.handle("packageStore:inspect", (_e, payload) => {
  const body = payload && typeof payload === "object" ? payload : {};
  const pkgDir = body.packageDir
    ? assertPackageStoreDirAllowed(body.packageDir)
    : path.resolve(packageDirFromConfig());
  const store = new PackageStore({ packageDir: pkgDir, ownerId: "sandbox:inspect" });
  return store.inspect();
});

ipcMain.handle("packageStore:listVersions", () => {
  const pkgDir = path.resolve(packageDirFromConfig());
  const store = new PackageStore({ packageDir: pkgDir, ownerId: "sandbox:list" });
  return buildVersionPanelInfo(store);
});

ipcMain.handle("subject:getOverview", () => {
  const pkgDir = path.resolve(packageDirFromConfig());
  const pub = readPublicConfig();
  let inboxSummary = summarizeInboxForOverview(null);
  try {
    const queue = inbox.listQueue(app.getPath("userData"));
    inboxSummary = summarizeInboxForOverview(queue);
  } catch {
    /* fail-closed empty summary */
  }
  return buildSubjectOverviewV1(pkgDir, {
    hasApiKey: !!pub.apiKeyConfigured,
    inboxSummary,
  });
});

// ---------- ID-01 identity (DID) ----------
ipcMain.handle("subject:getIdentity", async () => {
  try {
    const dir = packageDirFromConfig();
    const identity = loadOrCreateIdentity(dir);
    return { ok: true, identity };
  } catch (err) {
    return { ok: false, code: "identity_error", message: err.message };
  }
});

ipcMain.handle("subject:signData", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const data = String((payload && payload.data) || "");
    if (!data) return { ok: false, message: "缺少要签名的数据。" };
    const signature = signWithIdentity(dir, data);
    return { ok: true, signature };
  } catch (err) {
    return { ok: false, code: "sign_error", message: err.message };
  }
});

ipcMain.handle("subject:verifySignature", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const data = String((payload && payload.data) || "");
    const signature = String((payload && payload.signature) || "");
    if (!data || !signature) return { ok: false, message: "缺少数据或签名。" };
    const valid = verifyWithIdentity(dir, data, signature);
    return { ok: true, valid };
  } catch (err) {
    return { ok: false, code: "verify_error", message: err.message };
  }
});

// ---------- ID-02 role view (角色身份) ----------
ipcMain.handle("subject:getRoleView", async () => {
  try {
    const dir = packageDirFromConfig();
    const roleView = loadRoleView(dir);
    return { ok: true, roleView };
  } catch (err) {
    return { ok: false, code: "role_error", message: err.message };
  }
});

ipcMain.handle("subject:setRole", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const roleId = String((payload && payload.roleId) || "");
    if (!roleId) return { ok: false, message: "缺少角色 ID。" };
    const roleView = setCurrentRole(dir, roleId);
    return { ok: true, roleView };
  } catch (err) {
    return { ok: false, code: "role_error", message: err.message };
  }
});

ipcMain.handle("subject:getRoleContext", async () => {
  try {
    const dir = packageDirFromConfig();
    const context = getRoleContext(dir);
    return { ok: true, context };
  } catch (err) {
    return { ok: false, code: "role_error", message: err.message };
  }
});

// ---------- ID-03 VC credential (可验证凭据) ----------
ipcMain.handle("subject:issueVC", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const subject = (payload && payload.subject) || {};
    const opts = {
      validDays: (payload && payload.validDays) || 30,
      audience: (payload && payload.audience) || "",
    };
    const vc = issueCredential(dir, subject, opts);
    return { ok: true, vc };
  } catch (err) {
    return { ok: false, code: "vc_error", message: err.message };
  }
});

ipcMain.handle("subject:verifyVC", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const vc = (payload && payload.vc) || null;
    if (!vc) return { ok: false, message: "缺少要验证的凭据。" };
    const result = verifyCredential(dir, vc);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, code: "vc_error", message: err.message };
  }
});

// ---------- ID-04 credential flow (凭据出示流程) ----------
ipcMain.handle("subject:presentCredential", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const pkg = loadPackageForActBehalf();
    const audience = String((payload && payload.audience) || "").trim();
    const validDays = (payload && payload.validDays) || 30;
    const scope = String((payload && payload.scope) || "full").trim();
    const result = presentCredential(dir, pkg, { audience, validDays, scope });
    return result;
  } catch (err) {
    return { ok: false, code: "credential_error", message: err.message };
  }
});

ipcMain.handle("subject:revokeCredential", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const credentialId = String((payload && payload.credentialId) || "").trim();
    if (!credentialId) return { ok: false, message: "缺少凭据 ID。" };
    const result = revokeCredential(dir, credentialId);
    return result;
  } catch (err) {
    return { ok: false, code: "credential_error", message: err.message };
  }
});

ipcMain.handle("subject:verifyCredentialStatus", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const credentialId = String((payload && payload.credentialId) || "").trim();
    if (!credentialId) return { ok: false, message: "缺少凭据 ID。" };
    const result = verifyCredentialStatus(dir, credentialId);
    return result;
  } catch (err) {
    return { ok: false, code: "credential_error", message: err.message };
  }
});

ipcMain.handle("subject:listCredentials", async () => {
  try {
    const dir = packageDirFromConfig();
    const result = listCredentials(dir);
    return result;
  } catch (err) {
    return { ok: false, code: "credential_error", message: err.message };
  }
});

// ---------- ID-05 collaboration (主体协作闭环) ----------
ipcMain.handle("collaboration:create", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const result = createCollaboration(dir, payload || {});
    return result;
  } catch (err) {
    return { ok: false, code: "collaboration_error", message: err.message };
  }
});

ipcMain.handle("collaboration:addInteraction", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const result = addInteraction(dir, payload && payload.collaborationId, payload && payload.interaction);
    return result;
  } catch (err) {
    return { ok: false, code: "collaboration_error", message: err.message };
  }
});

ipcMain.handle("collaboration:addDeliverable", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const result = addDeliverable(dir, payload && payload.collaborationId, payload && payload.deliverable);
    return result;
  } catch (err) {
    return { ok: false, code: "collaboration_error", message: err.message };
  }
});

ipcMain.handle("collaboration:approveDeliverable", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const result = approveDeliverable(dir, payload && payload.collaborationId, payload && payload.deliverableIndex, payload && payload.approvedBy);
    return result;
  } catch (err) {
    return { ok: false, code: "collaboration_error", message: err.message };
  }
});

ipcMain.handle("collaboration:addFeedback", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const result = addFeedback(dir, payload && payload.collaborationId, payload && payload.feedback);
    return result;
  } catch (err) {
    return { ok: false, code: "collaboration_error", message: err.message };
  }
});

ipcMain.handle("collaboration:confirmFeedback", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const result = confirmFeedbackWriteBack(dir, payload && payload.collaborationId, payload && payload.feedbackIndex);
    return result;
  } catch (err) {
    return { ok: false, code: "collaboration_error", message: err.message };
  }
});

ipcMain.handle("collaboration:revoke", async (_e, payload) => {
  try {
    const dir = packageDirFromConfig();
    const result = revokeCollaboration(dir, payload && payload.collaborationId);
    return result;
  } catch (err) {
    return { ok: false, code: "collaboration_error", message: err.message };
  }
});

ipcMain.handle("collaboration:list", async () => {
  try {
    const dir = packageDirFromConfig();
    const result = listCollaborations(dir);
    return result;
  } catch (err) {
    return { ok: false, code: "collaboration_error", message: err.message };
  }
});

// ---------- PAN-01R sovereign collaboration experience (test harness only) ----------
function isPan01rTestHarnessEnabled() {
  return (
    process.env.DIGITALME_PAN01R_TEST_HARNESS === "1" ||
    process.env.DIGITALME_PAN01R_OWNER_RUNTIME === "1"
  );
}

function pan01rHooks() {
  return global.__PAN01R_TEST_HOOKS__ && typeof global.__PAN01R_TEST_HOOKS__ === "object"
    ? global.__PAN01R_TEST_HOOKS__
    : null;
}

function pan01rPackageDir() {
  const hooks = pan01rHooks();
  if (hooks && hooks.packageDir) return path.resolve(String(hooks.packageDir));
  return path.resolve(packageDirFromConfig());
}

function pan01rUserData() {
  const hooks = pan01rHooks();
  if (hooks && hooks.userData) return String(hooks.userData);
  return app.getPath("userData");
}

function pan01rApi() {
  const hooks = pan01rHooks();
  return createPanoramaExperience({
    callModelStream:
      hooks && typeof hooks.callModelStream === "function"
        ? hooks.callModelStream
        : callModelStream,
    getRuntimeConfig:
      hooks && typeof hooks.getRuntimeConfig === "function"
        ? hooks.getRuntimeConfig
        : readConfig,
    appendAudit:
      hooks && typeof hooks.appendAudit === "function"
        ? hooks.appendAudit
        : (userData, fields) => decisionAudit.appendEntry(userData, fields),
    listAudit:
      hooks && typeof hooks.listAudit === "function"
        ? hooks.listAudit
        : (userData, opts) => decisionAudit.list(userData, opts),
    packageDir: pan01rPackageDir(),
    userData: pan01rUserData(),
  });
}

function pan01rSenderId(event) {
  try {
    return String(event && event.sender && event.sender.id);
  } catch {
    return "";
  }
}

function allowFields(payload, keys) {
  const src = payload && typeof payload === "object" ? payload : {};
  const out = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
  }
  return out;
}


ipcMain.handle("packageStore:rollback", (_e, payload) => {
  const body = payload && typeof payload === "object" ? payload : {};
  const pkgDir = body.packageDir
    ? assertPackageStoreDirAllowed(body.packageDir)
    : path.resolve(packageDirFromConfig());
  const confirmed =
    body.confirmed === true ||
    (body.confirmation && body.confirmation.confirmed === true);
  if (!confirmed) {
    const e = new Error("需要明确确认后才能恢复到指定版本。");
    e.code = "confirmation_required";
    throw e;
  }
  const versionId = String(body.versionId || body.rollbackVersion || "").trim();
  if (!/^v\d+$/.test(versionId)) {
    const e = new Error("只能恢复主进程提供的版本编号，不能指定其他路径。");
    e.code = "version_id_invalid";
    throw e;
  }
  const store = new PackageStore({ packageDir: pkgDir, ownerId: "sandbox:rollback" });
  store.recover();
  const listed = store.listVersions();
  const allowed = listed.some((v) => v.kind === "snapshot" && v.versionId === versionId);
  if (!allowed) {
    const e = new Error("该版本已不存在或不可恢复，请刷新版本信息后重试。");
    e.code = "version_not_found";
    throw e;
  }
  return store.rollback(versionId, { confirmed: true });
});

ipcMain.handle("packageStore:recover", () => {
  const pkgDir = path.resolve(packageDirFromConfig());
  const store = new PackageStore({ packageDir: pkgDir, ownerId: "sandbox:recover" });
  return store.recover();
});

// ---------- Capability extensions IPC ----------
ipcMain.handle("extensions:getCatalog", () => enrichCatalogForUi());

ipcMain.handle("extensions:getConfig", () => getCapabilityExtensions());

ipcMain.handle("extensions:saveConfig", (_e, list) => {
  if (!Array.isArray(list)) throw new Error("扩展配置必须是数组");
  return saveCapabilityExtensions(
    list
      .map((ext) => ({
        id: String(ext.id || "").trim(),
        name: String(ext.name || ext.id || "").trim(),
        catalogId: ext.catalogId ? String(ext.catalogId) : undefined,
        command: String(ext.command || npxCommand()).trim(),
        args: Array.isArray(ext.args) ? ext.args.map(String) : [],
        cwd: ext.cwd ? String(ext.cwd) : undefined,
        env: ext.env && typeof ext.env === "object" ? ext.env : undefined,
        envKeyNames: Array.isArray(ext.envKeyNames) ? ext.envKeyNames.map(String) : undefined,
        note: ext.note ? String(ext.note) : undefined,
        params: ext.params && typeof ext.params === "object" ? ext.params : undefined,
      }))
      .filter((ext) => ext.id)
  );
});

ipcMain.handle("extensions:enable", async (_e, payload) => {
  const catalogId = payload?.catalogId || payload?.id;
  const item = catalog.getById(catalogId);
  if (!item) throw new Error("精选目录中不存在：" + catalogId);
  const envInput = payload?.env && typeof payload.env === "object" ? payload.env : {};
  const built = buildExtensionFromCatalog(item, {
    params: payload?.params || {},
    env: envInput,
  });
  const svc = getConfigSecrets();
  if (Object.keys(envInput).length) {
    svc.ingestExtensionSecrets(built.id, envInput);
  }
  const envKeyNames = (item.envKeys || []).map((ek) => ek.key).filter(Boolean);
  const publicBuilt = svc.sanitizeExtension(
    {
      ...built,
      env: undefined,
      envKeyNames,
    },
    svc.secretStore
  );
  const list = getCapabilityExtensions().filter((e) => e.id !== publicBuilt.id);
  list.push(publicBuilt);
  saveCapabilityExtensions(list);
  return publicBuilt;
});

ipcMain.handle("extensions:disable", async (_e, id) => {
  try {
    const em = await getExtensionManager();
    await em.disconnectExtension(id);
  } catch {}
  const list = getCapabilityExtensions().filter((e) => e.id !== id);
  saveCapabilityExtensions(list);
  return true;
});

ipcMain.handle("extensions:pickDirectory", async () => {
  const res = await dialog.showOpenDialog({
    title: "选择授权目录",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: defaultWorkspaceRoot(),
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle("extensions:pickFile", async () => {
  const res = await dialog.showOpenDialog({
    title: "选择数据库文件",
    properties: ["openFile"],
    filters: [
      { name: "SQLite", extensions: ["db", "sqlite", "sqlite3"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle("extensions:getStatus", async () => {
  const em = await getExtensionManager();
  return em.getSessionStatus();
});

ipcMain.handle("extensions:connect", async (_e, id) => {
  const ext = findExtensionById(id);
  if (ext.id === "filesystem" || (ext.args || []).includes("@modelcontextprotocol/server-filesystem")) {
    const rootArg = (ext.args || []).slice(-1)[0];
    if (rootArg && !String(rootArg).startsWith("-")) {
      try {
        fs.mkdirSync(rootArg, { recursive: true });
      } catch (e) {
        throw new Error("无法创建授权目录：" + rootArg + "（" + e.message + "）");
      }
    }
  }
  const hydrated = getConfigSecrets().hydrateExtensionEnv(ext);
  const em = await getExtensionManager();
  return em.connectExtension(hydrated);
});

ipcMain.handle("extensions:disconnect", async (_e, id) => {
  const em = await getExtensionManager();
  await em.disconnectExtension(id);
  return true;
});

ipcMain.handle("extensions:listTools", async (_e, id) => {
  const em = await getExtensionManager();
  return em.listTools(id);
});

ipcMain.handle("extensions:callTool", async (_e, { id, name, args }) => {
  if (!name) throw new Error("请指定工具名称");
  const em = await getExtensionManager();
  return em.callTool(id, name, args || {});
});

ipcMain.handle("shell:openExternal", async (_e, url) => {
  if (!url || !/^https?:\/\//i.test(String(url))) throw new Error("无效链接");
  const { shell } = require("electron");
  await shell.openExternal(String(url));
  return true;
});

ipcMain.handle("shell:openPath", async (_e, target) => {
  const { shell } = require("electron");
  const p = String(target || "").trim();
  if (!p) throw new Error("路径为空");
  const err = await shell.openPath(p);
  if (err) throw new Error(err || "无法打开该路径");
  return { ok: true, path: p };
});

// Preview write via PackageStore (bytes unchanged until confirm).
ipcMain.handle("builder:previewWrite", async (_e, payload) => {
  const body = payload && typeof payload === "object" ? payload : {};
  const pkgDir = packageDirFromConfig();
  if (body.materialKind === "identity") {
    // Do not accept renderer sourceMeta / source id — main generates provenance.
    return lifePackageWrite.previewLifeIdentityWrite(pkgDir, {
      identity: body.identity,
      filePath: body.filePath,
      title: body.title,
      reason: body.reason,
      factConfirmedFields: body.factConfirmedFields,
    });
  }
  return builderPackageWrite.previewPersonaWrite(pkgDir, {
    agg: body.agg,
    filePath: body.filePath,
    title: body.title,
    sourceMeta: body.sourceMeta,
    reason: body.reason,
  });
});

// Confirm write-back: persona / identity via PackageStore change set only.
ipcMain.handle("builder:write", async (_e, payload) => {
  const body = payload && typeof payload === "object" ? payload : {};
  const cfg = readConfig();
  const pkgDir = cfg.packageDir || DEFAULT_PACKAGE_DIR;
  const kind = body.materialKind === "identity" ? "identity" : "persona";

  if (kind === "identity") {
    if (
      body.identity != null ||
      body.ops != null ||
      body.dataKinds != null ||
      body.affectedPaths != null ||
      body.filePath != null ||
      body.title != null ||
      body.factConfirmedFields != null ||
      body.pathDataKinds != null
    ) {
      const err = new Error(
        "人生事实提交只接受变更集编号与确认标记，不能再次提交原始内容或写入计划。"
      );
      err.code = "identity_commit_payload_rejected";
      throw err;
    }
    return {
      materialKind: "identity",
      ...lifePackageWrite.runIdentityCommitAndArchive({
        packageDir: pkgDir,
        payload: {
          changeSetId: body.changeSetId,
          confirmed: body.confirmed,
          confirmation: body.confirmation,
        },
        userData: app.getPath("userData"),
        archiveFn: materials.archiveIdentityRun,
      }),
    };
  }

  // Persona: only changeSetId + confirmation — never raw agg/paths from renderer as the write plan.
  return {
    materialKind: "persona",
    ...builderPackageWrite.commitPersonaWrite(pkgDir, {
      changeSetId: body.changeSetId,
      confirmed: body.confirmed,
      confirmation: body.confirmation,
    }),
  };
});

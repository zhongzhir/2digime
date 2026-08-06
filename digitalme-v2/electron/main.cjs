"use strict";
/**
 * Electron main — 仅命令路由、窗口、文件对话框、文件夹揭示、模型凭证设置。
 * packaged 与 dev 共用本入口与同一领域运行链(无 packaged 专用业务分支)。
 * 未配置真实模型时不注册 Fake Adapter。
 */
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

/** @type {import('../dist/runtime/digitalme-runtime').DigitalMeRuntime | null} */
let runtime = null;
/** @type {import('../dist/runtime/commands').CommandBus | null} */
let bus = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {(() => void) | null} */
let unsubscribe = null;
/** @type {null | ((input: any) => Promise<any>)} */
let saveCredential = null;
/** @type {null | ((input?: any) => Promise<any>)} */
let deleteCredential = null;
/** @type {null | ((input?: any) => Promise<any>)} */
let testConnection = null;
/** @type {{ modelReady: boolean, modelMeta: any, needsCredentialSetup: boolean, status: any, isPackaged: boolean, buildMeta: any } | null} */
let lastBootInfo = null;

const COMMAND_NAMES = new Set([
  "subject.createPackage",
  "subject.openPackage",
  "subject.getOverview",
  "subject.confirmExperience",
  "subject.respondToLearning",
  "subject.captureInput",
  "subject.importMaterial",
  "subject.removeMaterial",
  "work.submitTask",
  "work.retryTask",
  "work.reviseArtifact",
  "work.cancelJob",
  "work.getTask",
  "work.listTasks",
  "artifact.getContent",
  "artifact.saveEdit",
  "artifact.export",
  "artifact.revealInFolder",
  "capability.list",
  "collab.simulateInteraction",
]);

function resolveAppRoot() {
  return path.resolve(__dirname, "..");
}

function buildBootInfo(model, appRoot, remoteCapabilityStatus) {
  const status = model.status || {
    credentialConfigured: model.ok === true,
    needsCredentialSetup: model.ok !== true,
    modelMeta: model.modelMeta || null,
  };
  return {
    modelReady: model.ok === true,
    modelMeta: model.modelMeta || null,
    needsCredentialSetup: !!model.needsCredentialSetup || model.ok !== true,
    isPackaged: app.isPackaged,
    buildMeta: loadBuildMeta(appRoot),
    status,
    remoteCapability: remoteCapabilityStatus || null,
  };
}

async function bootstrapRuntime() {
  const appRoot = resolveAppRoot();
  const {
    createDigitalMeRuntime,
  } = require(path.join(appRoot, "dist", "runtime", "digitalme-runtime"));
  const { createCommandBus } = require(path.join(appRoot, "dist", "runtime", "command-bus"));
  const { resolveModelConfig } = require(path.join(__dirname, "bootstrap-secrets.cjs"));

  const model = await resolveModelConfig({
    safeStorage,
    userDataPath: app.getPath("userData"),
    isPackaged: app.isPackaged,
    allowDevRuntimeFile: !app.isPackaged,
  });

  saveCredential = typeof model.saveCredential === "function" ? model.saveCredential : null;
  deleteCredential = typeof model.deleteCredential === "function" ? model.deleteCredential : null;
  testConnection = typeof model.testConnection === "function" ? model.testConnection : null;

  // App Shell:仅真实模型或无能力。禁止注册 Fake / both。
  // P2.2:有模型时注册真实 code-analysis;无模型时 needs_setup(无本地替代)。
  // 确定性 Adapter 仅显式 DIGITALME_V2_P21_DETERMINISTIC=1 时用于工程回退。
  const forceDeterministic = process.env.DIGITALME_V2_P21_DETERMINISTIC === "1";
  const codeAnalysisCapability =
    model.documentCapability === "openai-compatible"
      ? "openai-compatible"
      : forceDeterministic
        ? "deterministic"
        : "needs_setup";

  // 仅 UX 专项验收(未打包)可启用 Fake 文档能力;产品路径仍禁止 Fake。
  const uxAcceptanceFake =
    !app.isPackaged && process.env.DIGITALME_V2_UX_ACCEPTANCE === "1";

  // 外部专业能力：优先已保存配置；环境变量仅开发覆盖；停用则不注册。
  const {
    readRemoteCapabilityConfig,
    resolveResearchBaseUrl,
    publicRemoteCapabilityStatus,
  } = require(path.join(__dirname, "bootstrap-remote-capability.cjs"));
  const userDataPath = app.getPath("userData");
  const savedRemote = readRemoteCapabilityConfig(userDataPath);
  const resolvedRemote = resolveResearchBaseUrl(userDataPath);
  let a2aRemoteCapability = undefined;
  let remoteRegistered = false;
  let remoteConnectionState = savedRemote.enabled || resolvedRemote.source === "env_override"
    ? "unreachable"
    : "disconnected";
  if (resolvedRemote.enabled && resolvedRemote.baseUrl) {
    try {
      const {
        buildResearchEndpointPolicy,
        assertEndpointPolicyShape,
      } = require(path.join(appRoot, "dist", "capability", "remote-endpoint-policy"));
      const endpoint = buildResearchEndpointPolicy({ baseUrl: resolvedRemote.baseUrl });
      assertEndpointPolicyShape(endpoint);
      a2aRemoteCapability = {
        endpoint,
        pollIntervalMs: 200,
      };
      remoteRegistered = true;
      remoteConnectionState = "connected";
    } catch (err) {
      console.warn("[digitalme] external capability not registered:", err && err.message);
      remoteRegistered = false;
      remoteConnectionState = "unreachable";
      a2aRemoteCapability = undefined;
    }
  }

  const options = uxAcceptanceFake
    ? {
        documentCapability: "fake",
        registerOpenAiStub: false,
        codeAnalysisCapability: "needs_setup",
        ...(a2aRemoteCapability ? { a2aRemoteCapability } : {}),
      }
    : model.documentCapability === "openai-compatible"
      ? {
          documentCapability: "openai-compatible",
          openaiCompatible: model.openaiCompatible,
          secrets: model.secrets,
          registerOpenAiStub: false,
          codeAnalysisCapability,
          ...(a2aRemoteCapability ? { a2aRemoteCapability } : {}),
        }
      : {
          documentCapability: "none",
          registerOpenAiStub: false,
          ...(model.secrets ? { secrets: model.secrets } : {}),
          codeAnalysisCapability,
          ...(a2aRemoteCapability ? { a2aRemoteCapability } : {}),
        };

  runtime = createDigitalMeRuntime(options);
  bus = createCommandBus(runtime);
  unsubscribe = runtime.eventBus.subscribe((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("domain:event", event);
    }
  });
  const remoteStatus = publicRemoteCapabilityStatus({
    saved: savedRemote,
    resolved: resolvedRemote,
    registered: remoteRegistered,
    connectionState: remoteConnectionState,
  });
  lastBootInfo = buildBootInfo(model, appRoot, remoteStatus);
  return lastBootInfo;
}

function loadBuildMeta(appRoot) {
  try {
    return JSON.parse(
      require("node:fs").readFileSync(path.join(appRoot, "build-meta.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

function createWindow(bootInfo) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 880,
    minHeight: 640,
    title: "Digital Me",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const indexHtml = path.join(__dirname, "renderer", "index.html");
  mainWindow.loadURL(pathToFileURL(indexHtml).href);
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("shell:boot", bootInfo || lastBootInfo);
  });
  mainWindow.webContents.on("context-menu", (_evt, params) => {
    if (!params.isEditable) return;
    const menu = Menu.buildFromTemplate([
      { role: "cut", label: "剪切", enabled: params.editFlags.canCut },
      { role: "copy", label: "复制", enabled: params.editFlags.canCopy },
      { role: "paste", label: "粘贴", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll", label: "全选", enabled: params.editFlags.canSelectAll },
    ]);
    menu.popup({ window: mainWindow });
  });
  return mainWindow;
}

async function rebootstrapAndNotify() {
  if (unsubscribe) unsubscribe();
  if (runtime) await runtime.stop();
  const boot = await bootstrapRuntime();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("shell:boot", boot);
  }
  return boot;
}

function registerIpc() {
  ipcMain.handle("command:invoke", async (_evt, name, input) => {
    if (!bus || !runtime) throw new Error("runtime not ready");
    if (!COMMAND_NAMES.has(name)) throw new Error(`command not exposed: ${name}`);

    if (
      (name === "work.submitTask" ||
        name === "work.retryTask" ||
        name === "work.reviseArtifact") &&
      !(lastBootInfo && lastBootInfo.modelReady)
    ) {
      throw Object.assign(new Error("请先连接模型"), {
        code: "MODEL_NOT_CONFIGURED",
        actionable: "请先在设置中连接真实模型后再开始处理",
      });
    }

    if (name === "artifact.revealInFolder") {
      const artifactId = input && input.artifactId;
      const result = await bus.invoke(name, input || {});
      try {
        const dir = await runtime.getArtifactStorageDir(artifactId);
        const fs = require("node:fs");
        const preferred = ["result.md", "report.md"]
          .map((name) => path.join(dir, name))
          .find((p) => fs.existsSync(p));
        if (preferred) shell.showItemInFolder(preferred);
        else shell.showItemInFolder(dir);
      } catch {
        /* ignore */
      }
      return result;
    }

    if (name === "artifact.export") {
      const format = input && input.format;
      let targetPath = input && input.targetPath;
      if (!targetPath) {
        const defaultName =
          format === "docx" ? "成果.docx" : format === "md" ? "成果.md" : "成果";
        const picked = await dialog.showSaveDialog(mainWindow, {
          defaultPath: defaultName,
          filters:
            format === "docx"
              ? [{ name: "Word", extensions: ["docx"] }]
              : [{ name: "Markdown", extensions: ["md"] }],
        });
        if (picked.canceled || !picked.filePath) {
          throw new Error("已取消导出");
        }
        targetPath = picked.filePath;
      }
      return bus.invoke(name, { ...input, targetPath });
    }

    return bus.invoke(name, input || {});
  });

  ipcMain.handle("shell:pickOpenFiles", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle("shell:pickOpenDirectory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("shell:pickSaveDirectory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  /** 默认主体包目录(userData/subjects/default)，首次无需用户选择文件夹。 */
  ipcMain.handle("shell:getDefaultSubjectDir", async () => {
    const fs = require("node:fs");
    const dir = path.join(app.getPath("userData"), "subjects", "default");
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const manifest = path.join(dir, "manifest.json");
    let exists = false;
    try {
      fs.accessSync(manifest);
      exists = true;
    } catch {
      exists = false;
    }
    return { dir, exists };
  });

  ipcMain.handle("shell:getModelStatus", async () => {
    return lastBootInfo || { modelReady: false, needsCredentialSetup: true, status: null };
  });

  ipcMain.handle("shell:saveModelCredential", async (_evt, input) => {
    if (!saveCredential) throw new Error("本机安全存储不可用，暂时无法保存密钥");
    const apiKey = String((input && input.apiKey) || "").trim();
    const baseUrl = String((input && input.baseUrl) || "").trim();
    const model = String((input && input.model) || "").trim();
    const providerPreset = String((input && input.providerPreset) || "openai-compatible").trim();
    if (!baseUrl || !model) throw new Error("请填写服务地址与模型名称");
    if (!apiKey && !(input && input.allowExistingKey)) {
      throw new Error("请输入 API Key 后再保存");
    }
    await saveCredential({
      apiKey,
      baseUrl,
      model,
      providerId: "openai-compatible",
      providerPreset,
    });
    const boot = await rebootstrapAndNotify();
    return {
      ok: true,
      modelReady: boot.modelReady,
      modelMeta: boot.modelMeta,
      status: boot.status,
    };
  });

  ipcMain.handle("shell:testModelConnection", async (_evt, input) => {
    if (!testConnection) throw new Error("凭证存储不可用，请确认系统安全存储已启用");
    const result = await testConnection(input || {});
    return result;
  });

  ipcMain.handle("shell:deleteModelCredential", async (_evt, input) => {
    if (!deleteCredential) throw new Error("凭证存储不可用，请确认系统安全存储已启用");
    await deleteCredential(input || {});
    const boot = await rebootstrapAndNotify();
    return {
      ok: true,
      modelReady: boot.modelReady,
      modelMeta: boot.modelMeta,
      status: boot.status,
    };
  });

  ipcMain.handle("shell:getRemoteCapabilityStatus", async () => {
    const {
      readRemoteCapabilityConfig,
      resolveResearchBaseUrl,
      publicRemoteCapabilityStatus,
    } = require(path.join(__dirname, "bootstrap-remote-capability.cjs"));
    const userDataPath = app.getPath("userData");
    const saved = readRemoteCapabilityConfig(userDataPath);
    const resolved = resolveResearchBaseUrl(userDataPath);
    const registered = !!(lastBootInfo && lastBootInfo.remoteCapability && lastBootInfo.remoteCapability.registered);
    const connectionState =
      (lastBootInfo && lastBootInfo.remoteCapability && lastBootInfo.remoteCapability.connectionState) ||
      (saved.enabled ? "unreachable" : "disconnected");
    return publicRemoteCapabilityStatus({
      saved,
      resolved,
      registered,
      connectionState,
    });
  });

  ipcMain.handle("shell:testRemoteCapability", async (_evt, input) => {
    const {
      validateResearchEndpoint,
      normalizeBaseUrl,
      userFacingConnectError,
    } = require(path.join(__dirname, "bootstrap-remote-capability.cjs"));
    const baseUrl = normalizeBaseUrl((input && input.baseUrl) || "");
    try {
      const result = await validateResearchEndpoint(baseUrl, resolveAppRoot());
      return {
        ok: true,
        message: "连接正常，可以使用研究分析能力。",
        diagnostic: result.probe
          ? {
              stage: "ok",
              normalizedBaseUrl: result.probe.diagnostic.normalizedBaseUrl,
              agentCardUrl: result.probe.diagnostic.agentCardUrl,
              interfaceUrl: result.probe.diagnostic.interfaceUrl,
              jsonRpcMethod: result.probe.diagnostic.jsonRpcMethod,
              httpStatus: result.probe.diagnostic.httpStatus,
            }
          : undefined,
      };
    } catch (err) {
      console.warn("[digitalme] testRemoteCapability failed:", {
        action: "shell:testRemoteCapability",
        diagnostic: err && err.diagnostic,
        message: err && err.message,
      });
      return {
        ok: false,
        message: (err && err.userMessage) || userFacingConnectError(err),
      };
    }
  });

  ipcMain.handle("shell:saveRemoteCapability", async (_evt, input) => {
    const {
      validateResearchEndpoint,
      writeRemoteCapabilityConfig,
      normalizeBaseUrl,
      userFacingConnectError,
    } = require(path.join(__dirname, "bootstrap-remote-capability.cjs"));
    const baseUrl = normalizeBaseUrl((input && input.baseUrl) || "");
    try {
      await validateResearchEndpoint(baseUrl, resolveAppRoot());
    } catch (err) {
      const message =
        (err && err.userMessage) ||
        userFacingConnectError(err) ||
        "无法连接研究分析能力，请确认服务正在运行并检查地址。";
      console.warn("[digitalme] saveRemoteCapability failed:", {
        action: "shell:saveRemoteCapability",
        diagnostic: err && err.diagnostic,
        message: err && err.message,
        cause: err && err.cause && err.cause.message,
      });
      return { ok: false, message };
    }
    writeRemoteCapabilityConfig(app.getPath("userData"), {
      enabled: true,
      baseUrl,
    });
    const boot = await rebootstrapAndNotify();
    return {
      ok: true,
      remoteCapability: boot.remoteCapability,
      message: "已连接研究分析能力。",
    };
  });

  ipcMain.handle("shell:disableRemoteCapability", async () => {
    const {
      disableRemoteCapabilityConfig,
    } = require(path.join(__dirname, "bootstrap-remote-capability.cjs"));
    disableRemoteCapabilityConfig(app.getPath("userData"));
    const boot = await rebootstrapAndNotify();
    return {
      ok: true,
      remoteCapability: boot.remoteCapability,
      message: "已停用外部专业能力。",
    };
  });

  /** 在资源管理器中显示路径（壳层辅助，非领域命令）。 */
  ipcMain.handle("shell:revealPath", async (_evt, targetPath) => {
    const p = String(targetPath || "").trim();
    if (!p) return { opened: false };
    try {
      shell.showItemInFolder(p);
      return { opened: true };
    } catch {
      return { opened: false };
    }
  });

  /**
   * 轻量对话 transcript（壳层辅助面）。
   * 落在 SubjectPackage/ui/conversation.ndjson。
   * 成长捕获由主进程在回复完成后调度；状态以追加行记录，不改写历史消息。
   */
  function conversationFilePath() {
    if (!runtime || !runtime.subject) throw new Error("runtime not ready");
    const pkg = runtime.subject.getActive();
    if (!pkg) throw new Error("请先建立数字之我");
    return path.join(pkg.rootDir, "ui", "conversation.ndjson");
  }

  function isGrowthCaptureStatusRow(row) {
    return !!(row && row.kind === "growth_capture_status" && typeof row.turnId === "string");
  }

  function isConversationTurnRow(row) {
    if (!row || isGrowthCaptureStatusRow(row)) return false;
    return (
      typeof row.id === "string" &&
      (row.role === "user" || row.role === "assistant" || row.role === "system") &&
      typeof row.text === "string"
    );
  }

  function findLatestUserTurnId(file) {
    const fs = require("node:fs");
    if (!fs.existsSync(file)) return null;
    let lastUser = null;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (isConversationTurnRow(row) && row.role === "user") lastUser = row;
      } catch {
        /* skip */
      }
    }
    return lastUser;
  }

  ipcMain.handle("shell:conversationList", async () => {
    if (runtime && typeof runtime.listConversationTurns === "function") {
      return runtime.listConversationTurns();
    }
    const fs = require("node:fs");
    const file = conversationFilePath();
    if (!fs.existsSync(file)) return { turns: [] };
    const text = fs.readFileSync(file, "utf8");
    const turns = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (isConversationTurnRow(row)) turns.push(row);
      } catch {
        /* skip corrupt */
      }
    }
    return { turns };
  });

  ipcMain.handle("shell:conversationAppend", async (_evt, input) => {
    const fs = require("node:fs");
    const role = String((input && input.role) || "").trim();
    const text = String((input && input.text) || "").trim();
    if (!role || !text) throw new Error("对话内容不能为空");
    if (role !== "user" && role !== "assistant" && role !== "system") {
      throw new Error("无效的对话角色");
    }
    const file = conversationFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const turn = {
      id: `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      role,
      text,
      at: new Date().toISOString(),
    };
    fs.appendFileSync(file, `${JSON.stringify(turn)}\n`, "utf8");
    return { turn };
  });

  /** 清空对话 transcript；不删除已确认主体内容。 */
  ipcMain.handle("shell:conversationClear", async () => {
    const fs = require("node:fs");
    const file = conversationFilePath();
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      const code = err && err.code;
      if (code !== "ENOENT") throw err;
    }
    return { cleared: true };
  });

  ipcMain.handle("shell:conversationGrowthHint", async (_evt, input) => {
    const turnId = String((input && input.turnId) || "").trim();
    if (!turnId || !runtime || typeof runtime.conversationGrowthHint !== "function") {
      return { message: null };
    }
    try {
      const hint = await runtime.conversationGrowthHint(turnId);
      return { message: hint && hint.message ? hint.message : null };
    } catch {
      return { message: null };
    }
  });

  /**
   * 真实对话回复：读取 transcript 上下文后调用已配置模型。
   * 回复完成后由主进程调度成长捕获（不阻塞回复；renderer 不再旁路提交）。
   */
  ipcMain.handle("shell:conversationReply", async (_evt, input) => {
    const userText = String((input && input.text) || "").trim();
    if (!userText) {
      throw Object.assign(new Error("请先写一句话"), {
        actionable: "请输入内容后再发送",
      });
    }
    if (!lastBootInfo || !lastBootInfo.modelReady) {
      throw Object.assign(new Error("请先连接模型"), {
        actionable: "打开设置，配置并测试模型连接后再对话",
      });
    }

    const appRoot = resolveAppRoot();
    const { resolveModelConfig } = require(path.join(__dirname, "bootstrap-secrets.cjs"));
    const { providerCredentialKey } = require(path.join(
      appRoot,
      "dist",
      "infrastructure",
      "secret-store",
    ));
    const { chatComplete, ModelHttpError, DEFAULT_CHAT_MAX_TOKENS } = require(path.join(
      appRoot,
      "dist",
      "infrastructure",
      "model-http",
    ));

    const model = await resolveModelConfig({
      safeStorage,
      userDataPath: app.getPath("userData"),
      isPackaged: app.isPackaged,
      allowDevRuntimeFile: !app.isPackaged,
    });
    if (!model.ok || !model.openaiCompatible || !model.secrets) {
      throw Object.assign(new Error("请先连接模型"), {
        actionable: "打开设置，配置并测试模型连接后再对话",
      });
    }

    const providerId = model.openaiCompatible.providerId || "openai-compatible";
    const apiKey = await model.secrets.get(providerCredentialKey(providerId));
    if (!apiKey) {
      throw Object.assign(new Error("请先连接模型"), {
        actionable: "打开设置，配置并测试模型连接后再对话",
      });
    }

    const fs = require("node:fs");
    const file = conversationFilePath();
    /** @type {{ role: string, text: string }[]} */
    const turns = [];
    if (fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          if (isConversationTurnRow(row) && (row.role === "user" || row.role === "assistant") && row.text) {
            turns.push({ role: row.role, text: String(row.text) });
          }
        } catch {
          /* skip */
        }
      }
    }

    // 取最近若干轮，保证末条是当前用户消息
    const recent = turns.slice(-12);
    if (
      !recent.length ||
      recent[recent.length - 1].role !== "user" ||
      recent[recent.length - 1].text !== userText
    ) {
      recent.push({ role: "user", text: userText });
    }

    const messages = [
      {
        role: "system",
        content:
          "你是用户的数字之我助手。根据对话上下文直接、具体地回答最终答复正文。不要用「已记下」代替回答；不要假装已完成任务；不要输出分析过程、推理提纲或内部标签。",
      },
      ...recent.map((t) => ({
        role: t.role === "assistant" ? "assistant" : "user",
        content: t.text,
      })),
    ];

    // 测试/验收可覆盖：DIGITALME_CHAT_MAX_TOKENS；人为截断可用较小值
    const maxTokensEnv = Number(process.env.DIGITALME_CHAT_MAX_TOKENS || "");
    const maxTokens =
      Number.isFinite(maxTokensEnv) && maxTokensEnv > 0
        ? Math.floor(maxTokensEnv)
        : DEFAULT_CHAT_MAX_TOKENS;

    const userTurn = findLatestUserTurnId(file);
    const scheduleGrowth = (assistantText) => {
      if (!runtime || typeof runtime.scheduleConversationGrowthCapture !== "function") return;
      if (!userTurn || userTurn.text !== userText) return;
      try {
        runtime.scheduleConversationGrowthCapture({
          turnId: userTurn.id,
          userText,
          ...(assistantText ? { assistantText: String(assistantText).slice(0, 400) } : {}),
        });
      } catch {
        /* 成长不得阻断回复 */
      }
    };

    try {
      const result = await chatComplete({
        baseUrl: model.openaiCompatible.baseUrl,
        apiKey,
        model: model.openaiCompatible.model,
        messages,
        temperature: 0.4,
        maxTokens,
        timeoutMs: model.openaiCompatible.timeoutMs || 180_000,
      });
      const text = String(result.text || "").trim();
      if (result.truncated === true || result.finishReason === "length") {
        scheduleGrowth(text);
        return {
          text,
          status: "incomplete",
          finishReason: result.finishReason || "length",
          ...(userTurn ? { userTurnId: userTurn.id } : {}),
        };
      }
      if (!text) {
        scheduleGrowth("");
        return {
          text: "",
          status: "failed",
          finishReason: result.finishReason || null,
          ...(userTurn ? { userTurnId: userTurn.id } : {}),
        };
      }
      scheduleGrowth(text);
      return {
        text,
        status: "complete",
        finishReason: result.finishReason || "stop",
        ...(userTurn ? { userTurnId: userTurn.id } : {}),
      };
    } catch (err) {
      // 回复失败仍调度用户句捕获（用户表达已持久化）
      scheduleGrowth("");
      if (err instanceof ModelHttpError || (err && err.name === "ModelHttpError")) {
        const kind = err.kind || "";
        if (kind === "timeout" || kind === "aborted" || kind === "network") {
          const errObj = new Error(
            `${String(err.message || "模型调用中断").slice(0, 300)}。回复未完成，可重试`,
          );
          errObj.code = "CHAT_INCOMPLETE";
          throw errObj;
        }
        let actionable = "请稍后重试";
        if (kind === "unauthorized") actionable = "请检查模型凭证是否有效";
        else if (kind === "rate_limited") actionable = "请求过于频繁，请稍后再试";
        else if (kind === "server_error") actionable = "模型服务暂时不可用，请稍后重试";
        throw new Error(`${String(err.message || "模型调用失败").slice(0, 300)}。${actionable}`);
      }
      if (err && typeof err.message === "string" && /请重试|请检查|请稍后|请先|可重试/.test(err.message)) {
        throw err;
      }
      throw new Error(
        `${String((err && err.message) || err || "模型调用失败").slice(0, 300)}。请稍后重试，或到设置中测试模型连接`,
      );
    }
  });
}

app.whenReady().then(async () => {
  registerIpc();

  if (process.env.DIGITALME_V2_PACKAGED_ACCEPTANCE === "1") {
    try {
      const acceptance = require(path.join(__dirname, "packaged-acceptance.cjs"));
      const code = await acceptance.run({
        bootstrapRuntime,
        getRuntime: () => runtime,
        getBus: () => bus,
        createWindow,
        BrowserWindow,
        app,
      });
      app.exit(code);
    } catch (err) {
      console.error(
        JSON.stringify({
          ok: false,
          error: String(err && err.message ? err.message : err),
        }),
      );
      app.exit(1);
    }
    return;
  }

  if (process.env.DIGITALME_V2_PACKAGED_SMOKE === "1") {
    try {
      const smoke = require(path.join(__dirname, "packaged-smoke.cjs"));
      const code = await smoke.run({
        bootstrapRuntime,
        getRuntime: () => runtime,
        getBus: () => bus,
        createWindow,
        app,
      });
      app.exit(code);
    } catch (err) {
      console.error(
        JSON.stringify({
          ok: false,
          error: String(err && err.message ? err.message : err),
        }),
      );
      app.exit(1);
    }
    return;
  }

  if (process.env.DIGITALME_V2_CREDENTIAL_SETUP_ACCEPTANCE === "1") {
    try {
      const acceptance = require(path.join(__dirname, "packaged-credential-setup-acceptance.cjs"));
      const code = await acceptance.run({
        bootstrapRuntime,
        rebootstrapAndNotify,
        getRuntime: () => runtime,
        getBus: () => bus,
        getBootInfo: () => lastBootInfo,
        getSaveCredential: () => saveCredential,
        getDeleteCredential: () => deleteCredential,
        getTestConnection: () => testConnection,
        createWindow,
        app,
      });
      app.exit(code);
    } catch (err) {
      console.error(
        JSON.stringify({
          ok: false,
          error: String(err && err.message ? err.message : err),
        }),
      );
      app.exit(1);
    }
    return;
  }

  if (process.env.DIGITALME_V2_P17_ACCEPTANCE === "1") {
    try {
      const acceptance = require(path.join(__dirname, "packaged-p17-acceptance.cjs"));
      const code = await acceptance.run({
        bootstrapRuntime,
        getRuntime: () => runtime,
        getBus: () => bus,
        getBootInfo: () => lastBootInfo,
        getDeleteCredential: () => deleteCredential,
        createWindow,
        app,
      });
      app.exit(code);
    } catch (err) {
      console.error(
        JSON.stringify({
          ok: false,
          error: String(err && err.message ? err.message : err),
        }),
      );
      app.exit(1);
    }
    return;
  }

  if (process.env.DIGITALME_V2_P2A_ACCEPTANCE === "1") {
    try {
      const acceptance = require(path.join(__dirname, "packaged-p2a-acceptance.cjs"));
      const code = await acceptance.run({
        bootstrapRuntime,
        getRuntime: () => runtime,
        getBus: () => bus,
        getBootInfo: () => lastBootInfo,
        createWindow,
        app,
      });
      app.exit(code);
    } catch (err) {
      console.error(
        JSON.stringify({
          ok: false,
          error: String(err && err.message ? err.message : err),
        }),
      );
      app.exit(1);
    }
    return;
  }

  if (process.env.DIGITALME_V2_P23_ACCEPTANCE === "1") {
    try {
      const acceptance = require(path.join(__dirname, "packaged-p23-acceptance.cjs"));
      const code = await acceptance.run({
        bootstrapRuntime,
        getRuntime: () => runtime,
        getBus: () => bus,
        getBootInfo: () => lastBootInfo,
        createWindow,
        app,
      });
      app.exit(code);
    } catch (err) {
      console.error(
        JSON.stringify({
          ok: false,
          error: String(err && err.message ? err.message : err),
        }),
      );
      app.exit(1);
    }
    return;
  }

  const bootInfo = await bootstrapRuntime();
  createWindow(bootInfo);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(bootInfo);
  });
});

app.on("window-all-closed", async () => {
  if (unsubscribe) unsubscribe();
  if (runtime) await runtime.stop();
  if (process.platform !== "darwin") app.quit();
});

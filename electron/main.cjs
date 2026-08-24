"use strict";
/**
 * Electron main — 仅命令路由、窗口、文件对话框、文件夹揭示、模型凭证设置。
 * packaged 与 dev 共用本入口与同一领域运行链(无 packaged 专用业务分支)。
 * 未配置真实模型时不注册 Fake Adapter。
 */
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { installApplicationMenu } = require("./app-menu.cjs");
const {
  ensureDefaultPackageAttached: ensureDefaultPackageAttachedCore,
  sanitizeCommandError,
  USER_FACING_ATTACH_FAILED,
} = require("./default-package.cjs");

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
/** 外部专业能力是否已经过真实可达性验证（本进程内）。 */
let remoteReachabilityVerified = false;

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
  "work.delegateTask",
  "work.retryTask",
  "work.reviseArtifact",
  "work.cancelJob",
  "work.getTask",
  "work.listTasks",
  "work.converse",
  "artifact.getContent",
  "artifact.saveEdit",
  "artifact.export",
  "artifact.revealInFolder",
  "capability.list",
  "collab.interact",
  "subject.communicate",
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
  try {
    const {
      createElectronSafeStorageCipherAdapter,
      isElectronSafeStorageAvailable,
    } = require(path.join(appRoot, "dist", "infrastructure", "electron-safe-storage-cipher"));
    const { setCommCipher } = require(path.join(
      appRoot,
      "dist",
      "subject-comm",
      "transport-factory",
    ));
    if (isElectronSafeStorageAvailable(safeStorage)) {
      setCommCipher(createElectronSafeStorageCipherAdapter(safeStorage));
    }
  } catch {
    /* 通信密钥适配可选 */
  }

  const model = await resolveModelConfig({
    safeStorage,
    userDataPath: app.getPath("userData"),
    isPackaged: app.isPackaged,
    allowDevRuntimeFile: process.env.DIGITALME_V2_ALLOW_DEV_CREDENTIAL === "1",
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
  // 每次重建运行时：未做本轮探测前不得冒充可用
  remoteReachabilityVerified = false;
  let remoteConnectionState = "disconnected";
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
      remoteConnectionState = "configured_unverified";
    } catch (err) {
      console.warn("[digitalme] external capability not registered:", err && err.message);
      remoteRegistered = false;
      remoteConnectionState = "unreachable";
      a2aRemoteCapability = undefined;
    }
  } else if (savedRemote.enabled && savedRemote.baseUrl) {
    remoteConnectionState = "configured_unverified";
  }

  const {
    applyOwnerScenarioPatch,
  } = require(path.join(__dirname, "owner-scenario-env.cjs"));

  const options = applyOwnerScenarioPatch(
    uxAcceptanceFake
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
          },
  );

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
    reachabilityVerified: remoteReachabilityVerified,
  });
  lastBootInfo = buildBootInfo(model, appRoot, remoteStatus);
  return lastBootInfo;
}

async function ensureDefaultPackageAttached() {
  if (!runtime) return { ok: false, reason: "no_runtime" };
  const result = await ensureDefaultPackageAttachedCore({
    runtime,
    userDataPath: app.getPath("userData"),
  });
  if (!result.ok) {
    console.error("[digitalme] ensureDefaultPackageAttached failed:", result.reason);
  }
  return result;
}

const PACKAGE_BOOTSTRAP_COMMANDS = new Set([
  "subject.createPackage",
  "subject.openPackage",
  "capability.list",
]);

async function ensurePackageBeforeCommand(name) {
  if (PACKAGE_BOOTSTRAP_COMMANDS.has(name)) return;
  if (runtime && typeof runtime.isPackageAttached === "function" && runtime.isPackageAttached()) {
    return;
  }
  const ensured = await ensureDefaultPackageAttached();
  if (!ensured.ok) {
    throw Object.assign(new Error(USER_FACING_ATTACH_FAILED), {
      code: "PACKAGE_ATTACH_FAILED",
    });
  }
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
  // 重建 Runtime 后必须幂等重新挂载默认包，否则做事页仍可操作但 submitTask 失败。
  await ensureDefaultPackageAttached();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("shell:boot", boot);
  }
  return boot;
}

function registerIpc() {
  ipcMain.handle("command:invoke", async (_evt, name, input) => {
    if (!bus || !runtime) {
      throw Object.assign(new Error(USER_FACING_ATTACH_FAILED), { code: "RUNTIME_NOT_READY" });
    }
    if (!COMMAND_NAMES.has(name)) throw new Error(`command not exposed: ${name}`);

    try {
      await ensurePackageBeforeCommand(name);

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
            .map((fileName) => path.join(dir, fileName))
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
    } catch (err) {
      throw sanitizeCommandError(err);
    }
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

  ipcMain.handle("shell:inspectSoftwareProject", async (_e, input) => {
    const folderPath = input && input.path ? String(input.path) : "";
    if (!folderPath) {
      return {
        path: "",
        projectName: "",
        isSoftwareProject: false,
        markersHit: [],
        userFacingHint: "",
      };
    }
    try {
      const { inspectSoftwareProject } = require("../dist/work-runtime/work-intent");
      return await inspectSoftwareProject(folderPath);
    } catch (err) {
      return {
        path: folderPath,
        projectName: path.basename(folderPath),
        isSoftwareProject: false,
        markersHit: [],
        userFacingHint: "",
      };
    }
  });

  /** 在 Documents/Digital Me Projects 下创建唯一新项目目录（成果工作目录）。 */
  ipcMain.handle("shell:prepareSoftwareProject", async (_e, input) => {
    const goal = input && input.goal ? String(input.goal) : "新项目";
    const parentOverride =
      input && input.parentDir ? path.resolve(String(input.parentDir)) : "";
    try {
      const {
        allocateUniqueProjectDir,
        deriveProjectFolderName,
        displayProjectsRelativePath,
        resolveDigitalMeProjectsRoot,
      } = require("../dist/execution/project-location");
      const documentsPath = app.getPath("documents");
      const projectsRoot = parentOverride
        ? parentOverride
        : resolveDigitalMeProjectsRoot(documentsPath);
      const allocated = await allocateUniqueProjectDir(projectsRoot, goal, {
        reuseEmptySameName: true,
      });
      const displayPath = parentOverride
        ? allocated.absolutePath
        : displayProjectsRelativePath(documentsPath, allocated.absolutePath);
      return {
        ok: true,
        path: allocated.absolutePath,
        folderName: allocated.folderName,
        displayPath,
        documentsPath,
        projectsRoot,
        derivedName: deriveProjectFolderName(goal),
        created: !!allocated.created,
        reused: !!allocated.reused,
      };
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? String(err.message) : String(err),
      };
    }
  });

  /** 试运行探测（派生）。 */
  ipcMain.handle("shell:detectProjectRun", async (_e, input) => {
    const folderPath = input && input.path ? String(input.path) : "";
    if (!folderPath) return { runnable: false, reason: "缺少项目目录" };
    try {
      const { detectProjectRunInfo } = require("../dist/execution/run-detection");
      return await detectProjectRunInfo(folderPath, {
        knownCommands: Array.isArray(input && input.knownCommands)
          ? input.knownCommands.map(String)
          : [],
      });
    } catch (err) {
      return {
        runnable: false,
        reason: err && err.message ? String(err.message) : "探测失败",
      };
    }
  });

  /**
   * 发起试运行：仅在可可靠打开时执行；HTML 用系统默认打开；脚本类打开项目目录并返回命令。
   * 不得假报成功。
   */
  ipcMain.handle("shell:tryRunProject", async (_e, input) => {
    const folderPath = input && input.path ? String(input.path) : "";
    if (!folderPath) {
      return { ok: false, message: "缺少项目目录" };
    }
    try {
      const { detectProjectRunInfo } = require("../dist/execution/run-detection");
      const info = await detectProjectRunInfo(folderPath, {
        knownCommands: Array.isArray(input && input.knownCommands)
          ? input.knownCommands.map(String)
          : [],
      });
      if (!info.runnable) {
        return {
          ok: false,
          runnable: false,
          message:
            "代码已经生成，但 Digital Me 还不能直接替你打开这个程序。你可以先运行检查，或者继续让 Digital Me 完善它。",
          runInfo: info,
        };
      }
      if (info.kind === "html" && info.entryPath) {
        const openErr = await shell.openPath(info.entryPath);
        if (openErr) {
          return { ok: false, runnable: true, message: openErr, runInfo: info };
        }
        return {
          ok: true,
          runnable: true,
          message: "已在本机打开页面，请查看效果。",
          runInfo: info,
        };
      }
      await shell.openPath(folderPath);
      return {
        ok: true,
        runnable: true,
        message: info.command
          ? `已打开项目文件夹。请在本机终端运行：${info.command}`
          : "已打开项目文件夹，请在本机试运行。",
        runInfo: info,
      };
    } catch (err) {
      return {
        ok: false,
        message: err && err.message ? String(err.message) : String(err),
      };
    }
  });

  /** 将修订截图保存到当前主体包 materials（现有材料链，非第二 Store）。 */
  ipcMain.handle("shell:saveRevisionImage", async (_e, input) => {
    try {
      const dataUrl = input && input.dataUrl ? String(input.dataUrl) : "";
      const m = /^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i.exec(dataUrl);
      if (!m) return { ok: false, error: "不支持的图片格式" };
      const ext = m[2].toLowerCase() === "jpeg" ? "jpg" : m[2].toLowerCase();
      const buf = Buffer.from(m[3], "base64");
      if (buf.length > 8 * 1024 * 1024) return { ok: false, error: "图片过大" };
      const { resolveDefaultSubjectDir } = require("./default-package.cjs");
      const userDataPath = app.getPath("userData");
      const pkgDir = resolveDefaultSubjectDir(userDataPath);
      const dir = path.join(pkgDir, "materials", "revision-shots");
      fs.mkdirSync(dir, { recursive: true });
      const name = `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = path.join(dir, name);
      fs.writeFileSync(filePath, buf);
      return { ok: true, path: filePath };
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? String(err.message) : String(err),
      };
    }
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
    const { resolveDefaultSubjectDir, defaultPackageExists } = require("./default-package.cjs");
    const userDataPath = app.getPath("userData");
    const dir = resolveDefaultSubjectDir(userDataPath);
    require("node:fs").mkdirSync(path.dirname(dir), { recursive: true });
    return { dir, exists: defaultPackageExists(userDataPath) };
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
    let connectionState =
      (lastBootInfo && lastBootInfo.remoteCapability && lastBootInfo.remoteCapability.connectionState) ||
      (saved.enabled ? "configured_unverified" : "disconnected");
    if (remoteReachabilityVerified) connectionState = "connected";
    return publicRemoteCapabilityStatus({
      saved,
      resolved,
      registered,
      connectionState,
      reachabilityVerified: remoteReachabilityVerified,
    });
  });

  ipcMain.handle("shell:testRemoteCapability", async (_evt, input) => {
    const {
      validateResearchEndpoint,
      normalizeBaseUrl,
      userFacingConnectError,
      publicRemoteCapabilityStatus,
      readRemoteCapabilityConfig,
      resolveResearchBaseUrl,
    } = require(path.join(__dirname, "bootstrap-remote-capability.cjs"));
    const baseUrl = normalizeBaseUrl((input && input.baseUrl) || "");
    try {
      const result = await validateResearchEndpoint(baseUrl, resolveAppRoot());
      remoteReachabilityVerified = true;
      const userDataPath = app.getPath("userData");
      const status = publicRemoteCapabilityStatus({
        saved: readRemoteCapabilityConfig(userDataPath),
        resolved: resolveResearchBaseUrl(userDataPath),
        registered: !!(lastBootInfo && lastBootInfo.remoteCapability && lastBootInfo.remoteCapability.registered),
        connectionState: "connected",
        reachabilityVerified: true,
      });
      if (lastBootInfo) lastBootInfo.remoteCapability = status;
      return {
        ok: true,
        message: "连接正常，可以使用研究分析能力。",
        remoteCapability: status,
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
      remoteReachabilityVerified = false;
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
      publicRemoteCapabilityStatus,
      readRemoteCapabilityConfig,
      resolveResearchBaseUrl,
    } = require(path.join(__dirname, "bootstrap-remote-capability.cjs"));
    const baseUrl = normalizeBaseUrl((input && input.baseUrl) || "");
    try {
      await validateResearchEndpoint(baseUrl, resolveAppRoot());
    } catch (err) {
      remoteReachabilityVerified = false;
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
    remoteReachabilityVerified = true;
    const boot = await rebootstrapAndNotify();
    // rebootstrap 会清验证标记；保存前已探测成功，恢复为可用
    remoteReachabilityVerified = true;
    const userDataPath = app.getPath("userData");
    const status = publicRemoteCapabilityStatus({
      saved: readRemoteCapabilityConfig(userDataPath),
      resolved: resolveResearchBaseUrl(userDataPath),
      registered: !!(boot.remoteCapability && boot.remoteCapability.registered),
      connectionState: "connected",
      reachabilityVerified: true,
    });
    boot.remoteCapability = status;
    lastBootInfo = boot;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("shell:boot-info", boot);
    }
    return {
      ok: true,
      remoteCapability: status,
      message: "研究分析能力已可用。",
    };
  });

  ipcMain.handle("shell:disableRemoteCapability", async () => {
    const {
      disableRemoteCapabilityConfig,
    } = require(path.join(__dirname, "bootstrap-remote-capability.cjs"));
    disableRemoteCapabilityConfig(app.getPath("userData"));
    remoteReachabilityVerified = false;
    const boot = await rebootstrapAndNotify();
    return {
      ok: true,
      remoteCapability: boot.remoteCapability,
      message: "已停用外部专业能力。",
    };
  });

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

  /** 清空对话时递增；仅内存，用于丢弃迟到回复。不落盘、不新增对话库。 */
  let conversationGeneration = 0;

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
    const skipGrowthCapture = !!(input && input.skipGrowthCapture);
    const guideDimension = String((input && input.guideDimension) || "").trim();
    const file = conversationFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const turn = {
      id: `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      role,
      text,
      at: new Date().toISOString(),
    };
    fs.appendFileSync(file, `${JSON.stringify(turn)}\n`, "utf8");
    if (
      role === "user" &&
      skipGrowthCapture &&
      runtime &&
      typeof runtime.scheduleConversationGrowthCapture === "function"
    ) {
      try {
        runtime.scheduleConversationGrowthCapture({
          turnId: turn.id,
          userText: text,
          skipGrowthCapture: true,
          ...(guideDimension ? { dimensionKey: guideDimension } : {}),
        });
      } catch {
        /* 成长阻断不得影响对话落盘 */
      }
    }
    return { turn };
  });

  /** 清空对话 transcript；不删除已确认主体内容。 */
  ipcMain.handle("shell:conversationClear", async () => {
    conversationGeneration += 1;
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
      allowDevRuntimeFile: process.env.DIGITALME_V2_ALLOW_DEV_CREDENTIAL === "1",
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

    // 主体上下文装配：normal 与 growth_guided 共用同一事实来源（runtime 领域层）。
    // 仅含已确认、当前有效的本人信息；候选 / 失效 / 任务临时材料 / 内部字段名与事件 ID 不进入。
    let subjectContext = "";
    /** @type {string[]} 01B：与页面「已经了解」逐项相等的事实列表（每条自包含具体值）。 */
    let subjectFacts = [];
    let subjectContextOk = true;
    try {
      if (runtime && typeof runtime.buildConversationSubjectContext === "function") {
        const built = await runtime.buildConversationSubjectContext();
        if (built && built.ok === false) {
          subjectContextOk = false;
        } else if (built && typeof built.text === "string") {
          subjectContext = built.text;
          subjectFacts = Array.isArray(built.items)
            ? built.items.map((i) => String(i.text || "").trim()).filter(Boolean)
            : [];
        }
      }
    } catch {
      subjectContextOk = false;
    }
    if (!subjectContextOk) {
      // 读取数字之我信息失败：不得转成空主体继续调用模型，也不得声称“还不了解你”。
      throw Object.assign(new Error("本次未能读取数字之我信息，请重试。"), {
        actionable: "重新发送即可",
        subjectContextReadFailed: true,
      });
    }

    let growthGuide = "";
    const guideMode = String((input && input.guideMode) || "normal");
    // 成长引导指令只在 growth_guided 时存在；normal 模式不得携带强制追问指令。
    if (guideMode === "growth_guided") {
      try {
        if (runtime && typeof runtime.getOverview === "function") {
          const overview = await runtime.getOverview({});
          const question = overview && overview.growth && overview.growth.guidedQuestion;
          if (question && question.text) {
            growthGuide =
              `若用户愿意被了解，一次只问一个问题。当前最值得了解的是：${String(question.text)} ` +
              "用户可以换一个问题或稍后再聊。如果用户明确说不要记住这段或不要长期记录，不要假装已经把它变成长期了解。不要连续追问健康、财务、家庭等敏感信息。不要伪造用户说过的话。";
          }
        }
      } catch {
        growthGuide = "";
      }
    }

    const systemContent =
      runtime && typeof runtime.buildConversationSystemContent === "function"
        ? runtime.buildConversationSystemContent({ subjectFacts, growthGuide })
        : "你是用户的数字之我助手。根据对话上下文直接、具体地回答最终答复正文。不要用「已记下」代替回答；不要假装已完成任务；不要输出分析过程、推理提纲或内部标签。" +
          (growthGuide ? ` ${growthGuide}` : "");

    const messages = [
      { role: "system", content: systemContent },
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

    const skipGrowthCapture = !!(input && input.skipGrowthCapture);
    const userTurn = findLatestUserTurnId(file);
    const replyGeneration = conversationGeneration;

    // 01C/01D：主体事实查询 + 本人推断查询 → 受控回复（直接由 userVisibleFacts 生成），
    // 不调用模型、不做推断、不添加动机/性格/职业/价值/使用场景解释。
    const isFactQuery =
      !!runtime && typeof runtime.isSubjectFactQuery === "function" && runtime.isSubjectFactQuery(userText);
    const isInferenceQuery =
      !!runtime && typeof runtime.isPersonalInferenceQuery === "function" && runtime.isPersonalInferenceQuery(userText);
    if (isFactQuery || isInferenceQuery) {
      const controlled =
        typeof runtime.buildControlledFactualReply === "function"
          ? runtime.buildControlledFactualReply(subjectFacts)
          : `我目前确认的是：${subjectFacts.join("；")}。除此之外，我还不确定。`;
      // 01D：unsupported inference 检测器仅限「本人推断查询」路径执行（普通回复不检测）；
      // 检测异常仍保持 fail closed，不得返回空命中放行。
      if (isInferenceQuery) {
        try {
          if (runtime && typeof runtime.checkUnsupportedInference === "function") {
            const hits = await runtime.checkUnsupportedInference(controlled);
            if (Array.isArray(hits) && hits.length > 0) {
              return {
                text: "",
                status: "failed",
                finishReason: "unsupported_inference",
                unsupportedInference: hits.map((h) => h && h.category).filter(Boolean),
                ...(userTurn ? { userTurnId: userTurn.id } : {}),
              };
            }
          }
        } catch {
          return {
            text: "",
            status: "failed",
            finishReason: "inference_detection_failed",
            ...(userTurn ? { userTurnId: userTurn.id } : {}),
          };
        }
      }
      return {
        text: controlled,
        status: "complete",
        finishReason: "controlled_factual_reply",
        ...(userTurn ? { userTurnId: userTurn.id } : {}),
      };
    }

    if (runtime && typeof runtime.tryProvidedMaterialsLookup === "function") {
      try {
        const looked = await runtime.tryProvidedMaterialsLookup(userText);
        if (looked && typeof looked.text === "string" && looked.text.trim()) {
          return {
            text: String(looked.text).trim(),
            status: "complete",
            finishReason: "readonly_materials_lookup",
            ...(userTurn ? { userTurnId: userTurn.id } : {}),
          };
        }
      } catch {
        /* 资料查询失败时回落到普通对话，不得把协议错误抛到用户面 */
      }
    }

    const scheduleGrowth = (assistantText) => {
      if (replyGeneration !== conversationGeneration) return;
      if (skipGrowthCapture) return;
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

    // DIGITALME-CONVERSATION-SEARCH-RESEARCH-01：
    // 对话信息能力 — 自然对话 → 判断是否需要外部信息 → 不搜索/快速搜索/深度研究
    // → 综合本人上下文 + 外部来源 → 自然答案 + 可核验来源。
    // 仅在真实模型已配置时启用；可用 DIGITALME_V2_SEARCH_ENABLED=0 关闭。
    let searchFailureHonest = false;
    const searchEnabled =
      process.env.DIGITALME_V2_SEARCH_ENABLED !== "0" &&
      !!model.openaiCompatible &&
      !isFactQuery &&
      !isInferenceQuery;
    if (searchEnabled) {
      try {
        const { runClosureSearch } = require(path.join(
          appRoot,
          "dist",
          "capability",
          "conversation-search",
        ));
        const { createBingHtmlSearchConnector } = require(path.join(
          appRoot,
          "dist",
          "capability",
          "adapters",
          "bing-html-search",
        ));
        const searchChat = async (chatMessages, chatOpts) => {
          const result = await chatComplete({
            baseUrl: model.openaiCompatible.baseUrl,
            apiKey,
            model: model.openaiCompatible.model,
            messages: chatMessages,
            temperature:
              chatOpts && typeof chatOpts.temperature === "number"
                ? chatOpts.temperature
                : 0.4,
            maxTokens:
              chatOpts && Number.isFinite(chatOpts.maxTokens) && chatOpts.maxTokens > 0
                ? chatOpts.maxTokens
                : maxTokens,
            timeoutMs: model.openaiCompatible.timeoutMs || 180_000,
            ...(chatOpts && chatOpts.responseFormat
              ? { responseFormat: { type: chatOpts.responseFormat } }
              : {}),
          });
          return result;
        };
        const connector = createBingHtmlSearchConnector();
        // CAPABILITY-CLOSURE-RUNTIME-02：真实主链经 runClosureSearch 执行闭包分类
        // （专业搜索不可用 → baseline web + 通用模型 → BASELINE；无联网 → LIMITED 诚实回复）。
        const result = await runClosureSearch({
          userText,
          turns: recent
            .slice(0, -1)
            .map((t) => ({ role: t.role === "assistant" ? "assistant" : "user", content: t.text })),
          subjectFacts,
          currentDate: new Date().toISOString().slice(0, 10),
          chat: searchChat,
          connector,
          professionalSearchUsable: false,
          baselineSearchUsable: true,
          modelUsable: !!model.openaiCompatible,
        });
        const reply = result.reply;
        if (reply.mode !== "no_search") {
          scheduleGrowth(reply.text);
          return {
            text: reply.text,
            status: "complete",
            finishReason: reply.mode === "deep_research" ? "deep_research" : "web_search",
            capabilityClosure: result.resolution
              ? {
                  level: result.resolution.level,
                  ...(result.resolution.userNotice
                    ? { notice: result.resolution.userNotice }
                    : {}),
                  choices: result.resolution.userChoices,
                }
              : undefined,
            ...(userTurn ? { userTurnId: userTurn.id } : {}),
          };
        }
      } catch (err) {
        // 诚实失败：不阻断对话，回落到普通对话并要求模型如实说明无法核实。
        searchFailureHonest = true;
      }
    }
    if (searchFailureHonest) {
      messages.push({
        role: "system",
        content:
          "（本次未能获取到最新网络信息。回答时请如实说明无法核实最新信息，仅基于已有知识作答，不要假装实时。）",
      });
    }

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
      if (replyGeneration !== conversationGeneration) {
        return { text: "", status: "cancelled", finishReason: "cleared" };
      }
      const text = String(result.text || "").trim();
      // 01D：普通回复不执行 unsupported inference 检测（检测仅限本人推断查询路径）。
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
      if (replyGeneration !== conversationGeneration) {
        return { text: "", status: "cancelled", finishReason: "cleared" };
      }
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
  installApplicationMenu({
    openHelp: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("shell:open-help", { sectionId: "help-growth" });
      }
    },
  });
  registerIpc();

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

  const bootInfo = await bootstrapRuntime();
  await ensureDefaultPackageAttached();
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

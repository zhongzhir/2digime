"use strict";
/**
 * Electron main — 仅命令路由、窗口、文件对话框、文件夹揭示、模型凭证设置。
 * packaged 与 dev 共用本入口与同一领域运行链(无 packaged 专用业务分支)。
 * 未配置真实模型时不注册 Fake Adapter。
 */
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require("electron");
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

function buildBootInfo(model, appRoot) {
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
  // P2.1 确定性代码分析仅工程模式(未打包或显式环境变量)注册;packaged 默认不注册。
  const enableDeterministicCode =
    process.env.DIGITALME_V2_P21_DETERMINISTIC === "1" ||
    (process.env.DIGITALME_V2_P21_DETERMINISTIC !== "0" && !app.isPackaged);

  const options =
    model.documentCapability === "openai-compatible"
      ? {
          documentCapability: "openai-compatible",
          openaiCompatible: model.openaiCompatible,
          secrets: model.secrets,
          registerOpenAiStub: false,
          codeAnalysisCapability: enableDeterministicCode ? "deterministic" : "none",
        }
      : {
          documentCapability: "none",
          registerOpenAiStub: false,
          ...(model.secrets ? { secrets: model.secrets } : {}),
          codeAnalysisCapability: enableDeterministicCode ? "deterministic" : "none",
        };

  runtime = createDigitalMeRuntime(options);
  bus = createCommandBus(runtime);
  unsubscribe = runtime.eventBus.subscribe((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("domain:event", event);
    }
  });
  lastBootInfo = buildBootInfo(model, appRoot);
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
        shell.showItemInFolder(dir);
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

  ipcMain.handle("shell:getModelStatus", async () => {
    return lastBootInfo || { modelReady: false, needsCredentialSetup: true, status: null };
  });

  ipcMain.handle("shell:saveModelCredential", async (_evt, input) => {
    if (!saveCredential) throw new Error("凭证存储不可用，请确认系统安全存储已启用");
    const apiKey = String((input && input.apiKey) || "").trim();
    const baseUrl = String((input && input.baseUrl) || "").trim();
    const model = String((input && input.model) || "").trim();
    const providerPreset = String((input && input.providerPreset) || "openai-compatible").trim();
    if (!apiKey || !baseUrl || !model) throw new Error("请填写完整的模型连接信息");
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

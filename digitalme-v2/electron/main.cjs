"use strict";
/**
 * Electron main — 仅命令路由、窗口、文件对话框、文件夹揭示。
 * 业务逻辑全部在 dist/ 领域层。
 */
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

/** @type {import('../dist/runtime/digitalme-runtime').DigitalMeRuntime | null} */
let runtime = null;
/** @type {import('../dist/runtime/commands').CommandBus | null} */
let bus = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {(() => void) | null} */
let unsubscribe = null;

const COMMAND_NAMES = new Set([
  "subject.createPackage",
  "subject.openPackage",
  "subject.getOverview",
  "subject.confirmExperience",
  "work.submitTask",
  "work.retryTask",
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

async function bootstrapRuntime() {
  const {
    createDigitalMeRuntime,
  } = require(path.join(ROOT, "dist", "runtime", "digitalme-runtime"));
  const { createCommandBus } = require(path.join(ROOT, "dist", "runtime", "command-bus"));
  const { resolveDevModelConfig } = require(path.join(__dirname, "bootstrap-secrets.cjs"));

  const model = await resolveDevModelConfig({ safeStorage });
  const options =
    model.documentCapability === "openai-compatible"
      ? {
          documentCapability: "openai-compatible",
          openaiCompatible: model.openaiCompatible,
          secrets: model.secrets,
          registerOpenAiStub: false,
        }
      : {
          documentCapability: "fake",
          registerOpenAiStub: true,
        };

  runtime = createDigitalMeRuntime(options);
  bus = createCommandBus(runtime);
  unsubscribe = runtime.eventBus.subscribe((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("domain:event", event);
    }
  });
  return {
    modelReady: model.ok === true,
    modelMeta: model.modelMeta || null,
  };
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
    mainWindow.webContents.send("shell:boot", bootInfo);
  });
}

function registerIpc() {
  ipcMain.handle("command:invoke", async (_evt, name, input) => {
    if (!bus || !runtime) throw new Error("runtime not ready");
    if (!COMMAND_NAMES.has(name)) throw new Error(`command not exposed: ${name}`);

    if (name === "artifact.revealInFolder") {
      const artifactId = input && input.artifactId;
      const result = await bus.invoke(name, input || {});
      try {
        const dir = await runtime.getArtifactStorageDir(artifactId);
        shell.showItemInFolder(dir);
      } catch {
        /* opened flag from domain still returned */
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
}

app.whenReady().then(async () => {
  registerIpc();
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

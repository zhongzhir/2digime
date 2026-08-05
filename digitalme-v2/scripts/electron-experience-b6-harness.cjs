/**
 * EXPERIENCE-REDESIGN-01B-B6 — Playwright 驱动的 Electron harness。
 * 隔离 userData；Fake 文档能力；不触碰真实用户目录 / 真实 API Key。
 *
 * 由 Playwright `_electron.launch({ args: [thisFile] })` 启动。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

const userData =
  process.env.DIGITALME_B6_USER_DATA ||
  path.join(os.tmpdir(), `dmv2-b6-userdata-${process.pid}-${Date.now()}`);
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);

const fixturesRoot =
  process.env.DIGITALME_B6_FIXTURES || path.join(userData, 'fixtures');
fs.mkdirSync(fixturesRoot, { recursive: true });

const defaultDir = path.join(userData, 'subjects', 'default');
fs.mkdirSync(defaultDir, { recursive: true });

const matFile = path.join(fixturesRoot, 'note.md');
const matFolder = path.join(fixturesRoot, 'mixed-folder');
const unsupported = path.join(matFolder, 'skip.bin');
fs.writeFileSync(matFile, 'B6 验收材料：项目进展要点与风险。\n', 'utf8');
fs.mkdirSync(matFolder, { recursive: true });
fs.writeFileSync(path.join(matFolder, 'ok.txt'), '支持的文本材料。\n', 'utf8');
fs.writeFileSync(unsupported, Buffer.from([0, 1, 2, 3, 4]));

/** @type {import('../dist/runtime/digitalme-runtime').DigitalMeRuntime} */
let runtime;
/** @type {import('../dist/runtime/commands').CommandBus} */
let bus;
/** @type {BrowserWindow | null} */
let win = null;

let modelReady = process.env.DIGITALME_B6_MODEL_READY !== '0';
let credentialConfigured = modelReady;
let savedBaseUrl = 'https://api.deepseek.com/v1';
let savedModel = 'deepseek-v4-flash';
let savedPreset = 'deepseek';
let testMode = 'success';
let lastSavedApiKey = '';

/** @type {{ id: string, role: string, text: string, at: string }[]} */
const chatTurns = [];
let chatSeq = 0;

function modelStatusPayload() {
  return {
    modelReady: !!modelReady && !!credentialConfigured,
    needsCredentialSetup: !credentialConfigured,
    status: {
      credentialConfigured,
      needsCredentialSetup: !credentialConfigured,
      providerPreset: savedPreset,
      baseUrl: savedBaseUrl,
      model: savedModel,
      hasStoredKey: credentialConfigured,
      keyHint: credentialConfigured ? 'sk-••••••••••••1234' : '',
    },
  };
}

async function bootstrap() {
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { createCommandBus } = require('../dist/runtime/command-bus');
  runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    codeAnalysisCapability: 'needs_setup',
    fakeAdapter: { delayMs: Number(process.env.DIGITALME_B6_FAKE_DELAY_MS || 1200) },
  });
  bus = createCommandBus(runtime);
}

function registerIpc() {
  const { COMMAND_NAMES } = require('../dist/runtime/commands');
  const allowed = new Set(COMMAND_NAMES);
  ipcMain.handle('command:invoke', async (_e, name, input) => {
    if (!allowed.has(name)) throw new Error(`command not exposed: ${name}`);
    return bus.invoke(name, input || {});
  });
  ipcMain.handle('shell:pickOpenFiles', async () => [matFile]);
  ipcMain.handle('shell:pickOpenDirectory', async () => matFolder);
  ipcMain.handle('shell:pickSaveDirectory', async () => {
    throw new Error('pickSaveDirectory must not be required for first entry');
  });
  ipcMain.handle('shell:getDefaultSubjectDir', async () => {
    const manifest = path.join(defaultDir, 'manifest.json');
    let exists = false;
    try {
      fs.accessSync(manifest);
      exists = true;
    } catch {
      exists = false;
    }
    return { dir: defaultDir, exists };
  });
  ipcMain.handle('shell:getModelStatus', async () => modelStatusPayload());
  ipcMain.handle('shell:saveModelCredential', async (_e, input) => {
    const key = String((input && input.apiKey) || '').trim();
    if (key) lastSavedApiKey = key;
    if (!key && !credentialConfigured) throw new Error('missing api key');
    if (input && input.baseUrl) savedBaseUrl = String(input.baseUrl);
    if (input && input.model) savedModel = String(input.model);
    if (input && input.providerPreset) savedPreset = String(input.providerPreset);
    credentialConfigured = true;
    modelReady = true;
    return modelStatusPayload();
  });
  ipcMain.handle('shell:deleteModelCredential', async () => {
    credentialConfigured = false;
    modelReady = false;
    lastSavedApiKey = '';
    return modelStatusPayload();
  });
  ipcMain.handle('shell:testModelConnection', async () => {
    if (testMode === 'bad_key') {
      throw new Error('401 Unauthorized incorrect API key sk-leaked-should-not-appear');
    }
    if (testMode === 'network') {
      throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:9');
    }
    modelReady = true;
    credentialConfigured = true;
    return { ok: true, ...modelStatusPayload() };
  });
  ipcMain.handle('shell:revealPath', async () => ({ opened: true }));
  ipcMain.handle('shell:getRemoteCapabilityStatus', async () => ({
    connected: false,
    displayName: '研究分析能力',
    statusLabel: '状态：未连接',
  }));
  ipcMain.handle('shell:testRemoteCapability', async () => ({ ok: false, message: '未连接' }));
  ipcMain.handle('shell:saveRemoteCapability', async () => ({ ok: false }));
  ipcMain.handle('shell:disableRemoteCapability', async () => ({ ok: true }));
  ipcMain.handle('shell:conversationList', async () => ({ turns: chatTurns.slice() }));
  ipcMain.handle('shell:conversationAppend', async (_e, input) => {
    const turn = {
      id: `turn_${++chatSeq}`,
      role: String((input && input.role) || 'user'),
      text: String((input && input.text) || ''),
      at: '2026-01-01T00:00:00.000Z',
    };
    chatTurns.push(turn);
    return { turn };
  });
  ipcMain.handle('shell:conversationClear', async () => {
    chatTurns.length = 0;
    return { cleared: true };
  });

  // Playwright 可调用的测试钩子（仅 harness）
  ipcMain.handle('b6:setTestMode', async (_e, mode) => {
    testMode = String(mode || 'success');
    return { testMode };
  });
  ipcMain.handle('b6:getMeta', async () => ({
    userData,
    defaultDir,
    matFile,
    matFolder,
    lastSavedApiKeyPresent: !!lastSavedApiKey,
    lastSavedApiKeyLooksFull: /sk-[a-z0-9]{8,}/i.test(lastSavedApiKey),
    modelReady,
    credentialConfigured,
    chatCount: chatTurns.length,
  }));
}

async function createWindow(width, height) {
  win = new BrowserWindow({
    width: width || Number(process.env.DIGITALME_B6_WIDTH || 1440),
    height: height || Number(process.env.DIGITALME_B6_HEIGHT || 900),
    show: true,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  runtime.eventBus.subscribe((event) => {
    if (win && !win.isDestroyed()) win.webContents.send('domain:event', event);
  });

  // Playwright 需注入脚本；验收用临时 HTML 去掉 CSP（不改生产文件）
  const rendererDir = path.join(ROOT, 'electron', 'renderer');
  const srcHtml = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
  const baseHref = pathToFileURL(path.join(rendererDir, path.sep)).href;
  const patched = srcHtml
    .replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>\s*/i, '')
    .replace(/<head>/i, `<head>\n    <base href="${baseHref}">`);
  const harnessHtml = path.join(userData, 'b6-index.html');
  fs.writeFileSync(harnessHtml, patched, 'utf8');
  await win.loadURL(pathToFileURL(harnessHtml).href);
  win.webContents.send('shell:boot', {
    ...modelStatusPayload(),
    isPackaged: false,
  });
}

app.whenReady().then(async () => {
  try {
    await bootstrap();
    registerIpc();
    await createWindow();
    // 标记就绪，供 Playwright 轮询
    process.stdout.write(`B6_HARNESS_READY userData=${userData}\n`);
  } catch (err) {
    console.error('B6 harness failed to start', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

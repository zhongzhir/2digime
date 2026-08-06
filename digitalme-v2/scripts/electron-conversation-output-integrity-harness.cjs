/**
 * DIGITALME-V2-CONVERSATION-OUTPUT-INTEGRITY-01 — Electron harness（无真实模型）。
 * Playwright 启动本文件；隔离 userData。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const END_MARKER = 'END_OF_REPLY_20260805';
const REASONING_LEAK = '用户想要什么：这是内部分析过程，不得出现在用户面';

const userData =
  process.env.DIGITALME_COI_USER_DATA ||
  path.join(os.tmpdir(), `dmv2-coi-userdata-${process.pid}-${Date.now()}`);
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);

const defaultDir = path.join(userData, 'subjects', 'default');
fs.mkdirSync(defaultDir, { recursive: true });

/** @type {import('../dist/runtime/digitalme-runtime').DigitalMeRuntime} */
let runtime;
/** @type {import('../dist/runtime/commands').CommandBus} */
let bus;
/** @type {BrowserWindow | null} */
let win = null;

/** @type {{ id: string, role: string, text: string, at: string }[]} */
const chatTurns = [];
let chatSeq = 0;
let captureCount = 0;
/** @type {'auto'|'incomplete'|'network'|'fail'} */
let replyMode = String(process.env.DIGITALME_COI_REPLY_MODE || 'auto');

function buildLongArticle() {
  const sections = [];
  for (let i = 1; i <= 6; i += 1) {
    const body = `第${i}节正文。`.repeat(40);
    sections.push(`## 第${i}节\n\n${body}`);
  }
  return `${sections.join('\n\n')}\n\n${END_MARKER}`;
}

async function bootstrap() {
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { createCommandBus } = require('../dist/runtime/command-bus');
  runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    codeAnalysisCapability: 'needs_setup',
    fakeAdapter: { delayMs: 50 },
  });
  bus = createCommandBus(runtime);
}

function registerIpc() {
  const { COMMAND_NAMES } = require('../dist/runtime/commands');
  const allowed = new Set(COMMAND_NAMES);
  ipcMain.handle('command:invoke', async (_e, name, input) => {
    if (!allowed.has(name)) throw new Error(`command not exposed: ${name}`);
    if (name === 'subject.captureInput') {
      captureCount += 1;
      // 故意可失败：主回复不得依赖 capture
      if (process.env.DIGITALME_COI_CAPTURE_FAIL === '1') {
        throw new Error('capture intentionally failed');
      }
    }
    return bus.invoke(name, input || {});
  });
  ipcMain.handle('shell:pickOpenFiles', async () => []);
  ipcMain.handle('shell:pickOpenDirectory', async () => null);
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
  ipcMain.handle('shell:getModelStatus', async () => ({
    modelReady: true,
    needsCredentialSetup: false,
    status: { credentialConfigured: true, needsCredentialSetup: false },
  }));
  ipcMain.handle('shell:saveModelCredential', async () => ({ ok: true }));
  ipcMain.handle('shell:deleteModelCredential', async () => ({ ok: true }));
  ipcMain.handle('shell:testModelConnection', async () => ({ ok: true }));
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
      at: new Date().toISOString(),
    };
    chatTurns.push(turn);
    return { turn };
  });
  ipcMain.handle('shell:conversationClear', async () => {
    chatTurns.length = 0;
    return { cleared: true };
  });
  ipcMain.handle('shell:conversationReply', async (_e, input) => {
    const text = String((input && input.text) || '').trim();
    const mode = replyMode;
    if (mode === 'network') {
      const err = new Error('网络中断。回复未完成，可重试');
      err.code = 'CHAT_INCOMPLETE';
      throw err;
    }
    if (mode === 'fail') {
      throw new Error('模型暂时不可用。请稍后重试');
    }
    if (mode === 'incomplete') {
      return {
        text: '这是被截断的半句，尚无结束标记',
        status: 'incomplete',
        finishReason: 'length',
      };
    }
    if (/CHAT_SHORT_OK|只回复/.test(text)) {
      return { text: 'CHAT_SHORT_OK', status: 'complete', finishReason: 'stop' };
    }
    if (/1200|小节|END_OF_REPLY|长文|长回复/.test(text)) {
      // 故意不把 REASONING_LEAK 放进 text；模拟 adapter 已丢弃 reasoning
      void REASONING_LEAK;
      return {
        text: buildLongArticle(),
        status: 'complete',
        finishReason: 'stop',
      };
    }
    return {
      text: `（验收助手）收到：${text.slice(0, 120)}`,
      status: 'complete',
      finishReason: 'stop',
    };
  });

  ipcMain.handle('coi:setReplyMode', async (_e, mode) => {
    replyMode = String(mode || 'auto');
    return { replyMode };
  });
  ipcMain.handle('coi:getMeta', async () => ({
    userData,
    defaultDir,
    chatCount: chatTurns.length,
    userCount: chatTurns.filter((t) => t.role === 'user').length,
    assistantCount: chatTurns.filter((t) => t.role === 'assistant').length,
    captureCount,
    replyMode,
    endMarker: END_MARKER,
    turns: chatTurns.map((t) => ({ role: t.role, chars: t.text.length, preview: t.text.slice(0, 80) })),
  }));
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
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

  const rendererDir = path.join(ROOT, 'electron', 'renderer');
  const srcHtml = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
  const baseHref = pathToFileURL(path.join(rendererDir, path.sep)).href;
  const patched = srcHtml
    .replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>\s*/i, '')
    .replace(/<head>/i, `<head>\n    <base href="${baseHref}">`);
  const harnessHtml = path.join(userData, 'coi-index.html');
  fs.writeFileSync(harnessHtml, patched, 'utf8');
  await win.loadURL(pathToFileURL(harnessHtml).href);
  win.webContents.send('shell:boot', {
    modelReady: true,
    needsCredentialSetup: false,
    status: { credentialConfigured: true, needsCredentialSetup: false },
    isPackaged: false,
  });
}

app.whenReady().then(async () => {
  try {
    await bootstrap();
    registerIpc();
    await createWindow();
    global.__digitalmeCoi = {
      getMeta: async () => ({
        userData,
        defaultDir,
        chatCount: chatTurns.length,
        userCount: chatTurns.filter((t) => t.role === 'user').length,
        assistantCount: chatTurns.filter((t) => t.role === 'assistant').length,
        captureCount,
        replyMode,
        endMarker: END_MARKER,
      }),
      setReplyMode: (mode) => {
        replyMode = String(mode || 'auto');
        return replyMode;
      },
    };
    process.stdout.write(`COI_HARNESS_READY userData=${userData}\n`);
  } catch (err) {
    console.error('COI harness failed to start', err);
    app.exit(1);
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

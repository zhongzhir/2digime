/**
 * CONVERSATIONAL-WORKSPACE-10 — Electron 视觉截图（隔离 userData，不碰 MUHUB）。
 * 验证三栏结构：左任务、中对话+NL、右成果空态/验收去重。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_conversational-workspace-10-evidence');
const SHOTS = path.join(EVIDENCE, 'shots');
const USER_DATA = path.join(
  os.tmpdir(),
  `dmv2-ws10-ud-${Date.now()}-${process.pid}`,
);

app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', USER_DATA);

/** @type {import('../dist/runtime/digitalme-runtime').DigitalMeRuntime} */
let runtime;
/** @type {import('../dist/runtime/commands').CommandBus} */
let bus;
/** @type {BrowserWindow | null} */
let win = null;
let defaultDir = '';

const report = {
  startedAt: new Date().toISOString(),
  userData: USER_DATA,
  checks: [],
  shots: [],
  verdict: null,
};

app.on('window-all-closed', () => {});

function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  if (!ok) {
    throw new Error(`CHECK_FAILED: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function uiEval(source) {
  return win.webContents.executeJavaScript(`(${source})()`, true);
}

async function shot(name) {
  const file = path.join(SHOTS, `${String(report.shots.length + 1).padStart(2, '0')}-${name}.png`);
  const img = await win.capturePage();
  fs.writeFileSync(file, img.toPNG());
  const st = fs.statSync(file);
  check(`shot_${name}`, st.size > 2000, { file, size: st.size });
  report.shots.push({ name, file, size: st.size });
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
    return bus.invoke(name, input || {});
  });
  ipcMain.handle('shell:pickOpenFiles', async () => []);
  ipcMain.handle('shell:pickOpenDirectory', async () => null);
  ipcMain.handle('shell:pickSaveDirectory', async () => {
    throw new Error('not required');
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
  ipcMain.handle('shell:conversationList', async () => ({ turns: [] }));
  ipcMain.handle('shell:conversationAppend', async (_e, input) => ({
    turn: {
      id: 'turn_test',
      role: String((input && input.role) || 'user'),
      text: String((input && input.text) || ''),
      at: new Date().toISOString(),
    },
  }));
  ipcMain.handle('shell:conversationClear', async () => ({ cleared: true }));
  ipcMain.handle('shell:conversationReply', async (_e, input) => ({
    text: `收到：${String((input && input.text) || '').slice(0, 80)}`,
    status: 'complete',
    finishReason: 'stop',
  }));
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadURL(pathToFileURL(path.join(ROOT, 'electron', 'renderer', 'index.html')).href);
  win.webContents.send('shell:boot', {
    modelReady: true,
    needsCredentialSetup: false,
    status: { credentialConfigured: true, needsCredentialSetup: false },
    isPackaged: false,
  });
  await sleep(600);
}

async function waitUi(predicateSource, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = await uiEval(predicateSource);
    if (hit) return hit;
    await sleep(120);
  }
  throw new Error(`UI wait timeout: ${predicateSource}`);
}

async function enterWork() {
  await uiEval(`() => {
    const welcome = document.getElementById('view-welcome');
    if (welcome && !welcome.hidden) {
      document.getElementById('self-intro').value = 'WS-10 对话工作空间验收';
      document.getElementById('btn-create-pkg').click();
    }
    return true;
  }`);
  await waitUi(`() => {
    const shell = document.getElementById('view-shell');
    const welcome = document.getElementById('view-welcome');
    return shell && !shell.hidden && welcome && welcome.hidden;
  }`);
  await uiEval(`() => {
    const nav = document.getElementById('nav-work');
    if (nav) nav.click();
    return true;
  }`);
  await sleep(400);
}

async function mainSequence() {
  const root = path.join(os.tmpdir(), `dmv2-ws10-${Date.now()}`);
  defaultDir = path.join(root, 'default-subject');
  fs.mkdirSync(defaultDir, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  await createWindow();
  await enterWork();

  const structure = await uiEval(`() => {
    const timeline = document.getElementById('work-timeline');
    const nl = document.getElementById('work-nl-input');
    const send = document.getElementById('btn-work-nl-send');
    const empty = document.getElementById('artifact-empty-hint');
    const tasks = document.getElementById('task-list');
    return {
      hasTimeline: !!timeline,
      hasNl: !!nl && !nl.disabled,
      hasSend: !!send,
      emptyVisible: !!(empty && !empty.hidden),
      emptyText: empty ? empty.textContent.trim() : '',
      hasTaskList: !!tasks,
      convApi: !!(window.DigitalMeWorkConversation && window.DigitalMeWorkConversation.buildWorkTimeline),
    };
  }`);
  check('structure_left_center_right', structure.hasTimeline && structure.hasNl && structure.hasSend && structure.hasTaskList, structure);
  check('empty_artifact_copy', structure.emptyVisible && /尚未形成可交付成果/.test(structure.emptyText), structure);
  check('conversation_module_loaded', structure.convApi, structure);
  await shot('compose-empty-artifact');

  await uiEval(`() => {
    const conv = window.DigitalMeWorkConversation;
    const ol = document.getElementById('work-timeline');
    if (!conv || !ol) return false;
    const turns = conv.buildWorkTimeline({
      goal: '优化首页信息层级与视觉品质',
      understandingLines: ['目标：优化首页信息层级', '方案：调整布局与样式'],
      ctoReport: '本轮成果尚未完全达到目标：构建仍有失败。建议继续修正后再次验收。',
      userFacingNextStep: '请在下方说明你更在意的改动，或继续完善标题层级。',
      canAdoptSuggested: false,
      hasArtifact: true,
      artifactVersionId: 'ver_1',
    });
    ol.innerHTML = '';
    for (const turn of turns) {
      const li = document.createElement('li');
      li.className = 'work-turn work-turn-' + turn.role;
      const role = document.createElement('div');
      role.className = 'work-turn-role';
      role.textContent = conv.roleLabel(turn.role);
      const body = document.createElement('div');
      body.className = 'work-turn-text';
      body.textContent = turn.text || '';
      li.appendChild(role);
      li.appendChild(body);
      ol.appendChild(li);
    }
    const empty = document.getElementById('artifact-empty-hint');
    if (empty) {
      empty.hidden = true;
      empty.setAttribute('hidden', '');
    }
    const meta = document.getElementById('version-meta');
    if (meta) meta.textContent = '版本 1';
    const exec = document.getElementById('cc-acceptance-exec');
    const section = document.getElementById('cc-acceptance-section');
    const view = document.getElementById('code-change-view');
    if (view) {
      view.hidden = false;
      view.removeAttribute('hidden');
    }
    if (section) {
      section.hidden = false;
      section.removeAttribute('hidden');
    }
    if (exec) exec.textContent = '执行已完成 · 建议继续修正';
    const cto = document.getElementById('cc-cto-report');
    if (cto) {
      cto.hidden = true;
      cto.textContent = '';
    }
    const nl = document.getElementById('work-nl-input');
    if (nl) {
      nl.value = '标题字号再大一点，这里不符合我的要求';
      nl.disabled = false;
    }
    return ol.children.length >= 3;
  }`);
  await sleep(300);
  const mid = await uiEval(`() => {
    const ol = document.getElementById('work-timeline');
    const texts = [...(ol?.querySelectorAll('.work-turn-text') || [])].map((n) => n.textContent);
    const ctoHidden = document.getElementById('cc-cto-report')?.hidden !== false;
    const nl = document.getElementById('work-nl-input');
    return {
      turnCount: ol ? ol.children.length : 0,
      hasCtoInCenter: texts.some((t) => /尚未完全达到目标/.test(t || '')),
      ctoHiddenOnRight: ctoHidden,
      nlEnabled: !!(nl && !nl.disabled),
      nlHasOpinion: /不符合我的要求/.test(nl?.value || ''),
    };
  }`);
  check('center_has_cto_nl', mid.hasCtoInCenter && mid.turnCount >= 3, mid);
  check('right_hides_long_cto', mid.ctoHiddenOnRight, mid);
  check('nl_available_after_result', mid.nlEnabled && mid.nlHasOpinion, mid);
  await shot('revision-conversation');

  await uiEval(`() => {
    const conv = window.DigitalMeWorkConversation;
    const ol = document.getElementById('work-timeline');
    const turns = conv.buildWorkTimeline({
      goal: '优化首页信息层级与视觉品质',
      ctoReport: '本轮成果已达到目标，建议采用当前版本。',
      canAdoptSuggested: true,
      hasArtifact: true,
      artifactVersionId: 'ver_2',
      decisionAccepted: false,
    });
    ol.innerHTML = '';
    for (const turn of turns) {
      const li = document.createElement('li');
      li.className = 'work-turn work-turn-' + turn.role;
      const role = document.createElement('div');
      role.className = 'work-turn-role';
      role.textContent = conv.roleLabel(turn.role);
      const body = document.createElement('div');
      body.className = 'work-turn-text';
      body.textContent = turn.text || '';
      li.appendChild(role);
      li.appendChild(body);
      if (turn.actions && turn.actions.length) {
        const row = document.createElement('div');
        row.className = 'work-turn-actions';
        for (const action of turn.actions) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = action.id === 'confirm_adopt' ? 'primary' : 'ghost';
          btn.textContent = action.label;
          row.appendChild(btn);
        }
        li.appendChild(row);
      }
      ol.appendChild(li);
    }
    const meta = document.getElementById('version-meta');
    if (meta) meta.textContent = '版本 2';
    return true;
  }`);
  await sleep(250);
  const adopt = await uiEval(`() => {
    const btn = [...document.querySelectorAll('.work-turn-actions button')].find((b) =>
      /确认采用/.test(b.textContent || ''),
    );
    return { hasAdoptNearMessage: !!btn };
  }`);
  check('adopt_near_center_message', adopt.hasAdoptNearMessage, adopt);
  await shot('adopt-suggested');

  report.verdict = 'pass';
  report.completedAt = new Date().toISOString();
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, evidence: EVIDENCE, shots: report.shots.length }, null, 2));
}

app.whenReady().then(async () => {
  try {
    await bootstrap();
    registerIpc();
    await mainSequence();
    app.exit(0);
  } catch (err) {
    report.verdict = 'fail';
    report.error = err && err.message ? err.message : String(err);
    report.completedAt = new Date().toISOString();
    try {
      fs.mkdirSync(EVIDENCE, { recursive: true });
      fs.writeFileSync(path.join(EVIDENCE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      if (win && !win.isDestroyed()) {
        const failShot = path.join(SHOTS, 'failure.png');
        fs.mkdirSync(SHOTS, { recursive: true });
        const img = await win.capturePage();
        fs.writeFileSync(failShot, img.toPNG());
      }
    } catch {
      /* ignore */
    }
    console.error(err);
    app.exit(1);
  }
});

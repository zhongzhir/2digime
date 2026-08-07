/**
 * CODING-CAPABILITY-ONBOARDING-01 — Electron 三场景验收
 * A: 无 Coding Agent
 * B: 能力变为可用后恢复原任务进入确认
 * C: 不支持的桌面产品不得自动执行
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_coding-capability-onboarding-01-evidence');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-onb-ud-'));
app.setPath('userData', userData);
app.on('window-all-closed', () => {});

let runtime;
let bus;
let win = null;
let fixtureRepo = '';
let defaultDir = '';

const report = {
  schemaVersion: 'coding-capability-onboarding/1',
  startedAt: new Date().toISOString(),
  checks: [],
  verdict: null,
};

function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  if (!ok) {
    throw new Error(`CHECK_FAILED: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

function writeEvidence() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function uiEval(source) {
  return win.webContents.executeJavaScript(`(${source})()`, true);
}

function makeExecutorHook() {
  return async ({ pkg }) => {
    const target = path.join(pkg.workingDirectory, 'formatLabel.js');
    await fs.promises.writeFile(
      target,
      "function formatLabel(input){ return input==='start' ? 'done' : input; }\nmodule.exports={formatLabel};\n",
      'utf8',
    );
    return {
      exitCode: 0,
      summary: '已将 formatLabel 改为 done。',
      claimedChangedFiles: ['formatLabel.js'],
      testCommands: [],
      testResults: [],
    };
  };
}

async function createRuntime(mode) {
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { createCommandBus } = require('../dist/runtime/command-bus');
  if (mode === 'none') {
    runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      codeAnalysisCapability: 'needs_setup',
      externalExecutorCapability: { forceAvailability: 'needs_setup' },
    });
  } else if (mode === 'ready') {
    runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      codeAnalysisCapability: 'needs_setup',
      externalExecutorCapability: {
        forceAvailability: 'ready',
        executeHook: makeExecutorHook(),
      },
    });
  } else if (mode === 'unsupported') {
    runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      codeAnalysisCapability: 'needs_setup',
      externalExecutorCapability: { forceAvailability: 'needs_setup' },
      unsupportedDesktopCodingCapability: {
        displayName: '某桌面代码工具',
        detected: true,
      },
    });
  }
  bus = createCommandBus(runtime);
}

function registerIpc() {
  const handlers = [
    'command:invoke',
    'shell:pickOpenFiles',
    'shell:pickOpenDirectory',
    'shell:inspectSoftwareProject',
    'shell:getDefaultSubjectDir',
    'shell:getModelStatus',
    'shell:saveModelCredential',
    'shell:deleteModelCredential',
    'shell:testModelConnection',
    'shell:revealPath',
    'shell:getRemoteCapabilityStatus',
    'shell:testRemoteCapability',
    'shell:saveRemoteCapability',
    'shell:disableRemoteCapability',
    'shell:conversationList',
    'shell:conversationAppend',
    'shell:conversationClear',
    'shell:conversationReply',
    'shell:conversationGrowthHint',
    'shell:pickSaveDirectory',
  ];
  for (const name of handlers) {
    try {
      ipcMain.removeHandler(name);
    } catch {
      /* ignore */
    }
  }
  ipcMain.handle('command:invoke', async (_e, name, input) => bus.invoke(name, input || {}));
  ipcMain.handle('shell:pickOpenFiles', async () => []);
  ipcMain.handle('shell:pickOpenDirectory', async () => fixtureRepo);
  ipcMain.handle('shell:inspectSoftwareProject', async (_e, input) => {
    const { inspectSoftwareProject } = require('../dist/work-runtime/work-intent');
    return inspectSoftwareProject(input && input.path ? input.path : fixtureRepo);
  });
  ipcMain.handle('shell:getDefaultSubjectDir', async () => {
    const manifest = path.join(defaultDir, 'manifest.json');
    return { dir: defaultDir, exists: fs.existsSync(manifest) };
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
  ipcMain.handle('shell:testRemoteCapability', async () => ({ ok: false }));
  ipcMain.handle('shell:saveRemoteCapability', async () => ({ ok: true }));
  ipcMain.handle('shell:disableRemoteCapability', async () => ({ ok: true }));
  ipcMain.handle('shell:conversationList', async () => ({ messages: [] }));
  ipcMain.handle('shell:conversationAppend', async () => ({ ok: true }));
  ipcMain.handle('shell:conversationClear', async () => ({ ok: true }));
  ipcMain.handle('shell:conversationReply', async () => ({ text: '' }));
  ipcMain.handle('shell:conversationGrowthHint', async () => ({ hint: null }));
  ipcMain.handle('shell:pickSaveDirectory', async () => {
    throw new Error('unused');
  });
}

async function createWindow() {
  if (win && !win.isDestroyed()) win.destroy();
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL(pathToFileURL(path.join(ROOT, 'electron', 'renderer', 'index.html')).href);
  await sleep(800);
}

async function openWork() {
  await uiEval(`async () => {
    const api = window.digitalMe;
    const d = await api.getDefaultSubjectDir();
    try { await api.invoke('subject.openPackage', { dir: d.dir }); }
    catch { await api.invoke('subject.createPackage', { displayName: 'ONB', targetDir: d.dir }); }
    document.getElementById('nav-work').click();
    document.getElementById('btn-new-task').click();
    return true;
  }`);
}

async function run() {
  defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-onb-pkg-'));
  fixtureRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-onb-repo-'));
  fs.writeFileSync(path.join(fixtureRepo, 'package.json'), '{"name":"onb","private":true}\n');
  fs.writeFileSync(
    path.join(fixtureRepo, 'formatLabel.js'),
    "function formatLabel(input){ return input; }\nmodule.exports={formatLabel};\n",
  );

  // —— 场景 A：无 Coding Agent ——
  await createRuntime('none');
  registerIpc();
  await createWindow();
  await openWork();

  const sceneA = await uiEval(`async () => {
    document.getElementById('goal').value = '修改这个项目中的 formatLabel，使 start 返回 done。';
    document.getElementById('btn-add-folder').click();
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('btn-submit').click();
    await new Promise((r) => setTimeout(r, 500));
    const card = document.getElementById('executor-setup-card');
    const title = (document.getElementById('executor-setup-title') || {}).textContent || '';
    const msg = (document.getElementById('executor-setup-message') || {}).textContent || '';
    const blob = (card && card.innerText) || '';
    return {
      cardVisible: card && !card.hidden,
      title,
      msg,
      hasInternal: /CLI|Adapter|Registry|executorId/i.test(blob),
      useInstalled: !!document.getElementById('btn-coding-use-installed'),
      later: !!document.getElementById('btn-coding-connect-later'),
    };
  }`);
  check('a_onboarding_visible', !!(sceneA && sceneA.cardVisible), sceneA);
  check('a_title', /代码执行能力/.test(sceneA.title), sceneA);
  check('a_no_internal_terms', sceneA.hasInternal === false, sceneA);
  check('a_actions_present', !!(sceneA.useInstalled && sceneA.later), sceneA);

  const tasksA = await bus.invoke('work.listTasks', { limit: 10 });
  check('a_no_failed_job', (tasksA.tasks || []).length === 0, tasksA);

  await uiEval(`async () => {
    document.getElementById('btn-coding-connect-later').click();
    await new Promise((r) => setTimeout(r, 200));
    return true;
  }`);
  const pendingA = await bus.invoke('capability.list', { codingAction: { type: 'get_pending' } });
  check('a_pending_saved', !!(pendingA.pendingSoftwareTask && pendingA.pendingSoftwareTask.goal), pendingA);

  // —— 场景 B：能力变为可用，恢复进入确认 ——
  const pkgDir = defaultDir;
  await createRuntime('ready');
  registerIpc();
  await createWindow();
  const sceneB = await uiEval(`async () => {
    const api = window.digitalMe;
    await api.invoke('subject.openPackage', { dir: ${JSON.stringify(pkgDir)} });
    document.getElementById('nav-work').click();
    await new Promise((r) => setTimeout(r, 200));
    const pending = await api.invoke('capability.list', { codingAction: { type: 'get_pending' } });
    const goal = (pending.pendingSoftwareTask && pending.pendingSoftwareTask.goal) ||
      '修改这个项目中的 formatLabel，使 start 返回 done。';
    document.getElementById('goal').value = goal;
    document.getElementById('btn-add-folder').click();
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('btn-submit').click();
    await new Promise((r) => setTimeout(r, 600));
    return {
      confirmVisible: !document.getElementById('execution-confirm-card').hidden,
      executorLabel: (document.getElementById('execution-confirm-executor') || {}).textContent || '',
      goal: document.getElementById('goal').value,
      pendingKept: !!(pending && pending.pendingSoftwareTask),
    };
  }`);
  check('b_pending_kept', !!(sceneB && sceneB.pendingKept), sceneB);
  check('b_confirm_visible', !!(sceneB && sceneB.confirmVisible), sceneB);
  check('b_natural_executor_name', sceneB.executorLabel === '代码执行能力', sceneB);
  check('b_goal_retained', /formatLabel/.test(sceneB.goal), sceneB);

  await uiEval(`async () => {
    document.getElementById('btn-confirm-execution').click();
    await new Promise((r) => setTimeout(r, 900));
    return true;
  }`);
  await sleep(1200);
  const tasksB = await bus.invoke('work.listTasks', { limit: 10 });
  check('b_executed_one_task', (tasksB.tasks || []).length === 1, tasksB);

  // —— 场景 C：unsupported 桌面产品 ——
  defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-onb-pkg-c-'));
  await createRuntime('unsupported');
  registerIpc();
  await createWindow();
  await openWork();
  const sceneC = await uiEval(`async () => {
    document.getElementById('goal').value = '修改这个项目中的 formatLabel';
    document.getElementById('btn-add-folder').click();
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('btn-submit').click();
    await new Promise((r) => setTimeout(r, 500));
    document.getElementById('btn-coding-use-installed').click();
    await new Promise((r) => setTimeout(r, 500));
    const scan = (document.getElementById('coding-cap-scan-list') || {}).innerText || '';
    const confirmHidden = document.getElementById('execution-confirm-card').hidden;
    return {
      scan,
      confirmHidden,
      notConnected: /不能自动调用|无法自动使用/.test(scan),
      notReadyLabel: !/已连接/.test(scan) || /不能自动/.test(scan),
    };
  }`);
  check('c_unsupported_message', !!(sceneC && sceneC.notConnected), sceneC);
  check('c_no_auto_confirm', !!(sceneC && sceneC.confirmHidden), sceneC);

  const listedC = await bus.invoke('capability.list', { includeAvailability: true });
  const desk = (listedC.codingCapabilities || []).find((c) => c.invocationKind === 'desktop_handoff');
  check('c_not_marked_ready', !!(desk && desk.availability === 'unsupported'), desk);
  check('c_not_available_card', !(listedC.executorCapabilityCard && listedC.executorCapabilityCard.available), listedC.executorCapabilityCard);

  report.verdict = 'pass';
  report.completedAt = new Date().toISOString();
  writeEvidence();
  console.log(JSON.stringify({ ok: true, evidence: EVIDENCE, checks: report.checks.length }, null, 2));
}

app.whenReady().then(async () => {
  try {
    await run();
    app.exit(0);
  } catch (err) {
    report.verdict = 'fail';
    report.error = err && err.message ? err.message : String(err);
    report.completedAt = new Date().toISOString();
    writeEvidence();
    console.error(err);
    console.log(JSON.stringify({ ok: false, evidence: EVIDENCE, error: report.error }, null, 2));
    app.exit(1);
  }
});

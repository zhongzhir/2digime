/**
 * BLOCKER-03 — 多任务成果隔离 + 无目录提示 Electron 验收。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_software-dev-task-isolation-01-evidence');

let runtime;
let bus;
let win = null;
let defaultDir = '';
let repoA = '';
let repoB = '';
let emptyB = '';

const report = {
  schemaVersion: 'software-dev-task-isolation/1',
  startedAt: new Date().toISOString(),
  checks: [],
  verdict: null,
};

function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  if (!ok) throw new Error(`CHECK_FAILED: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
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

async function bootstrap() {
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { createCommandBus } = require('../dist/runtime/command-bus');
  runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    codeAnalysisCapability: 'needs_setup',
    externalExecutorCapability: {
      executeHook: async ({ pkg, prompt }) => {
        const wd = pkg.workingDirectory;
        const isB = /iso-b|empty-b|tetris/i.test(wd) || /俄罗斯|tetris/i.test(prompt);
        if (isB) {
          await fs.promises.writeFile(
            path.join(wd, 'tetris.js'),
            "console.log('tetris');\nmodule.exports={};\n",
            'utf8',
          );
          await fs.promises.writeFile(
            path.join(wd, 'package.json'),
            '{"name":"tetris","private":true,"scripts":{"test":"node -e \\"console.log(1)\\""}}\n',
            'utf8',
          );
          return {
            exitCode: 0,
            summary: '已创建最小俄罗斯方块项目骨架。',
            claimedChangedFiles: ['tetris.js', 'package.json'],
            testResults: [],
          };
        }
        const target = path.join(wd, 'formatLabel.js');
        const body =
          "function formatLabel(input){ return input==='start' ? 'done' : input; }\nmodule.exports={formatLabel};\n";
        await fs.promises.writeFile(target, body, 'utf8');
        return {
          exitCode: 0,
          summary: '已将 formatLabel 改为 done。',
          claimedChangedFiles: ['formatLabel.js'],
          testResults: [],
        };
      },
    },
  });
  bus = createCommandBus(runtime);
}

function registerIpc() {
  const { COMMAND_NAMES } = require('../dist/runtime/commands');
  const { inspectSoftwareProject } = require('../dist/work-runtime/work-intent');
  const allowed = new Set(COMMAND_NAMES);
  let pickSeq = 0;
  ipcMain.handle('command:invoke', async (_e, name, input) => {
    if (!allowed.has(name)) throw new Error(`command not exposed: ${name}`);
    return bus.invoke(name, input || {});
  });
  ipcMain.handle('shell:pickOpenFiles', async () => []);
  ipcMain.handle('shell:pickOpenDirectory', async () => {
    pickSeq += 1;
    if (pickSeq === 1) return repoA;
    return emptyB;
  });
  ipcMain.handle('shell:inspectSoftwareProject', async (_e, input) =>
    inspectSoftwareProject(input && input.path ? input.path : repoA),
  );
  ipcMain.handle('shell:prepareSoftwareProject', async (_e, input) => {
    const goal = input && input.goal ? String(input.goal) : '新项目';
    const parent =
      input && input.parentDir ? path.resolve(String(input.parentDir)) : emptyB;
    const folder = `dm-${String(goal).replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]+/g, '-').slice(0, 24) || 'project'}`;
    const target = path.join(parent, folder);
    fs.mkdirSync(target, { recursive: true });
    return {
      ok: true,
      path: target,
      folderName: folder,
      displayPath: target,
      created: true,
      reused: false,
    };
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
  ipcMain.handle('shell:pickSaveDirectory', async () => emptyB);
}

async function createWindow() {
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
  await sleep(900);
}

async function run() {
  defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-iso-pkg-'));
  repoA = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-iso-a-'));
  repoB = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-iso-b-'));
  emptyB = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-iso-empty-b-'));
  fs.writeFileSync(path.join(repoA, 'package.json'), '{"name":"a","private":true}\n');
  fs.writeFileSync(
    path.join(repoA, 'formatLabel.js'),
    "function formatLabel(input){ return input; }\nmodule.exports={formatLabel};\n",
  );

  await bootstrap();
  registerIpc();
  await createWindow();

  await uiEval(`async () => {
    const api = window.digitalMe;
    const d = await api.getDefaultSubjectDir();
    try { await api.invoke('subject.openPackage', { dir: d.dir }); }
    catch { await api.invoke('subject.createPackage', { displayName: 'ISO', targetDir: d.dir }); }
    document.getElementById('nav-work').click();
    document.getElementById('btn-new-task').click();
    return true;
  }`);

  // Task A
  await uiEval(`async () => {
    document.getElementById('goal').value = '修改这个项目中的 formatLabel，使 start 返回 done，并运行测试。';
    document.getElementById('btn-add-folder').click();
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('btn-submit').click();
    await new Promise((r) => setTimeout(r, 400));
    return !document.getElementById('execution-confirm-card').hidden;
  }`);
  check('a_confirm_visible', true);

  await uiEval(`async () => {
    document.getElementById('btn-confirm-execution').click();
    await new Promise((r) => setTimeout(r, 800));
    return true;
  }`);
  await sleep(1500);
  const tasksAfterA = await bus.invoke('work.listTasks', { limit: 10 });
  check('one_task_after_a', tasksAfterA.tasks.length === 1, tasksAfterA);

  const artAfterA = await uiEval(`() => {
    const view = document.getElementById('code-change-view');
    return {
      visible: view && !view.hidden,
      text: (document.getElementById('cc-summary') || {}).textContent || '',
      acceptance: (document.getElementById('cc-acceptance-section') || {}).innerText || '',
    };
  }`);
  check('a_artifact_visible', !!(artAfterA && artAfterA.visible), artAfterA);

  // New task B without folder
  await uiEval(`async () => {
    document.getElementById('btn-new-task').click();
    await new Promise((r) => setTimeout(r, 200));
    document.getElementById('goal').value = '开发一个俄罗斯方块游戏。';
    document.getElementById('btn-submit').click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      empty: (document.getElementById('artifact-empty') || {}).textContent || '',
      emptyHidden: document.getElementById('artifact-empty')
        ? document.getElementById('artifact-empty').hidden
        : true,
      panelHidden: document.getElementById('artifact-panel').hidden,
      codeHidden: document.getElementById('code-change-view').hidden,
      projectCard: !document.getElementById('project-folder-card').hidden,
      projectText: (document.getElementById('project-folder-message') || {}).textContent || '',
      leak: ((document.getElementById('cc-summary') || {}).textContent || '').includes('formatLabel'),
    };
  }`);
  const bNoFolder = await uiEval(`() => ({
    empty: (document.getElementById('artifact-empty') || {}).textContent || '',
    emptyHidden: document.getElementById('artifact-empty')
      ? document.getElementById('artifact-empty').hidden
      : true,
    codeHidden: document.getElementById('code-change-view').hidden,
    projectCard: !document.getElementById('project-folder-card').hidden,
    projectText: (document.getElementById('project-folder-message') || {}).textContent || '',
    leak: ((document.getElementById('cc-summary') || {}).textContent || '').includes('formatLabel'),
  })`);
  check('b_no_a_artifact_leak', bNoFolder.leak === false && bNoFolder.codeHidden === true, bNoFolder);
  check('b_needs_project_folder', bNoFolder.projectCard === true, bNoFolder);
  check('b_project_copy', /项目位置|文件夹/.test(bNoFolder.projectText), bNoFolder);

  const tasksMid = await bus.invoke('work.listTasks', { limit: 10 });
  check('still_one_task_before_b_confirm', tasksMid.tasks.length === 1, tasksMid);

  // 由 Digital Me 创建新项目并运行任务 B
  await uiEval(`async () => {
    const createBtn = document.getElementById('btn-create-new-project');
    if (!createBtn) throw new Error('missing btn-create-new-project');
    createBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    const confirmCreate = document.getElementById('btn-confirm-create-project');
    if (!confirmCreate) throw new Error('missing btn-confirm-create-project');
    confirmCreate.click();
    await new Promise((r) => setTimeout(r, 400));
    document.getElementById('btn-submit').click();
    await new Promise((r) => setTimeout(r, 500));
    if (!document.getElementById('execution-confirm-card').hidden) {
      document.getElementById('btn-confirm-execution').click();
      await new Promise((r) => setTimeout(r, 800));
    }
    return true;
  }`);
  await sleep(1600);

  const tasksAfterB = await bus.invoke('work.listTasks', { limit: 10 });
  check('two_tasks_after_b', tasksAfterB.tasks.length === 2, tasksAfterB);

  const bView = await uiEval(`() => ({
    text: ((document.getElementById('cc-summary') || {}).textContent || '') +
      ((document.getElementById('cc-file-list') || {}).innerText || ''),
    acceptance: (document.getElementById('cc-acceptance-section') || {}).innerText || '',
  })`);
  check('b_has_own_artifact', /tetris|俄罗斯|package\.json/i.test(bView.text), bView);

  // Switch back to A
  await uiEval(`async () => {
    const buttons = Array.from(document.querySelectorAll('#task-list button'));
    const aBtn = buttons.find((b) => /formatLabel|done|start/.test(b.innerText));
    if (aBtn) aBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  }`);
  const aAgain = await uiEval(`() => ({
    text: ((document.getElementById('cc-summary') || {}).textContent || '') +
      ((document.getElementById('cc-file-list') || {}).innerText || ''),
  })`);
  check('switch_back_a', /formatLabel|done/i.test(aAgain.text), aAgain);
  check('switch_back_a_no_tetris', !/tetris/i.test(aAgain.text), aAgain);

  // Switch to B again
  await uiEval(`async () => {
    const buttons = Array.from(document.querySelectorAll('#task-list button'));
    const bBtn = buttons.find((b) => /俄罗斯|tetris/i.test(b.innerText));
    if (bBtn) bBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  }`);
  const bAgain = await uiEval(`() => ({
    text: ((document.getElementById('cc-summary') || {}).textContent || '') +
      ((document.getElementById('cc-file-list') || {}).innerText || ''),
  })`);
  check('switch_back_b', /tetris|package\.json/i.test(bAgain.text), bAgain);

  // Duplicate accept buttons
  const dup = await uiEval(`() => ({
    accept: document.querySelectorAll('#btn-accept-artifact').length,
    collabAccept: document.querySelectorAll('#btn-collab-accept').length,
    restart: (document.getElementById('btn-restart-compose') || {}).textContent || '',
  })`);
  check('single_accept', dup.accept === 1, dup);
  check('no_collab_accept', dup.collabAccept === 0, dup);
  check('restart_is_new_task', /创建新任务/.test(dup.restart), dup);

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

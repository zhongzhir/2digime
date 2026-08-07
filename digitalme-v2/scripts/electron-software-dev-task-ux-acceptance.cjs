/**
 * SOFTWARE-DEVELOPMENT-TASK-UX-01 — Electron 真机/DOM 验收入口。
 * Fake 文档 + hooked 外部执行；覆盖示例、软件项目材料、确认卡、code-change 视图骨架。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_software-dev-task-ux-01-evidence');

/** @type {import('../dist/runtime/digitalme-runtime').DigitalMeRuntime} */
let runtime;
/** @type {import('../dist/runtime/commands').CommandBus} */
let bus;
/** @type {BrowserWindow | null} */
let win = null;
let defaultDir = '';
let fixtureRepo = '';

const report = {
  schemaVersion: 'software-dev-task-ux/1',
  startedAt: new Date().toISOString(),
  checks: [],
  verdict: null,
  ownerManualPath: [
    '打开 Digital Me → 做事',
    '新建任务，输入软件开发目标',
    '添加代码项目文件夹，确认显示「已添加软件项目」',
    '开始处理 → 确认卡 → 确认并开始',
    '查看文件/diff/测试 → 提出修改 → 采用 → 重启仍在',
  ],
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
  fs.writeFileSync(
    path.join(EVIDENCE, 'OWNER_MANUAL.md'),
    [
      '# 软件开发任务 UX — Owner 真机路径',
      '',
      ...report.ownerManualPath.map((x, i) => `${i + 1}. ${x}`),
      '',
      '自动化入口：',
      '',
      '```',
      'npm run accept:software-dev-task-ux',
      '```',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function uiEval(source) {
  return win.webContents.executeJavaScript(`(${source})()`, true);
}

async function waitTerminal(jobId, timeoutMs = 30000) {
  const { waitForJobTerminal } = require('../dist/work-runtime/job-runner');
  return waitForJobTerminal(runtime.workRuntime, jobId, timeoutMs);
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
        const target = path.join(pkg.workingDirectory, 'formatLabel.js');
        const isRev =
          !!(pkg.previousRun && pkg.previousRun.revisionRequest) || /改为 done|done/i.test(prompt);
        const body = isRev
          ? "function formatLabel(input){ return input==='start' ? 'done' : input; }\nmodule.exports={formatLabel};\n"
          : "function formatLabel(input){ return input==='start' ? 'start-processing' : input; }\nmodule.exports={formatLabel};\n";
        await fs.promises.writeFile(target, body, 'utf8');
        return {
          exitCode: 0,
          summary: isRev
            ? '已将 formatLabel 结果改为 done，并同步测试。'
            : '已修改 formatLabel，使 start 返回 start-processing。',
          claimedChangedFiles: ['formatLabel.js'],
          testCommands: ['node -e "require(\'./formatLabel.js\')"'],
          testResults: [
            {
              command: 'node -e "require(\'./formatLabel.js\')"',
              passed: true,
              summary: '通过',
            },
          ],
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
  ipcMain.handle('command:invoke', async (_e, name, input) => {
    if (!allowed.has(name)) throw new Error(`command not exposed: ${name}`);
    return bus.invoke(name, input || {});
  });
  ipcMain.handle('shell:pickOpenFiles', async () => []);
  ipcMain.handle('shell:pickOpenDirectory', async () => fixtureRepo);
  ipcMain.handle('shell:inspectSoftwareProject', async (_e, input) =>
    inspectSoftwareProject(input && input.path ? input.path : fixtureRepo),
  );
  ipcMain.handle('shell:pickSaveDirectory', async () => {
    throw new Error('pickSaveDirectory must not be required');
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
  ipcMain.handle('shell:testRemoteCapability', async () => ({ ok: false }));
  ipcMain.handle('shell:saveRemoteCapability', async () => ({ ok: true }));
  ipcMain.handle('shell:disableRemoteCapability', async () => ({ ok: true }));
  ipcMain.handle('shell:conversationList', async () => ({ messages: [] }));
  ipcMain.handle('shell:conversationAppend', async () => ({ ok: true }));
  ipcMain.handle('shell:conversationClear', async () => ({ ok: true }));
  ipcMain.handle('shell:conversationReply', async () => ({ text: '' }));
  ipcMain.handle('shell:conversationGrowthHint', async () => ({ hint: null }));
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
  await sleep(800);
}

async function run() {
  defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-sd-ux-pkg-'));
  fixtureRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-sd-ux-repo-'));
  fs.writeFileSync(path.join(fixtureRepo, 'package.json'), '{"name":"fixture","private":true}\n');
  fs.writeFileSync(
    path.join(fixtureRepo, 'formatLabel.js'),
    "function formatLabel(input){ return input; }\nmodule.exports={formatLabel};\n",
  );

  await bootstrap();
  registerIpc();
  await createWindow();

  // 打开默认主体并进入做事
  await uiEval(`async () => {
    const api = window.digitalMe;
    const d = await api.getDefaultSubjectDir();
    try { await api.invoke('subject.openPackage', { dir: d.dir }); }
    catch { await api.invoke('subject.createPackage', { displayName: 'SD-UX', targetDir: d.dir }); }
    const nav = document.getElementById('nav-work');
    if (nav) nav.click();
    const neu = document.getElementById('btn-new-task');
    if (neu) neu.click();
    return true;
  }`);

  const placeholder = await uiEval(`() => {
    const g = document.getElementById('goal');
    return g ? g.getAttribute('placeholder') || '' : '';
  }`);
  check('goal_placeholder', /修改软件项目/.test(placeholder), { placeholder });

  const examples = await uiEval(`() => {
    return Array.from(document.querySelectorAll('[data-goal-example]')).map((b) => b.getAttribute('data-goal-example'));
  }`);
  check('goal_examples', examples.length === 3, { examples });

  await uiEval(`() => {
    const btn = document.querySelector('[data-goal-example]');
    if (btn) btn.click();
    return document.getElementById('goal').value;
  }`);
  const filled = await uiEval(`() => document.getElementById('goal').value`);
  check('example_fills_goal_without_start', /登录页/.test(filled), { filled });

  await uiEval(`async () => {
    document.getElementById('goal').value = '修改这个项目中的 formatLabel，使输入 start 时返回 start-processing，并运行测试。';
    document.getElementById('btn-add-folder').click();
    await new Promise((r) => setTimeout(r, 200));
    return document.getElementById('material-list').innerText;
  }`);
  const materialsText = await uiEval(`() => document.getElementById('material-list').innerText`);
  check('software_project_label', /已添加软件项目/.test(materialsText), { materialsText });

  await uiEval(`async () => {
    document.getElementById('btn-submit').click();
    await new Promise((r) => setTimeout(r, 300));
    return !document.getElementById('execution-confirm-card').hidden;
  }`);
  const confirmVisible = await uiEval(
    `() => !document.getElementById('execution-confirm-card').hidden`,
  );
  check('execution_confirm_visible', confirmVisible === true);

  const confirmTitle = await uiEval(
    `() => document.getElementById('execution-confirm-title').textContent`,
  );
  check('confirm_title', /修改项目文件/.test(confirmTitle), { confirmTitle });

  const leak = await uiEval(`() => {
    const card = document.getElementById('execution-confirm-card').innerText;
    return /(queued|adapter|executorRunId|artifactType|CapabilityId)/i.test(card);
  }`);
  check('no_internal_leak_on_confirm', leak === false);

  const started = await uiEval(`async () => {
    document.getElementById('btn-confirm-execution').click();
    await new Promise((r) => setTimeout(r, 400));
    return true;
  }`);
  check('confirm_start_clicked', started === true);

  // 等待任务完成
  await sleep(1200);
  const tasks = await bus.invoke('work.listTasks', { limit: 5 });
  const taskId = tasks.tasks && tasks.tasks[0] && tasks.tasks[0].taskId;
  check('task_created', !!taskId, { tasks });
  const detail = await bus.invoke('work.getTask', { taskId });
  if (detail.latestJob && (detail.latestJob.status === 'queued' || detail.latestJob.status === 'running')) {
    await waitTerminal(detail.latestJob.jobId, 20000);
  }
  const after = await bus.invoke('work.getTask', { taskId });
  check('job_succeeded', after.latestJob && after.latestJob.status === 'succeeded', {
    status: after.latestJob && after.latestJob.status,
  });

  await uiEval(`async () => {
    // 重新选中任务以刷新成果
    const first = document.querySelector('#task-list button');
    if (first) first.click();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  }`);

  const cc = await uiEval(`() => {
    const view = document.getElementById('code-change-view');
    return {
      visible: view && !view.hidden,
      summary: (document.getElementById('cc-summary') || {}).textContent || '',
      files: (document.getElementById('cc-file-list') || {}).innerText || '',
      hasDiff: !!((document.getElementById('cc-diff') || {}).textContent || '').trim(),
    };
  }`);
  check('code_change_view', !!(cc && cc.visible), cc);
  check('code_change_files', /formatLabel/.test((cc && cc.files) || ''), cc);

  const decisionUi = await uiEval(`() => {
    const propose = document.getElementById('btn-propose-revision');
    const accept = document.getElementById('btn-accept-artifact');
    const reject = document.getElementById('btn-reject-artifact');
    const noteLabel = (document.getElementById('artifact-decision-note-field') || {}).innerText || '';
    const reviseBoxes = document.querySelectorAll('#btn-accept-artifact, #btn-reject-artifact');
    return {
      propose: propose ? propose.textContent : '',
      accept: !!accept,
      reject: !!reject,
      noteLabel,
      acceptCount: document.querySelectorAll('#btn-accept-artifact').length,
      rejectCount: document.querySelectorAll('#btn-reject-artifact').length,
      composerHidden: document.getElementById('revision-composer').hidden,
    };
  }`);
  check('propose_revision_visible', /提出修改/.test(decisionUi.propose || ''), decisionUi);
  check('single_accept_reject_pair', decisionUi.acceptCount === 1 && decisionUi.rejectCount === 1, decisionUi);
  check('decision_note_label', /采用或不采用说明/.test(decisionUi.noteLabel || ''), decisionUi);

  // 不采用不得打开修订或触发 reviseArtifact
  const rejectOnly = await uiEval(`async () => {
    document.getElementById('artifact-decision-note').value = '这次先不用';
    document.getElementById('btn-reject-artifact').click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      status: document.getElementById('artifact-decision-status').textContent,
      composerHidden: document.getElementById('revision-composer').hidden,
      revisionValue: document.getElementById('revision-request').value,
    };
  }`);
  check('reject_does_not_open_revision', rejectOnly.composerHidden === true, rejectOnly);
  check('reject_note_not_copied_to_revision', !(rejectOnly.revisionValue || '').trim(), rejectOnly);
  check('reject_status_mentions_propose', /提出修改/.test(rejectOnly.status || ''), rejectOnly);

  // 修订
  await uiEval(`async () => {
    document.getElementById('btn-propose-revision').click();
    await new Promise((r) => setTimeout(r, 100));
    document.getElementById('revision-request').value = '将结果改为 done，并同步更新测试。';
    document.getElementById('btn-revise').click();
    await new Promise((r) => setTimeout(r, 400));
    return true;
  }`);
  await sleep(1500);
  const afterRev = await bus.invoke('work.getTask', { taskId });
  if (
    afterRev.latestJob &&
    (afterRev.latestJob.status === 'queued' || afterRev.latestJob.status === 'running')
  ) {
    await waitTerminal(afterRev.latestJob.jobId, 20000);
  }
  const revDone = await bus.invoke('work.getTask', { taskId });
  check('revise_succeeded', revDone.latestJob && revDone.latestJob.status === 'succeeded', {
    status: revDone.latestJob && revDone.latestJob.status,
  });
  const artifactId = revDone.artifactIds && revDone.artifactIds[0];
  check('same_artifact_chain', !!artifactId && revDone.artifactIds.length === 1, {
    artifactIds: revDone.artifactIds,
  });

  // 采用
  await uiEval(`async () => {
    const first = document.querySelector('#task-list button');
    if (first) first.click();
    await new Promise((r) => setTimeout(r, 400));
    document.getElementById('btn-accept-artifact').click();
    await new Promise((r) => setTimeout(r, 400));
    return document.getElementById('artifact-decision-status').textContent;
  }`);
  const decision = await uiEval(
    `() => document.getElementById('artifact-decision-status').textContent`,
  );
  check('accepted', /已采用/.test(decision || ''), { decision });

  // 重启模拟：重开包再读任务
  const rt2 = require('../dist/runtime/digitalme-runtime').createDigitalMeRuntime({
    documentCapability: 'fake',
    codeAnalysisCapability: 'none',
    externalExecutorCapability: { executeHook: async () => ({ exitCode: 0, summary: 'noop', claimedChangedFiles: [] }) },
  });
  await rt2.openPackage({ dir: defaultDir });
  const restarted = await rt2.getTask({ taskId });
  check(
    'restart_persists',
    restarted.artifactIds && restarted.artifactIds.length > 0 && restarted.latestJob,
    { artifactIds: restarted.artifactIds },
  );

  const body = fs.readFileSync(path.join(fixtureRepo, 'formatLabel.js'), 'utf8');
  check('file_changed_to_done', /done/.test(body), { body: body.slice(0, 200) });

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

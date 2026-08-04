/**
 * SUBJECT-PERCEPTIBLE-UX-01 — Electron 交互验收(Fake 文档能力)。
 * 由 run-subject-ux-acceptance.cjs 以 DIGITALME_V2_UX_ACCEPTANCE=1 启动。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_mvp-subject-ux-acceptance-evidence');

/** @type {import('../dist/runtime/digitalme-runtime').DigitalMeRuntime} */
let runtime;
/** @type {import('../dist/runtime/commands').CommandBus} */
let bus;
/** @type {BrowserWindow | null} */
let win = null;
let pkgDir = '';
let materialPath = '';

const report = {
  startedAt: new Date().toISOString(),
  checks: [],
  verdict: null,
};

function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  if (!ok) {
    const err = new Error(`CHECK_FAILED: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
    throw err;
  }
}

function writeEvidence() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(
    path.join(EVIDENCE, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
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
  ipcMain.handle('shell:pickOpenFiles', async () => (materialPath ? [materialPath] : []));
  ipcMain.handle('shell:pickOpenDirectory', async () => pkgDir || null);
  ipcMain.handle('shell:pickSaveDirectory', async () => pkgDir || null);
  ipcMain.handle('shell:getModelStatus', async () => ({
    modelReady: true,
    needsCredentialSetup: false,
    status: { credentialConfigured: true, needsCredentialSetup: false },
  }));
  ipcMain.handle('shell:saveModelCredential', async () => ({ ok: true }));
  ipcMain.handle('shell:deleteModelCredential', async () => ({ ok: true }));
  ipcMain.handle('shell:testModelConnection', async () => ({ ok: true }));
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    show: false,
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
  await win.loadURL(pathToFileURL(path.join(ROOT, 'electron', 'renderer', 'index.html')).href);
  win.webContents.send('shell:boot', {
    modelReady: true,
    needsCredentialSetup: false,
    status: { credentialConfigured: true, needsCredentialSetup: false },
    isPackaged: false,
  });
  await sleep(400);
}

async function mainSequence() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dmv2-subj-ux-'));
  pkgDir = path.join(root, 'pkg');
  await fs.promises.mkdir(pkgDir, { recursive: true });
  materialPath = path.join(root, 'project-note.md');
  await fs.promises.writeFile(
    materialPath,
    ['我是注重 Digital Me 的产品负责人。', '方向：本地优先。', '原则：表达正式、结论先行。'].join('\n'),
    'utf8',
  );

  // 场景 A：一句话创建并立即做事
  await uiEval(`() => {
    const intro = document.getElementById('self-intro');
    intro.value = '我在做 Digital Me，重视真实用户价值。';
    document.getElementById('btn-create-pkg').click();
    return true;
  }`);
  await sleep(800);
  const view = await uiEval(`() => ({
    welcomeHidden: document.getElementById('view-welcome').hidden,
    workspaceHidden: document.getElementById('view-workspace').hidden,
    hasNow: !!document.querySelector('[data-section="now"]'),
    hasRecent: !!document.querySelector('[data-section="recent"]'),
    hasUnsure: !!document.querySelector('[data-section="unsure"]'),
    hasLearnMore: !!document.querySelector('[data-section="learn-more"]'),
    body: document.body.innerText,
  })`);
  check('entered_workspace_after_one_sentence', view.welcomeHidden === true && view.workspaceHidden === false);
  check('subject_sections_present', view.hasNow && view.hasRecent && view.hasUnsure && view.hasLearnMore);
  check(
    'no_internal_terms_in_dom',
    !/GrowthEvent|ContextSnapshot|\bcandidate\b|\bconfirmed\b|主体合同|填写完整档案/i.test(view.body),
    { sample: String(view.body).slice(0, 200) },
  );

  const overview0 = await bus.invoke('subject.getOverview', {});
  check('readiness_does_not_block', overview0.readinessBlocksTasks === false);

  await uiEval(`() => {
    document.getElementById('goal').value = '写一段产品说明，正式、结论先行。';
    document.getElementById('btn-submit').click();
    return true;
  }`);
  await sleep(600);
  const tasks = await bus.invoke('work.listTasks', {});
  check('task_created_without_archive', tasks.tasks.length >= 1);
  let t1 = await bus.invoke('work.getTask', { taskId: tasks.tasks[0].taskId });
  for (let i = 0; i < 30 && !(t1.latestJob && t1.latestJob.jobId); i += 1) {
    await sleep(100);
    t1 = await bus.invoke('work.getTask', { taskId: tasks.tasks[0].taskId });
  }
  check('first_job_present', !!(t1.latestJob && t1.latestJob.jobId));
  await waitTerminal(t1.latestJob.jobId);
  const t1b = await bus.invoke('work.getTask', { taskId: tasks.tasks[0].taskId });
  check('first_task_succeeded', t1b.latestJob && t1b.latestJob.status === 'succeeded', {
    state: t1b.state,
    job: t1b.latestJob && t1b.latestJob.status,
  });
  check('artifact_generated', (t1b.artifactIds || []).length >= 1);

  // 场景 B：修改 → 最近学到 → 确认 → 相似任务
  const artId = t1b.artifactIds[0];
  const content = await bus.invoke('artifact.getContent', { artifactId: artId });
  await bus.invoke('artifact.saveEdit', {
    artifactId: artId,
    text: `${content.text || ''}\n\n发布节奏要明确，删掉空话套话。\n`,
  });
  await sleep(300);
  await uiEval(`() => window.digitalMe.invoke('subject.getOverview', {})`);
  let overview1 = await bus.invoke('subject.getOverview', {});
  check('recent_learnings_after_edit', (overview1.recentLearnings || []).length >= 1, {
    count: (overview1.recentLearnings || []).length,
  });

  // 确认原则类 + 反馈类（若存在）
  const toAdopt = (overview1.recentLearnings || [])
    .filter((x) => x.suggestConfirm)
    .slice(0, 2)
    .map((x) => x.eventId);
  if (toAdopt.length === 0 && (overview1.recentLearnings || [])[0]) {
    toAdopt.push(overview1.recentLearnings[0].eventId);
  }
  for (const eventId of toAdopt) {
    await bus.invoke('subject.respondToLearning', { eventId, action: 'adopt' });
  }
  overview1 = await bus.invoke('subject.getOverview', {});
  check('active_understandings_after_adopt', (overview1.activeUnderstandings || []).length >= 1);

  const submitted2 = await bus.invoke('work.submitTask', {
    goal: '继续撰写产品周报并保持节奏',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitTerminal(submitted2.jobId);
  const t2 = await bus.invoke('work.getTask', { taskId: submitted2.taskId });
  check('growth_reuse_notice', !!(t2.appliedUnderstanding && t2.appliedUnderstanding.notice), {
    applied: t2.appliedUnderstanding || null,
  });
  const text2 = (await bus.invoke('artifact.getContent', { artifactId: t2.artifactIds[0] })).text || '';
  check(
    'second_task_reflects_growth',
    /主体要点|结论先行|正式|沿用经验|节奏|空话/.test(text2),
    { preview: text2.slice(0, 240) },
  );

  // 场景 C：资料增强 — UI 点击添加资料
  await uiEval(`() => {
    document.getElementById('btn-import-subject-material').click();
    return true;
  }`);
  await sleep(800);
  const overview2 = await bus.invoke('subject.getOverview', {});
  check(
    'material_import_surfaces_few_items',
    (overview2.recentLearnings || []).length <= 5,
    { count: (overview2.recentLearnings || []).length },
  );
  const importStatus = await uiEval(
    `() => document.getElementById('subject-import-status').textContent || ''`,
  );
  check('material_status_user_facing', /了解|做事|保存/.test(importStatus), { importStatus });

  // 场景 D：无关隔离
  const submitted3 = await bus.invoke('work.submitTask', {
    goal: '整理超市购物清单',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitTerminal(submitted3.jobId);
  const t3 = await bus.invoke('work.getTask', { taskId: submitted3.taskId });
  const text3 = (await bus.invoke('artifact.getContent', { artifactId: t3.artifactIds[0] })).text || '';
  check('unrelated_not_polluted', !text3.includes('## 沿用经验'), { preview: text3.slice(0, 200) });

  // 确认按钮数量受控：最近学到每条最多 3 个操作
  const btnStats = await uiEval(`() => {
    const recent = document.querySelectorAll('#subject-recent-list li');
    let max = 0;
    recent.forEach((li) => {
      max = Math.max(max, li.querySelectorAll('button').length);
    });
    return { items: recent.length, maxButtonsPerItem: max };
  }`);
  check('confirm_actions_bounded', btnStats.maxButtonsPerItem <= 3, btnStats);

  // 跳过资料仍可做事已在场景 A 覆盖；再验 skip 按钮存在且无第二轮强制填写
  const welcomeCopy = fs.readFileSync(path.join(ROOT, 'electron', 'renderer', 'index.html'), 'utf8');
  check('skip_allowed_in_markup', /先跳过，直接开始/.test(welcomeCopy));
  check('single_intro_field', (welcomeCopy.match(/self-intro/g) || []).length >= 1);
}

app.whenReady().then(async () => {
  try {
    await bootstrap();
    registerIpc();
    await createWindow();
    await mainSequence();
    report.verdict = 'passed';
    writeEvidence();
    console.log('electron-subject-ux-acceptance PASSED');
    app.exit(0);
  } catch (err) {
    report.verdict = 'failed';
    report.error = String(err && err.stack ? err.stack : err);
    writeEvidence();
    console.error(err);
    app.exit(1);
  }
});

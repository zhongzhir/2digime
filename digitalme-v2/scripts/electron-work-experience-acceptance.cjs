/**
 * EXPERIENCE-REDESIGN-01B-B2 — Electron 做事工作台视觉/DOM 验收。
 * Fake 文档能力；覆盖空态、长目标、材料摘要、处理中、成果、小窗口切换。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_work-experience-b2-evidence');

/** @type {import('../dist/runtime/digitalme-runtime').DigitalMeRuntime} */
let runtime;
/** @type {import('../dist/runtime/commands').CommandBus} */
let bus;
/** @type {BrowserWindow | null} */
let win = null;
let defaultDir = '';
let matFile = '';
let matFolder = '';

const report = { startedAt: new Date().toISOString(), checks: [], verdict: null };

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
    fakeAdapter: { delayMs: 1800 },
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
}

async function createWindow(width, height) {
  if (win && !win.isDestroyed()) {
    win.destroy();
    win = null;
  }
  win = new BrowserWindow({
    width,
    height,
    show: false,
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
  await sleep(500);
}

async function waitUi(predicateSource, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = await uiEval(predicateSource);
    if (hit) return hit;
    await sleep(120);
  }
  throw new Error(`UI wait timeout: ${predicateSource}`);
}

async function enterShell(opts = {}) {
  const preferAuto = !!opts.preferAuto;
  if (!preferAuto) {
    await uiEval(`() => {
      const welcome = document.getElementById('view-welcome');
      if (welcome && !welcome.hidden) {
        document.getElementById('self-intro').value = '我在做 Digital Me 做事工作台验收。';
        document.getElementById('btn-create-pkg').click();
      }
      return true;
    }`);
  }
  await waitUi(`() => {
    const shell = document.getElementById('view-shell');
    const welcome = document.getElementById('view-welcome');
    return shell && !shell.hidden && welcome && welcome.hidden;
  }`, 12000);
  await sleep(400);
  const shell = await uiEval(`() => ({
    welcomeHidden: document.getElementById('view-welcome').hidden,
    shellHidden: document.getElementById('view-shell').hidden,
    workVisible: document.getElementById('panel-work')?.hidden === false,
    workActive: document.getElementById('nav-work')?.classList.contains('active'),
    labels: [...document.querySelectorAll('.main-nav .nav-item')].map((b) => b.textContent.trim()),
  })`);
  check('entered_work_landing', shell.welcomeHidden && !shell.shellHidden && shell.workVisible && shell.workActive);
  check('nav_still_four', shell.labels.join('|') === '做事|对话|数字之我|协作', shell);
}

async function mainSequence() {
  const root = path.join(os.tmpdir(), `dmv2-work-exp-b2-${Date.now()}`);
  defaultDir = path.join(root, 'default-subject');
  fs.mkdirSync(defaultDir, { recursive: true });
  matFile = path.join(root, 'note.md');
  matFolder = path.join(root, 'folder');
  fs.mkdirSync(matFolder, { recursive: true });
  fs.writeFileSync(matFile, '材料正文：项目进展与风险。', 'utf8');
  fs.writeFileSync(path.join(matFolder, 'a.md'), '纳入文件 A', 'utf8');
  fs.writeFileSync(path.join(matFolder, 'skip.bin'), Buffer.alloc(8), 'utf8');
  for (let i = 0; i < 12; i += 1) {
    fs.writeFileSync(path.join(matFolder, `extra-${i}.md`), `材料 ${i}`, 'utf8');
  }

  await createWindow(1440, 900);
  await enterShell();

  // 1) 空白新任务：目标为大输入焦点
  const blank = await uiEval(`() => {
    const goal = document.getElementById('goal');
    const cs = getComputedStyle(goal);
    return {
      composeFocus: document.getElementById('panel-work')?.classList.contains('work-compose-focus'),
      goalOpen: document.getElementById('goal-details')?.open === true,
      minHeight: parseFloat(cs.minHeight) || goal.getBoundingClientRect().height,
      artifactHidden: document.getElementById('artifact-panel')?.hidden === true,
      collabHidden: document.getElementById('collab-box')?.hidden === true,
      assistLabels: [
        document.getElementById('btn-collab-open')?.textContent.trim(),
        document.getElementById('btn-external-cap-open')?.textContent.trim(),
      ],
      keepArtifact: !!document.getElementById('btn-chat-keep-artifact'),
    };
  }`);
  check('blank_compose_focus', blank.composeFocus && blank.goalOpen && blank.minHeight >= 200, blank);
  check('blank_artifact_quiet', blank.artifactHidden === true, blank);
  check('blank_collab_hidden_until_task', blank.collabHidden === true, blank);
  check('assist_labels_light', blank.assistLabels.join('|') === '请人帮忙|用专业能力', blank);
  check('no_keep_artifact', blank.keepArtifact === false);

  // 2) 长目标 + 文件/文件夹
  const longGoal = `${'请根据材料撰写一份完整项目进展简报，覆盖背景、进展、风险、下一步。'.repeat(30)}\n\n补充：字数超过一千字的长目标验收。`;
  check('long_goal_over_1000', longGoal.length > 1000, { len: longGoal.length });

  await win.webContents.executeJavaScript(
    `(() => { document.getElementById('goal').value = ${JSON.stringify(longGoal)}; return true; })()`,
    true,
  );
  await uiEval(`() => { document.getElementById('btn-add-files').click(); return true; }`);
  await sleep(200);
  await uiEval(`() => { document.getElementById('btn-add-folder').click(); return true; }`);
  await sleep(200);
  const mats = await uiEval(`() => ({
    summary: document.getElementById('material-list-summary')?.textContent || '',
    count: document.querySelectorAll('#material-list li').length,
    listMax: getComputedStyle(document.getElementById('material-list')).maxHeight,
  })`);
  check('materials_added', mats.count >= 2 && /已添加/.test(mats.summary), mats);
  check('materials_list_capped', !!mats.listMax && mats.listMax !== 'none', mats);

  // 3) 开始处理 → 处理中状态稳定
  await uiEval(`() => { document.getElementById('btn-submit').click(); return true; }`);
  const processing = await waitUi(`() => {
    const text = document.getElementById('job-status')?.textContent || '';
    return /处理|排队|进行/.test(text) ? text : false;
  }`, 8000);
  check('processing_status_user_facing', typeof processing === 'string' && !/jobId|Job ID|状态机/i.test(processing), {
    processing,
  });
  const mid = await uiEval(`() => ({
    goalReadonly: document.getElementById('goal')?.readOnly === true,
    assistVisible: document.getElementById('collab-box')?.hidden === false,
    rail: !!document.getElementById('work-status-rail'),
    bodyHasJobId: /jobId|Job ID/i.test(document.body.innerText),
  })`);
  check('processing_layout_stable_markers', mid.goalReadonly && mid.assistVisible && mid.rail, mid);
  check('no_jobid_leak_during_run', mid.bodyHasJobId === false, mid);

  // wait success
  const tasks = await bus.invoke('work.listTasks', { limit: 5 });
  const taskId = tasks.tasks && tasks.tasks[0] && tasks.tasks[0].taskId;
  check('task_created', !!taskId, tasks);
  const detail = await bus.invoke('work.getTask', { taskId });
  const jobId = detail.latestJob && detail.latestJob.jobId;
  check('job_created', !!jobId, detail);
  await waitTerminal(jobId, 40000);
  await sleep(800);

  const done = await waitUi(`() => {
    const panel = document.getElementById('artifact-panel');
    const editor = document.getElementById('artifact-editor');
    if (!panel || panel.hidden) return false;
    return {
      hasArtifactClass: document.querySelector('#panel-work .work-layout')?.classList.contains('has-artifact'),
      goalCollapsed: document.getElementById('goal-details')?.open === false,
      goalKept: (document.getElementById('goal')?.value || '').length > 1000,
      reviseSummary: document.querySelector('#revise-box > summary')?.textContent || '',
      reviseOpen: document.getElementById('revise-box')?.open === true,
      materialSummary: document.getElementById('material-summary-line')?.textContent || '',
      decision: document.getElementById('artifact-decision-status')?.textContent || '',
      editorLen: (editor?.value || '').length,
      assist: [
        document.getElementById('btn-collab-open')?.textContent.trim(),
        document.getElementById('btn-external-cap-open')?.textContent.trim(),
      ],
    };
  }`, 15000);

  check('artifact_visible_primary', done.hasArtifactClass === true && done.editorLen > 0, done);
  check('goal_collapsed_but_kept', done.goalCollapsed === true && done.goalKept === true, done);
  check('revise_not_competing_open', done.reviseOpen === false && /用说明修改/.test(done.reviseSummary), done);
  check('material_summary_present', /已读取|暂未纳入|文件/.test(done.materialSummary) || done.materialSummary.length > 0, done);
  check('assist_still_light', done.assist.join('|') === '请人帮忙|用专业能力', done);

  // 4) 采用成果（先于协作轻入口，避免跳转协作页后成果面不可点）
  await uiEval(`() => { document.getElementById('btn-accept-artifact').click(); return true; }`);
  await sleep(900);
  const accepted = await uiEval(`() => ({
    status: document.getElementById('artifact-decision-status')?.textContent || '',
    err: document.getElementById('artifact-decision-error')?.textContent || '',
    errHidden: document.getElementById('artifact-decision-error')?.hidden === true,
    disabled: document.getElementById('btn-accept-artifact')?.disabled === true,
  })`);
  check('accept_artifact', /已采用/.test(accepted.status), accepted);

  // 5) 轻入口携带上下文 → 协作向导
  await uiEval(`() => { document.getElementById('btn-collab-open').click(); return true; }`);
  await sleep(300);
  const ctx = await uiEval(`() => ({
    panelCollab: document.getElementById('panel-collab')?.hidden === false,
    pageNew: document.getElementById('collab-page-new')?.hidden === false,
    subtaskLen: (document.getElementById('collab-page-subtask')?.value || '').length,
    materials: Array.from(document.querySelectorAll('#collab-page-material-checks input[type=checkbox]')).map(
      (el) => el.checked,
    ),
    workFormGone: !document.getElementById('collab-form'),
  })`);
  check(
    'assist_opens_collab_wizard_with_task_context',
    ctx.panelCollab && ctx.pageNew && ctx.subtaskLen > 40 && ctx.workFormGone,
    ctx,
  );
  check('assist_materials_not_auto_checked', ctx.materials.every((c) => c === false), ctx);

  // 回到做事页继续布局验收
  await uiEval(`() => { document.getElementById('nav-work')?.click(); return true; }`);
  await sleep(400);

  // 6) 常用窗口下成果可滚动
  const scrollDesk = await uiEval(`() => {
    const side = document.querySelector('.artifact-side');
    const body = document.querySelector('.artifact-body');
    const ed = document.getElementById('artifact-editor');
    return {
      sideOverflow: side ? getComputedStyle(side).overflow : '',
      bodyOverflow: body ? getComputedStyle(body).overflowY || getComputedStyle(body).overflow : '',
      editorHeight: ed ? ed.getBoundingClientRect().height : 0,
    };
  }`);
  check(
    'desktop_artifact_readable',
    scrollDesk.editorHeight >= 200 && (scrollDesk.sideOverflow !== 'visible' || scrollDesk.bodyOverflow !== 'visible'),
    scrollDesk,
  );

  // 7) 较小窗口：任务/成果切换
  win.setSize(900, 720);
  await sleep(300);
  const small = await uiEval(`() => {
    document.querySelector('[data-work-stage="artifact"]')?.click();
    const layout = document.querySelector('#panel-work .work-layout');
    return {
      stage: layout?.dataset.stage,
      tabsVisible: document.getElementById('work-stage-tabs')?.hidden === false,
      mainHidden: getComputedStyle(document.getElementById('work-main')).display === 'none',
      artifactShown: getComputedStyle(document.getElementById('artifact-panel')).display !== 'none',
      toggleTasks: !!document.getElementById('btn-work-toggle-tasks'),
    };
  }`);
  check('small_window_stage_switch', small.stage === 'artifact' && small.mainHidden && small.artifactShown, small);
  check('small_window_tabs_or_toggle', small.tabsVisible === true || small.toggleTasks === true, small);

  await uiEval(`() => {
    document.querySelector('[data-work-stage="center"]')?.click();
    return true;
  }`);
  await sleep(150);
  const backCenter = await uiEval(`() => document.querySelector('#panel-work .work-layout')?.dataset.stage`);
  check('small_window_back_to_center', backCenter === 'center', { backCenter });

  // 8) 重新开始保留目标材料
  await uiEval(`() => {
    const btn = document.getElementById('btn-restart-compose');
    if (btn && !btn.hidden) btn.click();
    return true;
  }`);
  await sleep(300);
  const restarted = await uiEval(`() => ({
    modeTitle: document.getElementById('work-compose-title')?.textContent || '',
    goalLen: (document.getElementById('goal')?.value || '').length,
    goalEditable: document.getElementById('goal')?.readOnly === false,
    mats: document.querySelectorAll('#material-list li').length,
    artifactHidden: document.getElementById('artifact-panel')?.hidden === true,
  })`);
  check(
    'restart_keeps_goal_materials',
    /新建任务/.test(restarted.modeTitle) &&
      restarted.goalLen > 1000 &&
      restarted.goalEditable &&
      restarted.mats >= 2 &&
      restarted.artifactHidden,
    restarted,
  );

  // 9) 重启恢复：重载页面后选任务仍有成果（同进程模拟重启）
  const listBefore = await bus.invoke('work.listTasks', { limit: 5 });
  const restoreId = listBefore.tasks && listBefore.tasks[0] && listBefore.tasks[0].taskId;
  check('task_persists_for_restore', !!restoreId, listBefore);

  await win.loadURL(pathToFileURL(path.join(ROOT, 'electron', 'renderer', 'index.html')).href);
  win.webContents.send('shell:boot', {
    modelReady: true,
    needsCredentialSetup: false,
    status: { credentialConfigured: true, needsCredentialSetup: false },
    isPackaged: false,
  });
  await sleep(600);
  await enterShell({ preferAuto: true });
  await uiEval(`() => {
    const btn = document.querySelector('#task-list button.linkish');
    if (btn) btn.click();
    return !!btn;
  }`);
  await sleep(800);
  const restored = await waitUi(`() => {
    const panel = document.getElementById('artifact-panel');
    if (!panel || panel.hidden) return false;
    return {
      goalLen: (document.getElementById('goal')?.value || '').length,
      decision: document.getElementById('artifact-decision-status')?.textContent || '',
      editorLen: (document.getElementById('artifact-editor')?.value || '').length,
    };
  }`, 12000);
  check('restart_restores_task_and_artifact', restored.goalLen > 1000 && restored.editorLen > 0, restored);

  report.verdict = 'passed';
  console.log('\nelectron-work-experience-acceptance PASSED');
}

app.whenReady().then(async () => {
  try {
    await bootstrap();
    registerIpc();
    runtime.eventBus.subscribe((event) => {
      if (win && !win.isDestroyed()) win.webContents.send('domain:event', event);
    });
    await mainSequence();
    writeEvidence();
    app.exit(0);
  } catch (err) {
    report.verdict = 'failed';
    report.error = err && err.message ? err.stack || err.message : String(err);
    writeEvidence();
    console.error(err);
    app.exit(1);
  }
});

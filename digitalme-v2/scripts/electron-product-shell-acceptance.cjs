/**
 * PRODUCT-SHELL-REALIGNMENT-01-FIX — Electron 交互验收(Fake 文档 + 可取消长任务)。
 * 壳层与任务隔离以 UI 断言；Job 执行经 CommandBus，降低 Windows 文件锁竞态。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_mvp-product-shell-acceptance-evidence');

/** @type {import('../dist/runtime/digitalme-runtime').DigitalMeRuntime} */
let runtime;
/** @type {import('../dist/runtime/commands').CommandBus} */
let bus;
/** @type {BrowserWindow | null} */
let win = null;
let defaultDir = '';

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
    fakeAdapter: { delayMs: 2500 },
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

async function createWindow() {
  win = new BrowserWindow({
    width: 1920,
    height: 1080,
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
  await sleep(500);
}

async function waitUi(predicateSource, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = await uiEval(predicateSource);
    if (hit) return hit;
    await sleep(120);
  }
  throw new Error(`UI wait timeout: ${predicateSource}`);
}

async function mainSequence() {
  defaultDir = path.join(os.tmpdir(), `dmv2-product-shell-${Date.now()}`, 'default-subject');
  fs.mkdirSync(path.dirname(defaultDir), { recursive: true });

  await uiEval(`() => {
    document.getElementById('self-intro').value = '我在做 Digital Me。';
    document.getElementById('btn-create-pkg').click();
    return true;
  }`);
  await sleep(1000);

  const shell = await uiEval(`() => ({
    welcomeHidden: document.getElementById('view-welcome').hidden,
    shellHidden: document.getElementById('view-shell').hidden,
    navSubject: !!document.getElementById('nav-subject'),
    navWork: !!document.getElementById('nav-work'),
    navChat: !!document.getElementById('nav-chat'),
    navCollab: !!document.getElementById('nav-collab'),
    help: !!document.getElementById('btn-open-help'),
    settings: !!document.getElementById('btn-open-settings'),
    settingsInMainNav: !!document.querySelector('.main-nav #btn-open-settings'),
    settingsInSecondary: !!document.querySelector('.topbar-actions #btn-open-settings'),
    helpInSecondary: !!document.querySelector('.topbar-actions #btn-open-help'),
    labels: [...document.querySelectorAll('.main-nav .nav-item')].map((b) => b.textContent.trim()),
    workActive: document.getElementById('nav-work')?.classList.contains('active') === true,
    workVisible: document.getElementById('panel-work')?.hidden === false,
    keepArtifact: !!document.getElementById('btn-chat-keep-artifact'),
    newTask: !!document.getElementById('btn-new-task'),
    body: document.body.innerText,
  })`);
  check('entered_shell_without_folder_picker', shell.welcomeHidden === true && shell.shellHidden === false);
  check(
    'four_primary_nav_entries',
    shell.navSubject && shell.navWork && shell.navChat && shell.navCollab && shell.settings,
    shell,
  );
  check('settings_not_in_primary_nav', shell.settingsInMainNav === false, shell);
  check('settings_help_secondary', shell.settingsInSecondary === true && shell.helpInSecondary === true, shell);
  check(
    'nav_order_work_chat_subject_collab',
    shell.labels.join('|') === '做事|对话|数字之我|协作',
    shell,
  );
  check('default_landing_work', shell.workActive === true && shell.workVisible === true, shell);
  check('no_chat_keep_artifact_shell', shell.keepArtifact === false, shell);
  check('help_aux_present', shell.help === true);
  check('new_task_button_present', shell.newTask === true);
  check(
    'no_forbidden_learning_copy',
    !/最近学到|还不确定|使用了什么|已结合你之前确认的内容|让数字之我更了解你|GrowthEvent|ContextSnapshot/i.test(
      shell.body,
    ),
  );

  await uiEval(`() => { document.getElementById('nav-subject').click(); return true; }`);
  await sleep(200);
  const subjectView = await uiEval(`() => ({
    subjectHidden: document.getElementById('panel-subject').hidden,
    workHidden: document.getElementById('panel-work').hidden,
    title: document.querySelector('#panel-subject .page-title')?.textContent || '',
    hasActive: !!document.getElementById('subject-active-list'),
    hasMaterials: !!document.getElementById('subject-material-list'),
    materialEmpty: document.getElementById('subject-material-empty')?.textContent || '',
  })`);
  check('subject_panel_independent', subjectView.subjectHidden === false && subjectView.workHidden === true);
  check('subject_title', subjectView.title === '数字之我');
  check('subject_active_list_present', subjectView.hasActive === true);
  check('subject_material_list_present', subjectView.hasMaterials === true);
  check('subject_material_empty_hint', /还没有(添加)?资料/.test(subjectView.materialEmpty));

  // 资料真实列表与移除（命令 + UI）
  const overviewBase = await bus.invoke('subject.getOverview', {});
  const baseCount = (overviewBase.materials || []).length;
  const samplePath = path.join(os.tmpdir(), `dmv2-mat-${Date.now()}.txt`);
  fs.writeFileSync(samplePath, '资料内容用于验收\n', 'utf8');
  const imported = await bus.invoke('subject.importMaterial', {
    sourcePath: samplePath,
    distillCandidates: false,
  });
  check('material_imported', !!imported.materialRef);
  await uiEval(`() => { document.getElementById('nav-subject').click(); return true; }`);
  await waitUi(`() => {
    const text = document.getElementById('subject-material-list')?.innerText || '';
    return /dmv2-mat-/.test(text);
  }`, 5000);
  const matUi = await uiEval(`() => {
    const list = document.getElementById('subject-material-list');
    const empty = document.getElementById('subject-material-empty');
    return {
      emptyHidden: empty.hidden,
      text: list.innerText,
      removeCount: [...list.querySelectorAll('button')].filter((b) => b.textContent === '移除').length,
    };
  }`);
  check('material_list_shows_file', matUi.emptyHidden === true && /dmv2-mat-/.test(matUi.text));
  check('material_remove_control_present', matUi.removeCount >= 1);

  const overviewBefore = await bus.invoke('subject.getOverview', {});
  check('overview_materials_count', (overviewBefore.materials || []).length === baseCount + 1);
  const target = (overviewBefore.materials || []).find((m) => m.materialRef === imported.materialRef);
  check('imported_material_in_overview', !!target);
  check(
    'material_path_inside_package',
    target.absolutePath.includes(`${path.sep}materials${path.sep}`) &&
      target.absolutePath.includes(defaultDir),
  );
  await bus.invoke('subject.removeMaterial', { materialRef: imported.materialRef });
  check('package_copy_removed', !fs.existsSync(target.absolutePath));
  check('source_file_untouched', fs.existsSync(samplePath));
  const overviewAfter = await bus.invoke('subject.getOverview', {});
  check(
    'overview_removed_imported_only',
    (overviewAfter.materials || []).length === baseCount &&
      !(overviewAfter.materials || []).some((m) => m.materialRef === imported.materialRef),
  );
  await uiEval(`() => { document.getElementById('nav-subject').click(); return true; }`);
  await waitUi(`() => {
    const text = document.getElementById('subject-material-list')?.innerText || '';
    return !/dmv2-mat-/.test(text);
  }`, 5000);
  check('material_list_drops_removed_item', true);

  await uiEval(`() => { document.getElementById('btn-open-help').click(); return true; }`);
  await sleep(150);
  const helpView = await uiEval(`() => ({
    helpHidden: document.getElementById('view-help').hidden,
    shellHidden: document.getElementById('view-shell').hidden,
    text: document.getElementById('view-help').innerText,
  })`);
  check('help_aux_view_opens', helpView.helpHidden === false && helpView.shellHidden === true);
  check('help_mentions_three_surfaces', /对话/.test(helpView.text) && /做事/.test(helpView.text));
  await uiEval(`() => { document.getElementById('btn-help-back').click(); return true; }`);
  await sleep(100);

  await uiEval(`() => { document.getElementById('nav-work').click(); return true; }`);
  await sleep(150);

  const typeVal = await uiEval(`() => {
    const el = document.getElementById('artifact-type');
    return { tag: el?.tagName, value: el?.value || '' };
  }`);
  check(
    'artifact_type_defaults_document_hidden',
    typeVal.value === 'document' && typeVal.tag === 'INPUT',
    typeVal,
  );

  const layout = await uiEval(`() => {
    const appEl = document.getElementById('app');
    const work = document.querySelector('#panel-work .work-layout');
    const art = document.getElementById('artifact-panel');
    const appRect = appEl.getBoundingClientRect();
    const workRect = work.getBoundingClientRect();
    return {
      appWidth: appRect.width,
      workWidth: workRect.width,
      hasArtifactClass: work.classList.contains('has-artifact'),
      artifactHidden: art.hidden,
      columns: getComputedStyle(work).gridTemplateColumns,
    };
  }`);
  check('widescreen_app_uses_most_width', layout.appWidth >= 1400, layout);
  check('compose_no_empty_artifact_column', layout.artifactHidden === true && layout.hasArtifactClass === false, layout);
  check('work_layout_two_columns_without_artifact', (layout.columns.match(/px|fr|minmax/g) || []).length >= 2, layout);

  // UI 提交：Job 启动后不得停留在「等待开始」
  await uiEval(`() => {
    document.getElementById('btn-new-task').click();
    document.getElementById('goal').value = '写一份处理中说明';
    document.getElementById('artifact-type').value = 'document';
    document.getElementById('btn-submit').click();
    return true;
  }`);
  await waitUi(`() => {
    const t = document.getElementById('job-status').textContent || '';
    return /正在处理/.test(t) ? t : false;
  }`, 6000);
  const processingUi = await uiEval(`() => ({
    status: document.getElementById('job-status').textContent || '',
    cancelDisabled: document.getElementById('btn-cancel').disabled,
  })`);
  check(
    'job_leaves_waiting_after_start',
    /正在处理/.test(processingUi.status) && !/^等待开始$/.test(processingUi.status.trim()),
    processingUi,
  );
  check('cancel_enabled_while_processing', processingUi.cancelDisabled === false, processingUi);

  // 长任务可取消
  await uiEval(`() => { document.getElementById('btn-cancel').click(); return true; }`);
  await waitUi(`() => {
    const t = document.getElementById('job-status').textContent || '';
    return /已取消/.test(t) ? t : false;
  }`, 8000);
  const cancelledUi = await uiEval(`() => ({
    status: document.getElementById('job-status').textContent || '',
    actionable: document.getElementById('job-actionable').textContent || '',
    retryDisabled: document.getElementById('btn-retry').disabled,
  })`);
  check('long_job_cancellable', /已取消/.test(cancelledUi.status), cancelledUi);
  check('cancelled_shows_retry', cancelledUi.retryDisabled === false, cancelledUi);

  // Task1 via bus，再在 UI 选中验证成果
  const submitted1 = await bus.invoke('work.submitTask', {
    goal: '写第一份说明',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitTerminal(submitted1.jobId, 20000);
  await sleep(200);
  await uiEval(`() => {
    document.getElementById('nav-work').click();
    return true;
  }`);
  await sleep(200);
  const selected1 = await uiEval(`() => {
    const buttons = [...document.querySelectorAll('#task-list button')];
    const hit = buttons.find((b) => /第一份说明/.test(b.innerText));
    if (hit) hit.click();
    return !!hit;
  }`);
  check('task1_listed_and_selectable', selected1 === true);
  await sleep(400);
  const afterT1 = await uiEval(`() => ({
    artifactHidden: document.getElementById('artifact-panel').hidden,
    hasArtifactClass: document.querySelector('#panel-work .work-layout')?.classList.contains('has-artifact'),
    goal: document.getElementById('goal').value,
    editor: (document.getElementById('artifact-editor').value || ''),
    status: document.getElementById('job-status').textContent || '',
  })`);
  check('task1_result_visible_when_selected', afterT1.artifactHidden === false && afterT1.editor.length > 0);
  check('task1_goal_bound', /第一份说明/.test(afterT1.goal));
  check('artifact_column_only_when_result', afterT1.hasArtifactClass === true);
  check('task1_status_completed', /已完成/.test(afterT1.status), afterT1);

  // 新建任务：清空输入与成果
  await uiEval(`() => { document.getElementById('btn-new-task').click(); return true; }`);
  await sleep(200);
  const compose = await uiEval(`() => ({
    artifactHidden: document.getElementById('artifact-panel').hidden,
    hasArtifactClass: document.querySelector('#panel-work .work-layout')?.classList.contains('has-artifact'),
    goal: document.getElementById('goal').value,
    title: document.getElementById('work-compose-title').textContent,
    activeCount: document.querySelectorAll('#task-list li.active').length,
    status: document.getElementById('job-status').textContent || '',
  })`);
  check('new_task_clears_artifact', compose.artifactHidden === true);
  check('new_task_no_artifact_column', compose.hasArtifactClass === false);
  check('new_task_clears_goal', compose.goal === '');
  check('new_task_title', /新建任务/.test(compose.title || ''));
  check('new_task_no_active_selection', compose.activeCount === 0);
  check('new_task_clears_status', compose.status === '');

  // Task2 via bus；新建态下不应自动挂上旧成果
  const submitted2 = await bus.invoke('work.submitTask', {
    goal: '写第二份说明',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await sleep(100);
  const whileOtherRuns = await uiEval(`() => ({
    artifactHidden: document.getElementById('artifact-panel').hidden,
    goal: document.getElementById('goal').value,
    status: document.getElementById('job-status').textContent || '',
  })`);
  check('compose_keeps_artifact_empty_while_other_job', whileOtherRuns.artifactHidden === true);
  check('compose_goal_untouched_by_background_job', whileOtherRuns.goal === '');
  check('compose_status_untouched_by_background_job', whileOtherRuns.status === '');

  await waitTerminal(submitted2.jobId, 20000);
  await sleep(200);

  // 切回任务1恢复
  const backHit = await uiEval(`() => {
    const buttons = [...document.querySelectorAll('#task-list button')];
    const hit = buttons.find((b) => /第一份说明/.test(b.innerText));
    if (hit) hit.click();
    return !!hit;
  }`);
  check('can_reselect_task1', backHit === true);
  await sleep(400);
  const back = await uiEval(`() => ({
    artifactHidden: document.getElementById('artifact-panel').hidden,
    goal: document.getElementById('goal').value,
    editor: document.getElementById('artifact-editor').value || '',
    status: document.getElementById('job-status').textContent || '',
  })`);
  check('switch_back_restores_task1_goal', /第一份说明/.test(back.goal));
  check('switch_back_restores_task1_artifact', back.artifactHidden === false && /第一份说明/.test(back.editor));
  check('switch_back_restores_task1_status', /已完成/.test(back.status));

  // 再点任务2，确认互不串线
  const t2hit = await uiEval(`() => {
    const buttons = [...document.querySelectorAll('#task-list button')];
    const hit = buttons.find((b) => /第二份说明/.test(b.innerText));
    if (hit) hit.click();
    return !!hit;
  }`);
  check('can_select_task2', t2hit === true);
  await sleep(400);
  const t2view = await uiEval(`() => ({
    goal: document.getElementById('goal').value,
    editor: document.getElementById('artifact-editor').value || '',
    artifactHidden: document.getElementById('artifact-panel').hidden,
    status: document.getElementById('job-status').textContent || '',
  })`);
  check('task2_goal_isolated', /第二份说明/.test(t2view.goal));
  check(
    'task2_artifact_isolated',
    t2view.artifactHidden === false &&
      /第二份说明/.test(t2view.editor) &&
      !/第一份说明/.test(t2view.editor),
  );
  check('task2_status_isolated', /已完成/.test(t2view.status));
}

app.whenReady().then(async () => {
  try {
    await bootstrap();
    registerIpc();
    await createWindow();
    await mainSequence();
    report.verdict = 'passed';
    writeEvidence();
    console.log('electron-product-shell-acceptance PASSED');
    app.exit(0);
  } catch (err) {
    report.verdict = 'failed';
    report.error = String(err && err.stack ? err.stack : err);
    writeEvidence();
    console.error(err);
    app.exit(1);
  }
});

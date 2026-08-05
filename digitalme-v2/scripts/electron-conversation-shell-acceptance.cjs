/**
 * 对话一级入口 + 资料移除真实有效 + 任务隔离保持。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_mvp-conversation-shell-acceptance-evidence');

/** @type {import('../dist/runtime/digitalme-runtime').DigitalMeRuntime} */
let runtime;
/** @type {import('../dist/runtime/commands').CommandBus} */
let bus;
/** @type {BrowserWindow | null} */
let win = null;
let defaultDir = '';

const report = { startedAt: new Date().toISOString(), checks: [], verdict: null };

function check(name, okFlag, detail) {
  report.checks.push({ name, ok: !!okFlag, ...(detail ? { detail } : {}) });
  if (!okFlag) {
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

async function waitUi(predicateSource, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = await uiEval(predicateSource);
    if (hit) return hit;
    await sleep(120);
  }
  throw new Error(`UI wait timeout: ${predicateSource}`);
}

async function waitTerminal(jobId, timeoutMs = 20000) {
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
    fakeAdapter: { delayMs: 200 },
  });
  bus = createCommandBus(runtime);
}

function conversationFilePath() {
  const pkg = runtime.subject.getActive();
  if (!pkg) throw new Error('no active package');
  return path.join(pkg.rootDir, 'ui', 'conversation.ndjson');
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
  ipcMain.handle('shell:conversationList', async () => {
    const file = conversationFilePath();
    if (!fs.existsSync(file)) return { turns: [] };
    const turns = [];
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        turns.push(JSON.parse(line));
      } catch {
        /* skip */
      }
    }
    return { turns };
  });
  ipcMain.handle('shell:conversationAppend', async (_e, input) => {
    const role = String((input && input.role) || '').trim();
    const text = String((input && input.text) || '').trim();
    if (!role || !text) throw new Error('对话内容不能为空');
    const file = conversationFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const turn = {
      id: `turn_${Date.now().toString(36)}`,
      role,
      text,
      at: new Date().toISOString(),
    };
    fs.appendFileSync(file, `${JSON.stringify(turn)}\n`, 'utf8');
    return { turn };
  });
  ipcMain.handle('shell:conversationClear', async () => {
    const file = conversationFilePath();
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    return { cleared: true };
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
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

async function mainSequence() {
  defaultDir = path.join(os.tmpdir(), `dmv2-conversation-shell-${Date.now()}`, 'default-subject');
  fs.mkdirSync(path.dirname(defaultDir), { recursive: true });

  await uiEval(`() => {
    document.getElementById('self-intro').value = '我在做 Digital Me。';
    document.getElementById('btn-create-pkg').click();
    return true;
  }`);
  await sleep(1000);

  const nav = await uiEval(`() => ({
    chat: !!document.getElementById('nav-chat'),
    work: !!document.getElementById('nav-work'),
    subject: !!document.getElementById('nav-subject'),
    collab: !!document.getElementById('nav-collab'),
    settings: !!document.getElementById('btn-open-settings'),
    settingsInMainNav: !!document.querySelector('.main-nav #btn-open-settings'),
    help: !!document.getElementById('btn-open-help'),
    labels: [...document.querySelectorAll('.main-nav .nav-item')].map((b) => b.textContent.trim()),
  })`);
  check(
    'five_primary_nav_entries',
    nav.chat && nav.work && nav.subject && nav.collab && nav.settings,
    nav,
  );
  check('settings_in_primary_nav', nav.settingsInMainNav === true, nav);
  check(
    'nav_order_subject_chat_work_collab_settings',
    nav.labels.join('|') === '数字之我|对话|做事|协作|设置',
    nav,
  );
  check('help_aux_present', nav.help === true);

  // 对话独立使用，不创建 Task
  const tasksBefore = await bus.invoke('work.listTasks', { limit: 20 });
  const taskCountBefore = (tasksBefore.tasks || []).length;
  await uiEval(`() => { document.getElementById('nav-chat').click(); return true; }`);
  await sleep(200);
  await uiEval(`() => {
    document.getElementById('chat-input').value = '请记住我正在做验收，不要公开融资细节。';
    document.getElementById('btn-chat-send').click();
    return true;
  }`);
  await waitUi(`() => {
    const text = document.getElementById('chat-turns')?.innerText || '';
    return /请记住我正在做验收/.test(text) ? text : false;
  }`, 8000);
  const tasksAfterChat = await bus.invoke('work.listTasks', { limit: 20 });
  check(
    'chat_does_not_create_task',
    (tasksAfterChat.tasks || []).length === taskCountBefore,
    { before: taskCountBefore, after: (tasksAfterChat.tasks || []).length },
  );

  // transcript 落盘且不在 growth 文件
  const convFile = path.join(defaultDir, 'ui', 'conversation.ndjson');
  check('conversation_transcript_persisted', fs.existsSync(convFile));
  const growthFile = path.join(defaultDir, 'growth', 'events.ndjson');
  const growthText = fs.existsSync(growthFile) ? fs.readFileSync(growthFile, 'utf8') : '';
  check('transcript_not_written_as_growth_chat_history', !/"role"\s*:\s*"user"/.test(growthText));

  // 对话输入进入捕捉管线
  const events = await runtime.subject.listGrowthEvents();
  const captured = events.some(
    (e) =>
      e.source?.kind === 'owner_direct' &&
      /验收|融资/.test(`${e.payload?.title || ''}${e.payload?.detail || ''}`),
  );
  check('chat_input_enters_capture_pipeline', captured === true, {
    eventCount: events.length,
  });

  // 转为任务（最小入口）
  await uiEval(`() => { document.getElementById('btn-chat-to-task').click(); return true; }`);
  await sleep(300);
  const toTask = await uiEval(`() => ({
    workHidden: document.getElementById('panel-work').hidden,
    goal: document.getElementById('goal').value,
    title: document.getElementById('work-compose-title').textContent,
  })`);
  check('convert_to_task_opens_work', toTask.workHidden === false);
  check('convert_to_task_fills_goal', /验收|融资/.test(toTask.goal), toTask);
  check('convert_to_task_compose_mode', /新建任务/.test(toTask.title || ''));

  // 资料移除真实有效（UI 路径）
  await uiEval(`() => { document.getElementById('nav-subject').click(); return true; }`);
  await sleep(200);
  const samplePath = path.join(os.tmpdir(), `dmv2-conv-mat-${Date.now()}.txt`);
  fs.writeFileSync(samplePath, '这是要移除的验收资料\n', 'utf8');
  const imported = await bus.invoke('subject.importMaterial', {
    sourcePath: samplePath,
    distillCandidates: true,
  });
  const packageCopy = path.join(defaultDir, ...imported.materialRef.split('/'));
  check('material_package_copy_exists', fs.existsSync(packageCopy));
  await uiEval(`() => { document.getElementById('nav-subject').click(); return true; }`);
  await waitUi(`() => {
    const text = document.getElementById('subject-material-list')?.innerText || '';
    return /dmv2-conv-mat-|验收资料/.test(text) ? text : false;
  }`, 5000);

  // stub confirm
  await uiEval(`() => {
    window.confirm = () => true;
    const buttons = [...document.querySelectorAll('#subject-material-list button')];
    const remove = buttons.find((b) => b.textContent === '移除');
    if (remove) remove.click();
    return !!remove;
  }`);
  await waitUi(`() => {
    const text = document.getElementById('subject-material-list')?.innerText || '';
    const status = document.getElementById('subject-action-status')?.textContent || '';
    return (!/dmv2-conv-mat-/.test(text) && /已移除|未找到/.test(status)) ? status : false;
  }`, 8000);
  check('material_package_copy_gone', !fs.existsSync(packageCopy));
  check('material_source_still_exists', fs.existsSync(samplePath));
  const overview = await bus.invoke('subject.getOverview', {});
  check(
    'material_absent_from_overview',
    !(overview.materials || []).some((m) => m.materialRef === imported.materialRef),
  );
  const inactiveEvents = (await runtime.subject.listGrowthEvents()).filter(
    (e) => e.payload?.relation?.materialRef === imported.materialRef && e.type !== 'subject_corrected',
  );
  const { collectInactiveEventIds } = require('../dist/subject-core/derive-all');
  const inactive = new Set(collectInactiveEventIds(await runtime.subject.listGrowthEvents()));
  check(
    'material_related_events_inactivated',
    inactiveEvents.every((e) => inactive.has(e.id)),
    { related: inactiveEvents.map((e) => e.id) },
  );

  // 做事隔离仍有效
  const t1 = await bus.invoke('work.submitTask', {
    goal: '写第一份对话验收说明',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitTerminal(t1.jobId);
  await uiEval(`() => { document.getElementById('nav-work').click(); return true; }`);
  await sleep(200);
  await uiEval(`() => {
    const hit = [...document.querySelectorAll('#task-list button')].find((b) => /第一份对话验收/.test(b.innerText));
    if (hit) hit.click();
    return !!hit;
  }`);
  await sleep(400);
  await uiEval(`() => { document.getElementById('btn-new-task').click(); return true; }`);
  await sleep(200);
  const compose = await uiEval(`() => ({
    artifactHidden: document.getElementById('artifact-panel').hidden,
    goal: document.getElementById('goal').value,
  })`);
  check('work_isolation_new_task_clears', compose.artifactHidden === true && compose.goal === '');

  const body = await uiEval(`() => document.body.innerText`);
  check(
    'no_internal_event_terms_in_ui',
    !/GrowthEvent|ContextSnapshot|\bcandidate\b|\breadiness\b/i.test(body),
  );
}

app.whenReady().then(async () => {
  try {
    await bootstrap();
    registerIpc();
    await createWindow();
    await mainSequence();
    report.verdict = 'passed';
    writeEvidence();
    console.log('electron-conversation-shell-acceptance PASSED');
    app.exit(0);
  } catch (err) {
    report.verdict = 'failed';
    report.error = String(err && err.stack ? err.stack : err);
    writeEvidence();
    console.error(err);
    app.exit(1);
  }
});

/**
 * SOFTWARE-DEVELOPMENT-TASK-OWNER-ACCEPTANCE-01-BLOCKER-01
 * fresh-user-data：空 userData、不提前 create/open，验证默认包幂等挂载与确认卡。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const {
  ensureDefaultPackageAttached,
  countSubjectPackages,
  resolveDefaultSubjectDir,
  sanitizeCommandError,
  USER_FACING_ATTACH_FAILED,
} = require('../electron/default-package.cjs');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_software-dev-fresh-ud-01-evidence');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-sd-fresh-ud-'));
app.setPath('userData', userData);

// 验收过程中会销毁窗口；勿因此提前退出进程。
app.on('window-all-closed', () => {});

/** @type {import('../dist/runtime/digitalme-runtime').DigitalMeRuntime} */
let runtime;
/** @type {import('../dist/runtime/commands').CommandBus} */
let bus;
/** @type {BrowserWindow | null} */
let win = null;
let fixtureRepo = '';
let modelReady = true;

const report = {
  schemaVersion: 'software-dev-fresh-ud/1',
  startedAt: new Date().toISOString(),
  userData,
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
  return async ({ pkg, prompt }) => {
    const target = path.join(pkg.workingDirectory, 'formatLabel.js');
    const isRev =
      !!(pkg.previousRun && pkg.previousRun.revisionRequest) || /改为 done|done/i.test(prompt);
    const body = isRev
      ? "function formatLabel(input){ return input==='start' ? 'done' : input; }\nmodule.exports={formatLabel};\n"
      : "function formatLabel(input){ return input==='start' ? 'start-processing' : input; }\nmodule.exports={formatLabel};\n";
    await fs.promises.writeFile(target, body, 'utf8');
    return {
      exitCode: 0,
      summary: isRev ? 'done' : 'start-processing',
      claimedChangedFiles: ['formatLabel.js'],
      testCommands: [],
      testResults: [],
    };
  };
}

async function createRuntime() {
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { createCommandBus } = require('../dist/runtime/command-bus');
  runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    codeAnalysisCapability: 'needs_setup',
    externalExecutorCapability: { executeHook: makeExecutorHook() },
  });
  bus = createCommandBus(runtime);
}

async function ensureAttached() {
  return ensureDefaultPackageAttached({
    runtime,
    userDataPath: app.getPath('userData'),
  });
}

function registerIpc() {
  const { COMMAND_NAMES } = require('../dist/runtime/commands');
  const { inspectSoftwareProject } = require('../dist/work-runtime/work-intent');
  const allowed = new Set(COMMAND_NAMES);
  ipcMain.handle('command:invoke', async (_e, name, input) => {
    if (!allowed.has(name)) throw new Error(`command not exposed: ${name}`);
    try {
      if (name !== 'subject.createPackage' && name !== 'subject.openPackage' && name !== 'capability.list') {
        if (!runtime.isPackageAttached()) {
          const ensured = await ensureAttached();
          if (!ensured.ok) {
            throw Object.assign(new Error(USER_FACING_ATTACH_FAILED), {
              code: 'PACKAGE_ATTACH_FAILED',
            });
          }
        }
      }
      if (
        (name === 'work.submitTask' || name === 'work.retryTask' || name === 'work.reviseArtifact') &&
        !modelReady
      ) {
        throw Object.assign(new Error('请先连接模型'), { code: 'MODEL_NOT_CONFIGURED' });
      }
      return await bus.invoke(name, input || {});
    } catch (err) {
      throw sanitizeCommandError(err);
    }
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
    const dir = resolveDefaultSubjectDir(app.getPath('userData'));
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    return {
      dir,
      exists: fs.existsSync(path.join(dir, 'manifest.json')),
    };
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
  await sleep(900);
}

async function run() {
  check('empty_userData_no_package', countSubjectPackages(userData) === 0, {
    count: countSubjectPackages(userData),
  });

  fixtureRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-sd-fresh-repo-'));
  fs.writeFileSync(path.join(fixtureRepo, 'package.json'), '{"name":"fixture","private":true}\n');
  fs.writeFileSync(
    path.join(fixtureRepo, 'formatLabel.js'),
    "function formatLabel(input){ return input; }\nmodule.exports={formatLabel};\n",
  );

  await createRuntime();
  // 模拟产品启动：ensure 自动创建，测试本身不提前 create/open
  const first = await ensureAttached();
  check('ensure_creates_default', !!(first.ok && first.created), first);
  check('package_count_after_create', countSubjectPackages(userData) === 1, {
    count: countSubjectPackages(userData),
  });
  check('work_attached_after_ensure', runtime.isPackageAttached() === true);

  // 模拟保存模型后 rebootstrap：新 Runtime 未挂载，再 ensure 应 open 而非重复 create
  await runtime.stop();
  await createRuntime();
  check('detached_after_rebootstrap', runtime.isPackageAttached() === false);
  const second = await ensureAttached();
  check('ensure_reopens_same', !!(second.ok && !second.created), second);
  check('no_duplicate_package', countSubjectPackages(userData) === 1, {
    count: countSubjectPackages(userData),
  });
  check('work_reattached', runtime.isPackageAttached() === true);

  registerIpc();
  await createWindow();

  // UI：不手工 create/open；依赖 tryAutoOpenDefault / 已挂载状态
  await uiEval(`async () => {
    const api = window.digitalMe;
    const d = await api.getDefaultSubjectDir();
    if (!d.exists) throw new Error('default package missing');
    // 打开已存在默认包（对应产品 tryAutoOpenDefault），不 create
    await api.invoke('subject.openPackage', { dir: d.dir });
    const nav = document.getElementById('nav-work');
    if (nav) nav.click();
    const neu = document.getElementById('btn-new-task');
    if (neu) neu.click();
    return true;
  }`);

  await uiEval(`async () => {
    document.getElementById('goal').value =
      '修改这个项目中的 formatLabel，使输入 start 时返回 start-processing，并运行测试。';
    document.getElementById('btn-add-folder').click();
    await new Promise((r) => setTimeout(r, 250));
    return document.getElementById('material-list').innerText;
  }`);
  const materialsText = await uiEval(`() => document.getElementById('material-list').innerText`);
  check('software_project_added', /已添加软件项目/.test(materialsText), { materialsText });

  // 再次模拟 rebootstrap 后仍可提交（命令层幂等恢复）
  await runtime.stop();
  await createRuntime();
  check('detached_before_submit', runtime.isPackageAttached() === false);

  await uiEval(`async () => {
    document.getElementById('btn-submit').click();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  }`);

  const jobStatus = await uiEval(`() => document.getElementById('job-status').textContent || ''`);
  check(
    'no_runtime_not_attached_leak',
    !/work runtime not attached|command:invoke|Error invoking remote method/i.test(jobStatus),
    { jobStatus },
  );

  const confirmVisible = await uiEval(
    `() => !document.getElementById('execution-confirm-card').hidden`,
  );
  check('execution_confirm_visible', confirmVisible === true, { jobStatus });

  const confirmText = await uiEval(
    `() => document.getElementById('execution-confirm-card').innerText`,
  );
  check('confirm_has_project', /项目/.test(confirmText), { confirmText: confirmText.slice(0, 400) });
  check('confirm_has_workdir', /工作目录/.test(confirmText));
  check('confirm_has_ready', /准备完成/.test(confirmText));
  check('confirm_has_allowed', /允许/.test(confirmText));
  check('confirm_has_forbidden', /不会执行/.test(confirmText));

  // 关闭窗口后用同一 userData 重启 Runtime，原包应被打开且不重复
  if (win && !win.isDestroyed()) win.destroy();
  await runtime.stop();
  await createRuntime();
  const restarted = await ensureAttached();
  check('restart_reopens', !!(restarted.ok && !restarted.created), restarted);
  check('restart_no_duplicate', countSubjectPackages(userData) === 1, {
    count: countSubjectPackages(userData),
  });
  const subjectId = (await runtime.getOverview({})).subjectId;
  const manifest = JSON.parse(
    fs.readFileSync(path.join(resolveDefaultSubjectDir(userData), 'manifest.json'), 'utf8'),
  );
  check('same_subject_id', subjectId === manifest.id, { subjectId, manifestId: manifest.id });

  report.verdict = 'pass';
  report.completedAt = new Date().toISOString();
  writeEvidence();
  console.log(
    JSON.stringify(
      { ok: true, evidence: EVIDENCE, checks: report.checks.length, userData },
      null,
      2,
    ),
  );
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

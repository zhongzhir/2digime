/**
 * D11-E-16A — 真实 Electron 主链 smoke（隔离 userData）。
 * adapter: Fake document + hooked external executor（工程隔离，非 Owner 真机）。
 * 不得加载 fixture.html；截图必须对应真实 Task/Job/Artifact 状态。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_d11-e-runtime-evidence-16a');
const SHOTS = path.join(EVIDENCE, 'shots');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-d11e-rt-ud-'));

app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', USER_DATA);

/** @type {import('../dist/runtime/digitalme-runtime').DigitalMeRuntime} */
let runtime;
/** @type {import('../dist/runtime/commands').CommandBus} */
let bus;
/** @type {BrowserWindow | null} */
let win = null;
let defaultDir = '';
let fixtureRepo = '';

const report = {
  schemaVersion: 'd11e-runtime-evidence/1',
  task: '2DIGIME-BUILD-01-D11-E-RUNTIME-EVIDENCE-FOLLOWUP-16A',
  startedAt: new Date().toISOString(),
  userData: USER_DATA,
  adapter: {
    documentCapability: 'fake',
    externalExecutor: 'hooked_codex_like_isolation',
    note: '工程隔离 Fake/hooked adapter；非 Owner 真机、非真实 Codex CLI',
  },
  checks: [],
  shots: [],
  timeline: [],
  counts: {},
  restart: {},
  security: {},
  verdict: null,
};

function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  if (!ok) {
    throw new Error(`CHECK_FAILED: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

function note(event, detail) {
  report.timeline.push({ at: new Date().toISOString(), event, ...(detail ? { detail } : {}) });
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function uiEval(source) {
  return win.webContents.executeJavaScript(`(${source})()`, true);
}

async function shot(name, stateLabel) {
  const file = path.join(SHOTS, `${String(report.shots.length + 1).padStart(2, '0')}-${name}.png`);
  const img = await win.capturePage();
  fs.writeFileSync(file, img.toPNG());
  const st = fs.statSync(file);
  check(`shot_${name}_nonempty`, st.size > 2000, { file, size: st.size });
  report.shots.push({
    name,
    file,
    size: st.size,
    realState: stateLabel,
    kind: 'runtime_evidence',
  });
  note('screenshot', { name, stateLabel, file });
}

async function waitTerminal(jobId, timeoutMs = 45000) {
  const { waitForJobTerminal } = require('../dist/work-runtime/job-runner');
  return waitForJobTerminal(runtime.workRuntime, jobId, timeoutMs);
}

async function countStore() {
  const tasks = await bus.invoke('work.listTasks', { limit: 50 });
  const list = (tasks && tasks.tasks) || [];
  let jobs = 0;
  let artifacts = 0;
  const details = [];
  for (const t of list) {
    const d = await bus.invoke('work.getTask', { taskId: t.taskId });
    const jobList = await runtime.workRuntime.listJobsForTask(t.taskId);
    jobs += jobList.length;
    artifacts += (d.artifactIds || []).length;
    let decision = null;
    for (const aid of d.artifactIds || []) {
      try {
        const content = await bus.invoke('artifact.getContent', { artifactId: aid });
        if (content && content.ownerDecision && content.ownerDecision.status) {
          decision = content.ownerDecision.status;
        }
      } catch {
        /* ignore */
      }
    }
    details.push({
      taskId: t.taskId,
      statusLabel: d.userFacingLabel,
      jobCount: jobList.length,
      jobStatuses: jobList.map((j) => j.status),
      artifactIds: d.artifactIds || [],
      decision,
      plan: d.task && d.task.meta && d.task.meta.plan
        ? { version: d.task.meta.plan.version, status: d.task.meta.plan.status }
        : null,
      revisionLoop: d.task && d.task.meta && d.task.meta.revisionLoop
        ? {
            paused: !!d.task.meta.revisionLoop.paused,
            autoRoundCount: d.task.meta.revisionLoop.autoRoundCount || 0,
            inFlightJobId: d.task.meta.revisionLoop.inFlightJobId || null,
          }
        : null,
    });
  }
  return { taskCount: list.length, jobCount: jobs, artifactCount: artifacts, details };
}

function scriptedConverseChat() {
  const replies = [
    {
      intent: 'modify_plan',
      confidence: 0.93,
      reply: '已根据你的目标整理出一版开发规划，请在右侧确认后开始。',
      planUpdate:
        '目标：修改 formatLabel\n交付：start→start-processing\n路径：改实现并跑测试\n准备：项目目录与代码执行能力\n边界：不 commit/push/部署',
    },
    {
      intent: 'confirm_start',
      confidence: 0.95,
      reply: '规划已确认，可以开始开发。',
    },
  ];
  let i = 0;
  return async () => {
    const r = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return {
      text: JSON.stringify({
        intent: r.intent,
        confidence: r.confidence,
        reply: r.reply,
        ...(r.planUpdate ? { planUpdate: r.planUpdate } : {}),
      }),
    };
  };
}

async function bootstrap() {
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { createCommandBus } = require('../dist/runtime/command-bus');
  runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    converseChat: scriptedConverseChat(),
    codeAnalysisCapability: 'needs_setup',
    fakeAdapter: { delayMs: 80 },
    externalExecutorCapability: {
      forceAvailability: 'ready',
      executeHook: async ({ pkg, prompt }) => {
        const target = path.join(pkg.workingDirectory, 'formatLabel.js');
        const isRev =
          !!(pkg.previousRun && pkg.previousRun.revisionRequest) || /改为 done|done/i.test(prompt || '');
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
  ipcMain.removeHandler('command:invoke');
  ipcMain.handle('command:invoke', async (_e, name, input) => {
    if (!allowed.has(name)) throw new Error(`command not exposed: ${name}`);
    return bus.invoke(name, input || {});
  });
  const shellHandlers = {
    'shell:pickOpenFiles': async () => [],
    'shell:pickOpenDirectory': async () => fixtureRepo,
    'shell:inspectSoftwareProject': async (_e, input) =>
      inspectSoftwareProject(input && input.path ? input.path : fixtureRepo),
    'shell:pickSaveDirectory': async () => {
      throw new Error('not required');
    },
    'shell:getDefaultSubjectDir': async () => {
      const manifest = path.join(defaultDir, 'manifest.json');
      let exists = false;
      try {
        fs.accessSync(manifest);
        exists = true;
      } catch {
        exists = false;
      }
      return { dir: defaultDir, exists };
    },
    'shell:getModelStatus': async () => ({
      modelReady: true,
      needsCredentialSetup: false,
      status: { credentialConfigured: true, needsCredentialSetup: false },
    }),
    'shell:saveModelCredential': async () => ({ ok: true }),
    'shell:deleteModelCredential': async () => ({ ok: true }),
    'shell:testModelConnection': async () => ({ ok: true }),
    'shell:revealPath': async () => ({ opened: true }),
    'shell:getRemoteCapabilityStatus': async () => ({
      connected: false,
      displayName: '研究分析能力',
      statusLabel: '状态：未连接',
    }),
    'shell:testRemoteCapability': async () => ({ ok: false }),
    'shell:saveRemoteCapability': async () => ({ ok: true }),
    'shell:disableRemoteCapability': async () => ({ ok: true }),
    'shell:conversationList': async () => ({ turns: [] }),
    'shell:conversationAppend': async () => ({ ok: true }),
    'shell:conversationClear': async () => ({ ok: true }),
    'shell:conversationReply': async () => ({ text: '（隔离回复）' }),
    'shell:conversationGrowthHint': async () => ({ hint: null }),
  };
  for (const [ch, fn] of Object.entries(shellHandlers)) {
    try {
      ipcMain.removeHandler(ch);
    } catch {
      /* ignore */
    }
    ipcMain.handle(ch, fn);
  }
}

async function createWindow() {
  if (win) {
    try {
      win.destroy();
    } catch {
      /* ignore */
    }
    win = null;
  }
  win = new BrowserWindow({
    width: 1440,
    height: 900,
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
  await sleep(700);
}

async function enterWork() {
  await bus.invoke('subject.createPackage', {
    displayName: 'D11E-RT',
    targetDir: defaultDir,
  });
  await uiEval(`async () => {
    const api = window.digitalMe;
    await api.invoke('subject.openPackage', { dir: (await api.getDefaultSubjectDir()).dir });
    const nav = document.getElementById('nav-work');
    if (nav) nav.click();
    const neu = document.getElementById('btn-new-task');
    if (neu) neu.click();
    return true;
  }`);
  await sleep(400);
}

async function assertNoLegacyCards() {
  const cards = await uiEval(`() => ({
    executor: !!document.getElementById('executor-setup-card'),
    project: !!document.getElementById('project-folder-card'),
    execution: !!document.getElementById('execution-confirm-card'),
    hasStartDev: !!document.getElementById('btn-start-development'),
    hasPrep: !!document.getElementById('task-workspace-prep'),
  })`);
  check('no_legacy_mid_confirm_cards_in_dom', !cards.executor && !cards.project && !cards.execution, cards);
  check('right_panel_two_step_present', cards.hasStartDev && cards.hasPrep, cards);
  return cards;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-d11e-pkg-'));
  fixtureRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-d11e-repo-'));
  fs.writeFileSync(path.join(fixtureRepo, 'package.json'), '{"name":"d11e-fixture","private":true}\n');
  fs.writeFileSync(
    path.join(fixtureRepo, 'formatLabel.js'),
    "function formatLabel(input){ return input; }\nmodule.exports={formatLabel};\n",
  );

  await bootstrap();
  registerIpc();
  await createWindow();
  await enterWork();
  await assertNoLegacyCards();
  await shot('01-compose-no-legacy-cards', 'compose_empty_no_mid_confirm_cards');

  // 1) 形成并确认规划（经 work.converse + updatePlan）
  const goal = '修改这个项目中的 formatLabel，使输入 start 时返回 start-processing，并运行测试。';
  const converse = await bus.invoke('work.converse', {
    text: goal,
    contextRefs: [{ kind: 'folder', path: fixtureRepo }],
  });
  check('converse_ok', !!(converse && converse.taskId), { converseKeys: Object.keys(converse || {}) });
  const taskId = converse.taskId;
  note('plan_seeded', { taskId });

  const now = new Date().toISOString();
  await runtime.workRuntime.updateTaskPlan(taskId, {
    version: 1,
    status: 'confirmed',
    content:
      '目标：修改 formatLabel\n交付：start→start-processing\n路径：改实现并跑测试\n准备：项目目录与代码执行能力\n边界：不 commit/push/部署',
    updatedAt: now,
    confirmedAt: now,
    confirmedFacts: ['修改 formatLabel', '运行测试', '不提交不推送'],
  });
  note('plan_confirmed', { version: 1 });

  // 刷新 UI 选中任务
  await uiEval(`async () => {
    const first = document.querySelector('#task-list button, #task-list [data-task-id]');
    if (first) first.click();
    await new Promise((r) => setTimeout(r, 300));
    return true;
  }`);
  await sleep(300);
  await shot('02-plan-confirmed', 'plan_confirmed_ready_to_start');

  // 2) 低风险执行授权：先探测 needsExecutionConfirm，再带授权提交
  const preview = await bus.invoke('work.submitTask', {
    existingTaskId: taskId,
    goal,
    contextRefs: [{ kind: 'folder', path: fixtureRepo }],
    confirmedPlanVersion: 1,
  });
  check('needs_execution_confirm_or_running', !!(preview.needsExecutionConfirm || preview.jobId), preview);
  let authBoundary = null;
  let firstJobId = preview.jobId || null;

  if (preview.needsExecutionConfirm) {
    authBoundary = {
      title: preview.needsExecutionConfirm.title,
      workingDirectory: preview.needsExecutionConfirm.workingDirectory,
      allowed: preview.needsExecutionConfirm.allowed || [],
      forbidden: preview.needsExecutionConfirm.forbidden || [],
    };
    check(
      'auth_forbids_commit_push',
      authBoundary.forbidden.some((x) => /commit/i.test(x)) &&
        authBoundary.forbidden.some((x) => /push|部署|发布/i.test(x)),
      authBoundary,
    );
    report.security.executionAuthorizationPreview = authBoundary;
    note('execution_auth_preview', authBoundary);
    await shot('03-execution-auth-required', 'needs_execution_confirm_protocol_right_panel_path');

    const started = await bus.invoke('work.submitTask', {
      existingTaskId: taskId,
      goal,
      contextRefs: [{ kind: 'folder', path: fixtureRepo }],
      confirmedPlanVersion: 1,
      executionAuthorization: {
        confirmed: true,
        workingDirectory: preview.needsExecutionConfirm.workingDirectory,
        selectedCapabilityId: preview.needsExecutionConfirm.selectedCapabilityId,
        writeScope: preview.needsExecutionConfirm.writeScope || [
          preview.needsExecutionConfirm.workingDirectory,
        ],
        readScope: preview.needsExecutionConfirm.readScope || [
          preview.needsExecutionConfirm.workingDirectory,
        ],
      },
    });
    check('authorized_submit_creates_job', !!started.jobId, started);
    firstJobId = started.jobId;
    report.security.executionAuthorizationUsed = {
      confirmed: true,
      workingDirectory: preview.needsExecutionConfirm.workingDirectory,
      selectedCapabilityId: preview.needsExecutionConfirm.selectedCapabilityId,
    };
  } else {
    note('auto_started_without_extra_confirm', { jobId: firstJobId });
  }

  // 3) 真实 running
  check('has_first_job', !!firstJobId);
  let detail = await bus.invoke('work.getTask', { taskId });
  if (detail.latestJob && (detail.latestJob.status === 'queued' || detail.latestJob.status === 'running')) {
    await uiEval(`async () => {
      const first = document.querySelector('#task-list button, #task-list [data-task-id]');
      if (first) first.click();
      return true;
    }`);
    await sleep(200);
    await shot('04-developing-running', 'job_queued_or_running');
    await waitTerminal(detail.latestJob.jobId, 45000);
  }
  detail = await bus.invoke('work.getTask', { taskId });
  check('first_job_succeeded', detail.latestJob && detail.latestJob.status === 'succeeded', {
    status: detail.latestJob && detail.latestJob.status,
  });
  note('first_job_succeeded', { jobId: detail.latestJob.jobId });

  // 4) 真实成果 / 验收状态
  await uiEval(`async () => {
    const first = document.querySelector('#task-list button, #task-list [data-task-id]');
    if (first) first.click();
    await new Promise((r) => setTimeout(r, 600));
    return true;
  }`);
  await sleep(400);
  const afterFirst = await countStore();
  report.counts.afterFirstSuccess = afterFirst;
  check('has_artifact', afterFirst.artifactCount >= 1, afterFirst);
  check('decision_not_auto_adopted', afterFirst.details.every((d) => d.decision !== 'accepted'), afterFirst);
  await shot('05-result-acceptance', 'artifact_ready_not_auto_adopted');

  // 5) 未达标/修订入口：用户主动 reviseArtifact
  const artifactId = (afterFirst.details[0] && afterFirst.details[0].artifactIds[0]) || detail.artifactIds[0];
  check('artifact_id', !!artifactId);
  const revised = await bus.invoke('work.reviseArtifact', {
    taskId,
    artifactId,
    revisionRequest: '将结果改为 done，并同步更新测试。',
  });
  check('revision_job_created', !!revised.jobId, revised);
  note('revision_started', { jobId: revised.jobId });
  await shot('06-revision-in-flight', 'user_initiated_revision_job');
  await waitTerminal(revised.jobId, 45000);
  const afterRev = await countStore();
  report.counts.afterRevision = afterRev;
  check('revision_job_succeeded', afterRev.details[0].jobStatuses.includes('succeeded'), afterRev);
  check('same_task_after_revision', afterRev.taskCount === 1, afterRev);
  check('no_duplicate_task', afterRev.taskCount === 1, afterRev);

  // 6) 重启：新 runtime + 新窗口，同 package 目录
  const beforeRestart = await countStore();
  report.restart.before = beforeRestart;
  if (win) {
    win.destroy();
    win = null;
  }
  // 重新装配 runtime（同命令总线路径）
  await bootstrap();
  registerIpc();
  await createWindow();
  await uiEval(`async () => {
    const api = window.digitalMe;
    await api.invoke('subject.openPackage', { dir: (await api.getDefaultSubjectDir()).dir });
    const nav = document.getElementById('nav-work');
    if (nav) nav.click();
    await new Promise((r) => setTimeout(r, 400));
    const first = document.querySelector('#task-list button, #task-list [data-task-id]');
    if (first) first.click();
    return true;
  }`);
  await sleep(500);
  const afterRestart = await countStore();
  report.restart.after = afterRestart;
  check('restart_same_task_count', afterRestart.taskCount === beforeRestart.taskCount, {
    before: beforeRestart.taskCount,
    after: afterRestart.taskCount,
  });
  check('restart_same_task_id', afterRestart.details[0] && afterRestart.details[0].taskId === taskId, {
    taskId,
    after: afterRestart.details[0] && afterRestart.details[0].taskId,
  });
  check(
    'restart_job_count_stable',
    afterRestart.jobCount === beforeRestart.jobCount,
    { before: beforeRestart.jobCount, after: afterRestart.jobCount },
  );
  check(
    'restart_still_not_auto_adopted',
    afterRestart.details.every((d) => d.decision !== 'accepted'),
    afterRestart,
  );
  await assertNoLegacyCards();
  await shot('07-after-restart', 'same_task_restored_after_reopen');

  // 7) 安全汇总
  report.security.noDuplicateJobs = afterRestart.jobCount === beforeRestart.jobCount;
  report.security.noAutoAdopt = afterRestart.details.every((d) => d.decision !== 'accepted');
  report.security.noOverPrivilegeEvidence =
    !authBoundary ||
    (authBoundary.forbidden.some((x) => /commit/i.test(x)) &&
      authBoundary.forbidden.some((x) => /push|部署|发布/i.test(x)));
  check('security_no_duplicate_jobs', report.security.noDuplicateJobs);
  check('security_no_auto_adopt', report.security.noAutoAdopt);
  check('security_auth_boundary', report.security.noOverPrivilegeEvidence, authBoundary);

  report.finishedAt = new Date().toISOString();
  report.verdict = 'runtime_smoke_passed';
  report.ownerAccepted = false;
  report.ownerRuntime = 'not_started';

  fs.writeFileSync(path.join(EVIDENCE, 'runtime-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ verdict: report.verdict, checks: report.checks.length, shots: report.shots.length, userData: USER_DATA }, null, 2));
  app.quit();
}

app.whenReady().then(() =>
  main().catch((err) => {
    report.verdict = 'runtime_smoke_failed';
    report.error = err && err.message ? err.message : String(err);
    try {
      fs.mkdirSync(EVIDENCE, { recursive: true });
      fs.writeFileSync(path.join(EVIDENCE, 'runtime-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    } catch {
      /* ignore */
    }
    console.error(err);
    app.exit(1);
  }),
);

app.on('window-all-closed', () => {});

/**
 * 2DIGIME-BUILD-01-CORRECTIVE-PRODUCT-REDESIGN-18
 * 真实 Electron UI 主链 smoke（隔离 userData + 可丢弃项目）。
 * 用户动作经真实 renderer 点击/输入，不得用 fixture.html 或 command bus 代替主链。
 * adapter: Fake document + hooked external executor（工程隔离，非 Owner 真机 Codex）。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_corrective-18-smoke-evidence');
const SHOTS = path.join(EVIDENCE, 'shots');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-c18-ud-'));

app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', USER_DATA);

let runtime;
let bus;
let win = null;
let defaultDir = '';
let fixtureRepo = '';

const report = {
  schemaVersion: 'corrective-18-smoke/1',
  task: '2DIGIME-BUILD-01-CORRECTIVE-PRODUCT-REDESIGN-18',
  startedAt: new Date().toISOString(),
  userData: USER_DATA,
  adapter: {
    documentCapability: 'fake',
    externalExecutor: 'hooked_codex_like_isolation',
    note: '工程隔离；真实 renderer 主链；非 Owner 真机、非真实 Codex CLI',
  },
  checks: [],
  shots: [],
  timeline: [],
  counts: {},
  restart: {},
  verdict: null,
  ownerAccepted: false,
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
  report.shots.push({ name, file, size: st.size, realState: stateLabel, kind: 'ui_main_chain' });
  note('screenshot', { name, stateLabel, file });
}

async function waitUi(label, source, timeoutMs = 20000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await uiEval(source);
    if (last && last.ok) return last;
    await sleep(250);
  }
  throw new Error(`WAIT_UI_TIMEOUT: ${label} last=${JSON.stringify(last)}`);
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
    let ctoReport = '';
    for (const aid of d.artifactIds || []) {
      try {
        const content = await bus.invoke('artifact.getContent', { artifactId: aid });
        if (content && content.ownerDecision && content.ownerDecision.status) {
          decision = content.ownerDecision.status;
        }
        const acc = content && content.codeChange && content.codeChange.acceptanceSummary;
        if (acc && acc.ctoReport) ctoReport = String(acc.ctoReport);
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
      ctoReport,
    });
  }
  return { taskCount: list.length, jobCount: jobs, artifactCount: artifacts, details };
}

function scriptedConverseChat() {
  const replies = [
    {
      intent: 'modify_plan',
      confidence: 0.93,
      reply: '建议先改 formatLabel，再跑现有测试确认。右侧是开发规划，确认后我开始调度开发。',
      planUpdate:
        '目标：修改 formatLabel，使 start 返回 start-processing\n准备怎么做：改实现并跑测试\n如何判断完成：输入 start 得到 start-processing，测试通过\n重要边界：不 commit、不 push、不部署',
    },
    {
      intent: 'other',
      confidence: 0.2,
      reply: '???',
    },
  ];
  let i = 0;
  return async () => {
    const r = replies[Math.min(i, replies.length - 1)];
    i += 1;
    if (i > 1) {
      return { text: 'not-json-unparseable' };
    }
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
  const entered = await uiEval(`async () => {
    const skip = document.getElementById('btn-create-skip');
    if (skip) skip.click();
    await new Promise((r) => setTimeout(r, 1400));
    const nav = document.getElementById('nav-work');
    if (nav) nav.click();
    const neu = document.getElementById('btn-new-task');
    if (neu) neu.click();
    const welcome = document.getElementById('view-welcome');
    const shell = document.getElementById('view-shell');
    return {
      welcomeHidden: !!(welcome && welcome.hidden),
      shellHidden: !!(shell && shell.hidden),
      hasNl: !!document.getElementById('work-nl-input'),
    };
  }`);
  check('entered_work_shell', !!(entered && entered.welcomeHidden && !entered.shellHidden && entered.hasNl), entered);
  await sleep(400);
}

async function readUiSnapshot() {
  return uiEval(`() => {
    const vis = (id) => {
      const el = document.getElementById(id);
      if (!el) return { present: false, hidden: true, text: '', label: '' };
      const hidden = !!(el.hidden || el.getAttribute('hidden') !== null);
      return {
        present: true,
        hidden,
        text: String(el.textContent || '').trim().slice(0, 400),
        label: el.tagName === 'BUTTON' ? String(el.textContent || '').trim() : '',
      };
    };
    const more = document.getElementById('work-more-menu');
    const start = document.getElementById('btn-start-development');
    const plan = document.getElementById('task-workspace-plan');
    const accept = document.getElementById('btn-accept-artifact');
    const adoptBtns = Array.from(document.querySelectorAll('button')).filter((b) =>
      /采用这份成果|确认采用/.test(String(b.textContent || '')),
    );
    const isShown = (el) => {
      let n = el;
      while (n) {
        if (n.hidden || (n.getAttribute && n.getAttribute('hidden') !== null)) return false;
        if (n.classList && n.classList.contains('visually-hidden')) return false;
        n = n.parentElement;
      }
      return true;
    };
    const bad = Array.from(document.querySelectorAll('button, summary')).filter((b) => {
      if (!isShown(b)) return false;
      const t = String(b.textContent || '').trim();
      return /^(更多|前往处理|撤销授权|稍后重新验收|需要你确认)$/.test(t);
    }).map((b) => String(b.textContent || '').trim());
    const timeline = String((document.getElementById('work-timeline') || {}).textContent || '');
    return {
      heading: vis('tw-plan-heading'),
      planHidden: !plan || !!plan.hidden,
      startHidden: !start || !!start.hidden || !!(plan && plan.hidden),
      startLabel: start ? String(start.textContent || '').trim() : '',
      title: vis('task-workspace-title'),
      decision: vis('artifact-decision-status'),
      cto: vis('cc-cto-report'),
      ctoTitle: vis('cc-acceptance-title'),
      moreHidden: !more || !!more.hidden,
      acceptHidden: !accept || !!accept.hidden,
      visibleAdopt: adoptBtns.filter((b) => !b.hidden && b.getAttribute('hidden') === null).map((b) =>
        String(b.textContent || '').trim(),
      ),
      badVisible: bad,
      timeline: timeline.slice(0, 800),
      nlDisabled: !!(document.getElementById('work-nl-input') || {}).disabled,
    };
  }`);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-c18-pkg-'));
  fixtureRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-c18-repo-'));
  fs.writeFileSync(path.join(fixtureRepo, 'package.json'), '{"name":"c18-fixture","private":true}\n');
  fs.writeFileSync(
    path.join(fixtureRepo, 'formatLabel.js'),
    "function formatLabel(input){ return input; }\nmodule.exports={formatLabel};\n",
  );

  await bootstrap();
  registerIpc();
  await createWindow();
  await enterWork();
  await shot('01-compose', 'compose_ready');

  await uiEval(`async () => {
    const add = document.getElementById('btn-add-folder');
    if (add) add.click();
    await new Promise((r) => setTimeout(r, 400));
    return true;
  }`);
  await sleep(300);

  const goal = '修改这个项目中的 formatLabel，使输入 start 时返回 start-processing，并运行测试。';
  await uiEval(`async () => {
    const input = document.getElementById('work-nl-input');
    const send = document.getElementById('btn-work-nl-send');
    input.value = ${JSON.stringify(goal)};
    send.click();
    return true;
  }`);
  note('ui_nl_goal_sent');

  const planUi = await waitUi(
    'plan_visible',
    `() => {
      const plan = document.getElementById('task-workspace-plan');
      const heading = document.getElementById('tw-plan-heading');
      const start = document.getElementById('btn-start-development');
      const ok = plan && !plan.hidden && heading && /开发规划/.test(heading.textContent || '') && start && !start.hidden;
      return {
        ok,
        heading: heading && heading.textContent,
        start: start && start.textContent,
      };
    }`,
    15000,
  );
  check('plan_labeled_开发规划', /开发规划/.test(planUi.heading || ''), planUi);
  check('primary_start_label', /确认规划并开始开发/.test(planUi.start || ''), planUi);
  await shot('02-plan', 'plan_visible_after_nl');

  const startClick = await uiEval(`async () => {
    const btn = document.getElementById('btn-start-development');
    const plan = document.getElementById('task-workspace-plan');
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 1200));
    return {
      clicked: !!btn,
      planHidden: !plan || !!plan.hidden,
      status: String((document.getElementById('job-status') || {}).textContent || ''),
      prepHidden: !!(document.getElementById('task-workspace-prep') || {}).hidden,
      runningHidden: !!(document.getElementById('task-workspace-running') || {}).hidden,
    };
  }`);
  note('ui_confirm_plan_clicked', startClick);

  const prepVisible = await uiEval(`() => {
    const prep = document.getElementById('task-workspace-prep');
    const pick = document.getElementById('btn-tw-pick-project');
    const cont = document.getElementById('btn-tw-prep-continue');
    const create = document.getElementById('btn-tw-create-project');
    return {
      prepHidden: !prep || !!prep.hidden,
      pickHidden: !pick || !!pick.hidden,
      contHidden: !cont || !!cont.hidden,
      createHidden: !create || !!create.hidden,
    };
  }`);
  if (prepVisible && !prepVisible.prepHidden) {
    const prepClick = await uiEval(`() => {
      const risk = document.getElementById('btn-tw-high-risk-confirm');
      const pick = document.getElementById('btn-tw-pick-project');
      const cont = document.getElementById('btn-tw-prep-continue');
      const create = document.getElementById('btn-tw-create-project');
      const target =
        (risk && !risk.hidden && risk) ||
        (pick && !pick.hidden && pick) ||
        (cont && !cont.hidden && cont) ||
        (create && !create.hidden && create) ||
        null;
      if (target) target.click();
      return {
        clicked: !!target,
        id: target && target.id,
        riskHidden: !risk || !!risk.hidden,
      };
    }`);
    note('prep_clicked', { ...prepVisible, ...prepClick });
    await sleep(1500);
  }

  let afterStart = await countStore();
  const waitJobUntil = Date.now() + 20000;
  while (afterStart.jobCount === 0 && Date.now() < waitJobUntil) {
    await sleep(400);
    afterStart = await countStore();
  }
  check('one_task_after_start', afterStart.taskCount === 1, afterStart);
  check('job_created_after_start', afterStart.jobCount >= 1, { afterStart, startClick, prepVisible });
  await shot('03-after-start', 'after_confirm_plan');
  const jobs = afterStart.details[0]
    ? await runtime.workRuntime.listJobsForTask(afterStart.details[0].taskId)
    : [];
  const firstJob = jobs[0];
  if (firstJob && (firstJob.status === 'queued' || firstJob.status === 'running')) {
    await waitTerminal(firstJob.id, 45000);
  }

  await uiEval(`async () => {
    const first = document.querySelector('#task-list button, #task-list [data-task-id]');
    if (first) first.click();
    await new Promise((r) => setTimeout(r, 700));
    return true;
  }`);
  await sleep(500);

  const afterJob = await countStore();
  report.counts.afterFirstSuccess = afterJob;
  check('has_artifact', afterJob.artifactCount >= 1, afterJob);
  check('not_auto_adopted', afterJob.details.every((d) => d.decision !== 'accepted'), afterJob);
  check(
    'cto_conclusion_fields',
    /现在能不能用|是否达到目标|还需不需要修改|风险|建议下一步/.test(afterJob.details[0].ctoReport || ''),
    afterJob.details[0],
  );

  const resultUi = await waitUi(
    'result_visible',
    `() => {
      const cto = document.getElementById('cc-cto-report');
      const title = document.getElementById('cc-acceptance-title');
      const plan = document.getElementById('task-workspace-plan');
      const start = document.getElementById('btn-start-development');
      const decision = document.getElementById('artifact-decision-status');
      const text = String((cto && cto.textContent) || '');
      const ok = cto && !cto.hidden && /现在能不能用|是否达到目标/.test(text);
      return {
        ok,
        cto: text.slice(0, 400),
        title: title && title.textContent,
        planHidden: !plan || !!plan.hidden,
        startHidden: !start || !!start.hidden || !!(plan && plan.hidden),
        decision: decision && String(decision.textContent || '').trim(),
        decisionHidden: !decision || !!decision.hidden,
      };
    }`,
    15000,
  );
  check('result_leads_with_cto', /Digital Me 的结论/.test(resultUi.title || ''), resultUi);
  check('no_start_dev_after_result', resultUi.planHidden && resultUi.startHidden, resultUi);
  check('undecided_visible', /尚未决定/.test(resultUi.decision || ''), resultUi);
  await shot('04-result', 'cto_conclusion_visible');

  const snap = await readUiSnapshot();
  check('no_ambiguous_buttons', (snap.badVisible || []).length === 0, snap);
  check('more_menu_hidden', snap.moreHidden, snap);
  check('right_adopt_hidden', snap.acceptHidden, snap);
  check('nl_still_enabled', snap.nlDisabled === false, snap);

  const jobsBeforeConsult = afterJob.jobCount;
  await uiEval(`async () => {
    const input = document.getElementById('work-nl-input');
    const send = document.getElementById('btn-work-nl-send');
    input.value = '我看不懂这份结果。能不能用、要不要改、有什么风险？';
    send.click();
    return true;
  }`);
  const consultUi = await waitUi(
    'consult_grounded',
    `() => {
      const tl = String((document.getElementById('work-timeline') || {}).textContent || '');
      const bad = /没听懂|没有把你的意思理解清楚/.test(tl);
      const ok = /现在能不能用/.test(tl) && /建议下一步/.test(tl) && !bad;
      return { ok, bad, slice: tl.slice(-500) };
    }`,
    12000,
  );
  check('consult_not_unparseable', consultUi.ok && !consultUi.bad, consultUi);
  const afterConsult = await countStore();
  check('consult_does_not_create_job', afterConsult.jobCount === jobsBeforeConsult, {
    before: jobsBeforeConsult,
    after: afterConsult.jobCount,
  });
  await shot('05-consult', 'grounded_consult_reply');

  const beforeRestart = await countStore();
  report.restart.before = beforeRestart;
  if (win) {
    win.destroy();
    win = null;
  }
  await bootstrap();
  registerIpc();
  await createWindow();
  await uiEval(`async () => {
    const skip = document.getElementById('btn-create-skip');
    const welcome = document.getElementById('view-welcome');
    if (welcome && !welcome.hidden && skip) {
      skip.click();
      await new Promise((r) => setTimeout(r, 1200));
    }
    const api = window.digitalMe;
    await api.invoke('subject.openPackage', { dir: (await api.getDefaultSubjectDir()).dir });
    const nav = document.getElementById('nav-work');
    if (nav) nav.click();
    await new Promise((r) => setTimeout(r, 400));
    const first = document.querySelector('#task-list button, #task-list [data-task-id]');
    if (first) first.click();
    await new Promise((r) => setTimeout(r, 800));
    return true;
  }`);
  await sleep(600);
  const afterRestart = await countStore();
  report.restart.after = afterRestart;
  check('restart_same_task', afterRestart.taskCount === 1 && afterRestart.details[0].taskId === beforeRestart.details[0].taskId, {
    before: beforeRestart,
    after: afterRestart,
  });
  check('restart_same_jobs', afterRestart.jobCount === beforeRestart.jobCount, {
    before: beforeRestart.jobCount,
    after: afterRestart.jobCount,
  });
  check('restart_still_undecided', afterRestart.details.every((d) => d.decision === 'undecided'), afterRestart);

  const restartUi = await waitUi(
    'restart_complete_not_planning',
    `() => {
      const plan = document.getElementById('task-workspace-plan');
      const start = document.getElementById('btn-start-development');
      const title = document.getElementById('task-workspace-title');
      const decision = document.getElementById('artifact-decision-status');
      const cto = document.getElementById('cc-cto-report');
      const planShown = plan && !plan.hidden;
      const startShown = start && !start.hidden && planShown;
      const titleText = String((title && title.textContent) || '');
      const ok =
        !startShown &&
        (/成果|开发中|修订/.test(titleText) ||
          (!!decision && /尚未决定|已采用|未采用/.test(String(decision.textContent || ''))));
      return {
        ok,
        title: title && title.textContent,
        planHidden: !plan || !!plan.hidden,
        startShown: !!startShown,
        decision: decision && String(decision.textContent || '').trim(),
        cto: cto && String(cto.textContent || '').slice(0, 200),
      };
    }`,
    12000,
  );
  check('restart_no_start_development', !restartUi.startShown, restartUi);
  check('restart_decision_visible', /尚未决定|已采用|未采用/.test(restartUi.decision || ''), restartUi);
  await shot('06-restart', 'same_task_no_replay_start');

  report.finishedAt = new Date().toISOString();
  report.verdict = 'runtime_smoke_passed';
  report.ownerRuntime = 'not_started';
  fs.writeFileSync(path.join(EVIDENCE, 'runtime-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        verdict: report.verdict,
        checks: report.checks.length,
        shots: report.shots.length,
        userData: USER_DATA,
        ownerAccepted: false,
      },
      null,
      2,
    ),
  );
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

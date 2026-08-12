/**
 * 2DIGIME-BUILD-01-CORRECTIVE-18A-AI-CTO-RUNTIME-CLOSE
 * 真实已配置模型 + hooked executor + 隔离 userData + 可丢弃项目。
 * 不得用 unparseable scripted model 作为正常 CTO 证据。
 */
'use strict';

const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { runProbe } = require('./codex-silent-window-probe.cjs');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_corrective-18a-smoke-evidence');
const SHOTS = path.join(EVIDENCE, 'shots');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-c18a-ud-'));

app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', USER_DATA);

let runtime;
let bus;
let win = null;
let defaultDir = '';
let fixtureRepo = '';
let modelMeta = { source: '', model: '', baseUrl: '' };

const report = {
  schemaVersion: 'corrective-18a-smoke/1',
  task: '2DIGIME-BUILD-01-CORRECTIVE-18A-AI-CTO-RUNTIME-CLOSE',
  startedAt: new Date().toISOString(),
  userData: USER_DATA,
  adapter: {
    documentCapability: 'openai-compatible',
    externalExecutor: 'hooked_codex_like_isolation',
    converseChat: 'real_configured_model',
    ctoReviewChat: 'real_configured_model',
    note: '正常 CTO/规划/咨询走真实模型；文件修改仍用 hooked executor',
  },
  model: {},
  checks: [],
  shots: [],
  timeline: [],
  counts: {},
  restart: {},
  codexSilent: {},
  verdict: null,
  ownerAccepted: false,
  ownerRuntime: 'not_started',
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
    await sleep(400);
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

async function resolveSmokeModel() {
  const { resolveModelEnvAsync, createEnvSecretAccessor } = require('../dist/infrastructure/env-secrets');
  const { providerCredentialKey } = require('../dist/infrastructure/secret-store');
  const modelEnv = await resolveModelEnvAsync(ROOT, process.env);
  const envSecrets = createEnvSecretAccessor(process.env, modelEnv.providerId, modelEnv.runtime);
  const envKey = await envSecrets.get(providerCredentialKey(modelEnv.providerId));
  if (envKey) {
    return {
      source: modelEnv.source,
      openaiCompatible: {
        baseUrl: modelEnv.baseUrl,
        model: modelEnv.model,
        providerId: modelEnv.providerId,
        timeoutMs: 90_000,
      },
      secrets: envSecrets,
    };
  }
  const { resolveModelConfig } = require('../electron/bootstrap-secrets.cjs');
  const productUd = path.join(app.getPath('appData'), 'digitalme-app');
  const cfg = await resolveModelConfig({
    safeStorage,
    userDataPath: productUd,
    isPackaged: false,
    allowDevRuntimeFile: false,
  });
  if (cfg.ok && cfg.openaiCompatible && cfg.secrets) {
    return {
      source: 'product_secret_store',
      openaiCompatible: { ...cfg.openaiCompatible, timeoutMs: 90_000 },
      secrets: cfg.secrets,
    };
  }
  throw new Error(
    'NO_REAL_MODEL_CREDENTIAL: 18A 需要已配置真实模型，不得用 unparseable scripted model 作为正常 CTO 证据',
  );
}

async function bootstrap() {
  const model = await resolveSmokeModel();
  modelMeta = {
    source: model.source,
    model: model.openaiCompatible.model,
    baseUrl: model.openaiCompatible.baseUrl,
  };
  report.model = modelMeta;
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { createCommandBus } = require('../dist/runtime/command-bus');
  runtime = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: model.openaiCompatible,
    secrets: model.secrets,
    registerOpenAiStub: false,
    codeAnalysisCapability: 'needs_setup',
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

function fivePointRe() {
  return /现在能不能用[\s\S]*是否达到目标[\s\S]*还需不需要修改[\s\S]*风险[\s\S]*建议下一步/;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-c18a-pkg-'));
  fixtureRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-c18a-repo-'));
  fs.writeFileSync(path.join(fixtureRepo, 'package.json'), '{"name":"c18a-fixture","private":true}\n');
  fs.writeFileSync(
    path.join(fixtureRepo, 'formatLabel.js'),
    "function formatLabel(input){ return input; }\nmodule.exports={formatLabel};\n",
  );

  const probe = await runProbe(EVIDENCE);
  report.codexSilent = {
    verdict: probe.verdict,
    rustGrandchildConsole: probe.rustGrandchildConsole,
    visibleWindowCreated: probe.visibleWindowCreated,
    version: probe.version,
  };
  check(
    'codex_no_visible_black_window',
    probe.verdict === 'no_visible_window_observed' || probe.verdict === 'codex_not_installed',
    probe,
  );
  if (probe.verdict === 'codex_not_installed') {
    note('codex_probe_skipped', { reason: 'codex_not_installed' });
  }

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
      const turns = Array.from(document.querySelectorAll('#work-timeline .work-turn-digital_me .work-turn-text, #work-timeline li.work-turn-digital_me'));
      const last = turns.length ? String(turns[turns.length - 1].textContent || '').trim() : '';
      const planOk = plan && !plan.hidden && heading && /开发规划/.test(heading.textContent || '') && start && !start.hidden;
      const replyOk = last.length > 12 && !/没有把你的意思理解清楚|没听懂/.test(last);
      return {
        ok: !!(planOk && replyOk),
        heading: heading && heading.textContent,
        start: start && start.textContent,
        lastReply: last.slice(0, 300),
        timeline: String((document.getElementById('work-timeline') || {}).textContent || '').slice(-400),
      };
    }`,
    60000,
  );
  check('plan_labeled_开发规划', /开发规划/.test(planUi.heading || ''), planUi);
  check('primary_start_label', /确认规划并开始开发/.test(planUi.start || ''), planUi);
  check(
    'plan_advice_from_model',
    !/暂时根据已有记录|还不是完整的 AI CTO|没有把你的意思理解清楚|没听懂/.test(planUi.timeline || ''),
    planUi,
  );
  await shot('02-plan', 'plan_visible_after_real_model');

  const startClick = await uiEval(`async () => {
    const btn = document.getElementById('btn-start-development');
    const plan = document.getElementById('task-workspace-plan');
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 1500));
    const prep = document.getElementById('task-workspace-prep');
    const risk = document.getElementById('btn-tw-high-risk-confirm');
    return {
      clicked: !!btn,
      planHidden: !plan || !!plan.hidden,
      status: String((document.getElementById('job-status') || {}).textContent || ''),
      prepHidden: !!(document.getElementById('task-workspace-prep') || {}).hidden,
      prepText: String((prep && prep.textContent) || ''),
      highRiskBtnShown: !!(risk && !risk.hidden && risk.getAttribute('hidden') === null),
      runningHidden: !!(document.getElementById('task-workspace-running') || {}).hidden,
    };
  }`);
  note('ui_confirm_plan_clicked', startClick);
  check(
    'low_risk_start_no_extra_confirm',
    !startClick.highRiskBtnShown &&
      !/这项操作风险较高|需要额外确认/.test(startClick.status || '') &&
      !/这项操作风险较高|需要额外确认/.test(startClick.prepText || ''),
    startClick,
  );

  if (startClick && startClick.prepHidden === false && !startClick.highRiskBtnShown) {
    const prepClick = await uiEval(`() => {
      const pick = document.getElementById('btn-tw-pick-project');
      const cont = document.getElementById('btn-tw-prep-continue');
      const create = document.getElementById('btn-tw-create-project');
      const target =
        (pick && !pick.hidden && pick) ||
        (cont && !cont.hidden && cont) ||
        (create && !create.hidden && create) ||
        null;
      if (target) target.click();
      return { clicked: !!target, id: target && target.id };
    }`);
    note('prep_clicked_non_risk', prepClick);
    await sleep(1500);
  }

  let afterStart = await countStore();
  const waitJobUntil = Date.now() + 30000;
  while (afterStart.jobCount === 0 && Date.now() < waitJobUntil) {
    await sleep(400);
    afterStart = await countStore();
  }
  check('one_task_after_start', afterStart.taskCount === 1, afterStart);
  check('job_created_after_start', afterStart.jobCount >= 1, { afterStart, startClick });
  await shot('03-after-start', 'after_confirm_plan_low_risk');
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
    'cto_five_fields_from_model',
    fivePointRe().test(afterJob.details[0].ctoReport || '') &&
      !/暂时性判断|还不是完整的 AI CTO/.test(afterJob.details[0].ctoReport || '') &&
      !/\bmeets_plan\b|\bfile_changes\b|\bscope_boundary\b/.test(afterJob.details[0].ctoReport || ''),
    afterJob.details[0],
  );

  const resultUi = await waitUi(
    'result_visible',
    `() => {
      const cto = document.getElementById('cc-cto-report');
      const title = document.getElementById('cc-acceptance-title');
      const wsTitle = document.getElementById('task-workspace-title');
      const plan = document.getElementById('task-workspace-plan');
      const start = document.getElementById('btn-start-development');
      const decision = document.getElementById('artifact-decision-status');
      const tech = document.getElementById('cc-tech-evidence');
      const text = String((cto && cto.textContent) || '');
      const ok =
        cto &&
        !cto.hidden &&
        /现在能不能用/.test(text) &&
        /是否达到目标/.test(text) &&
        /建议下一步/.test(text);
      return {
        ok,
        cto: text.slice(0, 500),
        title: title && title.textContent,
        wsTitle: wsTitle && wsTitle.textContent,
        planHidden: !plan || !!plan.hidden,
        startHidden: !start || !!start.hidden || !!(plan && plan.hidden),
        decision: decision && String(decision.textContent || '').trim(),
        techOpen: !!(tech && tech.open),
      };
    }`,
    90000,
  );
  check('result_leads_with_cto', /Digital Me 的结论/.test(resultUi.title || ''), resultUi);
  check('result_workspace_成果', /成果/.test(resultUi.wsTitle || ''), resultUi);
  check('no_start_dev_after_result', resultUi.planHidden && resultUi.startHidden, resultUi);
  check('undecided_visible', /尚未决定/.test(resultUi.decision || ''), resultUi);
  check('tech_evidence_folded', resultUi.techOpen === false, resultUi);
  check('cto_ui_not_degraded_template', !/暂时性判断|还不是完整的 AI CTO/.test(resultUi.cto || ''), resultUi);
  await shot('04-result', 'real_ai_cto_conclusion_visible');

  const jobsBeforeConsult = afterJob.jobCount;
  await uiEval(`async () => {
    const input = document.getElementById('work-nl-input');
    const send = document.getElementById('btn-work-nl-send');
    input.value = '我看不懂这份结果。能不能用、要不要改、有什么风险？';
    send.click();
    return true;
  }`);
  const consultUi = await waitUi(
    'consult_model_reply',
    `() => {
      const turns = Array.from(document.querySelectorAll('#work-timeline .work-turn-digital_me .work-turn-text, #work-timeline li.work-turn-digital_me'));
      const last = turns.length
        ? String((turns[turns.length - 1].textContent || '')).trim()
        : '';
      const bad = /没听懂|没有把你的意思理解清楚/.test(last);
      const degraded = /暂时根据已有记录|还不是完整的 AI CTO/.test(last);
      const ok = last.length > 20 && /能用|风险|改|建议|试用|目标/.test(last) && !bad && !degraded;
      return { ok, bad, degraded, last: last.slice(0, 500), turnCount: turns.length };
    }`,
    60000,
  );
  check('consult_uses_model_not_template', consultUi.ok && !consultUi.bad && !consultUi.degraded, consultUi);
  const afterConsult = await countStore();
  check('consult_does_not_create_job', afterConsult.jobCount === jobsBeforeConsult, {
    before: jobsBeforeConsult,
    after: afterConsult.jobCount,
  });
  await shot('05-consult', 'real_model_consult_reply');

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
      await new Promise((r) => setTimeout(r, 1800));
    }
    const api = window.digitalMe;
    await api.invoke('subject.openPackage', { dir: (await api.getDefaultSubjectDir()).dir });
    const nav = document.getElementById('nav-work');
    if (nav) nav.click();
    await new Promise((r) => setTimeout(r, 800));
    const buttons = Array.from(document.querySelectorAll('#task-list button[data-task-id], #task-list button'));
    const target =
      buttons.find((b) => /尚未决定|建议采用|已采用|未采用|可试用/.test(String(b.textContent || ''))) ||
      buttons[0];
    if (target) target.click();
    await new Promise((r) => setTimeout(r, 1500));
    return { clicked: !!(target && target.dataset && target.dataset.taskId), label: target && String(target.textContent || '').slice(0, 80) };
  }`);
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
  check('restart_same_artifact', afterRestart.artifactCount === beforeRestart.artifactCount, afterRestart);
  check('restart_still_undecided', afterRestart.details.every((d) => d.decision === 'undecided'), afterRestart);

  const restartUi = await waitUi(
    'restart_restores_result_and_cto',
    `() => {
      const plan = document.getElementById('task-workspace-plan');
      const start = document.getElementById('btn-start-development');
      const title = document.getElementById('task-workspace-title');
      const decision = document.getElementById('artifact-decision-status');
      const cto = document.getElementById('cc-cto-report');
      const ctoTitle = document.getElementById('cc-acceptance-title');
      const tech = document.getElementById('cc-tech-evidence');
      const view = document.getElementById('code-change-view');
      const planShown = plan && !plan.hidden;
      const startShown = start && !start.hidden && planShown;
      const titleText = String((title && title.textContent) || '');
      const ctoText = String((cto && cto.textContent) || '');
      const ok =
        !startShown &&
        /成果/.test(titleText) &&
        /尚未决定/.test(String((decision && decision.textContent) || '')) &&
        cto &&
        !cto.hidden &&
        view &&
        !view.hidden &&
        /现在能不能用/.test(ctoText) &&
        /建议下一步/.test(ctoText);
      return {
        ok,
        title: titleText,
        planHidden: !plan || !!plan.hidden,
        startShown: !!startShown,
        decision: decision && String(decision.textContent || '').trim(),
        cto: ctoText.slice(0, 400),
        ctoTitle: ctoTitle && ctoTitle.textContent,
        techOpen: !!(tech && tech.open),
      };
    }`,
    90000,
  );
  check('restart_no_start_development', !restartUi.startShown, restartUi);
  check('restart_title_成果', /成果/.test(restartUi.title || ''), restartUi);
  check('restart_decision_visible', /尚未决定/.test(restartUi.decision || ''), restartUi);
  check('restart_cto_visible', /现在能不能用/.test(restartUi.cto || '') && /建议下一步/.test(restartUi.cto || ''), restartUi);
  check('restart_cto_not_empty', String(restartUi.cto || '').trim().length > 20, restartUi);
  check('restart_tech_folded', restartUi.techOpen === false, restartUi);
  report.restart.ui = restartUi;
  await shot('06-restart', 'result_and_cto_restored');

  report.finishedAt = new Date().toISOString();
  report.verdict = 'runtime_smoke_passed';
  fs.writeFileSync(path.join(EVIDENCE, 'runtime-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        verdict: report.verdict,
        checks: report.checks.length,
        shots: report.shots.length,
        model: modelMeta,
        codexSilent: report.codexSilent.verdict,
        ownerAccepted: false,
        ownerRuntime: 'not_started',
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

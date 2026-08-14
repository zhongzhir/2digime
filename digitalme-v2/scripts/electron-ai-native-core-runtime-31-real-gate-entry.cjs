/**
 * AI-NATIVE-CORE-RUNTIME-31-REAL-GATE Electron 入口。
 * require 真实 electron/main.cjs。禁止 Fake / hooked adapter。不改产品代码。
 */
'use strict';

const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PHASE = String(process.env.DIGITALME_31_PHASE || '').trim();
const EVIDENCE = process.env.DIGITALME_31_EVIDENCE;
const USER_DATA = process.env.DIGITALME_31_USER_DATA;
const FIXTURE = process.env.DIGITALME_31_FIXTURE;
const GOAL = process.env.DIGITALME_31_GOAL || '';

if (!EVIDENCE || !USER_DATA || !FIXTURE || !PHASE) {
  console.error('DIGITALME_31 env missing');
  process.exit(2);
}

fs.mkdirSync(EVIDENCE, { recursive: true });
app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', USER_DATA);
process.env.DIGITALME_V2_ALLOW_DEV_CREDENTIAL = '1';
delete process.env.DIGITALME_V2_UX_ACCEPTANCE;
delete process.env.DIGITALME_FORCE_FAKE;

const FORBIDDEN = ['请先确认当前计划', '已暂停自动修改'];
const RACE_V2 = 'RACE-PROBE-31-V2-MUST-NOT-EXECUTE';

const report = {
  ok: false,
  phase: PHASE,
  layer: 'boot',
  goal: GOAL,
  confirmClicks: 0,
  startedAt: new Date().toISOString(),
  timeline: [],
  checks: [],
};

function write() {
  fs.writeFileSync(path.join(EVIDENCE, `${PHASE}-progress.json`), `${JSON.stringify(report, null, 2)}\n`);
}

function note(name, detail) {
  report.timeline.push({ at: new Date().toISOString(), name, detail: detail || null });
  write();
}

function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  write();
  if (!ok) {
    const err = new Error(`CHECK_FAILED:${name}`);
    err.detail = detail;
    throw err;
  }
}

function fail(layer, reason, extra) {
  report.ok = false;
  report.layer = layer;
  report.uniqueBlocker = reason;
  if (extra) report.extra = extra;
  write();
  fs.writeFileSync(path.join(EVIDENCE, `${PHASE}-fail.json`), `${JSON.stringify(report, null, 2)}\n`);
  setTimeout(() => app.exit(1), 500);
}

function done() {
  report.ok = true;
  report.layer = 'done';
  write();
  fs.writeFileSync(path.join(EVIDENCE, `${PHASE}-done.json`), `${JSON.stringify(report, null, 2)}\n`);
  setTimeout(() => app.exit(0), 500);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ui(win, fnSource, ...args) {
  return win.webContents.executeJavaScript(
    `(${fnSource})(${args.map((a) => JSON.stringify(a)).join(',')})`,
    true,
  );
}

async function waitUi(win, name, fnSource, timeoutMs, ...fnArgs) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await ui(win, fnSource, ...fnArgs);
    if (last && last.ok) return last;
    await sleep(1200);
  }
  throw Object.assign(new Error(`waitUi timeout: ${name}`), { last });
}

function findRuntimeRoot() {
  const subjects = path.join(USER_DATA, 'subjects');
  if (!fs.existsSync(subjects)) return null;
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory() && ent.name === 'runtime') return p;
      if (ent.isDirectory()) {
        const found = walk(p);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(subjects);
}

function listKind(kind) {
  const rt = findRuntimeRoot();
  if (!rt) return [];
  const dir = path.join(rt, kind);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.bak'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function jobsForTask(taskId) {
  return listKind('jobs').filter((j) => j && j.taskId === taskId);
}

function artifactsForTask(taskId) {
  return listKind('artifacts').filter((a) => a && a.taskId === taskId);
}

function readTask(taskId) {
  return listKind('tasks').find((t) => t && t.id === taskId) || null;
}

function latestTask() {
  const tasks = listKind('tasks');
  tasks.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return tasks[0] || null;
}

function artifactText(art) {
  if (!art) return '';
  const dir = art.storageDir;
  if (dir && fs.existsSync(dir)) {
    for (const name of ['result.md', 'report.md']) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    }
    const names = fs.readdirSync(dir).filter((n) => n.endsWith('.md') || n.endsWith('.txt'));
    if (names.length) return fs.readFileSync(path.join(dir, names[0]), 'utf8');
  }
  const head =
    ((art.versions || []).find((v) => v.versionId === art.headVersionId) || (art.versions || [])[0]) ||
    null;
  const ref = head && head.content && head.content.ref;
  if (ref) {
    const rt = findRuntimeRoot();
    if (rt) {
      const p = path.join(rt, 'content', String(ref).replace(/\\/g, '/'));
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    }
  }
  return '';
}

function conversationText(task) {
  const turns = (task && task.meta && task.meta.conversation && task.meta.conversation.turns) || [];
  return turns.map((t) => String(t.content || t.text || '')).join('\n');
}

function pageHasForbidden(text) {
  const hay = String(text || '');
  return FORBIDDEN.filter((p) => hay.includes(p));
}

function scanJobWorkForPlan(job, planContent) {
  const rt = findRuntimeRoot();
  if (!rt || !job) return { found: false, files: [] };
  const dir = path.join(rt, 'work', 'jobs', job.id);
  const hits = [];
  const needle = String(planContent || '').trim().slice(0, 80);
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else {
        try {
          const body = fs.readFileSync(p, 'utf8');
          if (needle && body.includes(needle)) hits.push(p);
          if (/本轮执行方案（已确认规划/.test(body)) hits.push(p);
        } catch {
          /* binary */
        }
      }
    }
  };
  walk(dir);
  return { found: hits.length > 0, files: hits.slice(0, 12), workDir: dir };
}

const origShowOpenDialog = dialog.showOpenDialog.bind(dialog);
dialog.showOpenDialog = async function patched(bw, options) {
  const opts = options || bw || {};
  const props = opts.properties || [];
  if (props.includes('openDirectory')) {
    return { canceled: false, filePaths: [FIXTURE] };
  }
  return origShowOpenDialog(bw, options);
};

let started = false;

async function enterWork(win) {
  await sleep(1600);
  await ui(win, `async () => {
    const skip = document.getElementById('btn-create-skip');
    if (skip) skip.click();
    await new Promise((r) => setTimeout(r, 1400));
    const nav = document.getElementById('nav-work');
    if (nav) nav.click();
    await new Promise((r) => setTimeout(r, 600));
    return true;
  }`);
}

async function newTaskAttachFolder(win) {
  await ui(win, `async () => {
    const neu = document.getElementById('btn-new-task');
    if (neu) neu.click();
    await new Promise((r) => setTimeout(r, 500));
    const add = document.getElementById('btn-add-folder');
    if (add) add.click();
    await new Promise((r) => setTimeout(r, 900));
    return true;
  }`);
  await sleep(700);
}

async function sendGoal(win, goal) {
  note('nl_sent', { goal });
  await ui(
    win,
    `async (goal) => {
      const input = document.getElementById('work-nl-input');
      const send = document.getElementById('btn-work-nl-send');
      if (!input || !send) return { ok: false, reason: 'no_nl_controls' };
      input.value = goal;
      send.click();
      return true;
    }`,
    goal,
  );
}

const PLAN_PROBE = `() => {
  const plan = document.getElementById('task-workspace-plan');
  const heading = String((document.getElementById('tw-plan-heading') || {}).textContent || '');
  const start = document.getElementById('btn-start-development');
  const ver = String((document.getElementById('tw-plan-version') || {}).textContent || '');
  const status = String((document.getElementById('job-status') || {}).textContent || '');
  const actionable = String((document.getElementById('job-actionable') || {}).textContent || '');
  const body = String(document.body.innerText || '');
  const turns = Array.from(document.querySelectorAll('#work-timeline .work-turn-text, #work-timeline .work-turn'));
  const last = turns.length ? String(turns[turns.length - 1].textContent || '').trim() : '';
  const startReady = !!(start && !start.disabled && start.offsetParent !== null);
  const planVisible = !!(plan && !plan.hidden && startReady);
  const failed = /规划生成失败|理解或规划生成失败|模型连接不可用/.test(last + status + body);
  return {
    ok: planVisible && !failed,
    settled: planVisible || failed,
    heading,
    ver,
    lastReply: last.slice(0, 800),
    status,
    actionable,
    failed,
    startReady,
    bodySlice: body.slice(0, 2500),
  };
}`;

async function waitPlan(win) {
  const wait = PLAN_PROBE.replace('ok: planVisible && !failed', 'ok: planVisible || failed');
  let planUi = await waitUi(win, 'plan', wait, 150000);
  if (planUi.failed) {
    note('plan_retry', { lastReply: planUi.lastReply });
    await sendGoal(win, GOAL);
    planUi = await waitUi(win, 'plan_retry', wait, 150000);
  }
  check('plan_visible', !!(planUi && planUi.ok && !planUi.failed), planUi);
  return planUi;
}

async function waitExec(win, timeoutMs) {
  return waitUi(
    win,
    'job_terminal',
    `() => {
      const status = String((document.getElementById('job-status') || {}).textContent || '');
      const actionable = String((document.getElementById('job-actionable') || {}).textContent || '');
      const body = String(document.body.innerText || '');
      const prep = /代码执行能力|开发前还需完成准备|请先连接|尚未检测/.test(status + actionable);
      const failed = /没有做成|执行失败|未能完成|受阻/.test(status + actionable);
      const done = /已经做完|请看结论|请决定是否采用|建议采用|可以试用|需要继续修改|还不能采用|现在能不能用|验收说明暂未完成/.test(
        status + actionable + body,
      );
      return {
        ok: done || failed || prep,
        status,
        actionable,
        prep,
        failed,
        done,
        bodySlice: body.slice(0, 3000),
      };
    }`,
    timeoutMs,
  );
}

async function captureCto(win) {
  return waitUi(
    win,
    'cto',
    `() => {
      const nodes = Array.from(document.querySelectorAll('#work-timeline .work-turn'));
      const turns = nodes.map((el) => ({
        kind: String(el.dataset.turnKind || ''),
        text: String((el.querySelector('.work-turn-text') || el).textContent || '').trim(),
      }));
      const acc = turns.find((t) => t.kind === 'acceptance' || /现在能不能用|是否达到目标|验收说明暂未完成/.test(t.text));
      const page = String(document.body.innerText || '');
      return {
        ok: !!(acc && acc.text && acc.text.length > 20),
        cto: acc ? acc.text.slice(0, 2500) : '',
        page: page.slice(0, 4000),
        kinds: turns.map((t) => t.kind),
        startVisible: !!(
          document.getElementById('btn-start-development') &&
          document.getElementById('btn-start-development').offsetParent !== null &&
          !document.getElementById('btn-start-development').disabled
        ),
      };
    }`,
    180000,
  );
}

function assertNoForbidden(label, text) {
  const hits = pageHasForbidden(text);
  check(`${label}_no_forbidden_copy`, hits.length === 0, { hits, slice: String(text || '').slice(0, 800) });
}

function snapshotEqualsPlan(job, plan) {
  const snap = job && job.confirmedPlanSnapshot;
  const content = String((plan && plan.content) || '').trim();
  const snapContent = String((snap && snap.content) || '').trim();
  return {
    ok: !!(snap && snapContent && snapContent === content && snap.version === (plan && plan.version)),
    snapVersion: snap && snap.version,
    planVersion: plan && plan.version,
    snapPreview: snapContent.slice(0, 400),
    planPreview: content.slice(0, 400),
  };
}

async function runScenario1(win) {
  report.layer = 'ui';
  await enterWork(win);
  await newTaskAttachFolder(win);
  report.layer = 'converse';
  await sendGoal(win, GOAL);
  const planUi = await waitPlan(win);
  report.planUi = planUi;
  const taskBefore = latestTask();
  check('task_created', !!taskBefore, { taskBefore });
  const planBefore = taskBefore && taskBefore.meta && taskBefore.meta.plan;
  check('plan_draft_or_ready', !!(planBefore && planBefore.content && planBefore.version != null), planBefore);
  check(
    'not_thin',
    (taskBefore.meta && taskBefore.meta.runtimePath) !== 'thin_v1',
    { runtimePath: taskBefore.meta && taskBefore.meta.runtimePath, intentKind: taskBefore.intentKind },
  );
  report.taskId = taskBefore.id;
  report.planBefore = {
    version: planBefore.version,
    status: planBefore.status,
    contentPreview: String(planBefore.content || '').slice(0, 500),
    content: planBefore.content,
  };
  note('plan_ready', report.planBefore);

  report.layer = 'confirm';
  await ui(win, `() => {
    const start = document.getElementById('btn-start-development');
    if (start) start.click();
    return true;
  }`);
  report.confirmClicks = 1;
  note('confirm_clicked', { confirmClicks: 1 });
  await sleep(12000);
  const stillWaiting = await ui(win, `() => {
    const start = document.getElementById('btn-start-development');
    const startVisible = !!(start && !start.hidden && start.offsetParent !== null && !start.disabled);
    const status = String((document.getElementById('job-status') || {}).textContent || '');
    const body = String(document.body.innerText || '');
    const started = /已经做完|正在开始|正在生成|正在读取|请看结论|现在能不能用/.test(status + body);
    return { startVisible, started, status: status.slice(0, 200) };
  }`);
  note('confirm_followup', stillWaiting);
  if (stillWaiting && stillWaiting.startVisible && !stillWaiting.started) {
    await ui(win, `() => {
      const start = document.getElementById('btn-start-development');
      if (start && !start.disabled) start.click();
      return true;
    }`);
    report.confirmClicks = 2;
    note('confirm_reclicked', { confirmClicks: 2 });
  }

  report.layer = 'execute';
  const execUi = await waitExec(win, 420000);
  report.execUi = execUi;
  check('not_stopped_at_prep', !(execUi.prep && !execUi.done), execUi);

  await sleep(1500);
  const task = readTask(taskBefore.id);
  const jobs = jobsForTask(taskBefore.id);
  const arts = artifactsForTask(taskBefore.id);
  const planAfter = task && task.meta && task.meta.plan;
  report.planAfter = {
    version: planAfter && planAfter.version,
    status: planAfter && planAfter.status,
    contentPreview: String((planAfter && planAfter.content) || '').slice(0, 500),
  };
  report.jobCount = jobs.length;
  report.jobs = jobs.map((j) => ({
    id: j.id,
    status: j.status,
    capabilityId: j.capabilityId,
    revisionRequest: j.revisionRequest || null,
    snapshot: j.confirmedPlanSnapshot
      ? { version: j.confirmedPlanSnapshot.version, preview: String(j.confirmedPlanSnapshot.content || '').slice(0, 400) }
      : null,
  }));
  check('one_job', jobs.length === 1, { jobs: report.jobs });
  check('job_succeeded', !!(jobs[0] && jobs[0].status === 'succeeded'), { job: report.jobs[0] });
  check('no_revision_job', jobs.every((j) => !j.revisionRequest), { jobs: report.jobs });
  check('plan_same_version', planAfter && planAfter.version === planBefore.version, {
    before: planBefore.version,
    after: planAfter && planAfter.version,
  });
  check('plan_confirmed', planAfter && planAfter.status === 'confirmed', report.planAfter);
  const snapEq = snapshotEqualsPlan(jobs[0], {
    version: planBefore.version,
    content: planBefore.content,
  });
  check('job_snapshot_equals_confirmed_plan', snapEq.ok, snapEq);

  const art = arts[0];
  const body = artifactText(art);
  report.artifactId = art && art.id;
  report.artifactPreview = String(body || '').slice(0, 1200);
  check('artifact_nonempty', String(body || '').trim().length > 80, { len: String(body || '').length });
  check(
    'artifact_addresses_architecture',
    /架构|结构|模块|主线|能力/.test(body) && /问题|风险|不足|缺口/.test(body) && /建议|下一步|优先/.test(body),
    { preview: String(body || '').slice(0, 800) },
  );

  const cap = scanJobWorkForPlan(jobs[0], planBefore.content);
  const reconstructed = [
    `原始目标：${task.goal}`,
    `本轮执行方案（已确认规划第 ${jobs[0].confirmedPlanSnapshot.version} 版；必须按此方案执行，不得只按原始目标自行改写）：`,
    String(jobs[0].confirmedPlanSnapshot.content || '').trim(),
  ].join('\n\n');
  report.capabilityInput = {
    snapshotOnJob: true,
    reconstructedContainsPlan: reconstructed.includes(String(planBefore.content || '').trim()),
    persistedFiles: cap,
  };
  check('capability_input_contains_plan', report.capabilityInput.reconstructedContainsPlan, report.capabilityInput);

  const conv = conversationText(task) + '\n' + String(execUi.bodySlice || '');
  assertNoForbidden('scenario1_runtime', conv);
  const userTurns = ((task.meta && task.meta.conversation && task.meta.conversation.turns) || []).filter(
    (t) => t.role === 'user',
  );
  report.userTurns = userTurns.map((t) => String(t.content || '').slice(0, 200));
  check('single_confirm_click', report.confirmClicks >= 1 && report.confirmClicks <= 2, {
    confirmClicks: report.confirmClicks,
  });

  const ctoUi = await captureCto(win);
  report.cto = ctoUi.cto;
  report.digitalMeReply = ctoUi.cto;
  check('cto_from_real_result', ctoUi.ok, { cto: String(ctoUi.cto || '').slice(0, 800) });
  const artAfterCto = artifactsForTask(taskBefore.id)[0] || art;
  report.acceptance = artAfterCto && artAfterCto.acceptance
    ? {
        status: artAfterCto.acceptance.status,
        artifactVersionId: artAfterCto.acceptance.artifactVersionId,
        jobId: artAfterCto.acceptance.jobId,
        hasCtoReport: !!(artAfterCto.acceptance.summary && artAfterCto.acceptance.summary.ctoReport),
        ctoPreview: String(
          (artAfterCto.acceptance.summary && artAfterCto.acceptance.summary.ctoReport) ||
            artAfterCto.acceptance.failureMessage ||
            '',
        ).slice(0, 1500),
      }
    : null;
  check(
    'generic_cto_persisted',
    !!(report.acceptance && (report.acceptance.status === 'ready' || report.acceptance.status === 'failed')),
    report.acceptance,
  );
  check(
    'no_cto_dual_write',
    !!(artAfterCto && artAfterCto.acceptance && !artAfterCto.codeChange),
    { keys: artAfterCto ? Object.keys(artAfterCto) : [] },
  );
  const snapshot = jobs[0].snapshotId
    ? listKind('snapshots').find((s) => s && s.id === jobs[0].snapshotId)
    : null;
  const usedPaths = (jobs[0].materialUse && jobs[0].materialUse.usedPaths) || [];
  const usedNames = usedPaths.map((p) => String(p).replace(/\\/g, '/').split('/').pop());
  const useItems = (jobs[0].materialUse && jobs[0].materialUse.items) || [];
  const completenessItems = useItems.map((it) => ({
    path: it.path,
    displayName: String(it.path || '').replace(/\\/g, '/').split('/').pop(),
    completeness: it.completeness,
    sourceChars: it.sourceChars,
    usedChars: it.usedChars,
    full: it.completeness === 'full' && it.usedChars === it.sourceChars && it.sourceChars > 0,
  }));
  const includedCount =
    jobs[0].materialUse && typeof jobs[0].materialUse.includedCount === 'number'
      ? jobs[0].materialUse.includedCount
      : usedNames.length;
  const fullReadCount =
    jobs[0].materialUse && typeof jobs[0].materialUse.fullReadCount === 'number'
      ? jobs[0].materialUse.fullReadCount
      : completenessItems.filter((i) => i.full).length;
  const truncatedCount =
    jobs[0].materialUse && typeof jobs[0].materialUse.truncatedCount === 'number'
      ? jobs[0].materialUse.truncatedCount
      : completenessItems.filter((i) => i.completeness === 'truncated').length;
  const requiredNames = ['README.txt', 'architecture.md', 'execution.md'];
  const requiredFacts = requiredNames.map((name) => completenessItems.find((i) => i.displayName === name) || null);
  const allFull = requiredFacts.every((f) => f && f.full);
  const anyTruncated = completenessItems.some((i) => i.completeness === 'truncated');
  report.materialEvidence = {
    snapshotId: jobs[0].snapshotId || null,
    materialUse: jobs[0].materialUse || null,
    obtained: ((snapshot && snapshot.items) || []).map((it) => ({
      displayName: String(it.sourcePath || '').replace(/\\/g, '/').split('/').pop(),
      status: it.status,
      extracted: !!it.extractedTextRef,
      warning: it.warning || null,
    })),
    usedNames,
    includedCount,
    fullReadCount,
    truncatedCount,
    items: completenessItems,
    allCoreMaterialsFull: allFull,
  };
  check(
    'executor_used_project_files',
    usedNames.includes('README.txt') &&
      usedNames.includes('architecture.md') &&
      usedNames.includes('execution.md'),
    report.materialEvidence,
  );
  check(
    'material_completeness_facts',
    completenessItems.length >= 3 &&
      requiredFacts.every((f) => f && typeof f.sourceChars === 'number' && typeof f.usedChars === 'number') &&
      (allFull
        ? fullReadCount >= 3 && truncatedCount === 0
        : truncatedCount > 0 && fullReadCount !== includedCount),
    {
      includedCount,
      fullReadCount,
      truncatedCount,
      allFull,
      items: completenessItems,
    },
  );
  check(
    'acceptance_bound_to_head',
    !!(
      artAfterCto &&
      artAfterCto.acceptance &&
      artAfterCto.acceptance.artifactVersionId === artAfterCto.headVersionId
    ),
    {
      acceptanceVersion: artAfterCto && artAfterCto.acceptance && artAfterCto.acceptance.artifactVersionId,
      headVersionId: artAfterCto && artAfterCto.headVersionId,
    },
  );
  const summary = artAfterCto && artAfterCto.acceptance && artAfterCto.acceptance.summary;
  const canAdopt = !!(summary && summary.canAdoptSuggested);
  check('no_adopt_without_used_materials', usedNames.length > 0 || !canAdopt, {
    usedNames,
    canAdoptSuggested: canAdopt,
  });
  if (anyTruncated) {
    check('truncated_must_not_adopt', !canAdopt, {
      truncatedCount,
      canAdoptSuggested: canAdopt,
      items: completenessItems,
      ctoPreview: summary && summary.ctoReport,
    });
  } else {
    check('full_read_cto_may_adopt', allFull && canAdopt, {
      allFull,
      fullReadCount,
      canAdoptSuggested: canAdopt,
      primaryAction: summary && summary.primaryAction,
      ctoPreview: summary && summary.ctoReport,
    });
  }
  report.ctoConclusion = summary
    ? {
        status: artAfterCto.acceptance.status,
        artifactVersionId: artAfterCto.acceptance.artifactVersionId,
        headVersionId: artAfterCto.headVersionId,
        recommendation: summary.recommendation,
        canAdoptSuggested: summary.canAdoptSuggested,
        primaryAction: summary.primaryAction,
        goalLabel: summary.goalLabel,
        ctoReport: summary.ctoReport,
      }
    : null;
  fs.writeFileSync(
    path.join(EVIDENCE, 'scenario1-cto-evidence.json'),
    `${JSON.stringify(
      {
        materialEvidence: report.materialEvidence,
        ctoConclusion: report.ctoConclusion,
        acceptance: report.acceptance,
      },
      null,
      2,
    )}\n`,
  );
  assertNoForbidden('scenario1_page', ctoUi.page);
  check(
    'no_second_start_cta_after_success',
    !ctoUi.startVisible || /已经做完|现在能不能用|请看结论/.test(ctoUi.page),
    { startVisible: ctoUi.startVisible, page: String(ctoUi.page || '').slice(0, 600) },
  );

  fs.writeFileSync(
    path.join(EVIDENCE, 'restart-handoff.json'),
    `${JSON.stringify(
      {
        taskId: task.id,
        jobId: jobs[0].id,
        artifactId: art && art.id,
        planVersion: planAfter.version,
        snapshot: jobs[0].confirmedPlanSnapshot,
        cto: String(ctoUi.cto || '').slice(0, 1500),
      },
      null,
      2,
    )}\n`,
  );
  done();
}

async function runRestart(win) {
  const handoff = JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'restart-handoff.json'), 'utf8'));
  report.handoff = handoff;
  await enterWork(win);
  await sleep(1200);
  const selected = await ui(
    win,
    `async (taskId) => {
      const items = Array.from(document.querySelectorAll('#task-list [data-task-id], #task-list li, #task-list button'));
      let clicked = false;
      for (const el of items) {
        const id = el.getAttribute('data-task-id') || '';
        if (id === taskId || String(el.textContent || '').includes(taskId)) {
          el.click();
          clicked = true;
          break;
        }
      }
      if (!clicked && items[0]) {
        items[0].click();
        clicked = true;
      }
      await new Promise((r) => setTimeout(r, 1400));
      const start = document.getElementById('btn-start-development');
      const heading = String((document.getElementById('tw-plan-heading') || {}).textContent || '');
      const status = String((document.getElementById('job-status') || {}).textContent || '');
      const page = String(document.body.innerText || '');
      const startVisible = !!(start && !start.hidden && start.offsetParent !== null && !start.disabled);
      return {
        clicked,
        startVisible,
        heading,
        status,
        waitingConfirm: startVisible && /规划|确认/.test(heading + status),
        page: page.slice(0, 4000),
        hasCto: /现在能不能用/.test(page),
      };
    }`,
    handoff.taskId,
  );
  report.selected = selected;
  const task = readTask(handoff.taskId);
  const jobs = jobsForTask(handoff.taskId);
  const arts = artifactsForTask(handoff.taskId);
  const job = jobs.find((j) => j.id === handoff.jobId) || jobs[0];
  check('restart_same_task', !!(task && task.id === handoff.taskId), { id: task && task.id });
  check('restart_job_snapshot_persisted', !!(job && job.confirmedPlanSnapshot && job.confirmedPlanSnapshot.content), {
    snapshot: job && job.confirmedPlanSnapshot,
  });
  check(
    'restart_snapshot_unchanged',
    String((job && job.confirmedPlanSnapshot && job.confirmedPlanSnapshot.content) || '') ===
      String((handoff.snapshot && handoff.snapshot.content) || ''),
    {
      now: job && job.confirmedPlanSnapshot && String(job.confirmedPlanSnapshot.content || '').slice(0, 200),
    },
  );
  check('restart_one_job', jobs.length === 1, { jobs: jobs.map((j) => j.id) });
  check('restart_artifact_same_job', !!(arts[0] && (arts[0].id === handoff.artifactId || arts[0].jobId === handoff.jobId || arts[0].sourceJobId === handoff.jobId)), {
    arts: arts.map((a) => ({ id: a.id, jobId: a.jobId, sourceJobId: a.sourceJobId })),
  });
  const currentPlan = task && task.meta && task.meta.plan;
  check(
    'restart_execution_not_reread_current_plan_as_input',
    String((job && job.confirmedPlanSnapshot && job.confirmedPlanSnapshot.content) || '') ===
      String((handoff.snapshot && handoff.snapshot.content) || ''),
    { currentPlanVersion: currentPlan && currentPlan.version, snapshotVersion: job && job.confirmedPlanSnapshot && job.confirmedPlanSnapshot.version },
  );
  check('restart_not_waiting_reconfirm', !selected.waitingConfirm, selected);
  check('restart_cto_or_result_visible', !!(selected.hasCto || /现在能不能用|请看结论|已经做完/.test(selected.page)), {
    page: String(selected.page || '').slice(0, 800),
  });
  assertNoForbidden('restart', selected.page);
  report.cto = handoff.cto;
  done();
}

async function runRace(win) {
  report.layer = 'ui';
  await enterWork(win);
  await newTaskAttachFolder(win);
  report.layer = 'converse';
  await sendGoal(win, GOAL);
  const planUi = await waitPlan(win);
  report.planUi = planUi;
  const task = latestTask();
  check('race_task', !!task, { task });
  const plan = task.meta && task.meta.plan;
  check('race_plan_v1', !!(plan && plan.version != null && plan.content), plan);
  report.taskId = task.id;
  report.planV1 = { version: plan.version, status: plan.status, preview: String(plan.content || '').slice(0, 400) };
  const jobsBefore = jobsForTask(task.id).length;

  report.layer = 'confirm';
  const conv = await ui(
    win,
    `async (taskId) => {
      try {
        const res = await window.digitalMe.invoke('work.converse', { taskId, text: '确认' });
        return {
          ok: true,
          startAuthorized: !!res.startAuthorized,
          plan: res.plan || null,
          reply: String((res.reply || (res.newTurns && res.newTurns.map((t) => t.content).join('\\n')) || '')).slice(0, 800),
        };
      } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) };
      }
    }`,
    task.id,
  );
  note('race_confirm_converse', conv);
  check('race_confirm_invoke', !!(conv && conv.ok), conv);
  report.confirmClicks = 1;

  await sleep(400);
  const afterConfirm = readTask(task.id);
  const confirmed = afterConfirm && afterConfirm.meta && afterConfirm.meta.plan;
  check('race_confirmed_same_version', !!(confirmed && confirmed.version === plan.version && confirmed.status === 'confirmed'), {
    before: plan.version,
    after: confirmed && { version: confirmed.version, status: confirmed.status },
  });

  report.layer = 'mutate';
  const mutated = JSON.parse(JSON.stringify(afterConfirm));
  mutated.meta = mutated.meta || {};
  mutated.meta.plan = {
    ...confirmed,
    version: confirmed.version + 1,
    status: 'draft',
    content: `${RACE_V2}\n${confirmed.content}`,
    updatedAt: new Date().toISOString(),
  };
  const rt = findRuntimeRoot();
  const taskFile = path.join(rt, 'tasks', `${task.id}.json`);
  fs.writeFileSync(taskFile, `${JSON.stringify(mutated, null, 2)}\n`);
  const disk = readTask(task.id);
  check('race_v2_on_disk', disk && disk.meta.plan.version === confirmed.version + 1 && String(disk.meta.plan.content).includes(RACE_V2), {
    version: disk && disk.meta && disk.meta.plan && disk.meta.plan.version,
  });

  report.layer = 'submit';
  const submitted = await ui(
    win,
    `async (payload) => {
      try {
        const res = await window.digitalMe.invoke('work.submitTask', payload);
        return { ok: true, res };
      } catch (err) {
        return {
          ok: false,
          code: err && err.code,
          message: String(err && err.message ? err.message : err),
        };
      }
    }`,
    {
      goal: GOAL,
      contextRefs: [{ kind: 'folder', path: FIXTURE, projectOrigin: 'user_selected' }],
      requestedArtifactType: 'document',
      existingTaskId: task.id,
      confirmedPlanVersion: plan.version,
    },
  );
  report.submit = submitted;
  const mismatch =
    (submitted && submitted.code === 'plan_version_mismatch') ||
    /plan version mismatch|plan_version_mismatch|规划已更新/.test(String((submitted && submitted.message) || ''));
  check('race_plan_version_mismatch', !submitted.ok && mismatch, submitted);
  const jobsAfter = jobsForTask(task.id);
  check('race_job_count_unchanged', jobsAfter.length === jobsBefore, {
    before: jobsBefore,
    after: jobsAfter.length,
    jobs: jobsAfter.map((j) => j.id),
  });
  check(
    'race_did_not_execute_v2',
    jobsAfter.every((j) => !String((j.confirmedPlanSnapshot && j.confirmedPlanSnapshot.content) || '').includes(RACE_V2)),
    { jobs: jobsAfter },
  );
  done();
}

async function runScenario2(win) {
  report.layer = 'ui';
  const beforeFile = fs.readFileSync(path.join(FIXTURE, 'formatLabel.js'), 'utf8');
  report.fileBefore = beforeFile;
  await enterWork(win);
  await newTaskAttachFolder(win);
  report.layer = 'converse';
  await sendGoal(win, GOAL);
  const planUi = await waitPlan(win);
  report.planUi = planUi;
  const taskBefore = latestTask();
  check('s2_task', !!taskBefore, { taskBefore });
  const planBefore = taskBefore.meta && taskBefore.meta.plan;
  check('s2_plan', !!(planBefore && planBefore.content), planBefore);
  check(
    's2_thin',
    (taskBefore.meta && taskBefore.meta.runtimePath) === 'thin_v1' || taskBefore.intentKind === 'modify_code',
    { runtimePath: taskBefore.meta && taskBefore.meta.runtimePath, intentKind: taskBefore.intentKind },
  );
  report.taskId = taskBefore.id;
  report.planBefore = {
    version: planBefore.version,
    status: planBefore.status,
    content: planBefore.content,
    preview: String(planBefore.content || '').slice(0, 500),
  };

  report.layer = 'confirm';
  await ui(win, `() => {
    const start = document.getElementById('btn-start-development');
    if (start) start.click();
    return true;
  }`);
  report.confirmClicks = 1;
  note('confirm_clicked', { confirmClicks: 1 });

  report.layer = 'execute';
  const execUi = await waitExec(win, 480000);
  report.execUi = execUi;
  check('s2_not_prep', !(execUi.prep && !execUi.done), execUi);

  await sleep(1500);
  const task = readTask(taskBefore.id);
  const jobs = jobsForTask(taskBefore.id);
  const planAfter = task && task.meta && task.meta.plan;
  report.jobs = jobs.map((j) => ({
    id: j.id,
    status: j.status,
    capabilityId: j.capabilityId,
    revisionRequest: j.revisionRequest || null,
    executor: j.externalExecution || null,
    snapshot: j.confirmedPlanSnapshot
      ? { version: j.confirmedPlanSnapshot.version, preview: String(j.confirmedPlanSnapshot.content || '').slice(0, 400) }
      : null,
  }));
  check('s2_one_job', jobs.length === 1, { jobs: report.jobs });
  check('s2_job_succeeded', !!(jobs[0] && jobs[0].status === 'succeeded'), { job: report.jobs[0] });
  check('s2_no_revision_job', jobs.every((j) => !j.revisionRequest), { jobs: report.jobs });
  check('s2_plan_confirmed', planAfter && planAfter.status === 'confirmed' && planAfter.version === planBefore.version, {
    before: planBefore.version,
    after: planAfter && { version: planAfter.version, status: planAfter.status },
  });
  const snapEq = snapshotEqualsPlan(jobs[0], { version: planBefore.version, content: planBefore.content });
  check('s2_snapshot_equals_plan', snapEq.ok, snapEq);
  check(
    's2_codex_started',
    !!(
      jobs[0].externalExecution &&
      (jobs[0].externalExecution.lastExecutorStatus === 'succeeded' ||
        jobs[0].status === 'succeeded')
    ),
    { external: jobs[0].externalExecution },
  );

  const afterFile = fs.readFileSync(path.join(FIXTURE, 'formatLabel.js'), 'utf8');
  report.fileAfter = afterFile;
  check('s2_file_changed', afterFile !== beforeFile, { afterFile });
  check('s2_formatLabel_correct', /start-processing/.test(afterFile) && /function formatLabel/.test(afterFile), {
    afterFile,
  });

  const { spawnSync } = require('node:child_process');
  const nodeBin = process.env.npm_node_execpath || 'node';
  const testRun = spawnSync(nodeBin, ['formatLabel.test.js'], {
    cwd: FIXTURE,
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  report.testRun = { status: testRun.status, stdout: String(testRun.stdout || '').slice(0, 400), stderr: String(testRun.stderr || '').slice(0, 400) };
  check('s2_tests_pass', testRun.status === 0, report.testRun);

  const pkgScan = scanJobWorkForPlan(jobs[0], planBefore.content);
  let taskPackage = null;
  const pkgPath = pkgScan.files.find((f) => /task-package\.json$/.test(f));
  if (pkgPath) {
    try {
      taskPackage = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
      /* ignore */
    }
  } else {
    const rt = findRuntimeRoot();
    const guess = path.join(rt || '', 'work', 'jobs', jobs[0].id, 'external-execution', 'task-package.json');
    if (fs.existsSync(guess)) taskPackage = JSON.parse(fs.readFileSync(guess, 'utf8'));
  }
  report.taskPackageGoal = taskPackage && String(taskPackage.goal || '').slice(0, 800);
  check(
    's2_codex_package_contains_plan',
    !!(
      taskPackage &&
      String(taskPackage.goal || '').includes(String(planBefore.content || '').trim()) &&
      /本轮执行方案（已确认规划/.test(String(taskPackage.goal || ''))
    ),
    { goal: report.taskPackageGoal, files: pkgScan.files },
  );

  const conv = conversationText(task) + '\n' + String(execUi.bodySlice || '');
  assertNoForbidden('scenario2', conv);
  const ctoUi = await captureCto(win);
  report.cto = ctoUi.cto;
  check('s2_cto', ctoUi.ok, { cto: String(ctoUi.cto || '').slice(0, 800) });
  done();
}

async function run(win) {
  if (started) return;
  started = true;
  write();
  try {
    if (PHASE === 'scenario1') await runScenario1(win);
    else if (PHASE === 'restart') await runRestart(win);
    else if (PHASE === 'race') await runRace(win);
    else if (PHASE === 'scenario2') await runScenario2(win);
    else fail('boot', `unknown_phase:${PHASE}`);
  } catch (err) {
    fail(report.layer || 'unknown', String(err && err.message ? err.message : err), {
      last: err && err.last,
      detail: err && err.detail,
      stack: err && err.stack ? String(err.stack).slice(0, 2500) : '',
      checks: report.checks,
    });
  }
}

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('did-finish-load', () => {
    run(win);
  });
});

require(path.join(ROOT, 'electron', 'main.cjs'));
app.removeAllListeners('window-all-closed');
app.on('window-all-closed', () => {});

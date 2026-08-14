/**
 * AI-NATIVE-MATERIAL-AWARE-WORKFLOW-32-REAL-GATE Electron 入口。
 * require 真实 electron/main.cjs。禁止 Fake。不改产品代码。
 */
'use strict';

const { app, dialog } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PHASE = String(process.env.DIGITALME_32_PHASE || '').trim();
const EVIDENCE = process.env.DIGITALME_32_EVIDENCE;
const USER_DATA = process.env.DIGITALME_32_USER_DATA;
const FIXTURE = process.env.DIGITALME_32_FIXTURE;
const GOAL = process.env.DIGITALME_32_GOAL || '';
const IMPRINT_SRC = process.env.DIGITALME_32_IMPRINT_SRC || '';
const IMPRINT_DIGEST_BEFORE = process.env.DIGITALME_32_IMPRINT_DIGEST_BEFORE || '';

if (!EVIDENCE || !USER_DATA || !FIXTURE || !PHASE) {
  console.error('DIGITALME_32 env missing');
  process.exit(2);
}

fs.mkdirSync(EVIDENCE, { recursive: true });
app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', USER_DATA);
process.env.DIGITALME_V2_ALLOW_DEV_CREDENTIAL = '1';
delete process.env.DIGITALME_V2_UX_ACCEPTANCE;
delete process.env.DIGITALME_FORCE_FAKE;

const FORBIDDEN = ['请先确认当前计划', '已暂停自动修改'];
const BLIND_CLAIM_RE =
  /无法(直接)?(访问|读取).{0,12}(本地)?(文件夹|目录|项目)|请把.{0,20}粘贴|请粘贴.{0,20}(全文|内容|代码)/;

const report = {
  ok: false,
  phase: PHASE,
  layer: 'boot',
  goal: GOAL,
  fixture: FIXTURE,
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

function conversationText(task) {
  const turns = (task && task.meta && task.meta.conversation && task.meta.conversation.turns) || [];
  return turns.map((t) => String(t.content || t.text || '')).join('\n');
}

function assistantReplies(task) {
  const turns = (task && task.meta && task.meta.conversation && task.meta.conversation.turns) || [];
  return turns
    .filter((t) => t && t.role === 'assistant')
    .map((t) => String(t.content || t.text || ''))
    .join('\n');
}

function pageHasForbidden(text) {
  return FORBIDDEN.filter((p) => String(text || '').includes(p));
}

function hashTree(rootDir) {
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else {
        const rel = path.relative(rootDir, p).replace(/\\/g, '/');
        const buf = fs.readFileSync(p);
        files.push({
          rel,
          size: buf.length,
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        });
      }
    }
  };
  walk(rootDir);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return {
    count: files.length,
    files,
    digest: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'),
  };
}

function listChangedFiles(before, after) {
  const mapB = new Map((before.files || []).map((f) => [f.rel, f.sha256]));
  const mapA = new Map((after.files || []).map((f) => [f.rel, f.sha256]));
  const changed = [];
  for (const [rel, hash] of mapA) {
    if (mapB.get(rel) !== hash) changed.push(rel);
  }
  for (const rel of mapB.keys()) {
    if (!mapA.has(rel)) changed.push(`deleted:${rel}`);
  }
  return changed;
}

function scanJobWorkForPlan(job, planContent) {
  const rt = findRuntimeRoot();
  if (!rt || !job) return { found: false, files: [], taskPackage: null };
  const dir = path.join(rt, 'work', 'jobs', job.id);
  const hits = [];
  const needle = String(planContent || '').trim().slice(0, 80);
  let taskPackage = null;
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
          if (/task-package\.json$/.test(p)) {
            try {
              taskPackage = JSON.parse(body);
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* binary */
        }
      }
    }
  };
  walk(dir);
  return { found: hits.length > 0, files: hits.slice(0, 12), workDir: dir, taskPackage };
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
const fixtureBefore = hashTree(FIXTURE);

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
  const thinking = /正在思考/.test(status);
  const turns = Array.from(document.querySelectorAll('#work-timeline .work-turn')).map((el) => {
    const roleEl = el.querySelector('.work-turn-role, .work-turn-label, .turn-role');
    const textEl = el.querySelector('.work-turn-text') || el;
    return {
      role: String((roleEl && roleEl.textContent) || '').trim(),
      text: String((textEl && textEl.textContent) || '').trim(),
    };
  }).filter((t) => t.text);
  let lastAssistant = '';
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const t = turns[i];
    if (/^你$|^Owner$|^用户$/.test(t.role)) continue;
    lastAssistant = t.text;
    break;
  }
  const startReady = !!(start && !start.disabled && start.offsetParent !== null);
  const planVisible = !!(plan && !plan.hidden && startReady);
  const failed = !thinking && /规划生成失败|理解或规划生成失败|模型连接不可用/.test(lastAssistant + ' ' + status);
  return {
    ok: (!thinking && planVisible && !failed),
    settled: (!thinking && (planVisible || failed)),
    heading,
    ver,
    lastReply: String(lastAssistant || '').slice(0, 800),
    status,
    actionable,
    failed,
    thinking,
    startReady,
    turnCount: turns.length,
  };
}`;

async function waitPlan(win) {
  const wait = PLAN_PROBE.replace(
    'ok: (!thinking && planVisible && !failed)',
    'ok: (!thinking && (planVisible || failed))',
  );
  let planUi = await waitUi(win, 'plan', wait, 240000);
  if (planUi.failed) {
    note('plan_retry', { lastReply: planUi.lastReply });
    await sendGoal(win, GOAL);
    planUi = await waitUi(win, 'plan_retry', wait, 240000);
  }
  check('plan_visible', !!(planUi && planUi.ok && !planUi.failed && planUi.startReady), planUi);
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
      };
    }`,
    240000,
  );
}

function assertNoForbidden(label, text) {
  const hits = pageHasForbidden(text);
  check(`${label}_no_forbidden_copy`, hits.length === 0, { hits, slice: String(text || '').slice(0, 800) });
}

async function runScenario(win) {
  report.layer = 'ui';
  report.fixtureBefore = fixtureBefore;
  await enterWork(win);
  await newTaskAttachFolder(win);

  report.layer = 'converse';
  await sendGoal(win, GOAL);
  const planUi = await waitPlan(win);
  report.planUi = planUi;

  const taskBefore = latestTask();
  check('task_created', !!taskBefore, { taskBefore });
  report.taskId = taskBefore.id;

  const refs = (taskBefore.contextRefs || []).map((r) => ({ kind: r.kind, path: r.path }));
  check(
    'folder_attached',
    refs.some((r) => r.kind === 'folder' && String(r.path || '').replace(/\\/g, '/').includes(FIXTURE.replace(/\\/g, '/'))),
    { refs, fixture: FIXTURE },
  );

  const planBefore = taskBefore.meta && taskBefore.meta.plan;
  check('plan_draft_ready', !!(planBefore && planBefore.content && planBefore.version != null), {
    version: planBefore && planBefore.version,
    status: planBefore && planBefore.status,
    preview: String((planBefore && planBefore.content) || '').slice(0, 600),
  });
  report.planBefore = {
    version: planBefore.version,
    status: planBefore.status,
    content: planBefore.content,
    contentPreview: String(planBefore.content || '').slice(0, 800),
  };

  const reply = assistantReplies(taskBefore) + '\n' + String(planUi.lastReply || '');
  report.firstReplyPreview = reply.slice(0, 1500);
  check('no_blind_folder_claim', !BLIND_CLAIM_RE.test(reply), {
    preview: reply.slice(0, 1000),
  });
  check(
    'plan_mentions_real_project',
    /IMPRINT|分拣|triage|localStorage|html|csv|内容/i.test(String(planBefore.content || '') + reply),
    { planPreview: report.planBefore.contentPreview, replyPreview: reply.slice(0, 600) },
  );
  check(
    'zero_jobs_before_confirm',
    jobsForTask(taskBefore.id).length === 0,
    { jobs: jobsForTask(taskBefore.id).map((j) => j.id) },
  );
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
    const started = /已经做完|正在开始|正在生成|正在读取|请看结论|现在能不能用|正在修改|正在执行/.test(status + body);
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
  const execUi = await waitExec(win, 16 * 60 * 1000);
  report.execUi = execUi;
  check('not_stopped_at_prep', !(execUi.prep && !execUi.done), execUi);

  await sleep(2000);
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
    intentKind: j.intentKind || (task && task.intentKind) || null,
    requestedArtifactType: j.requestedArtifactType || (task && task.requestedArtifactType) || null,
    revisionRequest: j.revisionRequest || null,
    snapshot: j.confirmedPlanSnapshot
      ? {
          version: j.confirmedPlanSnapshot.version,
          preview: String(j.confirmedPlanSnapshot.content || '').slice(0, 400),
        }
      : null,
  }));

  check('exactly_one_job', jobs.length === 1, { jobs: report.jobs });
  check('job_succeeded', !!(jobs[0] && jobs[0].status === 'succeeded'), { job: report.jobs[0] });
  check('no_revision_job', jobs.every((j) => !j.revisionRequest), { jobs: report.jobs });
  check('single_confirm_click', report.confirmClicks >= 1 && report.confirmClicks <= 2, {
    confirmClicks: report.confirmClicks,
  });
  check('plan_confirmed', !!(planAfter && planAfter.status === 'confirmed'), report.planAfter);

  const capId = String((jobs[0] && jobs[0].capabilityId) || '');
  const intentKind = String((task && task.intentKind) || '');
  const artType = String(
    (task && task.requestedArtifactType) || (jobs[0] && jobs[0].requestedArtifactType) || '',
  );
  const isDocumentCap = /document|fake-document|prompt-assemble/i.test(capId);
  const isCodingCap =
    /external-executor|coding-agent|codex/i.test(capId) ||
    intentKind === 'modify_code' ||
    artType === 'code-change';
  check('coding_job_not_document', isCodingCap && !isDocumentCap, {
    capabilityId: capId,
    intentKind,
    requestedArtifactType: artType,
  });

  const fixtureAfter = hashTree(FIXTURE);
  const changed = listChangedFiles(fixtureBefore, fixtureAfter);
  report.fixtureAfter = { digest: fixtureAfter.digest, count: fixtureAfter.count };
  report.fixtureChangedFiles = changed.slice(0, 40);
  check('fixture_modified', changed.length > 0, { changed: report.fixtureChangedFiles });

  if (IMPRINT_SRC && fs.existsSync(IMPRINT_SRC) && IMPRINT_DIGEST_BEFORE) {
    const imprintNow = hashTree(IMPRINT_SRC);
    check('original_imprint_unchanged', imprintNow.digest === IMPRINT_DIGEST_BEFORE, {
      before: IMPRINT_DIGEST_BEFORE,
      after: imprintNow.digest,
    });
    report.imprintDigestAfter = imprintNow.digest;
  }

  const scan = scanJobWorkForPlan(jobs[0], planBefore.content);
  const pkgGoal = String((scan.taskPackage && scan.taskPackage.goal) || '');
  const workDirHint = String((jobs[0] && (jobs[0].workingDirectory || jobs[0].workDir)) || '');
  const pkgBrief = String(
    (scan.taskPackage &&
      (scan.taskPackage.projectBrief || scan.taskPackage.cwd || scan.taskPackage.workDir)) ||
      '',
  );
  const pkgJson = JSON.stringify(scan.taskPackage || {}).slice(0, 6000);
  const pathOk =
    workDirHint.includes(FIXTURE) ||
    pkgBrief.includes(FIXTURE) ||
    pkgBrief.includes(path.basename(FIXTURE)) ||
    pkgJson.includes(FIXTURE.replace(/\\/g, '\\\\')) ||
    pkgJson.includes(FIXTURE.replace(/\\/g, '/')) ||
    pkgGoal.includes(FIXTURE) ||
    /本地项目|IMPRINT|授权项目/.test(pkgBrief + pkgGoal);
  report.capabilityInput = {
    files: scan.files,
    packageGoalPreview: pkgGoal.slice(0, 1000),
    hasConfirmedPlanLabel: /本轮执行方案（已确认规划/.test(pkgGoal),
    hasPlanContent: pkgGoal.includes(String(planBefore.content || '').trim()),
    workDirHint,
    pkgBrief: pkgBrief.slice(0, 400),
    pathOk,
  };
  check(
    'coding_input_has_confirmed_plan',
    report.capabilityInput.hasConfirmedPlanLabel ||
      report.capabilityInput.hasPlanContent ||
      scan.found,
    report.capabilityInput,
  );
  check('coding_input_has_project_path', pathOk, {
    workDirHint,
    pkgBrief: pkgBrief.slice(0, 400),
    fixture: FIXTURE,
  });

  const conv = conversationText(task) + '\n' + String(execUi.bodySlice || '');
  assertNoForbidden('scenario', conv);

  const ctoUi = await captureCto(win);
  report.cto = ctoUi.cto;
  check('cto_visible', ctoUi.ok, { cto: String(ctoUi.cto || '').slice(0, 1000) });

  const art = arts[0] || artifactsForTask(taskBefore.id)[0];
  report.artifactId = art && art.id;
  report.acceptance = art && art.acceptance
    ? {
        status: art.acceptance.status,
        jobId: art.acceptance.jobId,
        hasCtoReport: !!(art.acceptance.summary && art.acceptance.summary.ctoReport),
        canAdoptSuggested: !!(art.acceptance.summary && art.acceptance.summary.canAdoptSuggested),
        ctoPreview: String(
          (art.acceptance.summary && art.acceptance.summary.ctoReport) ||
            art.acceptance.failureMessage ||
            '',
        ).slice(0, 1500),
      }
    : null;
  check(
    'cto_persisted',
    !!(report.acceptance && (report.acceptance.status === 'ready' || report.acceptance.status === 'failed')),
    report.acceptance,
  );

  // Auto-adopt must not happen; auto-revision jobs already checked.
  const ownerDecision = task && task.meta && task.meta.ownerDecision;
  check('no_auto_adopt', !(ownerDecision && ownerDecision === 'adopted'), { ownerDecision });

  fs.writeFileSync(
    path.join(EVIDENCE, 'restart-handoff.json'),
    `${JSON.stringify(
      {
        taskId: taskBefore.id,
        jobId: jobs[0].id,
        artifactId: art && art.id,
        planVersion: planBefore.version,
        planContent: planBefore.content,
        snapshotContent: jobs[0].confirmedPlanSnapshot && jobs[0].confirmedPlanSnapshot.content,
        fixtureDigestAfter: fixtureAfter.digest,
        changedFiles: changed,
      },
      null,
      2,
    )}\n`,
  );
  done();
}

async function runRestart(win) {
  report.layer = 'restart';
  const handoff = JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'restart-handoff.json'), 'utf8'));
  await enterWork(win);
  await sleep(2500);

  const selected = await waitUi(
    win,
    'restart_restore',
    `() => {
      const page = String(document.body.innerText || '');
      const status = String((document.getElementById('job-status') || {}).textContent || '');
      const actionable = String((document.getElementById('job-actionable') || {}).textContent || '');
      const start = document.getElementById('btn-start-development');
      const waitingConfirm = !!(start && !start.disabled && start.offsetParent !== null);
      const hasCto = /现在能不能用|请看结论|已经做完|验收说明暂未完成|是否达到目标/.test(page + status + actionable);
      return {
        ok: hasCto || /已经做完|请看结论/.test(status + actionable + page),
        waitingConfirm,
        hasCto,
        status,
        actionable,
        page: page.slice(0, 3000),
      };
    }`,
    120000,
  );

  const task = readTask(handoff.taskId) || latestTask();
  const jobs = jobsForTask(handoff.taskId);
  const arts = artifactsForTask(handoff.taskId);
  const job = jobs.find((j) => j.id === handoff.jobId) || jobs[0];

  check('restart_same_task', !!(task && task.id === handoff.taskId), { id: task && task.id });
  check('restart_one_job', jobs.length === 1, { jobs: jobs.map((j) => ({ id: j.id, status: j.status })) });
  check(
    'restart_job_snapshot_persisted',
    !!(job && job.confirmedPlanSnapshot && job.confirmedPlanSnapshot.content),
    { snap: job && job.confirmedPlanSnapshot && String(job.confirmedPlanSnapshot.content).slice(0, 400) },
  );
  check(
    'restart_snapshot_unchanged',
    String((job && job.confirmedPlanSnapshot && job.confirmedPlanSnapshot.content) || '') ===
      String(handoff.snapshotContent || ''),
    {},
  );
  check(
    'restart_artifact_same_job',
    !!(arts[0] && (arts[0].id === handoff.artifactId || arts[0].jobId === handoff.jobId || arts[0].sourceJobId === handoff.jobId)),
    { arts: arts.map((a) => a.id) },
  );
  check('restart_not_waiting_reconfirm', !selected.waitingConfirm, selected);
  check('restart_cto_or_result_visible', !!(selected.hasCto || /现在能不能用|请看结论|已经做完/.test(selected.page)), {
    status: selected.status,
    actionable: selected.actionable,
  });
  assertNoForbidden('restart', selected.page);
  done();
}

async function run(win) {
  if (started) return;
  started = true;
  write();
  try {
    if (PHASE === 'scenario') await runScenario(win);
    else if (PHASE === 'restart') await runRestart(win);
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

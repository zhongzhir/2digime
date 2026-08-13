/**
 * 2DIGIME-BUILD-01-CTO-REAL-MAIN-GATE-20A
 * Electron 入口：require 真实 electron/main.cjs，驱动 Owner 同款页面主链。
 * 禁止 hooked/Fake/scripted model。不改产品代码。
 */
'use strict';

const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = process.env.DIGITALME_20A_EVIDENCE || path.join(ROOT, 'scripts', '_cto-real-main-gate-20a-evidence');
const SHOTS = path.join(EVIDENCE, 'shots');
const USER_DATA = process.env.DIGITALME_20A_USER_DATA;
const FIXTURE = process.env.DIGITALME_20A_FIXTURE;
const PHASE = String(process.env.DIGITALME_20A_PHASE || '1');
const BLACK_PHASE_FILE = path.join(EVIDENCE, 'black-window-active-phase.json');

if (!USER_DATA || !FIXTURE) {
  console.error('DIGITALME_20A_USER_DATA / DIGITALME_20A_FIXTURE required');
  process.exit(2);
}

fs.mkdirSync(SHOTS, { recursive: true });
app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', USER_DATA);
process.env.DIGITALME_V2_ALLOW_DEV_CREDENTIAL = '1';
delete process.env.DIGITALME_V2_UX_ACCEPTANCE;
delete process.env.DIGITALME_FORCE_FAKE;

const local = {
  phase: PHASE,
  checks: [],
  timeline: [],
  // 黑窗持续采样必须在外层 Node 进程；Electron 主线程禁止 spawnSync PowerShell
  black: { delegatedToOuter: true, phases: [] },
};

function writeLocal(name) {
  fs.writeFileSync(path.join(EVIDENCE, name), `${JSON.stringify(local, null, 2)}\n`);
}

function note(name, detail) {
  local.timeline.push({ at: new Date().toISOString(), name, detail });
  writeLocal(`phase${PHASE}-progress.json`);
}

function check(name, ok, detail) {
  local.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  writeLocal(`phase${PHASE}-progress.json`);
  if (!ok) {
    const err = new Error(`CHECK_FAILED: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
    err.productDefectSuspected = !!(detail && detail.productDefectSuspected);
    throw err;
  }
}

function failMarker(err) {
  fs.writeFileSync(
    path.join(EVIDENCE, `phase${PHASE}-fail.json`),
    `${JSON.stringify(
      {
        ok: false,
        error: String(err && err.stack ? err.stack : err),
        productDefectSuspected: !!(err && err.productDefectSuspected),
        checks: local.checks,
        timeline: local.timeline,
        black: local.black,
      },
      null,
      2,
    )}\n`,
  );
}

function doneMarker(payload) {
  fs.writeFileSync(
    path.join(EVIDENCE, `phase${PHASE}-done.json`),
    `${JSON.stringify({ ok: true, ...payload, checks: local.checks, black: local.black }, null, 2)}\n`,
  );
}

function setBlackPhase(label) {
  const payload = { label, at: new Date().toISOString() };
  local.black.phases.push(payload);
  fs.writeFileSync(BLACK_PHASE_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  writeLocal(`phase${PHASE}-progress.json`);
}

function clearBlackPhase() {
  try {
    fs.unlinkSync(BLACK_PHASE_FILE);
  } catch {
    /* ignore */
  }
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
    await sleep(1000);
  }
  throw new Error(`waitUi timeout: ${name} last=${JSON.stringify(last)}`);
}

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  const file = path.join(SHOTS, `${name}.png`);
  fs.writeFileSync(file, img.toPNG());
  note('shot', { name, file });
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

function countJson(dir) {
  if (!dir || !fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.bak')).length;
}

function listJsonIds(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.bak'))
    .map((f) => f.replace(/\.json$/, ''));
}

function readRuntimeJson(kind, id) {
  const rt = findRuntimeRoot();
  if (!rt || !id) return null;
  const p = path.join(rt, kind, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function snapArtifact(art) {
  if (!art) return null;
  const versions = Array.isArray(art.versions) ? art.versions : [];
  const head = versions.find((v) => v.versionId === art.headVersionId);
  return {
    id: art.id,
    jobId: art.jobId || null,
    headVersionId: art.headVersionId || null,
    versionCount: versions.length,
    versionIds: versions.map((v) => v.versionId),
    headCreatedAt: head && head.createdAt ? head.createdAt : null,
    headNote: head && head.note ? head.note : null,
  };
}

function revisionCompletion() {
  const p = path.join(ROOT, 'dist', 'work-runtime', 'revision-completion.js');
  return require(p);
}

function copyCapturedRuntime() {
  const rt = findRuntimeRoot();
  if (!rt) return { ok: false, reason: 'no_runtime' };
  const dest = path.join(EVIDENCE, 'captured-runtime');
  fs.mkdirSync(dest, { recursive: true });
  for (const name of ['jobs', 'artifacts', 'tasks']) {
    const src = path.join(rt, name);
    const out = path.join(dest, name);
    fs.mkdirSync(out, { recursive: true });
    if (!fs.existsSync(src)) continue;
    for (const f of fs.readdirSync(src)) {
      if (!f.endsWith('.json')) continue;
      fs.copyFileSync(path.join(src, f), path.join(out, f));
    }
  }
  const fixtureDest = path.join(dest, 'fixture-project');
  fs.mkdirSync(fixtureDest, { recursive: true });
  for (const f of fs.readdirSync(FIXTURE)) {
    const src = path.join(FIXTURE, f);
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(fixtureDest, f));
  }
  return { ok: true, dest, runtime: rt };
}

function readLatestTask() {
  const rt = findRuntimeRoot();
  if (!rt) return null;
  const tasksDir = path.join(rt, 'tasks');
  if (!fs.existsSync(tasksDir)) return null;
  const files = fs
    .readdirSync(tasksDir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.bak'))
    .map((f) => path.join(tasksDir, f));
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return JSON.parse(fs.readFileSync(files[0], 'utf8'));
}

function parseCtoFive(text) {
  const raw = String(text || '');
  const fields = {
    canUse: '',
    goalAttained: '',
    needChange: '',
    risks: '',
    nextStep: '',
  };
  const patterns = [
    ['canUse', /现在能不能用[：:]\s*([^\n]+)/],
    ['goalAttained', /是否达到目标[：:]\s*([^\n]+)/],
    ['needChange', /还需不需要修改[：:]\s*([^\n]+)/],
    ['risks', /需要你知道的风险[：:]\s*([^\n]+)/],
    ['nextStep', /建议下一步[：:]\s*([^\n]+)/],
  ];
  for (const [key, re] of patterns) {
    const m = raw.match(re);
    if (m) fields[key] = String(m[1] || '').trim();
  }
  const missing = Object.entries(fields)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return { fields, missing, ok: missing.length === 0 };
}

function extractPlanSnapshot(task) {
  const plan = task && task.meta && task.meta.plan;
  return plan
    ? {
        version: plan.version,
        status: plan.status,
        source: plan.source || null,
        content: String(plan.content || ''),
      }
    : null;
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
  await ui(win, `async () => {
    const skip = document.getElementById('btn-create-skip');
    if (skip) skip.click();
    await new Promise((r) => setTimeout(r, 1600));
    const nav = document.getElementById('nav-work');
    if (nav) nav.click();
    await new Promise((r) => setTimeout(r, 600));
    return true;
  }`);
}

async function runPhase1(win) {
  note('phase1_start', { title: win.getTitle() });
  await sleep(1800);
  await enterWork(win);
  await ui(win, `async () => {
    const neu = document.getElementById('btn-new-task');
    if (neu) neu.click();
    return true;
  }`);
  await sleep(700);
  await shot(win, '01-compose');

  const noStart = await ui(win, `() => {
    const btn = document.getElementById('btn-submit');
    const visible = !!(btn && !btn.hidden && btn.getAttribute('hidden') == null && btn.offsetParent !== null);
    return { ok: !visible, visible, label: btn ? String(btn.textContent || '') : '' };
  }`);
  check('no_start_submit_before_plan', noStart.ok, noStart);

  await ui(win, `async () => {
    const add = document.getElementById('btn-add-folder');
    if (add) add.click();
    await new Promise((r) => setTimeout(r, 900));
    return true;
  }`);
  await sleep(900);

  const goal =
    '修改这个项目中的 formatLabel，使输入 start 时返回 start-processing，并运行测试。';
  const uniqueRevisionMarker = `20A-本地验证标记-${Date.now().toString(36)}`;
  await ui(
    win,
    `async (goal) => {
      const input = document.getElementById('work-nl-input');
      const send = document.getElementById('btn-work-nl-send');
      input.value = goal;
      send.click();
      return true;
    }`,
    goal,
  );
  note('nl_goal_sent', { goal });

  const planUi = await waitUi(
    win,
    'plan_v1',
    `() => {
      const plan = document.getElementById('task-workspace-plan');
      const heading = document.getElementById('tw-plan-heading');
      const start = document.getElementById('btn-start-development');
      const submit = document.getElementById('btn-submit');
      const submitVisible = !!(submit && !submit.hidden && submit.offsetParent !== null);
      const ver = String((document.getElementById('tw-plan-version') || {}).textContent || '');
      const turns = Array.from(document.querySelectorAll('#work-timeline .work-turn-digital_me, #work-timeline li.work-turn-digital_me'));
      const last = turns.length ? String(turns[turns.length - 1].textContent || '').trim() : '';
      const planOk = plan && !plan.hidden && heading && /开发规划/.test(heading.textContent || '') && start && !start.hidden;
      const replyOk = last.length > 12 && !/规划生成失败|没有把你的意思理解清楚|没听懂/.test(last);
      return { ok: !!(planOk && replyOk && !submitVisible), ver, lastReply: last.slice(0, 500), submitVisible };
    }`,
    240000,
  );
  check('first_plan_visible', planUi.ok, planUi);
  await shot(win, '02-plan-v1');

  const taskBeforeRev = readLatestTask();
  const planBefore = extractPlanSnapshot(taskBeforeRev);
  check('plan_v1_persisted', !!(planBefore && planBefore.version >= 1 && planBefore.source !== 'seed_internal'), planBefore);
  const jobsBeforePlanRev = countJson(path.join(findRuntimeRoot() || '', 'jobs'));

  await ui(
    win,
    `async (text) => {
      const input = document.getElementById('work-nl-input');
      const send = document.getElementById('btn-work-nl-send');
      input.value = text;
      send.click();
      return true;
    }`,
    `请修订规划：必须加入专属要求「${uniqueRevisionMarker}」，并说明改完后用本地测试确认。`,
  );

  const minPlanVersion = Number(planBefore && planBefore.version ? planBefore.version : 1);
  const planV2 = await waitUi(
    win,
    'plan_v2',
    `async (minVersion, marker) => {
      const verText = String((document.getElementById('tw-plan-version') || {}).textContent || '');
      const m = verText.match(/v\\s*(\\d+)/i);
      const version = m ? Number(m[1]) : 0;
      const body = [
        document.getElementById('tw-plan-goal'),
        document.getElementById('tw-plan-delivery'),
        document.getElementById('tw-plan-path'),
        document.getElementById('tw-plan-prep'),
        document.getElementById('tw-plan-bounds'),
        document.getElementById('task-workspace-plan'),
      ].map((el) => (el ? String(el.textContent || '') : '')).join('\\n');
      const hasMarker = body.includes(marker);
      return {
        ok: version > minVersion && (hasMarker || version > minVersion),
        version,
        verText,
        hasMarker,
        body: body.slice(0, 1200),
      };
    }`,
    180000,
    minPlanVersion,
    uniqueRevisionMarker,
  );

  // Disk must show strict increase; do not pass solely because v1 already mentions 测试
  let taskAfterRev = null;
  let planAfter = null;
  {
    const start = Date.now();
    while (Date.now() - start < 60000) {
      taskAfterRev = readLatestTask();
      planAfter = extractPlanSnapshot(taskAfterRev);
      if (planAfter && planBefore && planAfter.version > planBefore.version) break;
      await sleep(1000);
    }
  }
  const jobsAfterPlanRev = countJson(path.join(findRuntimeRoot() || '', 'jobs'));
  const versionGrew = !!(planAfter && planBefore && planAfter.version > planBefore.version);
  const markerInPlan =
    !!(planAfter && String(planAfter.content || '').includes(uniqueRevisionMarker)) ||
    !!(planV2 && planV2.hasMarker);
  const contentGrewBeyondTestKeyword =
    !!(planAfter && planBefore) &&
    String(planAfter.content || '') !== String(planBefore.content || '') &&
    (markerInPlan || String(planAfter.content || '').length > String(planBefore.content || '').length);
  check('plan_revision_version_strictly_increased', versionGrew, {
    before: planBefore,
    after: planAfter,
    ui: planV2,
    productDefectSuspected: true,
  });
  check('plan_revision_contains_new_requirement', markerInPlan && contentGrewBeyondTestKeyword, {
    marker: uniqueRevisionMarker,
    beforeLen: planBefore && String(planBefore.content || '').length,
    afterLen: planAfter && String(planAfter.content || '').length,
    content: planAfter && planAfter.content,
    productDefectSuspected: true,
  });
  check('plan_revision_zero_jobs', jobsAfterPlanRev === jobsBeforePlanRev && jobsAfterPlanRev === 0, {
    jobsBeforePlanRev,
    jobsAfterPlanRev,
    productDefectSuspected: true,
  });
  await shot(win, '03-plan-v2');

  // Confirm + first real Codex exec (黑窗由外层持续采样；此处只打相位标记)
  setBlackPhase('first_exec');
  note('confirm_plan_click', { version: planAfter.version });
  await ui(win, `async () => {
    const btn = document.getElementById('btn-start-development');
    if (btn) btn.click();
    return !!btn;
  }`);

  const fileV1 = await (async () => {
    const start = Date.now();
    let lastBody = '';
    let lastUi = null;
    let fileOkAt = 0;
    while (Date.now() - start < 480000) {
      try {
        lastBody = fs.readFileSync(path.join(FIXTURE, 'formatLabel.js'), 'utf8');
        if (/start-processing/.test(lastBody) && !fileOkAt) fileOkAt = Date.now();
      } catch {
        /* ignore */
      }
      try {
        lastUi = await ui(win, `() => {
          const status = String((document.getElementById('job-status') || {}).textContent || '');
          const body = String(document.body.innerText || '');
          const failed = /失败|无法完成|出错|中断/.test(status + body.slice(-400));
          const settled =
            /已完成|可以验收|成果|现在能不能用/.test(status + body) &&
            !/仍在处理|开发中/.test(status);
          return { status: status.slice(0, 200), failed, settled };
        }`);
        if (lastUi && lastUi.failed && Date.now() - start > 60000) {
          return { ok: false, body: lastBody, ui: lastUi };
        }
      } catch {
        /* ignore */
      }
      // 文件已改后，仍须等到 Job/成果落盘，避免竞态误判无 Artifact
      if (fileOkAt) {
        const rtNow = findRuntimeRoot();
        const arts = listJsonIds(path.join(rtNow || '', 'artifacts'));
        const jobsDir = path.join(rtNow || '', 'jobs');
        let jobSucceeded = false;
        try {
          for (const id of listJsonIds(jobsDir)) {
            const j = JSON.parse(fs.readFileSync(path.join(jobsDir, `${id}.json`), 'utf8'));
            if (j && j.status === 'succeeded') jobSucceeded = true;
            if (j && (j.status === 'failed' || j.status === 'cancelled')) {
              return { ok: false, body: lastBody, ui: lastUi, job: j };
            }
          }
        } catch {
          /* ignore transient rename */
        }
        if (arts.length >= 1 || jobSucceeded || (lastUi && lastUi.settled)) {
          return { ok: true, body: lastBody, ui: lastUi, arts, jobSucceeded };
        }
      }
      await sleep(1500);
    }
    return { ok: false, body: lastBody, ui: lastUi, timedOut: true };
  })();
  // wait CTO / artifact settle a bit
  await sleep(2500);
  clearBlackPhase();
  check('codex_first_exec_modified_file', fileV1.ok, {
    body: String(fileV1.body || '').slice(0, 400),
    ui: fileV1.ui || null,
    productDefectSuspected: true,
  });
  await shot(win, '04-after-first-exec');

  const rt = findRuntimeRoot();
  const jobsAfterExec = listJsonIds(path.join(rt || '', 'jobs'));
  const artsAfterExec = listJsonIds(path.join(rt || '', 'artifacts'));
  check('first_exec_created_job', jobsAfterExec.length >= 1, { jobsAfterExec });
  check('first_exec_created_artifact', artsAfterExec.length >= 1, {
    artsAfterExec,
    productDefectSuspected: true,
  });

  const ctoUi = await waitUi(
    win,
    'cto_five',
    `() => {
      const text = String(document.body.innerText || '');
      return { ok: /现在能不能用[：:]/.test(text) && /建议下一步[：:]/.test(text), text: text.slice(-2500) };
    }`,
    240000,
  );
  const cto1 = parseCtoFive(ctoUi.text);
  check('cto_five_fields_all_nonempty', cto1.ok, cto1);
  note('cto_five_v1', cto1.fields);
  await shot(win, '05-cto');

  // Consult
  const jobsBeforeConsult = countJson(path.join(rt || '', 'jobs'));
  const replyBeforeConsult = await ui(win, `() => {
    const turns = Array.from(document.querySelectorAll('#work-timeline .work-turn-digital_me, #work-timeline li.work-turn-digital_me'));
    const last = turns.length ? String(turns[turns.length - 1].textContent || '') : '';
    return { last: last.slice(0, 800), turnCount: turns.length };
  }`);
  await ui(win, `async () => {
    const input = document.getElementById('work-nl-input');
    const send = document.getElementById('btn-work-nl-send');
    input.value = '能不能用？是否达到目标？还需要修改吗？有什么风险？建议下一步是什么？';
    send.click();
    return true;
  }`);
  const consult = await waitUi(
    win,
    'consult',
    `async (beforeLast, beforeCount) => {
      const turns = Array.from(document.querySelectorAll('#work-timeline .work-turn-digital_me, #work-timeline li.work-turn-digital_me'));
      const last = turns.length ? String(turns[turns.length - 1].textContent || '') : '';
      const bad = /规划生成失败|没听懂|没有把你的意思理解清楚|暂时无法理解/.test(last);
      const grounded = /能不能用|达到目标|风险|下一步|可用|成果|formatLabel|start-processing/.test(last);
      const changed = last.length > 30 && last !== beforeLast && turns.length > beforeCount;
      return { ok: changed && !bad && grounded, last: last.slice(0, 1000), turnCount: turns.length };
    }`,
    180000,
    replyBeforeConsult.last || '',
    replyBeforeConsult.turnCount || 0,
  );
  const jobsAfterConsult = countJson(path.join(rt || '', 'jobs'));
  check('consult_grounded_no_degrade', consult.ok, {
    before: replyBeforeConsult.last,
    after: consult.last,
  });
  check('consult_jobs_unchanged', jobsAfterConsult === jobsBeforeConsult, {
    jobsBeforeConsult,
    jobsAfterConsult,
  });
  await shot(win, '06-consult');

  // 等咨询 converse 完全结束（发送钮可用）再发修订，避免并发 work.converse
  await waitUi(
    win,
    'nl_ready_after_consult',
    `() => {
      const send = document.getElementById('btn-work-nl-send');
      const ready = !!(send && !send.disabled);
      return { ok: ready, disabled: !!(send && send.disabled) };
    }`,
    120000,
  );

  // NL revision → new job/artifact + file change to done
  const jobsBeforeRev = listJsonIds(path.join(rt || '', 'jobs'));
  const artsBeforeRev = listJsonIds(path.join(rt || '', 'artifacts'));
  const artBeforeSnap = snapArtifact(readRuntimeJson('artifacts', artsBeforeRev[0]));
  const fileBeforeRev = fs.readFileSync(path.join(FIXTURE, 'formatLabel.js'), 'utf8');
  const cto1Fields = cto1.fields;
  setBlackPhase('revision_exec');
  const turnsBeforeRev = await ui(win, `() => {
    const turns = Array.from(document.querySelectorAll('#work-timeline .work-turn-digital_me, #work-timeline li.work-turn-digital_me, #work-timeline .work-turn-user, #work-timeline li.work-turn-user'));
    return { count: turns.length };
  }`);
  await ui(win, `async () => {
    const input = document.getElementById('work-nl-input');
    const send = document.getElementById('btn-work-nl-send');
    input.value = '按你说的改吧：把 start 的返回值改成 done，并同步测试。';
    send.click();
    return true;
  }`);

  // 先等到「用户修订原文 + Digital Me 回复」或修订 Job 启动（不得因乐观用户气泡提前放行）
  const revConverse = await waitUi(
    win,
    'revision_converse_or_job',
    `async (beforeCount) => {
      const nodes = Array.from(document.querySelectorAll('#work-timeline li, #work-timeline .work-turn-digital_me, #work-timeline .work-turn-user'));
      let sawUserRev = false;
      let sawReplyAfter = false;
      let last = '';
      for (const n of nodes) {
        const t = String(n.textContent || '');
        const cls = String(n.className || '');
        const isUser = /work-turn-user|\\buser\\b/.test(cls) || /^你[:：]/.test(t) || t.startsWith('按你说的改');
        if (isUser && /按你说的改|改成\\s*done|返回值改成/.test(t)) sawUserRev = true;
        if (sawUserRev && !isUser && t.length > 24) {
          sawReplyAfter = true;
          last = t;
        }
      }
      const status = String((document.getElementById('job-status') || {}).textContent || '');
      const running = /正在按你的修改|开发中|正在修改/.test(status);
      const bad = /规划生成失败|没听懂|没有把你的意思理解清楚|暂时无法理解/.test(last);
      return {
        ok: !bad && ((sawUserRev && (sawReplyAfter || running)) || running),
        bad,
        sawUserRev,
        sawReplyAfter,
        turnCount: nodes.length,
        beforeCount,
        last: last.slice(0, 240),
        status: status.slice(0, 160),
      };
    }`,
    300000,
    turnsBeforeRev.count || 0,
  );
  note('revision_converse', revConverse);

  const fileRev = await (async () => {
    const start = Date.now();
    let body = fileBeforeRev;
    let lastUi = null;
    let lastJob = null;
    const { revisionArtifactAdvanced } = revisionCompletion();
    while (Date.now() - start < 480000) {
      try {
        body = fs.readFileSync(path.join(FIXTURE, 'formatLabel.js'), 'utf8');
      } catch {
        /* ignore */
      }
      const rtNow = findRuntimeRoot();
      const jobsNow = listJsonIds(path.join(rtNow || '', 'jobs'));
      const newIds = jobsNow.filter((id) => !jobsBeforeRev.includes(id));
      if (newIds.length > 1) {
        return { ok: false, reason: 'duplicate_revision_jobs', body, newIds };
      }
      if (newIds.length === 1) {
        lastJob = readRuntimeJson('jobs', newIds[0]);
        if (lastJob && (lastJob.status === 'failed' || lastJob.status === 'cancelled')) {
          return { ok: false, reason: 'revision_job_failed', body, job: lastJob, ui: lastUi };
        }
        if (
          lastJob &&
          lastJob.status === 'succeeded' &&
          !lastJob.failure &&
          /done/.test(body) &&
          body !== fileBeforeRev
        ) {
          const artId = lastJob.artifactId || lastJob.targetArtifactId || artsBeforeRev[0];
          const artSnap = snapArtifact(readRuntimeJson('artifacts', artId));
          const advanced = revisionArtifactAdvanced(artBeforeSnap, artSnap);
          if (advanced) {
            return {
              ok: true,
              body,
              job: lastJob,
              artSnap,
              newJobs: newIds,
            };
          }
        }
      }
      try {
        lastUi = await ui(win, `() => {
          const status = String((document.getElementById('job-status') || {}).textContent || '');
          const bodyText = String(document.body.innerText || '');
          const failed = /执行失败，尚未产生可确认的成果|这项任务执行失败/.test(status + bodyText);
          return { status: status.slice(0, 200), failed };
        }`);
        if (lastUi && lastUi.failed && Date.now() - start > 120000) {
          return { ok: false, reason: 'ui_failed', body, ui: lastUi, job: lastJob };
        }
      } catch {
        /* ignore */
      }
      await sleep(2000);
    }
    return { ok: false, reason: 'timeout', body, job: lastJob, ui: lastUi };
  })();
  await sleep(2000);
  clearBlackPhase();

  const jobsAfterRev = listJsonIds(path.join(findRuntimeRoot() || '', 'jobs'));
  const artsAfterRev = listJsonIds(path.join(findRuntimeRoot() || '', 'artifacts'));
  const newJobs = jobsAfterRev.filter((id) => !jobsBeforeRev.includes(id));
  const newArts = artsAfterRev.filter((id) => !artsBeforeRev.includes(id));
  const revJob = (fileRev && fileRev.job) || (newJobs[0] ? readRuntimeJson('jobs', newJobs[0]) : null);
  const revArtId =
    (revJob && (revJob.artifactId || revJob.targetArtifactId)) || artsAfterRev[0] || artsBeforeRev[0];
  const artAfterSnap = snapArtifact(readRuntimeJson('artifacts', revArtId));
  const { revisionArtifactAdvanced, headVersionBoundToJob, ctoFieldsDiffer } = revisionCompletion();
  const artAdvanced = revisionArtifactAdvanced(artBeforeSnap, artAfterSnap);

  check('revision_created_new_job', newJobs.length === 1, {
    jobsBeforeRev,
    jobsAfterRev,
    newJobs,
  });
  check(
    'revision_job_succeeded',
    !!(
      revJob &&
      revJob.status === 'succeeded' &&
      !revJob.failure &&
      !revJob.error
    ),
    {
      jobId: revJob && revJob.id,
      status: revJob && revJob.status,
      failure: revJob && revJob.failure,
      artifactId: revJob && revJob.artifactId,
      targetArtifactId: revJob && revJob.targetArtifactId,
    },
  );
  check('revision_created_new_artifact', artAdvanced, {
    artsBeforeRev,
    artsAfterRev,
    newArts,
    before: artBeforeSnap,
    after: artAfterSnap,
  });
  const bound = headVersionBoundToJob(readRuntimeJson('artifacts', revArtId), newJobs[0] || '');
  check('revision_artifact_bound_to_second_job', bound.ok, bound);
  check('revision_file_changed_to_done', fileRev.ok && /done/.test(fileRev.body), {
    before: fileBeforeRev.slice(0, 300),
    after: String(fileRev.body || '').slice(0, 300),
    reason: fileRev.reason || null,
  });
  await shot(win, '07-revision');

  const cto2Wait = await (async () => {
    const start = Date.now();
    let last = { ok: false, failed: false, fields: {}, text: '' };
    while (Date.now() - start < 240000) {
      const raw = await ui(win, `() => {
        const text = String(document.body.innerText || '');
        const failed = /执行失败，尚未产生可确认的成果|这项任务执行失败/.test(text);
        return { text: text.slice(-3500), failed };
      }`);
      const parsed = parseCtoFive(raw && raw.text);
      last = {
        ok: parsed.ok,
        failed: !!(raw && raw.failed),
        fields: parsed.fields,
        missing: parsed.missing,
        text: (raw && raw.text) || '',
      };
      if (parsed.ok && !last.failed && ctoFieldsDiffer(cto1Fields, parsed.fields)) return last;
      await sleep(2000);
    }
    return last;
  })();
  check('cto_five_after_revision_all_nonempty', cto2Wait.ok && !cto2Wait.failed, cto2Wait);
  check('revision_cto_not_identical_to_first', ctoFieldsDiffer(cto1Fields, cto2Wait.fields), {
    first: cto1Fields,
    second: cto2Wait.fields,
    headCreatedAtBefore: artBeforeSnap && artBeforeSnap.headCreatedAt,
    headCreatedAtAfter: artAfterSnap && artAfterSnap.headCreatedAt,
    headVersionIdBefore: artBeforeSnap && artBeforeSnap.headVersionId,
    headVersionIdAfter: artAfterSnap && artAfterSnap.headVersionId,
  });
  const cto2 = { ok: cto2Wait.ok, fields: cto2Wait.fields, missing: cto2Wait.missing || [] };

  const taskFinal = readLatestTask();
  const handoff = {
    taskId: taskFinal && taskFinal.id,
    goal: taskFinal && taskFinal.goal,
    plan: extractPlanSnapshot(taskFinal),
    jobs: jobsAfterRev,
    artifacts: artsAfterRev,
    cto: cto2.fields,
    ctoFirst: cto1Fields,
    revisionJobId: newJobs[0] || null,
    artifactBefore: artBeforeSnap,
    artifactAfter: artAfterSnap,
    formatLabel: String(fileRev.body || '').slice(0, 500),
    uniqueRevisionMarker,
    ownerDecision: null,
  };
  // try read ownerDecision from artifact content via UI text if present
  const decisionProbe = await ui(win, `() => {
    const text = String(document.body.innerText || '');
    let ownerDecision = null;
    if (/已采用/.test(text)) ownerDecision = 'accepted';
    else if (/未采用/.test(text)) ownerDecision = 'rejected';
    else if (/尚未决定|等待/.test(text)) ownerDecision = 'undecided';
    return { ownerDecision, hasStartSubmit: /开始处理/.test(text) && !!document.getElementById('btn-submit') && !document.getElementById('btn-submit').hidden };
  }`);
  handoff.ownerDecision = decisionProbe.ownerDecision;
  check(
    'revision_owner_decision_not_auto_adopted',
    handoff.ownerDecision === 'undecided' || handoff.ownerDecision === 'rejected',
    { ownerDecision: handoff.ownerDecision },
  );
  const captured = copyCapturedRuntime();
  note('captured_runtime', captured);
  fs.writeFileSync(path.join(EVIDENCE, 'restart-handoff.json'), `${JSON.stringify(handoff, null, 2)}\n`);
  note('handoff_written', handoff);

  doneMarker({ handoff });
  setTimeout(() => app.exit(0), 800);
}

async function runPhase2(win) {
  note('phase2_restart_start', { title: win.getTitle() });
  const handoff = JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'restart-handoff.json'), 'utf8'));
  await sleep(1800);
  await enterWork(win);
  await sleep(1200);
  await shot(win, '08-restart');

  // Prefer selecting existing task if listed
  const selected = await ui(
    win,
    `async (taskId) => {
      const items = Array.from(document.querySelectorAll('[data-task-id], .task-item, #task-list button, #task-list li'));
      let clicked = false;
      for (const el of items) {
        const id = el.getAttribute('data-task-id') || '';
        const text = String(el.textContent || '');
        if ((taskId && id === taskId) || (taskId && text.includes(taskId)) || /formatLabel|等待|成果|决定/.test(text)) {
          el.click();
          clicked = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 1200));
      const submit = document.getElementById('btn-submit');
      const submitVisible = !!(submit && !submit.hidden && submit.offsetParent !== null && /开始处理/.test(submit.textContent || ''));
      const planHeading = String((document.getElementById('tw-plan-heading') || {}).textContent || '');
      const startDev = document.getElementById('btn-start-development');
      const startDevVisible = !!(startDev && !startDev.hidden && startDev.offsetParent !== null);
      const body = String(document.body.innerText || '');
      return {
        clicked,
        submitVisible,
        startDevVisible,
        planHeading,
        hasCto: /现在能不能用[：:]/.test(body) && /建议下一步[：:]/.test(body),
        failedUi: /执行失败|尚未产生可确认的成果|尚未产生成果/.test(body),
        bodySlice: body.slice(0, 2500),
      };
    }`,
    handoff.taskId,
  );

  check('restart_no_start_submit', !selected.submitVisible, selected);
  check('restart_not_initial_planning_cta', !(selected.startDevVisible && /开发规划/.test(selected.planHeading)), selected);
  check('restart_ui_not_failed', !selected.failedUi, {
    failedUi: selected.failedUi,
    bodySlice: selected.bodySlice,
  });

  const cto = parseCtoFive(selected.bodySlice);
  check('restart_cto_five_restored', cto.ok, cto);
  if (handoff.cto) {
    const { ctoFieldsFingerprint } = revisionCompletion();
    const latestFp = ctoFieldsFingerprint(cto.fields);
    const expectedFp = ctoFieldsFingerprint(handoff.cto);
    check('restart_cto_matches_latest_revision', latestFp === expectedFp && Boolean(latestFp), {
      restored: cto.fields,
      expected: handoff.cto,
    });
  }

  const task = readLatestTask();
  check('restart_same_task', !!(task && task.id === handoff.taskId), {
    expected: handoff.taskId,
    actual: task && task.id,
  });
  const jobsNow = listJsonIds(path.join(findRuntimeRoot() || '', 'jobs'));
  check('restart_two_jobs', jobsNow.length === 2, { jobsNow, expected: handoff.jobs });
  const revJobId = handoff.revisionJobId || (handoff.jobs && handoff.jobs[1]);
  const revJob = readRuntimeJson('jobs', revJobId);
  check('restart_revision_job_succeeded', !!(revJob && revJob.status === 'succeeded' && !revJob.failure), {
    jobId: revJobId,
    status: revJob && revJob.status,
    failure: revJob && revJob.failure,
  });
  const artNow = snapArtifact(readRuntimeJson('artifacts', (handoff.artifacts && handoff.artifacts[0]) || null));
  const { revisionArtifactAdvanced } = revisionCompletion();
  check(
    'restart_artifact_version_chain',
    revisionArtifactAdvanced(handoff.artifactBefore, artNow),
    { before: handoff.artifactBefore, after: artNow },
  );
  const fileNow = fs.readFileSync(path.join(FIXTURE, 'formatLabel.js'), 'utf8');
  check('restart_file_still_revised', /done/.test(fileNow), { fileNow: fileNow.slice(0, 300) });

  doneMarker({
    selected,
    cto: cto.fields,
    taskId: task && task.id,
    handoffTaskId: handoff.taskId,
  });
  setTimeout(() => app.exit(0), 800);
}

async function runAutomation(win) {
  if (started) return;
  started = true;
  try {
    if (PHASE === '2') await runPhase2(win);
    else await runPhase1(win);
  } catch (err) {
    failMarker(err);
    console.error(err);
    setTimeout(() => app.exit(1), 500);
  }
}

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('did-finish-load', () => {
    runAutomation(win);
  });
});

require(path.join(ROOT, 'electron', 'main.cjs'));
app.removeAllListeners('window-all-closed');
app.on('window-all-closed', () => {
  // keep alive until automation exits explicitly
});

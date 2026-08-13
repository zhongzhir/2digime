/**
 * THIN-26 真实闭环驱动：require electron/main.cjs。
 * Owner 一次自然语言 + 一次确认。不改产品代码。
 */
'use strict';

const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = process.env.DIGITALME_THIN26_EVIDENCE;
const USER_DATA = process.env.DIGITALME_THIN26_USER_DATA;
const FIXTURE = process.env.DIGITALME_THIN26_FIXTURE;
const GOAL = process.env.DIGITALME_THIN26_GOAL ||
  '通读这个项目，让 formatLabel 在输入 start 时返回 start-processing，并跑测试。';

if (!EVIDENCE || !USER_DATA || !FIXTURE) {
  console.error('THIN26 env missing');
  process.exit(2);
}

fs.mkdirSync(EVIDENCE, { recursive: true });
app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', USER_DATA);
process.env.DIGITALME_V2_ALLOW_DEV_CREDENTIAL = '1';
delete process.env.DIGITALME_V2_UX_ACCEPTANCE;
delete process.env.DIGITALME_FORCE_FAKE;

const report = {
  ok: false,
  layer: 'boot',
  goal: GOAL,
  confirmClicks: 0,
  startedAt: new Date().toISOString(),
  timeline: [],
};

function write() {
  fs.writeFileSync(path.join(EVIDENCE, 'REAL_LOOP.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function note(name, detail) {
  report.timeline.push({ at: new Date().toISOString(), name, detail });
  write();
}

function fail(layer, reason, extra) {
  report.ok = false;
  report.layer = layer;
  report.uniqueBlocker = reason;
  if (extra) report.extra = extra;
  write();
  fs.writeFileSync(path.join(EVIDENCE, 'fail.json'), `${JSON.stringify(report, null, 2)}\n`);
  setTimeout(() => app.exit(1), 400);
}

function done() {
  report.ok = true;
  write();
  fs.writeFileSync(path.join(EVIDENCE, 'done.json'), `${JSON.stringify(report, null, 2)}\n`);
  setTimeout(() => app.exit(0), 400);
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
    await sleep(1500);
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

function latestJson(kind) {
  const rt = findRuntimeRoot();
  if (!rt) return null;
  const dir = path.join(rt, kind);
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.bak'))
    .map((f) => path.join(dir, f));
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return JSON.parse(fs.readFileSync(files[0], 'utf8'));
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

async function run(win) {
  if (started) return;
  started = true;
  report.layer = 'ui';
  write();
  try {
    await sleep(1600);
    await ui(win, `async () => {
      const skip = document.getElementById('btn-create-skip');
      if (skip) skip.click();
      await new Promise((r) => setTimeout(r, 1400));
      const nav = document.getElementById('nav-work');
      if (nav) nav.click();
      await new Promise((r) => setTimeout(r, 500));
      const neu = document.getElementById('btn-new-task');
      if (neu) neu.click();
      return true;
    }`);
    await sleep(600);
    await ui(win, `async () => {
      const add = document.getElementById('btn-add-folder');
      if (add) add.click();
      await new Promise((r) => setTimeout(r, 900));
      return true;
    }`);
    await sleep(700);

    report.layer = 'converse';
    note('nl_sent', { goal: GOAL });
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
      GOAL,
    );

    const planProbe = `() => {
      const plan = document.getElementById('task-workspace-plan');
      const heading = String((document.getElementById('tw-plan-heading') || {}).textContent || '');
      const start = document.getElementById('btn-start-development');
      const ver = String((document.getElementById('tw-plan-version') || {}).textContent || '');
      const status = String((document.getElementById('job-status') || {}).textContent || '');
      const actionable = String((document.getElementById('job-actionable') || {}).textContent || '');
      const turns = Array.from(document.querySelectorAll('#work-timeline .work-turn-digital_me, #work-timeline [data-role="digital_me"], #work-timeline .work-turn-text'));
      const last = turns.length ? String(turns[turns.length - 1].textContent || '').trim() : '';
      const planVisible = !!(plan && !plan.hidden && start && !start.disabled);
      const failed = /规划生成失败|理解或规划生成失败|模型连接不可用/.test(last + status);
      const prep = /代码执行能力|开发前还需完成准备|请先连接/.test(status + actionable);
      return {
        ok: planVisible && !failed,
        settled: planVisible || failed,
        heading,
        ver,
        lastReply: last.slice(0, 800),
        status,
        actionable,
        prep,
        failed,
      };
    }`;
    const planWait = planProbe.replace('ok: planVisible && !failed', 'ok: planVisible || failed');
    let planUi = await waitUi(win, 'plan', planWait, 120000);
    if (planUi.failed) {
      note('plan_retry', { lastReply: planUi.lastReply });
      await ui(
        win,
        `async (goal) => {
          const input = document.getElementById('work-nl-input');
          const send = document.getElementById('btn-work-nl-send');
          if (!input || !send) return false;
          input.value = goal;
          send.click();
          return true;
        }`,
        GOAL,
      );
      planUi = await waitUi(win, 'plan_retry', planWait, 120000);
      if (planUi.failed || !planUi.ok) {
        fail('converse', '规划可靠性阻断', planUi);
        return;
      }
    }
    report.plan = planUi;
    report.layer = 'confirm';
    note('plan_ready', planUi);

    const beforeFile = fs.readFileSync(path.join(FIXTURE, 'formatLabel.js'), 'utf8');
    report.fileBefore = beforeFile;

    await ui(win, `() => {
      const start = document.getElementById('btn-start-development');
      if (start) start.click();
      return true;
    }`);
    report.confirmClicks = 1;
    note('confirm_clicked', { confirmClicks: 1 });

    report.layer = 'execute';
    const execUi = await waitUi(
      win,
      'job_terminal',
      `() => {
        const status = String((document.getElementById('job-status') || {}).textContent || '');
        const actionable = String((document.getElementById('job-actionable') || {}).textContent || '');
        const start = document.getElementById('btn-start-development');
        const startVisible = !!(start && !start.hidden && start.offsetParent !== null);
        const prep = /代码执行能力|开发前还需完成准备|请先连接|尚未检测/.test(status + actionable);
        const running = /正在|处理中|开发中/.test(status);
        const failed = /没有做成|执行失败|未能完成|受阻/.test(status + actionable);
        const done = /已经做完|请看结论|请决定是否采用|建议采用|可以试用|需要继续修改|还不能采用/.test(
          status + actionable,
        );
        return {
          ok: done || failed || prep,
          status,
          actionable,
          startVisible,
          prep,
          running,
          failed,
          done,
        };
      }`,
      420000,
    );
    report.execUi = execUi;
    note('exec_ui', execUi);

    if (execUi.prep && !execUi.done) {
      fail('execute', 'stopped_at_capability_prep', execUi);
      return;
    }

    const task = latestJson('tasks');
    const job = latestJson('jobs');
    const art = latestJson('artifacts');
    report.taskId = task && task.id;
    report.runtimePath = task && task.meta && task.meta.runtimePath;
    report.intentKind = task && task.intentKind;
    report.planVersion = task && task.meta && task.meta.plan && task.meta.plan.version;
    report.planStatus = task && task.meta && task.meta.plan && task.meta.plan.status;
    report.jobId = job && job.id;
    report.jobStatus = job && job.status;
    report.jobFailure = job && job.failure;
    report.jobActionable = job && job.actionable;
    report.codexStarted = !!(
      job &&
      (job.status === 'running' ||
        job.status === 'succeeded' ||
        job.status === 'failed' ||
        (job.externalExecution && job.externalExecution.lastExecutorStatus))
    );
    report.artifactId = art && art.id;
    const afterFile = fs.readFileSync(path.join(FIXTURE, 'formatLabel.js'), 'utf8');
    report.fileAfter = afterFile;
    report.fileChanged = afterFile !== beforeFile;

    const ctoUi = await waitUi(
      win,
      'cto',
      `() => {
        const nodes = Array.from(document.querySelectorAll('#work-timeline .work-turn'));
        const turns = nodes.map((el) => ({
          kind: String(el.dataset.turnKind || ''),
          text: String((el.querySelector('.work-turn-text') || el).textContent || '').trim(),
        }));
        const acc = turns.find((t) => t.kind === 'acceptance' || /现在能不能用|是否达到目标/.test(t.text));
        const page =
          String((document.getElementById('job-status') || {}).textContent || '') +
          '\\n' +
          String((document.getElementById('job-actionable') || {}).textContent || '') +
          '\\n' +
          turns.map((t) => t.text).join('\\n');
        const leak = /\\bJob\\b|\\bArtifact\\b|规划版本\\s*v|runtimePath|thin_v1|seed_internal|meets_plan|needs_revision/.test(
          page,
        );
        const adoptBtn = Array.from(document.querySelectorAll('#work-timeline button')).some((b) =>
          /采用这份成果/.test(String(b.textContent || '')),
        );
        return {
          ok: !!(acc && acc.text && acc.text.length > 20),
          cto: acc ? acc.text.slice(0, 2000) : '',
          page: page.slice(0, 2500),
          leak,
          adoptBtn,
          kinds: turns.map((t) => t.kind),
        };
      }`,
      180000,
    );
    report.cto = ctoUi.cto;
    report.digitalMeReply = ctoUi.cto;
    report.pageLeak = !!ctoUi.leak;
    report.adoptButtonVisible = !!ctoUi.adoptBtn;
    report.revisionLoop = task && task.meta && task.meta.revisionLoop;
    note('cto_ready', {
      leak: ctoUi.leak,
      adoptBtn: ctoUi.adoptBtn,
      cto: String(ctoUi.cto || '').slice(0, 800),
    });

    if (report.pageLeak) {
      fail('cto', 'page_leaked_internal_terms', { page: ctoUi.page });
      return;
    }
    if (execUi.prep && !execUi.done) {
      fail('execute', 'stopped_at_capability_prep', execUi);
      return;
    }
    if (!job || (job.status !== 'succeeded' && job.status !== 'failed')) {
      fail('execute', `job_not_terminal:${job && job.status}`, { job, execUi });
      return;
    }
    report.layer = 'done';
    done();
  } catch (err) {
    fail(report.layer || 'unknown', String(err && err.message ? err.message : err), {
      last: err && err.last,
      stack: err && err.stack ? String(err.stack).slice(0, 2000) : '',
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

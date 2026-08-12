/**
 * 2DIGIME-BUILD-01-SINGLE-RUNTIME-PATH-20
 * 真实 electron/main.cjs 父链 UI 证据：真实模型 + 真实 Codex + 真实页面入口。
 */
'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_single-runtime-path-20-evidence');
const SHOTS = path.join(EVIDENCE, 'shots');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-srp20-ud-'));
const FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-srp20-repo-'));

fs.mkdirSync(SHOTS, { recursive: true });
fs.writeFileSync(
  path.join(FIXTURE, 'package.json'),
  JSON.stringify({ name: 'srp20-fixture', private: true }, null, 2) + '\n',
);
fs.writeFileSync(
  path.join(FIXTURE, 'formatLabel.js'),
  "function formatLabel(input){ return input; }\nmodule.exports={formatLabel};\n",
);
fs.writeFileSync(path.join(FIXTURE, 'index.js'), "module.exports=require('./formatLabel');\n");

app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', USER_DATA);
process.env.DIGITALME_V2_ALLOW_DEV_CREDENTIAL = '1';
delete process.env.DIGITALME_V2_UX_ACCEPTANCE;
delete process.env.DIGITALME_FORCE_FAKE;

const report = {
  schemaVersion: 'single-runtime-path-20/1',
  task: '2DIGIME-BUILD-01-SINGLE-RUNTIME-PATH-20',
  startedAt: new Date().toISOString(),
  entry: 'electron/main.cjs',
  userData: USER_DATA,
  fixtureProject: FIXTURE,
  checks: [],
  timeline: [],
  codex: { duringUi: null },
  store: {},
  verdict: null,
  ownerAccepted: false,
};

function note(name, detail) {
  report.timeline.push({ at: new Date().toISOString(), name, detail });
  writeReport();
}

function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  writeReport();
  if (!ok) throw new Error(`CHECK_FAILED: ${name} ${detail ? JSON.stringify(detail) : ''}`);
}

function writeReport() {
  fs.writeFileSync(path.join(EVIDENCE, 'runtime-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function snapshotWindows() {
  if (process.platform !== 'win32') return { platform: process.platform, conhost: 0, visible: [] };
  const ps = `
    $con = @(Get-Process conhost -ErrorAction SilentlyContinue).Count
    $vis = @(Get-Process | Where-Object {
      $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and (
        $_.ProcessName -match 'codex|conhost|cmd|powershell' -or
        $_.MainWindowTitle -match 'codex|vendor|Command Prompt|命令提示符'
      )
    } | Select-Object ProcessName, Id, MainWindowTitle)
    @{ conhost = $con; visible = @($vis | ForEach-Object { \"$($_.ProcessName):$($_.Id):$($_.MainWindowTitle)\" }) } | ConvertTo-Json -Compress
  `;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 20000,
  });
  try {
    const parsed = JSON.parse(String(r.stdout || '').trim() || '{}');
    return {
      platform: 'win32',
      conhost: Number(parsed.conhost || 0),
      visible: Array.isArray(parsed.visible) ? parsed.visible : parsed.visible ? [parsed.visible] : [],
    };
  } catch {
    return { platform: 'win32', conhost: -1, visible: [] };
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

async function waitUi(win, name, fnSource, timeoutMs = 180000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await ui(win, fnSource);
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

function findTasksDir() {
  const subjects = path.join(USER_DATA, 'subjects');
  if (!fs.existsSync(subjects)) return null;
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory() && ent.name === 'tasks') return p;
      if (ent.isDirectory()) {
        const found = walk(p);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(subjects);
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

async function runAutomation(win) {
  if (started) return;
  started = true;
  note('automation_start', { title: win.getTitle() });
  await sleep(2000);

  await ui(win, `async () => {
    const skip = document.getElementById('btn-create-skip');
    if (skip) skip.click();
    await new Promise((r) => setTimeout(r, 1500));
    const nav = document.getElementById('nav-work');
    if (nav) nav.click();
    await new Promise((r) => setTimeout(r, 500));
    const neu = document.getElementById('btn-new-task');
    if (neu) neu.click();
    return true;
  }`);
  await sleep(800);
  await shot(win, '01-compose');

  const noStart = await ui(win, `() => {
    const btn = document.getElementById('btn-submit');
    const visible = !!(btn && !btn.hidden && btn.getAttribute('hidden') == null && btn.offsetParent !== null);
    const label = btn ? String(btn.textContent || '') : '';
    return { ok: !visible || !/开始处理/.test(label), visible, label };
  }`);
  check('no_start_submit_before_plan', noStart.ok, noStart);

  await ui(win, `async () => {
    const add = document.getElementById('btn-add-folder');
    if (add) add.click();
    await new Promise((r) => setTimeout(r, 800));
    return true;
  }`);
  await sleep(1000);

  const goal =
    '修改这个项目中的 formatLabel，使输入 start 时返回 start-processing，并运行测试。';
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
  note('nl_sent', { goal });

  const planUi = await waitUi(
    win,
    'plan_visible',
    `() => {
      const plan = document.getElementById('task-workspace-plan');
      const heading = document.getElementById('tw-plan-heading');
      const start = document.getElementById('btn-start-development');
      const submit = document.getElementById('btn-submit');
      const submitVisible = !!(submit && !submit.hidden && submit.offsetParent !== null);
      const turns = Array.from(document.querySelectorAll('#work-timeline .work-turn-digital_me, #work-timeline li.work-turn-digital_me'));
      const last = turns.length ? String(turns[turns.length - 1].textContent || '').trim() : '';
      const planOk = plan && !plan.hidden && heading && /开发规划/.test(heading.textContent || '') && start && !start.hidden;
      const replyOk = last.length > 12 && !/规划生成失败|没有把你的意思理解清楚|没听懂/.test(last);
      return {
        ok: !!(planOk && replyOk && !submitVisible),
        heading: heading && heading.textContent,
        start: start && start.textContent,
        lastReply: last.slice(0, 400),
        submitVisible,
      };
    }`,
    240000,
  );
  check('model_plan_and_advice_visible', planUi.ok, planUi);
  await shot(win, '02-plan');

  await ui(win, `async () => {
    const input = document.getElementById('work-nl-input');
    const send = document.getElementById('btn-work-nl-send');
    input.value = '规划里补充：改完后用本地测试确认 start 返回 start-processing';
    send.click();
    return true;
  }`);
  const planV2 = await waitUi(
    win,
    'plan_revised',
    `() => {
      const body = String((document.getElementById('tw-plan-body') || document.getElementById('task-workspace-plan') || {}).textContent || '');
      const ver = String((document.getElementById('tw-plan-version') || {}).textContent || '');
      return {
        ok: /测试|start-processing|验证/.test(body) || /v\\s*2|第\\s*2|版本\\s*2/i.test(ver + body),
        body: body.slice(0, 300),
        ver,
      };
    }`,
    180000,
  );
  check('nl_plan_revision_no_exec_yet', planV2.ok, planV2);

  const beforeWin = snapshotWindows();
  note('windows_before_confirm', beforeWin);
  await ui(win, `async () => {
    const btn = document.getElementById('btn-start-development');
    if (btn) btn.click();
    return !!btn;
  }`);

  const running = await waitUi(
    win,
    'job_running_or_done',
    `() => {
      const status = String((document.getElementById('job-status') || {}).textContent || '');
      const runningEl = document.getElementById('task-workspace-running');
      const ok = /开发中|处理中|queued|running|已完成|可查看|成果/.test(status) || (runningEl && !runningEl.hidden);
      return { ok: !!ok, status: status.slice(0, 200) };
    }`,
    300000,
  );
  check('job_started_after_confirm', running.ok, running);

  const fileChanged = await (async () => {
    const start = Date.now();
    while (Date.now() - start < 480000) {
      try {
        const body = fs.readFileSync(path.join(FIXTURE, 'formatLabel.js'), 'utf8');
        if (/start-processing/.test(body)) return { ok: true, body: body.slice(0, 300) };
      } catch {
        /* ignore */
      }
      await sleep(2000);
    }
    return { ok: false };
  })();
  check('codex_modified_formatLabel', fileChanged.ok, fileChanged);

  await sleep(1200);
  const afterWin = snapshotWindows();
  const beforeSet = new Set(beforeWin.visible || []);
  const newVisible = (afterWin.visible || []).filter((t) => !beforeSet.has(t));
  report.codex.duringUi = {
    before: beforeWin,
    after: afterWin,
    newVisible,
    conhostDelta: (afterWin.conhost || 0) - (beforeWin.conhost || 0),
  };
  check('no_new_visible_codex_console', newVisible.length === 0, report.codex.duringUi);
  await shot(win, '03-after-exec');

  const cto = await waitUi(
    win,
    'cto_five',
    `() => {
      const text = String(document.body.innerText || '');
      const ok = /现在能不能用|是否达到目标|还需不需要修改|风险|建议下一步/.test(text);
      return { ok, slice: text.slice(-900) };
    }`,
    240000,
  );
  check('cto_five_point_conclusion', cto.ok, { slice: cto.slice });

  const jobsBefore = (() => {
    const td = findTasksDir();
    if (!td) return 0;
    const jd = path.join(path.dirname(td), 'jobs');
    return fs.existsSync(jd) ? fs.readdirSync(jd).filter((f) => f.endsWith('.json')).length : 0;
  })();
  await ui(win, `async () => {
    const input = document.getElementById('work-nl-input');
    const send = document.getElementById('btn-work-nl-send');
    input.value = '能不能用？还需要修改吗？有什么风险？';
    send.click();
    return true;
  }`);
  await waitUi(
    win,
    'consult_reply',
    `() => {
      const turns = Array.from(document.querySelectorAll('#work-timeline .work-turn-digital_me, #work-timeline li.work-turn-digital_me'));
      const last = turns.length ? String(turns[turns.length - 1].textContent || '') : '';
      return { ok: last.length > 20 && !/规划生成失败|没听懂|没有把你的意思理解清楚/.test(last), last: last.slice(0, 400) };
    }`,
    180000,
  );
  const jobsAfter = (() => {
    const td = findTasksDir();
    if (!td) return 0;
    const jd = path.join(path.dirname(td), 'jobs');
    return fs.existsSync(jd) ? fs.readdirSync(jd).filter((f) => f.endsWith('.json')).length : 0;
  })();
  check('consult_no_new_job', jobsAfter === jobsBefore, { jobsBefore, jobsAfter });
  await shot(win, '04-consult');

  await ui(win, `async () => {
    const input = document.getElementById('work-nl-input');
    const send = document.getElementById('btn-work-nl-send');
    input.value = '按你说的改吧：把 start 的返回值改成 done';
    send.click();
    return true;
  }`);
  const revised = await (async () => {
    const start = Date.now();
    while (Date.now() - start < 480000) {
      try {
        const body = fs.readFileSync(path.join(FIXTURE, 'formatLabel.js'), 'utf8');
        if (/done/.test(body)) return { ok: true, body: body.slice(0, 300) };
      } catch {
        /* ignore */
      }
      await sleep(2500);
    }
    return { ok: false };
  })();
  check('nl_revision_changed_file', revised.ok, revised);
  await shot(win, '05-revision');

  const taskFiles = (() => {
    const td = findTasksDir();
    return td ? fs.readdirSync(td).filter((f) => f.endsWith('.json')) : [];
  })();
  report.store = {
    taskFiles,
    formatLabel: fs.readFileSync(path.join(FIXTURE, 'formatLabel.js'), 'utf8').slice(0, 400),
  };
  check('task_persisted', taskFiles.length >= 1, { taskFiles });
  check(
    'restart_disk_facts_present',
    taskFiles.length >= 1 && /done|start-processing/.test(report.store.formatLabel),
    report.store,
  );

  report.verdict = 'engineering_real_main_chain_passed';
  report.finishedAt = new Date().toISOString();
  writeReport();
  note('done', report.verdict);
  setTimeout(() => app.exit(0), 500);
}

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('did-finish-load', () => {
    runAutomation(win).catch((err) => {
      report.verdict = 'engineering_real_main_chain_failed';
      report.error = String(err && err.stack ? err.stack : err);
      writeReport();
      console.error(err);
      setTimeout(() => app.exit(1), 500);
    });
  });
});

writeReport();
require(path.join(ROOT, 'electron', 'main.cjs'));
// 防止自动化等待模型时主窗意外关闭导致进程退出
app.removeAllListeners('window-all-closed');
app.on('window-all-closed', () => {
  if (!report.verdict) {
    report.error = report.error || 'window_all_closed_before_verdict';
    writeReport();
    return;
  }
  app.quit();
});

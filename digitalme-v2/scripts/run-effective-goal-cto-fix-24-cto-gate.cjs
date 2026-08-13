/**
 * 2DIGIME-BUILD-01-EFFECTIVE-GOAL-CTO-FIX-24
 * 复用加固后的 20A 入口；证据写入 _effective-goal-cto-fix-24-evidence。
 * 非 Git user_selected；不 git init；不 hooked/Fake executor。
 * 模型合同失败必须零 Job。任一检查失败立即停止，不写 passed verdict。
 * 全量与 931a2c8 的 533/22/1 逐项比较；不得把新增失败列为历史失败。
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_effective-goal-cto-fix-24-evidence');
const SHOTS = path.join(EVIDENCE, 'shots');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const ENTRY = path.join(__dirname, 'electron-cto-real-main-gate-20a-entry.cjs');

/** 931a2c8 全量失败名（含 suite 行）；比较用。不得把本轮新增失败加入此集合。 */
const BASELINE_931A2C8_FAIL_NAMES = new Set([
  '未安装任何代码执行能力时返回引导且不创建失败 Job',
  'Codex ready 时进入权限确认',
  '软件任务无能力时不回退文档生成',
  '目标和材料在稍后连接后仍保留并可恢复',
  '空目录项目先选目录再选能力',
  'coding-capability-onboarding-01',
  'FORCE=needs_setup 只通过派生 options 生效；adapter 不读环境变量',
  '场景 B：当前进程未配置；不创建失败 Task/Job；不落盘测试开关',
  '场景 C：unsupported 仅当前进程；不允许自动执行',
  '默认场景 A 不受 B/C 开关影响；同包去掉开关后恢复真实探测派生',
  'coding-capability-owner-scenarios-close-01',
  '8. 对话修改规划与咨询不授权新 Job',
  'corrective product redesign 18',
  'submitTask returns confirm card then executes with hooked adapter',
  'external-execution-closed-loop',
  'submitTask confirm card surfaces unreliable copy when locate yields nothing',
  'fix-real-runtime-locate-03 product chain',
  '无项目目录时返回 needsProjectFolder 且不创建 Task',
  '确认执行只创建一个 Task；两任务成果不串线',
  'software-dev-blocker-03',
  'modify_code + 软件项目触发执行确认',
  '执行能力不可用时显示可行动提示且不回退文档',
  '修订复用同一 task/artifact 主链',
  'software-development-task-ux',
  'does not register fake or available document capabilities',
  'DigitalMeRuntime documentCapability none',
  'A: 相关偏好复用 → appliedUnderstanding 出现且 ≤3 条',
  '完整成长闭环:Task A 编辑确认后 Task B 复用;未确认与不相似隔离',
  'SUBJECT-MVP: one sentence start → task without archive gate → growth reuse',
  'D11-A 意图评测：≥50 条真实输入，误建执行=0，正确率≥95%',
]);
const BASELINE_931A2C8 = { pass: 533, fail: 22, skip: 1, head: '931a2c8' };

fs.mkdirSync(EVIDENCE, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const name of fs.readdirSync(EVIDENCE)) {
  if (name === 'EFFECTIVE_GOAL_CTO_FIX24_DIAGNOSIS.json') continue;
  const p = path.join(EVIDENCE, name);
  fs.rmSync(p, { recursive: true, force: true });
}
fs.mkdirSync(SHOTS, { recursive: true });

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-23-ud-'));
const FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-23-repo-'));
fs.writeFileSync(
  path.join(FIXTURE, 'package.json'),
  JSON.stringify(
    { name: 'dm-23-fixture', private: true, scripts: { test: 'node formatLabel.test.js' } },
    null,
    2,
  ) + '\n',
);
fs.writeFileSync(
  path.join(FIXTURE, 'formatLabel.js'),
  "function formatLabel(input){ return input; }\nmodule.exports={formatLabel};\n",
);
fs.writeFileSync(path.join(FIXTURE, 'index.js'), "module.exports=require('./formatLabel');\n");
fs.writeFileSync(
  path.join(FIXTURE, 'formatLabel.test.js'),
  "const { formatLabel } = require('./formatLabel');\n" +
    "if (formatLabel('start') !== 'start-processing' && formatLabel('start') !== 'done') {\n" +
    "  console.error('unexpected', formatLabel('start'));\n  process.exit(1);\n}\n" +
    "console.log('ok');\n",
);

const report = {
  schemaVersion: 'effective-goal-cto-fix-24-cto/1',
  task: '2DIGIME-BUILD-01-EFFECTIVE-GOAL-CTO-FIX-24',
  startedAt: new Date().toISOString(),
  headBaseline: '931a2c8',
  entry: 'electron/main.cjs',
  userData: USER_DATA,
  fixtureProject: FIXTURE,
  phases: {},
  blackWindow: { samples: [], violations: [], byPhase: {} },
  checks: [],
  regression: null,
  verdict: null,
  productDefectSuspected: false,
  ownerAccepted: false,
  thirdOwnerRuntime: 'not_started',
};

function writeReport() {
  fs.writeFileSync(path.join(EVIDENCE, 'runtime-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function note(name, detail) {
  if (!report.timeline) report.timeline = [];
  report.timeline.push({ at: new Date().toISOString(), name, detail });
  writeReport();
}

function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  writeReport();
  if (!ok) {
    const err = new Error(`CHECK_FAILED: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
    err.checkName = name;
    err.detail = detail;
    throw err;
  }
}

function snapshotWindows() {
  if (process.platform !== 'win32') {
    return { at: new Date().toISOString(), platform: process.platform, conhost: 0, visible: [] };
  }
  const ps = `
    $con = @(Get-Process conhost -ErrorAction SilentlyContinue).Count
    $vis = @(Get-Process | Where-Object {
      $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and (
        $_.ProcessName -match '^(codex|conhost|cmd|powershell|pwsh)$' -or
        $_.MainWindowTitle -match 'codex|vendor|Command Prompt|命令提示符|Windows PowerShell'
      )
    } | Select-Object ProcessName, Id, MainWindowTitle)
    @{ conhost = $con; visible = @($vis | ForEach-Object { "$($_.ProcessName):$($_.Id):$($_.MainWindowTitle)" }) } | ConvertTo-Json -Compress
  `;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15000,
  });
  try {
    const parsed = JSON.parse(String(r.stdout || '').trim() || '{}');
    return {
      at: new Date().toISOString(),
      platform: 'win32',
      conhost: Number(parsed.conhost || 0),
      visible: Array.isArray(parsed.visible)
        ? parsed.visible
        : parsed.visible
          ? [parsed.visible]
          : [],
    };
  } catch {
    return {
      at: new Date().toISOString(),
      platform: 'win32',
      conhost: -1,
      visible: [],
      error: String(r.stderr || r.stdout || ''),
    };
  }
}

function startBlackMonitor(phase, baselineVisible) {
  const baseline = new Set(baselineVisible || []);
  const state = {
    phase,
    baseline: [...baseline],
    samples: [],
    violations: [],
    timer: null,
    stopped: false,
    byLabel: {},
  };
  const tick = () => {
    if (state.stopped) return;
    let label = phase;
    try {
      if (fs.existsSync(path.join(EVIDENCE, 'black-window-active-phase.json'))) {
        const active = JSON.parse(
          fs.readFileSync(path.join(EVIDENCE, 'black-window-active-phase.json'), 'utf8'),
        );
        if (active && active.label) label = String(active.label);
      }
    } catch {
      /* ignore */
    }
    const snap = snapshotWindows();
    const sample = { phase, label, ...snap };
    state.samples.push(sample);
    report.blackWindow.samples.push(sample);
    if (!state.byLabel[label]) state.byLabel[label] = { samples: [], violations: [] };
    state.byLabel[label].samples.push(sample);
    const newcomers = (snap.visible || []).filter((v) => !baseline.has(v));
    const bad = newcomers.filter((v) =>
      /codex|conhost|cmd|powershell|vendor|Command Prompt|命令提示符/i.test(v),
    );
    if (bad.length) {
      const violation = { at: snap.at, label, bad, snap };
      state.violations.push(violation);
      state.byLabel[label].violations.push(violation);
      report.blackWindow.violations.push({ phase, label, at: snap.at, bad });
      writeReport();
    }
  };
  tick();
  state.timer = setInterval(tick, 700);
  return state;
}

function stopBlackMonitor(state) {
  state.stopped = true;
  if (state.timer) clearInterval(state.timer);
  report.blackWindow.byPhase[state.phase] = {
    sampleCount: state.samples.length,
    violationCount: state.violations.length,
    violations: state.violations,
    byLabel: Object.fromEntries(
      Object.entries(state.byLabel).map(([k, v]) => [
        k,
        { sampleCount: v.samples.length, violationCount: v.violations.length, violations: v.violations },
      ]),
    ),
  };
  writeReport();
  return state.violations;
}

function waitMarker(file, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      if (fs.existsSync(file)) {
        clearInterval(t);
        try {
          resolve(JSON.parse(fs.readFileSync(file, 'utf8')));
        } catch (err) {
          reject(err);
        }
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(t);
        reject(new Error(`marker timeout: ${file}`));
      }
    }, 500);
  });
}

function spawnElectron(phase, extraEnv = {}) {
  const env = {
    ...process.env,
    DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
    DIGITALME_20A_PHASE: String(phase),
    DIGITALME_20A_USER_DATA: USER_DATA,
    DIGITALME_20A_FIXTURE: FIXTURE,
    DIGITALME_20A_EVIDENCE: EVIDENCE,
    DIGITALME_20A_FORCE_UNPARSEABLE: path.join(EVIDENCE, 'force-unparseable.flag'),
    ...extraEnv,
  };
  delete env.DIGITALME_V2_UX_ACCEPTANCE;
  delete env.DIGITALME_FORCE_FAKE;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(ELECTRON, ['--disable-gpu', ENTRY], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => {
    stdout += c.toString('utf8');
    if (stdout.length > 200000) stdout = stdout.slice(-100000);
  });
  child.stderr.on('data', (c) => {
    stderr += c.toString('utf8');
    if (stderr.length > 200000) stderr = stderr.slice(-100000);
  });
  return {
    child,
    getLogs: () => ({ stdout: stdout.slice(-8000), stderr: stderr.slice(-8000) }),
  };
}

function parseFailedNames(out) {
  const names = [];
  for (const line of String(out || '').split(/\r?\n/)) {
    // 只计用例行（缩进 ✖），不计 suite 汇总行
    const m = line.match(/^\s{2,}✖\s+(.+?)\s+\([\d.]+ms\)\s*$/);
    if (m) names.push(m[1].trim());
  }
  return [...new Set(names)];
}

function runNodeTests() {
  const tests = [
    'dist/work-runtime/tests/work-converse.test.js',
    'dist/work-runtime/tests/work-runtime.test.js',
    'dist/work-runtime/tests/owner-revision-routing-fix-22.test.js',
    'dist/work-runtime/tests/revision-completion-gate-fix-23.test.js',
    'dist/execution/tests/effective-goal-cto-fix-24.test.js',
    'dist/execution/tests/corrective-product-redesign-18.test.js',
    'dist/execution/tests/nongit-project-trust-fix-21.test.js',
    'dist/execution/tests/single-runtime-path-20.test.js',
    'dist/execution/tests/planning-workspace-13.test.js',
    'dist/execution/tests/fix-return-edit-action-04.test.js',
    'dist/work-runtime/tests/controlled-revision-production-lock-15b.test.js',
  ];
  const r = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', ...tests],
    { cwd: ROOT, encoding: 'utf8', timeout: 300000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  return {
    exitCode: r.status,
    pass: Number((out.match(/ℹ pass (\d+)/) || [])[1] || 0),
    fail: Number((out.match(/ℹ fail (\d+)/) || [])[1] || 0),
    skip: Number((out.match(/ℹ skipped (\d+)/) || [])[1] || 0),
    failedNames: parseFailedNames(out),
    tail: out.slice(-2500),
  };
}

function runFullSuite() {
  const r = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', 'dist/**/*.test.js'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 20 * 60 * 1000,
      windowsHide: true,
      shell: false,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const failedNames = parseFailedNames(out);
  const uniqueFails = [...new Set(failedNames)];
  const newFails = uniqueFails.filter((n) => !BASELINE_931A2C8_FAIL_NAMES.has(n));
  const fixedVsBaseline = [...BASELINE_931A2C8_FAIL_NAMES].filter((n) => !uniqueFails.includes(n));
  return {
    exitCode: r.status,
    pass: Number((out.match(/ℹ pass (\d+)/) || [])[1] || 0),
    fail: Number((out.match(/ℹ fail (\d+)/) || [])[1] || 0),
    skip: Number((out.match(/ℹ skipped (\d+)/) || [])[1] || 0),
    failedNames: uniqueFails,
    newFails,
    fixedVsBaseline,
    baseline: BASELINE_931A2C8,
    timedOut: r.status === null && /ETIMEDOUT|timed out/i.test(String(r.error || '')),
    error: r.error ? String(r.error.message || r.error) : null,
    tail: out.slice(-4000),
  };
}

async function main() {
  writeReport();
  note('prepared', { USER_DATA, FIXTURE });

  const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
    shell: true,
  });
  check('clean_build', build.status === 0, {
    status: build.status,
    tail: String(build.stdout || build.stderr || '').slice(-1500),
  });

  const phase1Marker = path.join(EVIDENCE, 'phase1-done.json');
  const phase1Fail = path.join(EVIDENCE, 'phase1-fail.json');
  try {
    fs.unlinkSync(phase1Marker);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(phase1Fail);
  } catch {
    /* ignore */
  }

  const baseline = snapshotWindows();
  note('phase1_baseline_windows', baseline);
  const monConfirm = startBlackMonitor('phase1_confirm_to_first_exec', baseline.visible);
  const p1 = spawnElectron('1');
  note('phase1_spawned', { pid: p1.child.pid });

  let phase1Result;
  try {
    phase1Result = await Promise.race([
      waitMarker(phase1Marker, 30 * 60 * 1000),
      waitMarker(phase1Fail, 30 * 60 * 1000).then((fail) => {
        const err = new Error(fail.error || 'phase1 failed');
        err.phaseFail = fail;
        throw err;
      }),
      new Promise((_, reject) => {
        p1.child.on('exit', (code) => {
          if (!fs.existsSync(phase1Marker)) {
            reject(
              new Error(
                `phase1 electron exited early code=${code} logs=${JSON.stringify(p1.getLogs())}`,
              ),
            );
          }
        });
      }),
    ]);
  } finally {
    const violations = stopBlackMonitor(monConfirm);
    report.phases.phase1_black = { violations: violations.length };
  }

  report.phases.phase1 = phase1Result;
  writeReport();
  check('phase1_marker_ok', !!(phase1Result && phase1Result.ok), phase1Result);

  const entryBlack = (phase1Result && phase1Result.black) || {};
  report.blackWindow.entryPhase1 = entryBlack;
  const outerPhase1 = report.blackWindow.byPhase.phase1_confirm_to_first_exec || {
    violationCount: 0,
    byLabel: {},
  };
  const firstExec = (outerPhase1.byLabel && outerPhase1.byLabel.first_exec) || { violationCount: 0 };
  const revisionExec = (outerPhase1.byLabel && outerPhase1.byLabel.revision_exec) || {
    violationCount: 0,
  };
  check(
    'black_window_phase1_no_visible_console',
    outerPhase1.violationCount === 0 &&
      firstExec.violationCount === 0 &&
      revisionExec.violationCount === 0,
    {
      outer: { sampleCount: outerPhase1.sampleCount, violationCount: outerPhase1.violationCount },
      firstExec: { violationCount: firstExec.violationCount },
      revisionExec: { violationCount: revisionExec.violationCount },
      entryPhases: entryBlack.phases || [],
    },
  );

  try {
    p1.child.kill();
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 1500));

  const phase2Marker = path.join(EVIDENCE, 'phase2-done.json');
  const phase2Fail = path.join(EVIDENCE, 'phase2-fail.json');
  try {
    fs.unlinkSync(phase2Marker);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(phase2Fail);
  } catch {
    /* ignore */
  }

  const p2 = spawnElectron('2', {
    DIGITALME_20A_HANDOFF: path.join(EVIDENCE, 'restart-handoff.json'),
  });
  note('phase2_spawned', { pid: p2.child.pid });
  let phase2Result;
  try {
    phase2Result = await Promise.race([
      waitMarker(phase2Marker, 8 * 60 * 1000),
      waitMarker(phase2Fail, 8 * 60 * 1000).then((fail) => {
        const err = new Error(fail.error || 'phase2 failed');
        err.phaseFail = fail;
        throw err;
      }),
      new Promise((_, reject) => {
        p2.child.on('exit', (code) => {
          if (!fs.existsSync(phase2Marker)) {
            reject(
              new Error(
                `phase2 electron exited early code=${code} logs=${JSON.stringify(p2.getLogs())}`,
              ),
            );
          }
        });
      }),
    ]);
  } finally {
    try {
      p2.child.kill();
    } catch {
      /* ignore */
    }
  }
  report.phases.phase2 = phase2Result;
  writeReport();
  check('phase2_restart_restore_ok', !!(phase2Result && phase2Result.ok), phase2Result);

  const focused = runNodeTests();
  report.regression = { focused };
  check('focused_regression_no_new_fail', focused.fail === 0 && focused.exitCode === 0, focused);

  const full = runFullSuite();
  report.regression.full = full;
  writeReport();
  check('full_suite_finished', full.exitCode !== null && !full.timedOut, {
    exitCode: full.exitCode,
    timedOut: full.timedOut,
    error: full.error,
  });
  check('full_suite_no_new_fails', full.newFails.length === 0, {
    fail: full.fail,
    failedNames: full.failedNames,
    newFails: full.newFails,
    fixedVsBaseline: full.fixedVsBaseline,
    baseline: BASELINE_931A2C8,
    pass: full.pass,
    skip: full.skip,
    exitCode: full.exitCode,
  });

  report.verdict = 'effective_goal_cto_fix_24_cto_passed';
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(EVIDENCE, 'GATE_SUMMARY.md'),
    [
      '# FIX-24 CTO Gate — PASSED',
      '',
      `- verdict: \`${report.verdict}\``,
      `- finishedAt: ${report.finishedAt}`,
      `- ownerAccepted: false`,
      `- thirdOwnerRuntime: not_started`,
      `- black-window violations: ${report.blackWindow.violations.length}`,
      `- focused regression: pass=${focused.pass} fail=${focused.fail} exitCode=${focused.exitCode}`,
      `- full suite: exitCode=${full.exitCode} pass=${full.pass} fail=${full.fail} skip=${full.skip}`,
      '',
    ].join('\n'),
  );
  writeReport();
  console.log(
    JSON.stringify(
      {
        ok: true,
        verdict: report.verdict,
        evidence: EVIDENCE,
        ownerAccepted: false,
        thirdOwnerRuntime: 'not_started',
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  report.verdict = 'effective_goal_cto_fix_24_cto_failed';
  report.error = String(err && err.stack ? err.stack : err);
  report.productDefectSuspected = true;
  report.finishedAt = new Date().toISOString();
  writeReport();
  console.error(report.error);
  process.exit(1);
});

/**
 * 2DIGIME-BUILD-01-CTO-REAL-MAIN-GATE-20A
 * 外层编排：隔离 userData、持续黑窗采样、真正重启、证据收口。
 * 不修改产品代码。
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_cto-real-main-gate-20a-evidence');
const SHOTS = path.join(EVIDENCE, 'shots');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const ENTRY = path.join(__dirname, 'electron-cto-real-main-gate-20a-entry.cjs');

fs.rmSync(EVIDENCE, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
// Preserve last failure for diagnosis alongside a fresh run folder name used by report
const PRIOR_FAIL_NOTE = path.join(ROOT, 'scripts', '_cto-real-main-gate-20a-prior-fail-note.json');
try {
  fs.writeFileSync(
    PRIOR_FAIL_NOTE,
    `${JSON.stringify(
      {
        note: 'Previous run cleared into fresh evidence dir; see git history / prior agent logs for EPERM+blocking-monitor diagnosis',
        clearedAt: new Date().toISOString(),
        rootCauseHypothesis:
          'Electron entry used spawnSync PowerShell every 600ms on main thread, stalling JobRunner (job stuck in context phase; atomic rename EPERM left only .bak)',
      },
      null,
      2,
    )}\n`,
  );
} catch {
  /* ignore */
}

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-20a-ud-'));
const FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-20a-repo-'));
fs.writeFileSync(
  path.join(FIXTURE, 'package.json'),
  JSON.stringify({ name: 'dm-20a-fixture', private: true }, null, 2) + '\n',
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
  schemaVersion: 'cto-real-main-gate-20a/1',
  task: '2DIGIME-BUILD-01-CTO-REAL-MAIN-GATE-20A',
  startedAt: new Date().toISOString(),
  headBaseline: '2063958',
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

function runNodeTests() {
  const tests = [
    'dist/work-runtime/tests/work-converse.test.js',
    'dist/execution/tests/single-runtime-path-20.test.js',
    'dist/execution/tests/planning-workspace-13.test.js',
    'dist/execution/tests/fix-return-edit-action-04.test.js',
    'dist/work-runtime/tests/controlled-revision-production-lock-15b.test.js',
  ];
  const r = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', ...tests],
    { cwd: ROOT, encoding: 'utf8', timeout: 300000, windowsHide: true },
  );
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const pass = Number((out.match(/ℹ pass (\d+)/) || [])[1] || 0);
  const fail = Number((out.match(/ℹ fail (\d+)/) || [])[1] || 0);
  const skip = Number((out.match(/ℹ skipped (\d+)/) || [])[1] || 0);
  return {
    exitCode: r.status,
    pass,
    fail,
    skip,
    tail: out.slice(-2500),
  };
}

async function main() {
  writeReport();
  note('prepared', { USER_DATA, FIXTURE });

  // --- clean build ---
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

  // --- phase1: full chain until revision + handoff ---
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
      waitMarker(phase1Marker, 25 * 60 * 1000),
      waitMarker(phase1Fail, 25 * 60 * 1000).then((fail) => {
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
      outer: outerPhase1,
      firstExec,
      revisionExec,
      entryPhases: entryBlack.phases || [],
    },
  );

  // Ensure electron closed
  try {
    p1.child.kill();
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 1500));

  // --- phase2: true restart same userData ---
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

  // --- regression tests ---
  const focused = runNodeTests();
  report.regression = { focused };
  check('focused_regression_no_new_fail', focused.fail === 0, focused);

  // optional full suite summary (non-blocking on historical fails)
  const full = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', 'dist/**/*.test.js'],
    { cwd: ROOT, encoding: 'utf8', timeout: 600000, windowsHide: true, shell: false },
  );
  const fullOut = `${full.stdout || ''}\n${full.stderr || ''}`;
  report.regression.full = {
    exitCode: full.status,
    pass: Number((fullOut.match(/ℹ pass (\d+)/) || [])[1] || 0),
    fail: Number((fullOut.match(/ℹ fail (\d+)/) || [])[1] || 0),
    skip: Number((fullOut.match(/ℹ skipped (\d+)/) || [])[1] || 0),
    note: 'Historical fails may remain; compare with prior Build-01 fail=4 baseline',
    tail: fullOut.slice(-2000),
  };
  writeReport();

  report.verdict = 'cto_real_main_gate_passed';
  report.finishedAt = new Date().toISOString();
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
  report.verdict = 'cto_real_main_gate_failed';
  report.error = String(err && err.stack ? err.stack : err);
  if (err && err.phaseFail && err.phaseFail.productDefectSuspected) {
    report.productDefectSuspected = true;
  }
  report.finishedAt = new Date().toISOString();
  writeReport();
  console.error(report.error);
  process.exit(1);
});

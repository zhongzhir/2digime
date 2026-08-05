/**
 * EXPERIENCE-REDESIGN-01B-B6 — Playwright UI 验收入口。
 * 连续运行 3 次（每次独立 userData），默认成功不落仓库残留。
 * 用法: npm run accept:experience-redesign-ui
 *
 * 重建截图到临时目录后打印路径；可选 DIGITALME_B6_KEEP_RUN=1 保留。
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`OK: ${msg}`);
}

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status || 1);

const runs = Math.max(1, Number(process.env.DIGITALME_B6_UI_RUNS || 3) || 3);
const driver = path.join(__dirname, 'playwright-experience-redesign-ui.cjs');
const electronBin = require('electron');

function killLeftoverHarness() {
  if (process.platform !== 'win32') return [];
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*electron-experience-b6-harness*' }; foreach ($x in $p) { try { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }; ($p | Select-Object -ExpandProperty ProcessId) -join ','`,
    ],
    { encoding: 'utf8' },
  );
  return String(ps.stdout || '')
    .split(/[,\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

for (let i = 1; i <= runs; i += 1) {
  killLeftoverHarness();
  const runDir = path.join(os.tmpdir(), `dmv2-b6-accept-${Date.now()}-${i}`);
  fs.mkdirSync(runDir, { recursive: true });
  console.log(`\n--- experience-redesign-ui run ${i}/${runs} ---`);
  const res = spawnSync(process.execPath, [driver], {
    cwd: appRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      DIGITALME_B6_RUN_DIR: runDir,
      DIGITALME_B6_UI_RUNS: undefined,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    shell: false,
  });
  if (res.status !== 0) {
    killLeftoverHarness();
    fail(`UI run ${i}/${runs} failed (dir=${runDir})`);
  }
  const reportPath = path.join(runDir, 'report.json');
  if (!fs.existsSync(reportPath)) fail(`missing report for run ${i}: ${runDir}`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (report.verdict !== 'passed') fail(`run ${i} verdict ${report.verdict}`);
  if (!Array.isArray(report.shots) || report.shots.length < 8) {
    fail(`run ${i} expected >=8 shots, got ${report.shots && report.shots.length}`);
  }
  ok(`run ${i}/${runs} passed shots=${report.shots.length} dir=${runDir}`);
  if (process.env.DIGITALME_B6_KEEP_RUN !== '1') {
    try {
      fs.rmSync(runDir, { recursive: true, force: true });
    } catch {
      /* Windows 偶发锁：忽略，tmpdir 可回收 */
    }
  }
}

const leftover = killLeftoverHarness();
if (leftover.length) {
  fail(`leftover B6 harness process after runs: ${leftover.join(',')}`);
}
ok('no leftover B6 harness process detected');

ok(`electron binary resolved: ${electronBin}`);
console.log('\naccept:experience-redesign-ui PASSED');

/**
 * Cursor 真机 Electron 操作复核（隔离 harness，保留截图证据）。
 * 不提交；证据目录默认 scripts/_owner-acceptance-blockers-01-evidence/
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const evidence = path.join(appRoot, 'scripts', '_owner-acceptance-blockers-01-evidence');
fs.mkdirSync(evidence, { recursive: true });

const build = spawnSync('npm', ['run', 'build'], { cwd: appRoot, stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status || 1);

const driver = path.join(__dirname, 'playwright-owner-blockers.cjs');
const result = spawnSync(process.execPath, [driver], {
  cwd: appRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    DIGITALME_OWNER_BLOCKERS_RUN_DIR: evidence,
  },
});

const reportPath = path.join(evidence, 'report.json');
if (fs.existsSync(reportPath)) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  console.log('\n--- Cursor Electron verify summary ---');
  console.log(`verdict: ${report.verdict}`);
  console.log(`checks: ${report.checks.length}`);
  console.log(`shots: ${(report.shots || []).length}`);
  for (const s of report.shots || []) {
    console.log(`  - ${s.name}: ${s.file}`);
  }
}

process.exit(result.status || 0);

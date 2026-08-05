/**
 * 重建 B6 视觉截图到 gitignore 目录（不提交 PNG）。
 * 用法: npm run accept:experience-redesign-ui:baselines
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const appRoot = path.resolve(__dirname, '..');
const baselineDir = path.join(appRoot, 'scripts', '_experience-redesign-b6-baselines');
const runDir = path.join(os.tmpdir(), `dmv2-b6-baseline-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });

const driver = path.join(__dirname, 'playwright-experience-redesign-ui.cjs');
const res = spawnSync(process.execPath, [driver], {
  cwd: appRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    DIGITALME_B6_RUN_DIR: runDir,
    DIGITALME_B6_KEEP_RUN: '1',
  },
  shell: false,
});
if (res.status !== 0) process.exit(res.status || 1);

const shotsSrc = path.join(runDir, 'shots');
fs.mkdirSync(baselineDir, { recursive: true });
for (const name of fs.readdirSync(shotsSrc)) {
  fs.copyFileSync(path.join(shotsSrc, name), path.join(baselineDir, name));
}
fs.copyFileSync(path.join(runDir, 'report.json'), path.join(baselineDir, 'last-report.json'));
console.log(`OK: baselines rebuilt at ${baselineDir}`);
console.log('NOTE: baselines are gitignored; rebuild anytime with this command.');

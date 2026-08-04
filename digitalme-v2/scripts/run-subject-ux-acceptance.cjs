/**
 * SUBJECT-PERCEPTIBLE-UX-01 验收:
 * 1) 静态检查 renderer 无内部术语泄漏 / 无强制档案文案
 * 2) Electron + Fake 文档能力走通最小 Owner 路径
 *
 * 用法: npm run accept:subject-ux
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

// --- 静态检查 ---
const rendererFiles = [
  'electron/renderer/index.html',
  'electron/renderer/app.js',
  'electron/renderer/styles.css',
].map((p) => path.join(appRoot, p));

const forbidden = [
  /GrowthEvent/,
  /ContextSnapshot/,
  /\bcandidate\b/i,
  /\bconfirmed\b/i,
  /主体合同/,
  /填写完整档案/,
  /完善全部字段/,
  /readinessBlocksTasks/,
  /subjectReadiness/,
  /confidence/,
];

const requiredCopy = [
  /现在的我/,
  /最近学到/,
  /还不确定/,
  /让数字之我更了解你/,
  /先用一句话介绍你自己/,
  /先跳过，直接开始/,
  /以后这样做/,
  /暂时不要/,
];

let allText = '';
for (const file of rendererFiles) {
  allText += `\n${fs.readFileSync(file, 'utf8')}`;
}

for (const re of forbidden) {
  if (re.test(allText)) fail(`internal/forbidden term leaked: ${re}`);
}
ok('no forbidden internal terms in renderer');

for (const re of requiredCopy) {
  if (!re.test(allText)) fail(`missing user-facing copy: ${re}`);
}
ok('required user-facing copy present');

if (/完整档案|七类表单|多标签配置/.test(allText)) {
  fail('onboarding / archive pressure copy found');
}
ok('no forced multi-step archive onboarding copy');

if (!/subject-panel/.test(allText) || !/applied-understanding/.test(allText)) {
  fail('subject panel or applied-understanding missing');
}
ok('subject panel + applied understanding mounts present');

// 禁止「一次确认全部身份/档案」类压力文案;允许说明无需马上处理
if (/一次确认全部身份|确认全部档案|批量确认全部/.test(allText)) {
  fail('bulk confirm UX found');
}
ok('no bulk confirm-all UX');

// --- Electron 交互验收 (Fake 文档) ---
const electronBin = require('electron');
const acceptScript = path.join(__dirname, 'electron-subject-ux-acceptance.cjs');
const result = spawnSync(electronBin, [acceptScript], {
  stdio: 'inherit',
  shell: false,
  cwd: appRoot,
  env: {
    ...process.env,
    DIGITALME_V2_UX_ACCEPTANCE: '1',
  },
});
if (result.status !== 0) {
  fail(`electron UX acceptance exited ${result.status}`);
}
ok('electron UX acceptance passed');
console.log('\naccept:subject-ux PASSED');

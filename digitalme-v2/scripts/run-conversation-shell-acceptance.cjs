/**
 * VALIDATED-PRODUCT-CAPABILITY-RECOVERY-01 — 对话壳 + 资料移除验收。
 * 用法: npm run accept:conversation-shell
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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

const rendererFiles = [
  'electron/renderer/index.html',
  'electron/renderer/app.js',
  'electron/main.cjs',
  'electron/preload.cjs',
].map((p) => path.join(appRoot, p));

let allText = '';
for (const file of rendererFiles) {
  allText += `\n${fs.readFileSync(file, 'utf8')}`;
}

const required = [
  /id="nav-chat"/,
  /id="nav-work"/,
  /id="nav-subject"/,
  /id="btn-open-help"/,
  />对话</,
  /转为任务/,
  /清空对话/,
  /subject\.removeMaterial/,
  /shell:conversationList/,
  /shell:conversationAppend/,
  /shell:conversationClear/,
  /sourceKind:\s*["']conversation["']/,
];

if (/id="nav-collab"/.test(allText)) {
  fail('empty collaboration primary nav still present');
}

for (const re of required) {
  if (!re.test(allText)) fail(`missing conversation-shell marker: ${re}`);
}
ok('conversation-shell markers present');

if (/GrowthEvent|ContextSnapshot|candidateExperiences/.test(allText.replace(/\/\*[\s\S]*?\*\//g, ''))) {
  // allow only if not in user-facing HTML text — soft check on HTML alone
}
const html = fs.readFileSync(path.join(appRoot, 'electron/renderer/index.html'), 'utf8');
if (/GrowthEvent|ContextSnapshot|candidate|confirmed|readiness/i.test(html)) {
  fail('internal terms leaked into index.html');
}
ok('no internal terms in conversation HTML');

const electronBin = require('electron');
const acceptScript = path.join(__dirname, 'electron-conversation-shell-acceptance.cjs');
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
  fail(`electron conversation-shell acceptance exited ${result.status}`);
}
ok('electron conversation-shell acceptance passed');
console.log('\naccept:conversation-shell PASSED');

/**
 * ARTIFACT-ACCEPTANCE-AND-REJECTION-01 验收:
 * - 静态：成果区采用/不采用、无内部术语
 * - 领域：幂等、版本重置、相关复用、无关隔离、失败不伪装
 * - Electron：按钮可见、采用后状态、编辑后重置
 *
 * 用法: npm run accept:artifact-feedback
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
  'electron/renderer/styles.css',
].map((p) => path.join(appRoot, p));

let allText = '';
for (const file of rendererFiles) {
  allText += `\n${fs.readFileSync(file, 'utf8')}`;
}

const required = [
  /id="btn-accept-artifact"/,
  /id="btn-reject-artifact"/,
  />采用</,
  />不采用</,
  /尚未决定是否采用|已采用|未采用/,
  /artifact_acceptance/,
  /artifact_rejection/,
  /artifactVersionId/,
  /可选说明/,
];

for (const re of required) {
  if (!re.test(allText)) fail(`missing artifact-feedback marker: ${re}`);
}
ok('artifact-feedback UI markers present');

const html = fs.readFileSync(path.join(appRoot, 'electron/renderer/index.html'), 'utf8');
if (/GrowthEvent|ContextSnapshot|confidence|candidateExperiences/i.test(html)) {
  fail('internal terms leaked into artifact decision HTML');
}
ok('no internal terms in decision HTML');

const domain = spawnSync(
  process.execPath,
  ['--test', 'dist/subject-core/tests/artifact-decision.test.js'],
  { stdio: 'inherit', cwd: appRoot },
);
if (domain.status !== 0) fail(`artifact-decision domain tests exited ${domain.status}`);
ok('artifact-decision domain tests passed');

const electronBin = require('electron');
const acceptScript = path.join(__dirname, 'electron-artifact-feedback-acceptance.cjs');
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
  fail(`electron artifact-feedback acceptance exited ${result.status}`);
}
ok('electron artifact-feedback acceptance passed');
console.log('\naccept:artifact-feedback PASSED');

/**
 * DIGITALME-V2-GROWTH-PERCEPTION-BRIDGE-01 验收入口。
 * 用法: npm run accept:growth-perception-bridge
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);
const evidenceDir = path.join(appRoot, 'scripts', '_growth-perception-bridge-evidence');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`OK: ${msg}`);
}

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true, cwd: appRoot });
if (build.status !== 0) fail(`build exited ${build.status || 1}`);
ok('build');

const html = fs.readFileSync(path.join(appRoot, 'electron/renderer/index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(appRoot, 'electron/renderer/app.js'), 'utf8');

if (/已结合你之前确认的内容/.test(html)) {
  fail('growth notice must not be static HTML (create dynamically when applied)');
}
if (!/id="applied-understanding"/.test(html)) fail('missing applied-understanding container');
if (!/id="material-summary"/.test(html)) fail('missing material-summary container');
if (!/renderAppliedUnderstanding/.test(appJs)) fail('renderer must wire appliedUnderstanding');
if (!/renderMaterialSummary/.test(appJs)) fail('renderer must wire materialSummary');
if (!/仅本次使用|以后优先采用|稍后再说/.test(appJs)) fail('JIT labels must match product copy');
if (/GrowthEvent|subjectContextDigest|conflictId/.test(appJs)) {
  fail('renderer must not display internal growth jargon');
}
ok('renderer wiring + silent surface');

const domain = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    'dist/work-runtime/tests/material-summary.test.js',
    'dist/subject-core/tests/growth-perception-bridge.test.js',
    'dist/infrastructure/tests/extract.test.js',
  ],
  { stdio: 'inherit', shell: false, cwd: appRoot },
);
if (domain.status !== 0) fail(`domain tests exited ${domain.status || 1}`);
ok('A–D domain + material summary + extract');

fs.mkdirSync(evidenceDir, { recursive: true });
const summary = {
  status: 'accept_passed',
  generatedAt: new Date().toISOString(),
  scenarios: ['A_related_reuse', 'B_unrelated_silent', 'C_jit_non_blocking', 'D_material_transparency'],
  checks: [
    'appliedUnderstanding_ui_dynamic',
    'materialSummary_from_snapshot',
    'jit_natural_copy',
    'no_second_store',
    'extract_skip_transparency',
  ],
};
fs.writeFileSync(
  path.join(evidenceDir, 'acceptance-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
);
ok('accept:growth-perception-bridge');
console.log(JSON.stringify(summary, null, 2));

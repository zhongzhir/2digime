/**
 * DIGITALME-V2-SUBJECT-COLLABORATION-FOUNDATION-01-REAL-VALIDATION
 * 真实模型同机双主体协作纵向验收；无凭证则失败（不得 Fake 冒充）。
 *
 * 用法: npm run accept:collaboration-real
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

const run = spawnSync(process.execPath, ['scripts/run-subject-collaboration-foundation-real.cjs'], {
  stdio: 'inherit',
  cwd: appRoot,
  env: { ...process.env },
});
if (run.status !== 0) {
  fail(`foundation real validation exited ${run.status}`);
}

const summaryPath = path.join(
  appRoot,
  'scripts',
  '_subject-collaboration-foundation-real-evidence',
  'summary.json',
);
if (!fs.existsSync(summaryPath)) fail('missing summary.json evidence');
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
if (summary.ok !== true) fail('summary.ok must be true');
if (summary.evidenceKind !== 'real_model') fail('evidenceKind must be real_model');
if (!summary.model || !summary.model.model) fail('summary.model missing');
if (!summary.collaboration || !summary.collaboration.termsDigest) {
  fail('summary.collaboration.termsDigest missing');
}
if (!summary.artifacts || !summary.artifacts.bArtifactId || !summary.artifacts.aLocalArtifactId) {
  fail('summary.artifacts incomplete');
}
ok('summary.json checks passed');

console.log('\naccept:collaboration-real PASSED');

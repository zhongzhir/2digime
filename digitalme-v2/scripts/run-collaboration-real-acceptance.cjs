/**
 * COLLABORATION-REAL-CAPABILITY-VALIDATION-01
 * 真实模型同机双主体协作单样本；无凭证则失败（不得 Fake 冒充）。
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

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status || 1);

const domain = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', 'dist/collaboration/tests/local-collaboration-real.test.js'],
  {
    stdio: 'inherit',
    cwd: appRoot,
    env: { ...process.env },
  },
);
if (domain.status !== 0) {
  fail(`collaboration-real tests exited ${domain.status}`);
}
ok('collaboration-real domain sample passed');

const evidence = path.join(
  appRoot,
  'scripts',
  '_mvp-collaboration-real-evidence',
  'real-collab-sample.json',
);
if (!fs.existsSync(evidence)) {
  fail('missing real-collab-sample.json evidence');
}
const payload = JSON.parse(fs.readFileSync(evidence, 'utf8'));
if (payload.reachedModel !== true) fail('evidence.reachedModel must be true');
if (!payload.mentionsAuthorizedToken) fail('evidence must mention authorized material token');
if (payload.mentionsUnauthorizedToken) fail('evidence must not mention unauthorized token');
ok('evidence checks passed');

console.log('\naccept:collaboration-real PASSED');

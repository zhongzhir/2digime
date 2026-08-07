/**
 * DIGITALME-V2-COLLABORATION-REAL-LOOP-01 自动化验收入口。
 * 跑独立 A/B 协作闭环测试并落证据；不 commit / 不 push。
 *
 * 用法: npm run accept:collaboration-real-loop
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

const evidenceDir = path.join(appRoot, 'scripts', '_collaboration-real-loop-01-evidence');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

fs.mkdirSync(evidenceDir, { recursive: true });

const build = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'build'],
  { stdio: 'inherit', cwd: appRoot, shell: true },
);
if (build.status !== 0) fail('build failed');

const testFile = path.join(
  'dist',
  'collaboration',
  'tests',
  'collaboration-real-loop-01.test.js',
);
if (!fs.existsSync(path.join(appRoot, testFile))) {
  fail(`missing ${testFile}`);
}

const run = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', testFile],
  { stdio: 'inherit', cwd: appRoot, env: { ...process.env } },
);

const summary = {
  task: 'DIGITALME-V2-COLLABORATION-REAL-LOOP-01',
  ok: run.status === 0,
  finishedAt: new Date().toISOString(),
  testFile,
  exitCode: run.status,
  notes: [
    'Independent SubjectPackage A/B',
    'propose skipAutoEvaluate → B respond → Grant both sides',
    'B fulfill via existing Task → A revise → A adopt',
    'separate GrowthEvent; restart persistence',
  ],
};

fs.writeFileSync(
  path.join(evidenceDir, 'summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
);

if (run.status !== 0) fail(`collaboration-real-loop-01 tests exited ${run.status}`);
ok('collaboration-real-loop-01 tests passed');
console.log('\naccept:collaboration-real-loop PASSED');
console.log(`evidence: ${path.join(evidenceDir, 'summary.json')}`);
console.log(`Owner checklist: ${path.join(evidenceDir, 'OWNER_CHECKLIST.md')}`);

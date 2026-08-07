/**
 * DIGITALME-V2-REMOTE-SUBJECT-COMMUNICATION-01 本机三进程远程语义验收。
 * 用法: npm run accept:remote-subject-communication
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);
const evidenceDir = path.join(appRoot, 'scripts', '_remote-subject-communication-01-evidence');

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

const tests = [
  path.join('dist', 'subject-comm', 'tests', 'remote-subject-communication-01.test.js'),
  path.join('dist', 'subject-comm', 'tests', 'opportunity-discovery-01.test.js'),
];
for (const t of tests) {
  if (!fs.existsSync(path.join(appRoot, t))) fail(`missing ${t}`);
}

const run = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', ...tests],
  { stdio: 'inherit', cwd: appRoot },
);
if (run.status !== 0) fail(`remote/opportunity tests exited ${run.status}`);
ok('remote + opportunity tests passed');

const collab = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'accept:collaboration-real-loop'],
  { stdio: 'inherit', cwd: appRoot, shell: true },
);
if (collab.status !== 0) fail('collaboration-real-loop regression failed');
ok('collaboration-real-loop regression passed');

const summary = {
  task: 'DIGITALME-V2-REMOTE-SUBJECT-COMMUNICATION-01',
  ok: true,
  finishedAt: new Date().toISOString(),
  notes: [
    'RelayService + RelayTransport E2EE',
    'Isolated A/B no shared package path',
    'signal / signal_response / collaboration_sync',
    'offline store-and-forward + outbox retry',
    'Local + opportunity + collaboration regressions',
  ],
};
fs.writeFileSync(
  path.join(evidenceDir, 'summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
);

console.log('\naccept:remote-subject-communication PASSED');
console.log(`evidence: ${path.join(evidenceDir, 'summary.json')}`);

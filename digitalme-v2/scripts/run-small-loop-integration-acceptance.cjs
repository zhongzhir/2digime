#!/usr/bin/env node
/**
 * DIGITALME-V2-SMALL-LOOP-INTEGRATION-01 acceptance runner
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const testFile = path.join(
  root,
  'dist',
  'subject-core',
  'tests',
  'small-loop-integration-01.test.js',
);

const build = spawnSync('npm', ['run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
if (build.status !== 0) process.exit(build.status || 1);

const run = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', testFile],
  { cwd: root, stdio: 'inherit' },
);
process.exit(run.status || 0);

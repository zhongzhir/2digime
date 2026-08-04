/**
 * SUBJECT-MVP-01 专项验收入口。
 * 用法: npm run accept:subject-mvp
 */
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status || 1);

const testFile = path.join(
  appRoot,
  'dist',
  'subject-core',
  'tests',
  'subject-mvp.accept.test.js',
);
const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', testFile],
  { stdio: 'inherit', shell: false, cwd: appRoot },
);
process.exit(result.status === null ? 1 : result.status);

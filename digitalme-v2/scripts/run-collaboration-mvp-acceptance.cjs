/**
 * COLLABORATION-MVP-01 验收：
 * - 静态：做事页低干扰协作入口仍在；领域闭环不变
 * - 领域：同机双主体授权/执行/隔离/撤销
 *
 * 用法: npm run accept:collaboration-mvp
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

const html = fs.readFileSync(path.join(appRoot, 'electron/renderer/index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(appRoot, 'electron/renderer/app.js'), 'utf8');

for (const re of [
  /另一个数字之我/,
  /交给协作对象|交给另一个数字之我/,
  /id="btn-collab-open"/,
  /id="btn-collab-issue"/,
  /id="btn-collab-revoke"/,
  /action:\s*["']issue["']/,
  /action:\s*["']execute["']/,
  /action:\s*["']revoke["']/,
]) {
  const hay = html + '\n' + appJs;
  if (!re.test(hay)) fail(`missing collaboration marker: ${re}`);
}
ok('collaboration work-page secondary entry markers present');

if (/GrowthEvent|AuthorizationGrant|ContextSnapshot/i.test(html)) {
  fail('internal terms leaked into collaboration HTML');
}
ok('no internal terms in collaboration HTML');

const domain = spawnSync(
  process.execPath,
  ['--test', 'dist/collaboration/tests/local-collaboration.test.js'],
  { stdio: 'inherit', cwd: appRoot },
);
if (domain.status !== 0) fail(`collaboration domain tests exited ${domain.status}`);
ok('collaboration domain tests passed');

console.log('\naccept:collaboration-mvp PASSED');

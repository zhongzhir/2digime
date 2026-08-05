/**
 * DIGITALME-V2-EXPERIENCE-REDESIGN-01B-B4 验收：
 * - 做事页仅轻入口；协作向导统一；任务上下文传递
 * - 材料默认不勾选（不静默扩大授权）
 * - 结果采用回原任务；撤销走既有运行时；无第二 Store
 *
 * 用法: npm run accept:collab-experience
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
const styles = fs.readFileSync(path.join(appRoot, 'electron/renderer/styles.css'), 'utf8');
const hay = `${html}\n${appJs}\n${styles}`;

const workChunk =
  html.match(/id="panel-work"[\s\S]*?(?=id="panel-collab")/)?.[0] ||
  html.match(/id="panel-work"[\s\S]*?id="artifact-panel"/)?.[0] ||
  '';

if (!/id="btn-collab-open"/.test(workChunk) || !/id="btn-external-cap-open"/.test(workChunk)) {
  fail('work page must keep light entries 请人帮忙 / 用专业能力');
}
if (/id="collab-form"/.test(workChunk)) {
  fail('work page must not keep full collab form');
}
if (/id="external-cap-panel"/.test(workChunk)) {
  fail('work page must not expand external capability full form');
}
if (/id="btn-collab-issue"/.test(workChunk) || /id="collab-peer-dir"/.test(workChunk)) {
  fail('work page must not keep peer issue controls');
}
if (/外部专业能力不是另一个数字之我|协作与专业能力/.test(workChunk)) {
  fail('work page must not keep long collaboration concept copy');
}
ok('work page keeps light entries only');

for (const re of [
  /id="panel-collab"/,
  /id="collab-page-home"/,
  /id="collab-page-new"/,
  /id="collab-page-target-mode"/,
  /id="collab-page-subtask"/,
  /id="collab-page-material-checks"/,
  /id="btn-collab-page-issue"/,
  /id="btn-collab-page-cancel"/,
  /id="external-cap-panel"/,
  /可找谁帮忙/,
  /进行中/,
  /待你处理/,
  /已撤销/,
  /openCollabWizardFromWork/,
  /collabDraftFromWork/,
  /applyCollabDraftToWizard/,
  /checked:\s*false/,
]) {
  if (!re.test(hay)) fail(`missing B4 marker: ${re}`);
}
ok('collab home + unified wizard markers present');

if (!/issuerTaskId:\s*collabDraftFromWork/.test(appJs) && !/collabDraftFromWork\.issuerTaskId/.test(appJs)) {
  fail('wizard issue must pass issuerTaskId from work draft');
}
if (!/setNav\(["']work["']\)/.test(appJs)) {
  fail('accept path must be able to return to work task');
}
ok('task context handoff and adopt-back wiring present');

for (const re of [/等待开始/, /正在处理/, /需要你确认/, /已完成/, /未完成/, /已撤销/]) {
  if (!re.test(appJs)) fail(`missing user-facing collab status: ${re}`);
}
ok('natural-language collab statuses present');

for (const bad of [
  /AuthorizationGrant/,
  /ContextSnapshot/,
  /Agent Card/,
  /Interaction Contract/,
  /\bA2A\b/,
  /Grant ID/,
  /Job ID/,
]) {
  if (bad.test(html)) fail(`protocol/internal term leaked into HTML: ${bad}`);
}
ok('no protocol jargon in collaboration HTML');

if (/localStorage\.setItem\(["']collab|indexedDB|new CollaborationStore|createCollabStore/i.test(appJs)) {
  fail('second collaboration store detected in renderer');
}
const collabSrc = path.join(appRoot, 'src/collaboration');
if (fs.existsSync(collabSrc)) {
  const files = fs.readdirSync(collabSrc, { recursive: true }).filter((f) => /\.(ts|js)$/.test(String(f)));
  const blob = files
    .map((f) => fs.readFileSync(path.join(collabSrc, f), 'utf8'))
    .join('\n');
  if (/class SecondCollab|new CollaborationStore|createSecondCollabStore/.test(blob)) {
    fail('second collaboration store detected in domain');
  }
}
ok('no second collaboration store');

const domain = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', 'dist/collaboration/tests/local-collaboration.test.js'],
  { stdio: 'inherit', cwd: appRoot },
);
if (domain.status !== 0) fail(`collaboration domain tests exited ${domain.status}`);
ok('collaboration domain / revoke path still green');

console.log('\naccept:collab-experience PASSED');

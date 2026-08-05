/**
 * DIGITALME-V2-EXPERIENCE-REDESIGN-01B-B2 — 做事工作台结构与主路径 DOM 验收。
 * 用法: npm run accept:work-experience
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
const css = fs.readFileSync(path.join(appRoot, 'electron/renderer/styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(appRoot, 'electron/renderer/app.js'), 'utf8');
const hay = `${html}\n${css}\n${appJs}`;

// B1 未回退
{
  const navMatch = html.match(/class="main-nav"[^>]*>([\s\S]*?)<\/nav>/);
  if (!navMatch) fail('main-nav missing');
  const labels = [...navMatch[1].matchAll(/>([^<]+)<\/button>/g)].map((m) => m[1].trim());
  if (labels.join('|') !== '做事|对话|数字之我|协作') {
    fail(`B1 nav regression: got ${labels.join('/')}`);
  }
  if (/id="btn-open-settings"/.test(navMatch[1])) fail('settings must stay secondary');
  if (/btn-chat-keep-artifact|留为成果/.test(html)) fail('empty keep-artifact returned');
}
ok('B1 nav/landing not regressed');

for (const re of [
  /id="goal-details"/,
  /class="goal-input"/,
  /id="material-list-wrap"/,
  /id="material-summary"/,
  /id="work-status-rail"/,
  /id="btn-restart-compose"/,
  /id="work-stage-tabs"/,
  /id="btn-work-toggle-tasks"/,
  /请人帮忙/,
  /用专业能力/,
  /id="btn-collab-open"/,
  /id="btn-external-cap-open"/,
  /id="revise-box"/,
  /用说明修改成果/,
  /id="artifact-editor"/,
  /work-compose-focus/,
]) {
  if (!re.test(hay)) fail(`missing workbench marker: ${re}`);
}
ok('workbench DOM markers present');

if (/协作与专业能力/.test(html) && /外部专业能力不是另一个数字之我/.test(html)) {
  fail('work page must not keep long resident collab explanation');
}
if (/参考资料/.test(html.match(/id="panel-work"[\s\S]*?id="panel-collab"/)?.[0] || '')) {
  fail('work materials must not use weakened「参考资料」wording');
}
ok('work assist is light-entry; materials wording ok');

if (!/\.goal-input[\s\S]*min-height:\s*220px/.test(css) && !/\.goal-input[\s\S]*min-height:\s*min\(/.test(css)) {
  fail('goal input must have enlarged min-height');
}
if (!/\.material-list[\s\S]*max-height:\s*180px/.test(css)) {
  fail('material list must be compact/scrollable');
}
if (!/data-stage|work-stage-tab/.test(css) || !/@media\s*\(max-width:\s*980px\)/.test(css)) {
  fail('responsive work stage / small-window rules missing');
}
if (!/\.artifact-side[\s\S]*overflow:\s*(auto|hidden)/.test(css)) {
  fail('artifact side must support contained scrolling');
}
ok('layout CSS for complex tasks / small windows');

for (const bad of [
  /\bJob ID\b/i,
  /\bjobId\b/,
  /AuthorizationGrant/,
  /ContextSnapshot/,
  /GrowthEvent/,
  /tool_calls/,
  /DSML/,
  /状态机/,
]) {
  if (bad.test(html)) fail(`internal term leaked into work HTML: ${bad}`);
}
ok('no protocol / internal state leakage in work HTML');

if (!/carryTaskContextIntoAssist/.test(appJs)) {
  fail('assist light entries must carry current task context');
}
if (!/syncGoalPresentation/.test(appJs)) {
  fail('goal presentation sync missing');
}
ok('workbench behavior wiring present');

const electronBin = require('electron');
const acceptScript = path.join(__dirname, 'electron-work-experience-acceptance.cjs');
const electron = spawnSync(electronBin, [acceptScript], {
  stdio: 'inherit',
  shell: false,
  cwd: appRoot,
  env: {
    ...process.env,
    DIGITALME_V2_UX_ACCEPTANCE: '1',
  },
});
if (electron.status !== 0) fail(`electron work-experience acceptance exited ${electron.status}`);
ok('electron work-experience acceptance passed');

console.log('\naccept:work-experience PASSED');

/**
 * PRODUCT-SHELL-REALIGNMENT-01 验收:
 * - 静态扫描禁止过度展示与内部术语
 * - Electron 交互:无目录选择、三入口、新建任务隔离、数字之我独立
 *
 * 用法: npm run accept:product-shell
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

const rendererFiles = [
  'electron/renderer/index.html',
  'electron/renderer/app.js',
  'electron/renderer/styles.css',
].map((p) => path.join(appRoot, p));

let allText = '';
for (const file of rendererFiles) {
  allText += `\n${fs.readFileSync(file, 'utf8')}`;
}

const forbidden = [
  /最近学到/,
  /还不确定/,
  /使用了什么/,
  /已结合你之前确认的内容/,
  /让数字之我更了解你/,
  /GrowthEvent/,
  /ContextSnapshot/,
  /\bcandidate\b/i,
  /\bconfirmed\b/i,
  /\breadiness\b/i,
  /主体合同/,
  /不必一次整理完整资料/,
];

for (const re of forbidden) {
  if (re.test(allText)) fail(`forbidden user-facing copy/term: ${re}`);
}
ok('forbidden copy/terms absent');

const required = [
  /建立你的数字之我/,
  /用一句话介绍你自己，或者告诉我你最近在做什么/,
  /开始使用/,
  /先跳过/,
  /id="nav-chat"/,
  /id="nav-subject"/,
  /id="nav-work"/,
  /id="nav-collab"/,
  /id="panel-collab"/,
  /id="btn-open-help"/,
  /id="btn-open-settings"/,
  /新建任务/,
  /已确认的重要内容/,
  /已添加的资料/,
  /getDefaultSubjectDir/,
  /id="artifact-type"/,
  /value="document"/,
];

for (const re of required) {
  if (!re.test(allText)) fail(`missing required shell marker: ${re}`);
}
ok('required shell markers present');

const htmlOnly = fs.readFileSync(path.join(appRoot, 'electron/renderer/index.html'), 'utf8');
{
  const navMatch = htmlOnly.match(/class="main-nav"[^>]*>([\s\S]*?)<\/nav>/);
  if (!navMatch) fail('main-nav missing');
  const labels = [...navMatch[1].matchAll(/>([^<]+)<\/button>/g)].map((m) => m[1].trim());
  const expected = ['数字之我', '对话', '做事', '协作', '设置'];
  if (labels.join('|') !== expected.join('|')) {
    fail(`primary nav order must be ${expected.join(' / ')}; got ${labels.join(' / ')}`);
  }
  if (!/class="main-nav"[\s\S]*id="btn-open-settings"/.test(htmlOnly)) {
    fail('设置 must be a primary nav item inside main-nav');
  }
}
ok('primary nav frozen as 数字之我 / 对话 / 做事 / 协作 / 设置');

if (!/id="nav-collab"/.test(htmlOnly) || !/id="panel-collab"/.test(htmlOnly)) {
  fail('collaboration primary nav/panel missing');
}
if (
  !/新建协作/.test(htmlOnly) ||
  !/协作对象/.test(htmlOnly) ||
  !/其他数字之我/.test(htmlOnly) ||
  !/进行中/.test(htmlOnly) ||
  !/已完成/.test(htmlOnly) ||
  !/已撤销/.test(htmlOnly)
) {
  fail('collaboration home sections incomplete');
}
if (/<h2[^>]*>已连接的协作对象<\/h2>/.test(htmlOnly)) {
  fail('collab home still uses superseded「已连接的协作对象」section title');
}
{
  const settingsBlock = htmlOnly.slice(htmlOnly.indexOf('view-settings'), htmlOnly.indexOf('view-shell'));
  if (/外部专业能力|remote-cap-base-url|保存并连接/.test(settingsBlock)) {
    fail('settings must not host external capability connection UI');
  }
}
if (/AuthorizationGrant|ContextSnapshot|GrowthEvent|Grant ID|Job ID/i.test(htmlOnly)) {
  fail('internal collaboration terms leaked into shell HTML');
}
ok('collaboration primary entry present with home sections');

if (/代码项目分析|value="code-analysis"|value="code-change"/.test(allText)) {
  fail('artifact type still exposes internal capability choices');
}
ok('artifact type defaults to document without user choice');

if (!/max-width:\s*min\(1680px,\s*96vw\)/.test(allText) || !/\.work-layout\.has-artifact/.test(allText)) {
  fail('wide responsive work layout markers missing');
}
ok('wide work layout CSS present');

if (/btn-open-pkg|welcome-model-status/.test(allText)) {
  fail('welcome still exposes open-existing or model status');
}
if (!/getDefaultSubjectDir/.test(allText) || !/createOrOpenDefaultPackage/.test(allText)) {
  fail('default subject dir path missing');
}
if (/pickSaveDirectory\(\)/.test(allText)) {
  fail('renderer still calls pickSaveDirectory; first entry must use default dir');
}
ok('first-entry uses default subject dir (no welcome folder picker UI)');

const electronBin = require('electron');
const acceptScript = path.join(__dirname, 'electron-product-shell-acceptance.cjs');
const result = spawnSync(electronBin, [acceptScript], {
  stdio: 'inherit',
  shell: false,
  cwd: appRoot,
  env: {
    ...process.env,
    DIGITALME_V2_UX_ACCEPTANCE: '1',
  },
});
if (result.status !== 0) {
  fail(`electron product-shell acceptance exited ${result.status}`);
}
ok('electron product-shell acceptance passed');
console.log('\naccept:product-shell PASSED');

/**
 * EXPERIENCE-REDESIGN-01B-B6 — B1–B5 关键合同静态验收（跨切片，不串跑全部历史 accept）。
 * 用法: npm run accept:experience-redesign
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
const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const hay = `${html}\n${css}\n${appJs}`;

// B1 导航合同
{
  const nav = html.match(/class="main-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
  const labels = [...nav.matchAll(/>([^<]+)<\/button>/g)].map((m) => m[1].trim());
  if (labels.join('|') !== '做事|对话|数字之我|协作') fail(`B1 nav: ${labels.join('/')}`);
  if (/id="btn-open-settings"/.test(nav)) fail('settings must stay secondary');
  if (!/topbar-actions[\s\S]*id="btn-open-settings"/.test(html)) fail('settings secondary missing');
  if (!/topbar-actions[\s\S]*id="btn-open-help"/.test(html)) fail('help secondary missing');
  if (/btn-chat-keep-artifact|留为成果/.test(html)) fail('deleted keep-artifact returned');
}
ok('B1 nav / landing contract');

// B2 做事工作台
for (const re of [/id="goal"/, /id="work-status-rail"/, /请人帮忙/, /用专业能力/, /work-compose-focus/]) {
  if (!re.test(hay)) fail(`B2 marker missing: ${re}`);
}
{
  const work = html.match(/id="panel-work"[\s\S]*?(?=id="panel-collab")/)?.[0] || '';
  if (/id="collab-form"/.test(work) || /id="external-cap-panel"/.test(work)) {
    fail('B2/B4: work must not keep full collab forms');
  }
}
ok('B2 workbench contract');

// B3 设置
if (!/id="advanced-connection"/.test(html) || !/高级连接/.test(html)) fail('B3 advanced missing');
if (!/btn-toggle-api-key/.test(html)) fail('B3 key toggle missing');
ok('B3 settings contract');

// B4 协作
for (const re of [
  /openCollabWizardFromWork/,
  /collabDraftFromWork/,
  /id="collab-page-new"/,
  /等待开始/,
  /需要你确认/,
]) {
  if (!re.test(hay)) fail(`B4 marker missing: ${re}`);
}
ok('B4 collab contract');

// B5 视觉文案
for (const re of [/--focus-ring:/, /\.empty-hint/, /\.page-lead/, /\.chat-composer/]) {
  if (!re.test(css)) fail(`B5 marker missing: ${re}`);
}
{
  const helpItems = [...(html.match(/id="view-help"[\s\S]*?<\/section>/)?.[0] || '').matchAll(/<li>/g)]
    .length;
  if (helpItems < 3 || helpItems > 5) fail(`B5 help items ${helpItems}`);
}
ok('B5 visual/content contract');

// 无协议泄漏
for (const bad of [/AuthorizationGrant/, /Agent Card/, /Interaction Contract/, /\bA2A\b/, /GrowthEvent/]) {
  if (bad.test(html)) fail(`protocol leak: ${bad}`);
}
ok('no protocol jargon in HTML');

// B6 基础设施存在
for (const script of [
  'accept:experience-redesign',
  'accept:experience-redesign-ui',
  'accept:experience-redesign-a11y',
]) {
  if (!pkg.scripts || !pkg.scripts[script]) fail(`missing npm script ${script}`);
}
if (!fs.existsSync(path.join(appRoot, 'scripts/electron-experience-b6-harness.cjs'))) {
  fail('B6 harness missing');
}
if (!fs.existsSync(path.join(appRoot, 'scripts/playwright-experience-redesign-ui.cjs'))) {
  fail('B6 playwright UI driver missing');
}
if (!pkg.devDependencies || !pkg.devDependencies.playwright) fail('playwright not in devDependencies');
ok('B6 harness / scripts wired');

console.log('\naccept:experience-redesign PASSED');

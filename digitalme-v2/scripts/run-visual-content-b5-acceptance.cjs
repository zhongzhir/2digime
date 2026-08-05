/**
 * DIGITALME-V2-EXPERIENCE-REDESIGN-01B-B5
 * 视觉 token / 文案收束 / 空态与焦点态静态验收（不扩能力）。
 * 用法: npm run accept:visual-content
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

for (const re of [
  /--accent:\s*#0f6a5a/,
  /--danger:\s*#8a2f2f/,
  /--radius:/,
  /--focus-ring:/,
  /--accent-soft:/,
  /--transition:/,
  /\.empty-hint/,
  /\.page-lead/,
  /:focus-visible/,
  /prefers-reduced-motion/,
  /\.chat-composer/,
  /\.subject-list-pending/,
  /\.work-assist-lite/,
  /\.nav-item-secondary/,
]) {
  if (!re.test(css)) fail(`missing visual token/marker: ${re}`);
}
ok('design tokens and focus/empty/chat markers present');

const accentMatches = css.match(/--accent:\s*#[0-9a-fA-F]{3,8}/g) || [];
if (accentMatches.length !== 1) fail(`expected single --accent definition, got ${accentMatches.length}`);
if (/#7c3aed|#a855f7|neon|glow:\s*|linear-gradient\([^)]*purple/i.test(css)) {
  fail('forbidden purple/neon/tech-console look detected');
}
ok('single accent; no purple/neon console look');

const help = html.match(/id="view-help"[\s\S]*?<\/section>/)?.[0] || '';
const helpItems = [...help.matchAll(/<li>/g)].length;
if (helpItems < 3 || helpItems > 5) fail(`help must have 3–5 items, got ${helpItems}`);
if (/主体资料|目标与边界|应用级运行参数|不会自动生成成果/.test(help)) {
  fail('help still has heavy/duplicative copy');
}
if (/主导航|五个入口/.test(help)) fail('help must not restate primary nav meta');
ok('help shortened to 3–5 useful items');

for (const re of [
  /交流想法；需要时可转为任务/,
  /找人帮忙或使用专业能力/,
  /连接模型后即可做事与对话/,
  /class="empty-hint"/,
  /subject-list-pending/,
  /chat-panel/,
  /chat-composer/,
]) {
  if (!re.test(html)) fail(`missing B5 content/layout marker: ${re}`);
}
ok('page leads and empty/chat layout present');

const workChunk = html.match(/id="panel-work"[\s\S]*?(?=id="panel-collab")/)?.[0] || '';
if (/外部专业能力不是另一个数字之我|协作与专业能力/.test(workChunk)) {
  fail('work page must not restore long collab concept copy');
}
if ((workChunk.match(/muted tiny/g) || []).length > 4) {
  fail('work page still stacks too many muted tiny lines');
}
ok('work page stays quiet');

for (const bad of [
  /AuthorizationGrant/,
  /ContextSnapshot/,
  /GrowthEvent/,
  /Agent Card/,
  /Interaction Contract/,
  /\bA2A\b/,
  /\bJob ID\b/i,
  /状态机/,
  /tool_calls/,
  /DSML/,
]) {
  if (bad.test(html)) fail(`internal/protocol term in HTML: ${bad}`);
}
ok('no protocol jargon in HTML');

if (!/openCollabWizardFromWork/.test(appJs) || !/collabDraftFromWork/.test(appJs)) {
  fail('B4 collab handoff must not regress');
}
if (!/id="advanced-connection"/.test(html) || !/高级连接/.test(html)) {
  fail('B3 advanced connection must not regress');
}
const nav = html.match(/class="main-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
const labels = [...nav.matchAll(/>([^<]+)<\/button>/g)].map((m) => m[1].trim());
if (labels.join('|') !== '做事|对话|数字之我|协作') {
  fail(`B1 nav regression: ${labels.join('/')}`);
}
ok('B1–B4 shell markers not regressed');

console.log('\naccept:visual-content PASSED');

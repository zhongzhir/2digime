/**
 * DIGITALME-V2-EXPERIENCE-REDESIGN-01B-B3 — 模型连接设置渐进披露验收。
 * 用法: npm run accept:model-connection-settings
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
const secrets = fs.readFileSync(path.join(appRoot, 'electron/bootstrap-secrets.cjs'), 'utf8');
const main = fs.readFileSync(path.join(appRoot, 'electron/main.cjs'), 'utf8');

// B1 未回退
{
  const navMatch = html.match(/class="main-nav"[^>]*>([\s\S]*?)<\/nav>/);
  if (!navMatch) fail('main-nav missing');
  const labels = [...navMatch[1].matchAll(/>([^<]+)<\/button>/g)].map((m) => m[1].trim());
  if (labels.join('|') !== '做事|对话|数字之我|协作') fail(`B1 nav regression: ${labels.join('/')}`);
  if (/id="btn-open-settings"/.test(navMatch[1])) fail('settings must stay secondary');
}
ok('B1 secondary settings not regressed');

// B2 轻入口仍在
if (!/请人帮忙/.test(html) || !/用专业能力/.test(html) || !/goal-input/.test(html)) {
  fail('B2 workbench markers missing');
}
ok('B2 workbench markers present');

const settingsStart = html.indexOf('id="view-settings"');
const settingsEnd = html.indexOf('id="view-shell"');
const settingsChunk =
  settingsStart >= 0 && settingsEnd > settingsStart ? html.slice(settingsStart, settingsEnd) : '';
if (!settingsChunk) fail('settings view missing');

for (const re of [
  /id="model-provider"/,
  /DeepSeek/,
  /自定义服务/,
  /id="model-api-key"/,
  /id="btn-toggle-api-key"/,
  /id="model-connection-state"/,
  /id="btn-save-model"/,
  /id="btn-test-model"/,
  /id="btn-delete-model"/,
  /id="advanced-connection"/,
  />高级连接</,
  /id="model-base-url"/,
  /id="model-id"/,
  /id="btn-restore-model-preset"/,
  /恢复推荐设置/,
  /id="settings-tech-detail"/,
]) {
  if (!re.test(settingsChunk)) fail(`missing settings marker: ${re}`);
}
ok('settings progressive-disclosure markers present');

// Base URL / Model ID 必须在 advanced-connection 内
const adv = settingsChunk.match(/id="advanced-connection"[\s\S]*?<\/details>/);
if (!adv) fail('advanced-connection block missing');
if (!/id="model-base-url"/.test(adv[0]) || !/id="model-id"/.test(adv[0])) {
  fail('Base URL / Model ID must live inside advanced-connection');
}
const beforeAdv = settingsChunk.slice(0, settingsChunk.indexOf('id="advanced-connection"'));
if (/id="model-base-url"|id="model-id"/.test(beforeAdv)) {
  fail('Base URL / Model ID must not appear outside advanced-connection');
}
ok('Base URL / Model ID default-hidden in advanced');

if (/OpenAI-compatible/.test(settingsChunk)) {
  fail('settings must not show OpenAI-compatible jargon by default');
}
if (/SecretAccessor|环境变量|tool_calls|DSML/.test(settingsChunk)) {
  fail('settings leaked internal concepts');
}
if (/凭证状态：/.test(settingsChunk)) {
  fail('old credential-status copy should be replaced');
}
ok('settings copy is user-facing');

for (const re of [
  /userFacingModelError/,
  /redactSecrets/,
  /setConnectionStateLabel/,
  /advancedFieldsDirty/,
  /btn-restore-model-preset|restoreModelPreset/,
  /allowExistingKey/,
  /selectTask\(activeTaskId\)/,
]) {
  if (!re.test(appJs)) fail(`missing settings wiring: ${re}`);
}
ok('renderer settings behavior wiring present');

if (!/label:\s*"自定义服务"/.test(secrets)) {
  fail('bootstrap preset label should be 自定义服务');
}
if (!/allowExistingKey/.test(main)) {
  fail('main save path should allow existing key reuse');
}
if (!/await store\.get\(providerCredentialKey/.test(secrets)) {
  fail('saveCredential should reuse existing key when input empty');
}
ok('credential save reuses existing key without second store');

if (!/\.advanced-connection/.test(css) || !/\.key-input-row/.test(css)) {
  fail('settings CSS for advanced/key row missing');
}
ok('settings CSS present');

const electronBin = require('electron');
const result = spawnSync(electronBin, [path.join(__dirname, 'electron-model-connection-settings-acceptance.cjs')], {
  stdio: 'inherit',
  shell: false,
  cwd: appRoot,
  env: { ...process.env, DIGITALME_V2_UX_ACCEPTANCE: '1' },
});
if (result.status !== 0) fail(`electron model-connection settings acceptance exited ${result.status}`);
ok('electron model-connection settings acceptance passed');

console.log('\naccept:model-connection-settings PASSED');

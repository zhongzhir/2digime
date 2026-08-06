/**
 * DIGITALME-V2-CONVERSATION-OUTPUT-INTEGRITY-01 验收入口。
 * 用法: npm run accept:conversation-output-integrity
 *
 * 含：静态门禁 + model-http 单测 + Electron UI（长回复/截断/重试/重载）。
 * 真实 DeepSeek 另见: node scripts/run-conversation-output-integrity-real.cjs
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

const evidenceDir = path.join(appRoot, 'scripts', '_conversation-output-integrity-evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status || 1);
ok('build');

const required = [
  'src/infrastructure/model-http.ts',
  'electron/main.cjs',
  'electron/preload.cjs',
  'electron/renderer/app.js',
  'scripts/electron-conversation-output-integrity-harness.cjs',
  'scripts/playwright-conversation-output-integrity.cjs',
];
for (const rel of required) {
  if (!fs.existsSync(path.join(appRoot, rel))) fail(`missing ${rel}`);
}

const modelHttp = fs.readFileSync(path.join(appRoot, 'src/infrastructure/model-http.ts'), 'utf8');
if (/reasoning_content[\s\S]{0,80}\|\|/.test(modelHttp) && /content\.trim\(\)\.length === 0/.test(modelHttp) === false) {
  // soft: ensure we don't fall back to reasoning as text
}
if (/message\?\.content[\s\S]{0,120}reasoning_content/.test(modelHttp.replace(/\s+/g, ' '))) {
  // old bug pattern: content || reasoning
  const compact = modelHttp.replace(/\s+/g, ' ');
  if (/content \|\|[\s\S]{0,40}reasoning_content|reasoning_content \|\|[\s\S]{0,40}content/.test(compact)) {
    fail('model-http must not fall back to reasoning_content for user text');
  }
}
if (!/reasoning_content 一律不进入|reasoning discarded|reasoning_content 丢弃/.test(modelHttp)) {
  fail('model-http must explicitly discard reasoning_content');
}
if (!/DEFAULT_CHAT_MAX_TOKENS\s*=\s*4096/.test(modelHttp)) {
  fail('DEFAULT_CHAT_MAX_TOKENS must be 4096');
}
if (!/finishReason|truncated/.test(modelHttp)) {
  fail('model-http must surface finishReason/truncated');
}
ok('model-http reasoning isolation + finishReason');

const mainJs = fs.readFileSync(path.join(appRoot, 'electron/main.cjs'), 'utf8');
if (!/status:\s*["']incomplete["']/.test(mainJs) || !/status:\s*["']complete["']/.test(mainJs)) {
  fail('main conversationReply must return complete/incomplete status');
}
if (!/DIGITALME_CHAT_MAX_TOKENS|DEFAULT_CHAT_MAX_TOKENS/.test(mainJs)) {
  fail('main must use raised/default chat max tokens');
}
ok('main conversationReply completion status');

const appJs = fs.readFileSync(path.join(appRoot, 'electron/renderer/app.js'), 'utf8');
if (!/回复未完成，可重试/.test(appJs) || !/已回复/.test(appJs) || !/无法回复，请重试/.test(appJs)) {
  fail('renderer must use authentic completion statuses');
}
if (!/replyStatus === ["']incomplete["']/.test(appJs)) {
  fail('renderer must gate 已回复 on replyStatus');
}
if (!/不重复写入用户消息|不重复成长采集/.test(appJs)) {
  fail('retry path must avoid duplicate user/capture');
}
ok('renderer completion + retry semantics');

const unit = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', 'dist/infrastructure/tests/model-http.test.js'],
  { stdio: 'inherit', cwd: appRoot },
);
if (unit.status !== 0) fail(`model-http unit tests exited ${unit.status}`);
ok('model-http unit tests');

const runDir = path.join(os.tmpdir(), `dmv2-coi-accept-${Date.now()}`);
const driver = path.join(__dirname, 'playwright-conversation-output-integrity.cjs');
const ui = spawnSync(process.execPath, [driver], {
  stdio: 'inherit',
  cwd: appRoot,
  env: {
    ...process.env,
    DIGITALME_COI_RUN_DIR: runDir,
    DIGITALME_COI_EVIDENCE: evidenceDir,
  },
});
if (ui.status !== 0) fail(`playwright conversation-output-integrity exited ${ui.status}`);
ok(`ui acceptance evidence: ${runDir}`);

const summary = {
  writtenAt: new Date().toISOString(),
  verdict: 'passed',
  runDir,
  evidenceDir,
};
fs.writeFileSync(path.join(evidenceDir, 'acceptance-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log('\naccept:conversation-output-integrity PASSED');

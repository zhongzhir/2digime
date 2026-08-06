/**
 * DIGITALME-V2-OWNER-ACCEPTANCE-BLOCKERS-01 验收入口。
 * 用法: npm run accept:owner-blockers
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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
ok('build');

const required = [
  'electron/renderer/styles.css',
  'electron/renderer/app.js',
  'electron/main.cjs',
  'electron/preload.cjs',
  'scripts/playwright-owner-blockers.cjs',
  'scripts/lib/make-text-pdf.cjs',
];
for (const rel of required) {
  if (!fs.existsSync(path.join(appRoot, rel))) fail(`missing ${rel}`);
}

const css = fs.readFileSync(path.join(appRoot, 'electron/renderer/styles.css'), 'utf8');
if (!/\.shell-panel\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s.test(css)) {
  fail('shell-panel[hidden] display:none !important missing');
}
ok('panel hidden CSS guard');

const appJs = fs.readFileSync(path.join(appRoot, 'electron/renderer/app.js'), 'utf8');
if (/已记下。需要做成具体工作时/.test(appJs)) {
  fail('hardcoded chat ack stub still present');
}
if (!/conversation\.reply/.test(appJs)) {
  fail('chat must call conversation.reply');
}
ok('chat uses real reply path');

const mainJs = fs.readFileSync(path.join(appRoot, 'electron/main.cjs'), 'utf8');
if (!/shell:conversationReply/.test(mainJs)) {
  fail('shell:conversationReply missing in main');
}
ok('conversationReply IPC present');

const fake = fs.readFileSync(path.join(appRoot, 'src/capability/adapters/fake-document.ts'), 'utf8');
if (!/collectMaterialSnippets/.test(fake)) {
  fail('fake document must include material snippets');
}
ok('fake document materials wired');

const runDir = path.join(os.tmpdir(), `dmv2-owner-blockers-accept-${Date.now()}`);
const driver = path.join(__dirname, 'playwright-owner-blockers.cjs');
const result = spawnSync(process.execPath, [driver], {
  stdio: 'inherit',
  cwd: appRoot,
  env: {
    ...process.env,
    DIGITALME_OWNER_BLOCKERS_RUN_DIR: runDir,
  },
});
if (result.status !== 0) {
  fail(`playwright-owner-blockers exited ${result.status}`);
}
ok(`owner-blockers electron evidence: ${runDir}`);
console.log('\naccept:owner-blockers PASSED');

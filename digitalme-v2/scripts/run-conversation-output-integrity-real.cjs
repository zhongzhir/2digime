/**
 * 真实 DeepSeek 对话输出完整性。
 * 用法: node scripts/run-conversation-output-integrity-real.cjs
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

const evidenceDir = path.join(
  appRoot,
  'scripts',
  '_conversation-output-integrity-evidence',
  'real',
);
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

const electronCli = path.join(appRoot, 'node_modules', 'electron', 'cli.js');
const load = spawnSync(process.execPath, [electronCli, path.join('scripts', 'load-app-model-credential.cjs')], {
  cwd: appRoot,
  stdio: 'inherit',
  shell: false,
});
if (load.status !== 0) fail(`load-app-model-credential exited ${load.status}`);

const cred = path.join(
  appRoot,
  'scripts',
  '_mvp-p14-real-capability-evidence',
  '.runtime-model-credential.json',
);
if (!fs.existsSync(cred)) fail('credential import file missing after load');
const meta = JSON.parse(fs.readFileSync(cred, 'utf8'));
const host = (() => {
  try {
    return new URL(meta.baseUrl).host;
  } catch {
    return '';
  }
})();
if (!/deepseek/i.test(host)) fail(`expected deepseek host, got ${host}`);
ok(`credential ready host=${host} model=${meta.model}`);

const driver = path.join(__dirname, 'playwright-conversation-output-integrity-real.cjs');
const result = spawnSync(process.execPath, [driver], {
  cwd: appRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    DIGITALME_COI_REAL_EVIDENCE: evidenceDir,
    DIGITALME_V2_CREDENTIAL_IMPORT: cred,
  },
});

const reportPath = path.join(evidenceDir, 'report.json');
if (fs.existsSync(reportPath)) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  console.log('\n--- real integrity summary ---');
  console.log(`verdict: ${report.verdict}`);
  console.log(`checks: ${(report.checks || []).length}`);
  console.log(`scenarios: ${JSON.stringify(report.scenarios || {}, null, 2)}`);
  console.log(`realDeepSeek: ${JSON.stringify(report.realDeepSeek || null)}`);
  console.log(`evidence: ${evidenceDir}`);
}

if (result.status !== 0) fail(`real integrity driver exited ${result.status}`);
console.log('\nconversation-output-integrity REAL PASSED');

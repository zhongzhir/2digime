/**
 * 真实 DeepSeek + 真实 PDF 预检入口（不改产品）。
 * 用法: node scripts/run-owner-blockers-real-preflight.cjs
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
  '_owner-acceptance-blockers-01-real-preflight-evidence',
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
  env: { ...process.env },
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
ok(`credential ready host=${host} model=${meta.model} keyChars=${String(meta.apiKey || '').length}`);

const driver = path.join(__dirname, 'playwright-owner-blockers-real-preflight.cjs');
const result = spawnSync(process.execPath, [driver], {
  cwd: appRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    DIGITALME_REAL_PREFLIGHT_EVIDENCE: evidenceDir,
    DIGITALME_V2_CREDENTIAL_IMPORT: cred,
  },
});

const reportPath = path.join(evidenceDir, 'report.json');
if (fs.existsSync(reportPath)) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  console.log('\n--- real preflight summary ---');
  console.log(`verdict: ${report.verdict}`);
  console.log(`checks: ${(report.checks || []).length}`);
  console.log(`realDeepSeek: ${JSON.stringify(report.realDeepSeek || null)}`);
  console.log(`summary: ${JSON.stringify(report.summary || null)}`);
  console.log(`evidence: ${evidenceDir}`);
}

if (result.status !== 0) fail(`real preflight exited ${result.status}`);
ok('real DeepSeek + PDF preflight PASSED');
console.log('\naccept:owner-blockers-real-preflight PASSED');

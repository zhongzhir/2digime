/**
 * DIGITALME-V2-A2A-REMOTE-CAPABILITY-ADAPTER-01 验收。
 * 用法: npm run accept:a2a-remote-capability
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

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true, cwd: appRoot });
if (build.status !== 0) fail(`build exited ${build.status || 1}`);
ok('build');

// Static contract checks
const adapterSrc = fs.readFileSync(path.join(appRoot, 'src/capability/adapters/a2a-remote.ts'), 'utf8');
for (const m of [
  'describe',
  'checkAvailability',
  'prepareAuthorizedInput',
  'execute',
  'getStatus',
  'cancel',
  'recover',
  'collectArtifact',
]) {
  if (!adapterSrc.includes(`${m}(`) && !adapterSrc.includes(`${m}():`)) {
    fail(`A2A adapter missing lifecycle method: ${m}`);
  }
}
ok('A2A adapter lifecycle methods present');

const policySrc = fs.readFileSync(
  path.join(appRoot, 'src/capability/remote-endpoint-policy.ts'),
  'utf8',
);
for (const key of [
  'endpointId',
  'baseUrl',
  'expectedAgentCardUrl',
  'allowedHost',
  'allowedProtocol',
  'capabilityAllowlist',
  'modelPolicy',
  'maxTaskDuration',
  'maxInputBytes',
  'maxOutputBytes',
  'maxCallsPerTask',
  'enabled',
]) {
  if (!policySrc.includes(key)) fail(`endpoint policy missing field: ${key}`);
}
ok('endpoint policy fields present');

if (!fs.existsSync(path.join(appRoot, 'reference-agents/research-a2a-agent/server.cjs'))) {
  fail('missing independent research-a2a-agent');
}
ok('reference agent present');

const html = fs.readFileSync(path.join(appRoot, 'electron/renderer/index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(appRoot, 'electron/renderer/app.js'), 'utf8');
const ui = `${html}\n${appJs}`;
for (const re of [
  /研究分析能力（已连接的专业能力）/,
  /外部专业能力：研究分析能力/,
  /已连接的专业能力/,
  /交给协作对象/,
  /collab-target-mode/,
  /external-research/,
  /cap_a2a_research_analysis/,
  /另一个数字之我/,
]) {
  if (!re.test(ui)) fail(`missing product path marker: ${re}`);
}
if (/\bA2A\b/.test(html) || /Agent Card|JSON-RPC|taskId|protocol version|endpoint/i.test(html)) {
  fail('product HTML must not expose protocol jargon');
}
// 非 SubjectPackage 不得被称作“另一个数字之我”
if (/external-research[\s\S]{0,200}另一个数字之我/.test(html)) {
  fail('external capability option must not be labeled as 另一个数字之我');
}
ok('product path markers present without protocol jargon in HTML');

// 端点身份与凭证纪律
const policySrcFull = fs.readFileSync(
  path.join(appRoot, 'src/capability/remote-endpoint-policy.ts'),
  'utf8',
);
for (const key of [
  'forbidOffAllowlistRedirect',
  'forbidRedelegate',
  'credentialSecretKey',
  'fingerprintEndpointPolicy',
  'loopback-http',
]) {
  if (!policySrcFull.includes(key)) fail(`endpoint identity marker missing: ${key}`);
}
ok('endpoint identity policy markers present');

const receiptSrc = fs.readFileSync(path.join(appRoot, 'src/capability/action-receipt.ts'), 'utf8');
if (!/scrubSensitive/.test(receiptSrc)) fail('action receipt must scrub sensitive text');
ok('action receipt scrub present');

const agentExec = fs.readFileSync(
  path.join(appRoot, 'reference-agents/research-a2a-agent/agent-executor.cjs'),
  'utf8',
);
if (/model_length_pad|deterministicRiskBrief\(goal,\s*inputText,\s*'model_length_pad'/.test(agentExec)) {
  fail('reference agent must not pad substantive template content for short model output');
}
if (!/modelGeneratedContent/.test(agentExec) || !/deterministicFormatting/.test(agentExec)) {
  fail('reference agent must distinguish modelGeneratedContent vs deterministicFormatting');
}
if (!/insufficientLength/.test(agentExec) || !/revisionAttempted/.test(agentExec)) {
  fail('reference agent must support revision + insufficientLength failure');
}
ok('artifact integrity gates present in reference agent');

const runnerSrc = fs.readFileSync(path.join(appRoot, 'src/work-runtime/job-runner.ts'), 'utf8');
if (/class\s+A2ATaskStore|RemoteExecutionStore/.test(runnerSrc)) {
  fail('must not introduce second remote store/state machine');
}
ok('no second store in job-runner');

const design = path.join(
  appRoot,
  'docs/design/digitalme_v2_a2a_remote_capability_adapter_v0.1_202608.md',
);
if (!fs.existsSync(design)) fail('missing design doc');
ok('design doc present');

// Unit tests (deterministic)
const unit = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    'dist/capability/tests/a2a-remote-capability.test.js',
    'dist/capability/adapters/tests/a2a-remote.test.js',
  ],
  { stdio: 'inherit', cwd: appRoot, env: process.env },
);
if (unit.status !== 0) fail(`unit tests exited ${unit.status || 1}`);
ok('unit tests');

// E2E with independent agent + one real model task
const e2e = spawnSync(process.execPath, ['scripts/_a2a-remote-capability-e2e.cjs'], {
  stdio: 'inherit',
  cwd: appRoot,
  env: process.env,
});
if (e2e.status !== 0) fail(`e2e exited ${e2e.status || 1}`);
ok('a2a remote capability e2e');

console.log('\nPASS: accept:a2a-remote-capability');

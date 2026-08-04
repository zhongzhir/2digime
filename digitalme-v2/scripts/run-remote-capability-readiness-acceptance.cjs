/**
 * DIGITALME-V2-REMOTE-CAPABILITY-PRODUCT-READINESS-01 验收。
 * 用法: npm run accept:remote-capability-readiness
 *
 * 完整路径:
 * Subject → Task → AuthorizationGrant → ControlledRemoteCapabilityAdapter
 * → 本地 Job 投影 → Candidate Artifact → Verification → 采用/拒绝
 * → GrowthEvent → 重启恢复
 *
 * 默认单次通过(REMOTE_CAPABILITY_ACCEPT_ATTEMPTS=1)。
 * 超时与产品逻辑失败不得自动重试掩盖;不做 EPERM 全局治理。
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
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

function runNode(args, opts = {}) {
  return spawnSync(process.execPath, args, {
    stdio: 'inherit',
    cwd: appRoot,
    ...opts,
  });
}

// 默认单次通过。仅当明确遇到 EPERM/EBUSY 才允许有限重试;超时/产品逻辑失败不得掩盖。
const MAX_ATTEMPTS = Math.max(
  1,
  Math.min(3, Number(process.env.REMOTE_CAPABILITY_ACCEPT_ATTEMPTS || 1) || 1),
);
let lastStatus = 1;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  console.log(`\n=== remote-capability-readiness attempt ${attempt}/${MAX_ATTEMPTS} ===`);

  const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true, cwd: appRoot });
  if (build.status !== 0) {
    lastStatus = build.status || 1;
    fail(`build exited ${lastStatus}`);
  }
  ok('build');

  // 静态:Adapter 合同方法冻结;无第二 Store/状态机关键字滥扩
  const adapterSrc = fs.readFileSync(path.join(appRoot, 'src/capability/adapter.ts'), 'utf8');
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
    if (!new RegExp(`${m}\\s*\\(`).test(adapterSrc) && !new RegExp(`${m}\\(`).test(adapterSrc)) {
      // interface methods use name():
      if (!new RegExp(`${m}\\s*\\(`).test(adapterSrc) && !adapterSrc.includes(`${m}(`) && !adapterSrc.includes(`${m}:`)) {
        // also check describe(): form
      }
    }
    if (!adapterSrc.includes(`${m}(`) && !adapterSrc.includes(`${m}:`)) {
      // TypeScript interface: describe(): ...
      if (!new RegExp(`${m}\\s*\\(`).test(adapterSrc)) {
        fail(`adapter contract missing method: ${m}`);
      }
    }
  }
  for (const m of [
    'describe()',
    'checkAvailability(',
    'prepareAuthorizedInput(',
    'execute(',
    'getStatus(',
    'cancel(',
    'recover(',
    'collectArtifact(',
  ]) {
    if (!adapterSrc.includes(m.replace('()', '(')) && !adapterSrc.includes(m)) {
      // softer: ensure name present as method signature
    }
  }
  const requiredNames = [
    'describe',
    'checkAvailability',
    'prepareAuthorizedInput',
    'execute',
    'getStatus',
    'cancel',
    'recover',
    'collectArtifact',
  ];
  for (const name of requiredNames) {
    if (!adapterSrc.includes(name)) fail(`adapter contract missing: ${name}`);
  }
  ok('unified CapabilityAdapter contract present');

  const jobSrc = fs.readFileSync(path.join(appRoot, 'src/work-runtime/execution-job.ts'), 'utf8');
  if (!jobSrc.includes('remoteExecution?')) fail('ExecutionJob missing optional remoteExecution mapping');
  if (/type\s+JobStatus\s*=\s*[^=]*pending/.test(jobSrc)) {
    fail('second job status machine detected');
  }
  ok('remoteExecution is mapping only; Job five-state intact');

  const runnerSrc = fs.readFileSync(path.join(appRoot, 'src/work-runtime/job-runner.ts'), 'utf8');
  if (/new\s+RemoteExecutionStore|class\s+RemoteJobStore/.test(runnerSrc)) {
    fail('second remote execution store detected');
  }
  ok('no second remote store in job-runner');

  const regSrc = fs.readFileSync(path.join(appRoot, 'src/capability/registration.ts'), 'utf8');
  if (!regSrc.includes("'remote-subject'")) fail('remote-subject missing from ADAPTER_TYPES');
  ok('remote-subject in production adapter whitelist');

  const unit = runNode([
    '--test',
    '--test-concurrency=1',
    'dist/capability/tests/remote-capability-contract.test.js',
    'dist/capability/adapters/tests/controlled-remote.test.js',
  ]);
  if (unit.status !== 0) {
    lastStatus = unit.status || 1;
    fail(`unit/integration tests exited ${lastStatus}`);
  }
  ok('unit/integration remote capability tests passed');

  // 端到端验收脚本(内联 require dist)
  const e2e = runNode([path.join(appRoot, 'scripts/_remote-capability-readiness-e2e.cjs')]);
  if (e2e.status !== 0) {
    lastStatus = e2e.status || 1;
    fail(`e2e exited ${lastStatus}`);
  }
  ok('e2e readiness path passed');

  console.log('\nACCEPT: remote-capability-readiness PASSED');
  process.exit(0);
}

process.exit(lastStatus || 1);

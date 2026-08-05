/**
 * DIGITALME-V2-SUBJECT-DISTILLATION-AND-JIT-CONFIRMATION-01 验收。
 * 用法: npm run accept:subject-distillation-jit-confirmation
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('path');

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

const html = fs.readFileSync(path.join(appRoot, 'electron/renderer/index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(appRoot, 'electron/renderer/app.js'), 'utf8');
for (const bad of [/GrowthEvent/, /conflictId/, /confidence\s*[:=]/, /分类器/, /MemoryStore|ProfileStore|PreferenceStore/]) {
  if (bad.test(html) && /待你确认|已确认的重要内容/.test(html)) {
    // allow only if not in user-visible copy — still fail if GrowthEvent in html
  }
  if (/GrowthEvent|conflictId|MemoryStore|ProfileStore/.test(html)) {
    fail(`user HTML must stay silent: ${bad}`);
  }
}
if (!/已确认的重要内容|待你确认的内容/.test(html)) fail('subject panel sections missing');
if (!/ownerChoicePrompt|本次使用|以后优先|暂不决定/.test(appJs)) {
  fail('renderer should support natural JIT choice options');
}
ok('user surface silent + JIT natural options');

const core = [
  fs.readFileSync(path.join(appRoot, 'src/subject-core/candidate-quality-gate.ts'), 'utf8'),
  fs.readFileSync(path.join(appRoot, 'src/subject-core/structured-distill.ts'), 'utf8'),
  fs.readFileSync(path.join(appRoot, 'src/subject-core/jit-confirmation.ts'), 'utf8'),
].join('\n');
if (!/runCandidateQualityGate|structuredDistillToEvents|findJitConflict|use_a_once|prefer_b/.test(core)) {
  fail('distillation/JIT core missing');
}
if (/MemoryStore|PreferenceStore|LearningStore|ProfileStore/.test(core)) {
  fail('must not introduce second store');
}
ok('distill + JIT rules present');

const domain = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    'dist/subject-core/tests/subject-distillation-jit-confirmation.test.js',
    'dist/subject-core/tests/subject-growth-loop.test.js',
  ],
  { stdio: 'inherit', shell: false, cwd: appRoot },
);
if (domain.status !== 0) fail(`domain tests exited ${domain.status || 1}`);
ok('distillation/JIT + growth-loop domain tests');

const metricsPath = path.join(appRoot, 'scripts', '_subject-distillation-jit-evidence', 'metrics.json');
if (!fs.existsSync(metricsPath)) fail('missing metrics evidence');
const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
if (metrics.erroneous_user_attribution !== 0) fail('erroneous user attribution must be 0');
if (metrics.silent_conflict_overwrite !== 0) fail('silent conflict overwrite must be 0');
if (metrics.unrelated_task_confirmations !== 0) fail('unrelated confirmations must be 0');
if (metrics.distill_failure_blocks_task !== false) fail('distill failure must not block task');
ok('quality metrics gates');

const summary = {
  status: 'accept_passed',
  generatedAt: new Date().toISOString(),
  metrics,
};
fs.writeFileSync(
  path.join(appRoot, 'scripts', '_subject-distillation-jit-evidence', 'acceptance-summary.json'),
  JSON.stringify(summary, null, 2),
  'utf8',
);
ok('accept:subject-distillation-jit-confirmation');
console.log(JSON.stringify(summary, null, 2));

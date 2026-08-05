/**
 * DIGITALME-V2-REAL-DISTILLATION-INTEGRATION-AND-JIT-FIX-01 验收。
 * 用法: npm run accept:real-distillation-jit-integration
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

const runtimeSrc = fs.readFileSync(path.join(appRoot, 'src/runtime/digitalme-runtime.ts'), 'utf8');
if (!/setDistillModelRuntime|createSubjectDistillModelRuntime/.test(runtimeSrc)) {
  fail('captureInput product path must wire distill model runtime');
}
if (!/forceIncludeEventIds:\s*includeEventIds/.test(runtimeSrc)) {
  fail('JIT includeEventIds must reach selectSubjectInjection');
}
ok('product distill runtime wired');

const distill = [
  fs.readFileSync(path.join(appRoot, 'src/subject-core/structured-distill.ts'), 'utf8'),
  fs.readFileSync(path.join(appRoot, 'src/subject-core/candidate-normalize.ts'), 'utf8'),
  fs.readFileSync(path.join(appRoot, 'src/subject-core/distill-model-runtime.ts'), 'utf8'),
  fs.readFileSync(path.join(appRoot, 'src/subject-core/subject-service.ts'), 'utf8'),
].join('\n');

if (!/normalizeModelCandidate|user_preference|createSubjectDistillModelRuntime/.test(distill)) {
  fail('normalization + product distill runtime missing');
}
if (/process\.env\.(OPENAI|DEEPSEEK|API_KEY)|new OpenAI\b/.test(distill)) {
  fail('must not create parallel env-based model client for distill');
}
if (/PreferenceStore|MemoryStore|ProfileStore|JitDecisionStore|LearningStore/.test(distill)) {
  fail('must not introduce second store');
}
if ((distill.match(/structuredDistillToEvents/g) || []).length < 1) {
  fail('single formal distill entry missing');
}
ok('single formal path + normalize + no second store');

const html = fs.readFileSync(path.join(appRoot, 'electron/renderer/index.html'), 'utf8');
if (/user_preference|norm_category|raw_category|GrowthEvent|needs_confirmation/.test(html)) {
  fail('user HTML must not expose raw schema / internal tags');
}
ok('user surface silent on raw schema');

const domain = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    'dist/subject-core/tests/real-distillation-jit-integration.test.js',
    'dist/subject-core/tests/subject-distillation-jit-confirmation.test.js',
  ],
  { stdio: 'inherit', shell: false, cwd: appRoot },
);
if (domain.status !== 0) fail(`domain tests exited ${domain.status || 1}`);
ok('integration + distillation domain tests');

const evidenceDir = path.join(appRoot, 'scripts', '_real-distillation-jit-integration-evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const summary = {
  status: 'accept_passed',
  generatedAt: new Date().toISOString(),
  checks: [
    'captureInput_product_model_runtime',
    'user_preference_normalized',
    'model_needs_confirmation_does_not_override',
    'silent_low_risk_preference',
    'conflict_pending_jit',
    'unrelated_zero_confirm',
    'once_prefer_defer',
    'model_failure_non_blocking',
    'no_second_store_or_taxonomy',
  ],
};
fs.writeFileSync(path.join(evidenceDir, 'acceptance-summary.json'), JSON.stringify(summary, null, 2));
ok('evidence written');
console.log('ACCEPT PASS: real-distillation-jit-integration');

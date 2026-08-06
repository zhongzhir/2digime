/**
 * DIGITALME-V2-TASK-INSTRUCTION-AND-REVISION-INTEGRITY-01 验收入口。
 * 用法: npm run accept:task-instruction-revision-integrity
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

const evidenceDir = path.join(appRoot, 'scripts', '_task-instruction-revision-integrity-evidence');
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

const promptSrc = fs.readFileSync(path.join(appRoot, 'src/capability/adapters/prompt-assemble.ts'), 'utf8');
const policySrc = fs.readFileSync(path.join(appRoot, 'src/work-runtime/ai-first-policy.ts'), 'utf8');
const runnerSrc = fs.readFileSync(path.join(appRoot, 'src/work-runtime/job-runner.ts'), 'utf8');
const appJs = fs.readFileSync(path.join(appRoot, 'electron/renderer/app.js'), 'utf8');

if (!/材料不得自动成为最终答案/.test(promptSrc)) fail('prompt must forbid materials as final answer');
if (!/rejectionReason/.test(promptSrc)) fail('prompt must include rejectionReason');
if (!/scoreAgainstGoal|相关度/.test(promptSrc)) fail('materials must be relevance-ranked');
if (!/extractTopicTerms/.test(policySrc) || !/roughSimilarity/.test(policySrc)) {
  fail('outcome check must cover theme + substantial change');
}
if (!/rejectionReason/.test(runnerSrc)) fail('job-runner must persist rejectionReason');
if (!/主题未紧扣|几乎相同|不少于约/.test(runnerSrc)) {
  fail('job-runner must hard-fail on theme/no-change/min-length defects');
}
if (!/rejectionReason/.test(appJs) || !/lastArtifactRejectionReason/.test(appJs)) {
  fail('renderer must pass rejectionReason into reviseArtifact');
}
ok('static contract guards');

const unit = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    'dist/capability/adapters/tests/openai-compatible.test.js',
    'dist/work-runtime/tests/ai-first-execution.test.js',
  ],
  { stdio: 'inherit', cwd: appRoot },
);
if (unit.status !== 0) fail(`unit tests exited ${unit.status}`);
ok('unit tests');

const driver = path.join(__dirname, 'run-task-instruction-revision-integrity-runtime.cjs');
const rt = spawnSync(process.execPath, [driver], {
  stdio: 'inherit',
  cwd: appRoot,
  env: { ...process.env, DIGITALME_TIRI_EVIDENCE: evidenceDir },
});
if (rt.status !== 0) fail(`runtime integrity driver exited ${rt.status}`);
ok('runtime integrity scenarios');

fs.writeFileSync(
  path.join(evidenceDir, 'acceptance-summary.json'),
  `${JSON.stringify({ writtenAt: new Date().toISOString(), verdict: 'passed' }, null, 2)}\n`,
);
console.log('\naccept:task-instruction-revision-integrity PASSED');

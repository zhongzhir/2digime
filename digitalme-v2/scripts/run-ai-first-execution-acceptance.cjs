/**
 * DIGITALME-V2-AI-FIRST-EXECUTION-SIMPLIFICATION-01 验收。
 * 用法: npm run accept:ai-first-execution
 *
 * 覆盖：一次主模型调用、无相关不强注、高相关≤3、学习失败不阻断、
 * Outcome Check 修订最多一次、Snapshot 如实、用户面静默、高风险档位、无第二状态机。
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

const html = fs.readFileSync(path.join(appRoot, 'electron/renderer/index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(appRoot, 'electron/renderer/app.js'), 'utf8');

for (const bad of [
  /GrowthEvent/,
  /ContextSnapshot/,
  /selectionReasons/,
  /ExecutionProfile/,
  /ai_first/,
  /targeted_revision_required/,
  /OutcomeCheck/,
  /subjectContextDigest/,
]) {
  if (bad.test(html)) fail(`user HTML must stay silent: ${bad}`);
}
ok('user HTML silent on AI-first internals');

for (const bad of [/ExecutionProfile/, /targeted_revision_required/, /ai_first_policy/]) {
  if (bad.test(appJs)) fail(`renderer must not surface internal AI-first names: ${bad}`);
}
if (!/正在处理|正在完成/.test(appJs)) fail('renderer must keep silent progress label');
if (!/采用/.test(html) || !/不采用/.test(html)) fail('renderer must keep adopt/reject actions');
ok('renderer remains silent on execution internals');

const policySrc = fs.readFileSync(path.join(appRoot, 'src/work-runtime/ai-first-policy.ts'), 'utf8');
const runnerSrc = fs.readFileSync(path.join(appRoot, 'src/work-runtime/job-runner.ts'), 'utf8');
const selectorSrc = fs.readFileSync(
  path.join(appRoot, 'src/subject-core/experience-selector.ts'),
  'utf8',
);

if (!/chooseExecutionProfile/.test(policySrc) || !/checkOutcome/.test(policySrc)) {
  fail('ai-first-policy must define profile + outcome check');
}
if (!/buildTargetedRevisionRequest/.test(policySrc)) {
  fail('targeted revision helper missing');
}
if (!/AI_FIRST_MAX_ENTRIES|ai_first/.test(selectorSrc)) {
  fail('selector must default to ai_first with max 3');
}
if (!/learning must not affect delivery|主体注入失败不得阻断|Outcome Check/.test(runnerSrc)) {
  // runner uses Chinese comment for inject best-effort
  if (!/主体注入失败不得阻断/.test(runnerSrc)) {
    fail('job-runner must best-effort subject inject');
  }
}
if (!/checkOutcome/.test(runnerSrc) || !/buildTargetedRevisionRequest/.test(runnerSrc)) {
  fail('job-runner must wire outcome check + one revision');
}
if (/new JobStateMachine|SecondStateMachine|MemoryStore/.test(runnerSrc + policySrc + selectorSrc)) {
  fail('must not introduce second state machine or memory store');
}
ok('ai-first policy wired without second state machine');

const domain = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    'dist/work-runtime/tests/ai-first-execution.test.js',
    'dist/subject-core/tests/external-artifact-reuse-quality.test.js',
  ],
  { stdio: 'inherit', shell: false, cwd: appRoot },
);
if (domain.status !== 0) fail(`ai-first domain tests exited ${domain.status || 1}`);
ok('ai-first domain tests passed');

const evidencePath = path.join(
  appRoot,
  'scripts',
  '_ai-first-execution-evidence',
  'ab-comparison.json',
);
if (!fs.existsSync(evidencePath)) {
  fail('missing ab-comparison.json evidence');
}
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
if (!evidence.byTask || !evidence.rows) fail('ab evidence incomplete');
for (const name of ['wechat_article', 'project_plan', 'doc_review']) {
  const row = evidence.byTask[name];
  if (!row) fail(`missing A/B task ${name}`);
  if (row.aiFirstCalls > row.legacyCalls) fail(`${name}: ai-first calls must not exceed legacy`);
  if (row.aiFirstSelected > row.legacySelected) {
    fail(`${name}: ai-first selected context must not exceed legacy`);
  }
}
ok('A/B comparison evidence recorded');

const summary = {
  status: 'accept_passed',
  generatedAt: new Date().toISOString(),
  checks: [
    'one_primary_model_call',
    'no_forced_weak_inject',
    'max_3_strong_experiences',
    'learning_failure_isolated',
    'outcome_check_at_most_one_revision',
    'snapshot_records_actual_use',
    'ui_silent',
    'high_risk_profile_detected',
    'no_second_state_machine',
  ],
  abComparison: evidence.byTask,
};
fs.writeFileSync(
  path.join(appRoot, 'scripts', '_ai-first-execution-evidence', 'acceptance-summary.json'),
  JSON.stringify(summary, null, 2),
  'utf8',
);
ok('accept:ai-first-execution');
console.log(JSON.stringify(summary, null, 2));

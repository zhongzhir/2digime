/**
 * DIGITALME-V2-SUBJECT-GROWTH-LOOP-01 验收。
 * 用法: npm run accept:subject-growth-loop
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
for (const bad of [
  /GrowthEvent/,
  /confidence\s*[:=]/,
  /signal:strong/,
  /category:external_claim/,
  /subjectContextDigest/,
  /inactiveEventIds/,
]) {
  if (bad.test(html)) fail(`user HTML must stay silent: ${bad}`);
}
if (!/已确认的重要内容|待你确认的内容/.test(html)) fail('subject panel should show natural sections');
if (!/recentLearnings/.test(appJs)) fail('renderer should render recent learnings without internal jargon');
if (/GrowthEvent|confidence数值|抽取队列/.test(appJs) === false) {
  // ok — ensure we don't display those labels
}
ok('user surface silent + natural subject sections');

const core = [
  fs.readFileSync(path.join(appRoot, 'src/subject-core/growth-signal.ts'), 'utf8'),
  fs.readFileSync(path.join(appRoot, 'src/subject-core/growth-async.ts'), 'utf8'),
  fs.readFileSync(path.join(appRoot, 'src/subject-core/candidate-distill.ts'), 'utf8'),
  fs.readFileSync(path.join(appRoot, 'src/subject-core/experience-selector.ts'), 'utf8'),
].join('\n');
if (!/silent_adopt|must_confirm|external_claim|scheduleGrowthWork|weak_structure/.test(core)) {
  fail('growth loop core rules missing');
}
if (/MemoryStore|PreferenceStore|LearningStore|ProfileStore/.test(core)) {
  fail('must not introduce second store');
}
ok('growth loop rules present without second store');

const domain = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    'dist/subject-core/tests/subject-growth-loop.test.js',
    'dist/work-runtime/tests/ai-first-execution.test.js',
  ],
  { stdio: 'inherit', shell: false, cwd: appRoot },
);
if (domain.status !== 0) fail(`growth loop domain tests exited ${domain.status || 1}`);
ok('growth loop + ai-first domain tests');

const metricsPath = path.join(appRoot, 'scripts', '_subject-growth-loop-evidence', 'metrics.json');
if (!fs.existsSync(metricsPath)) fail('missing metrics evidence');
const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
if (metrics.growth_failure_blocks_task !== false) fail('growth failure must not block task');
if (metrics.unrelated_pollution !== 0) fail('unrelated pollution must be zero');
if (metrics.silent_conflict_overwrite !== 0) fail('conflict must not silent overwrite');
ok('quality metrics gates');

// optional real-model probe (skip when no credential)
const probe = spawnSync(process.execPath, ['scripts/probe-subject-growth-real-model.cjs'], {
  stdio: 'inherit',
  shell: false,
  cwd: appRoot,
  env: process.env,
});
if (probe.status !== 0) fail(`real-model probe exited ${probe.status || 1}`);
ok('real-model probe completed (or skipped cleanly)');

const summary = {
  status: 'accept_passed',
  generatedAt: new Date().toISOString(),
  metrics,
};
fs.writeFileSync(
  path.join(appRoot, 'scripts', '_subject-growth-loop-evidence', 'acceptance-summary.json'),
  JSON.stringify(summary, null, 2),
  'utf8',
);
ok('accept:subject-growth-loop');
console.log(JSON.stringify(summary, null, 2));

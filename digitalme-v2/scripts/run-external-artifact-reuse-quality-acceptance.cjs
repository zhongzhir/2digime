/**
 * DIGITALME-V2-EXTERNAL-ARTIFACT-REUSE-AND-QUALITY-01 验收。
 * 用法: npm run accept:external-artifact-reuse-quality
 *
 * 覆盖：采用成长、拒绝不复用、相关/弱相关/无关、版本、A/B、静默 UI、无第二 Store。
 * 证据仅写 scripts/_external-artifact-reuse-quality-evidence/，不进用户面。
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
const ui = `${html}\n${appJs}`;

for (const bad of [
  /GrowthEvent/,
  /ContextSnapshot/,
  /selectionReasons/,
  /quality_signal_observed/,
  /causal_attribution/,
  /inactiveEventIds/,
  /subjectContextDigest/,
  /reuse:weak_structure/,
  /capabilityVersion:/,
]) {
  if (bad.test(html)) fail(`user HTML must stay silent: ${bad}`);
}
ok('user HTML silent on growth/reuse internals');

if (!/artifact_acceptance/.test(appJs) || !/artifact_rejection/.test(appJs)) {
  fail('renderer must keep accept/reject capture path');
}
if (!/sourceCapabilityKind:\s*"external_capability"/.test(appJs)) {
  fail('external accept path must record sourceCapabilityKind for evidence (API only)');
}
ok('accept/reject wiring present');

// 无第二 Store / 第二事实源
const growthSrc = fs.readFileSync(path.join(appRoot, 'src/subject-core/growth-event.ts'), 'utf8');
const selectorSrc = fs.readFileSync(
  path.join(appRoot, 'src/subject-core/experience-selector.ts'),
  'utf8',
);
if (/ExternalKnowledgeStore|external-knowledge-store|ClaimsStore/.test(`${growthSrc}\n${selectorSrc}`)) {
  fail('must not introduce external knowledge / claims store');
}
if (!/resolvePositiveExperiences/.test(selectorSrc) || !/weak_structure_only/.test(selectorSrc)) {
  fail('selector must enforce latest-accept-only and weak structure boundary');
}
ok('reuse boundaries present without second store');

const domain = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    'dist/subject-core/tests/external-artifact-reuse-quality.test.js',
    'dist/subject-core/tests/artifact-decision.test.js',
  ],
  { stdio: 'inherit', shell: false, cwd: appRoot },
);
if (domain.status !== 0) fail(`domain reuse/quality tests exited ${domain.status || 1}`);
ok('domain reuse/quality tests passed');

const evidencePath = path.join(
  appRoot,
  'scripts',
  '_external-artifact-reuse-quality-evidence',
  'stages.json',
);
if (!fs.existsSync(evidencePath)) {
  fail('missing stages.json evidence from domain test');
}
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const stageNames = (evidence.stages || []).map((s) => s.stage);
for (const need of [
  'baseline_without_accept',
  'owner_accept_growth',
  'related_reuse',
  'ab_quality_contrast',
  'weak_related_boundary',
  'unrelated_zero_pollution',
  'reject_not_positive_reuse',
  'version_latest_only',
  'accept_then_reject_same_version',
]) {
  if (!stageNames.includes(need)) fail(`evidence missing stage: ${need}`);
}
const ab = (evidence.stages || []).find((s) => s.stage === 'ab_quality_contrast');
if (!ab || !ab.qualityImproved) fail('A/B must observe quality signal after accept reuse');
if (!evidence.attribution || !/quality_signal_observed/.test(String(evidence.attribution.conclusion))) {
  fail('attribution conclusion missing');
}
ok('evidence stages + A/B attribution recorded (debug only)');

const design = path.join(
  appRoot,
  'docs',
  'design',
  'digitalme_v2_external_artifact_reuse_and_quality_v0.1_202608.md',
);
if (!fs.existsSync(design)) fail('design doc missing');
const designText = fs.readFileSync(design, 'utf8');
for (const needle of [
  '质量假设',
  '复用边界',
  '归因',
  'A/B',
  '污染',
  '版本',
  '通用质量评估',
]) {
  if (!designText.includes(needle)) fail(`design doc missing section keyword: ${needle}`);
}
ok('design doc present');

console.log('');
console.log('PASS: accept:external-artifact-reuse-quality');

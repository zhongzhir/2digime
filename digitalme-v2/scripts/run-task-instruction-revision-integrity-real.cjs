/**
 * 真实 DeepSeek：多材料首轮 + 拒绝修订 + 不可满足。
 * 用法: node scripts/run-task-instruction-revision-integrity-real.cjs
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const evidenceDir = path.join(ROOT, 'scripts', '_task-instruction-revision-integrity-evidence', 'real');
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

const electronCli = path.join(ROOT, 'node_modules', 'electron', 'cli.js');
const load = spawnSync(process.execPath, [electronCli, 'scripts/load-app-model-credential.cjs'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (load.status !== 0) fail(`load credential exited ${load.status}`);

const cred = path.join(ROOT, 'scripts', '_mvp-p14-real-capability-evidence', '.runtime-model-credential.json');
if (!fs.existsSync(cred)) fail('credential missing');
const meta = JSON.parse(fs.readFileSync(cred, 'utf8'));
const host = new URL(meta.baseUrl).host;
if (!/deepseek/i.test(host)) fail(`expected deepseek, got ${host}`);
ok(`credential host=${host} model=${meta.model} keyChars=${String(meta.apiKey || '').length}`);

process.env.DIGITALME_V2_CREDENTIAL_IMPORT = cred;

/** @type {object[]} */
const modelCalls = [];
const origRequire = Module.prototype.require;
Module.prototype.require = function patched(request) {
  const exported = origRequire.apply(this, arguments);
  const norm = String(request || '').replace(/\\/g, '/');
  if (
    exported &&
    typeof exported.chatComplete === 'function' &&
    exported.ModelHttpError &&
    !exported.__tiriPatched &&
    norm.includes('model-http')
  ) {
    const orig = exported.chatComplete;
    exported.chatComplete = async function wrapped(opts) {
      const messages = Array.isArray(opts.messages) ? opts.messages : [];
      const joined = messages.map((m) => String(m.content || '')).join('\n');
      try {
        const result = await orig.apply(this, arguments);
        modelCalls.push({
          at: new Date().toISOString(),
          host: (() => {
            try {
              return new URL(String(opts.baseUrl || '')).host;
            } catch {
              return '';
            }
          })(),
          chars: String(result.text || '').length,
          hasGoalAivestor: /Aivestor/.test(joined),
          hasRejection: /不采用理由|主题错误/.test(joined),
          hasRevision: /修改要求|重新撰写/.test(joined),
          hasMaterialContract: /不得整篇|事实与素材/.test(joined),
          hasWaicMaterial: /WAIC/.test(joined),
          hasAivestorMaterial: /Aivestor/.test(joined),
          preview: String(result.text || '').slice(0, 160),
        });
        return result;
      } catch (err) {
        modelCalls.push({
          error: String((err && err.message) || err).slice(0, 200),
        });
        throw err;
      }
    };
    exported.__tiriPatched = true;
  }
  return exported;
};

async function main() {
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { waitForJobTerminal } = require('../dist/work-runtime/job-runner');
  const { createEnvSecretAccessor, resolveModelEnvAsync } = require('../dist/infrastructure/env-secrets');

  const modelEnv = await resolveModelEnvAsync(ROOT, process.env);
  if (!modelEnv.runtime) throw new Error('no model credential for real run');
  const credRuntime = modelEnv.runtime;
  const secrets = createEnvSecretAccessor(process.env, credRuntime.providerId, credRuntime);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmv2-tiri-real-'));
  const matDir = path.join(root, 'materials');
  fs.mkdirSync(matDir, { recursive: true });
  fs.writeFileSync(
    path.join(matDir, 'aivestor-brief.md'),
    [
      '# Aivestor 素材',
      '产品定位：面向个人投资者的智能投研助手。',
      '目标用户：希望提升决策质量的知识工作者与投资者。',
      '核心能力：组合分析、风险提示、材料摘要。',
      '应用价值：把分散信息变成可执行的研究判断。',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(matDir, 'waic-broker-skill.md'),
    [
      '# WAIC 券商 Skill 完整介绍',
      `${'本文详细介绍 WAIC 展会中的券商 Skill 方案，与 Aivestor 无关。'.repeat(60)}`,
    ].join('\n'),
    'utf8',
  );

  const runtime = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    registerOpenAiStub: false,
    openaiCompatible: {
      providerId: credRuntime.providerId,
      baseUrl: credRuntime.baseUrl,
      model: credRuntime.model,
      temperature: 0.3,
      maxTokens: 4096,
      timeoutMs: 300_000,
    },
    secrets,
  });
  await runtime.createPackage({
    displayName: 'TIRI-Real',
    targetDir: path.join(root, 'pkg'),
    initialSelfDescription: '真实多材料任务指令验收',
  });

  const goal =
    '写一篇关于 Aivestor 项目的介绍文章，不少于1500字。请综合材料中与 Aivestor 相关的产品定位、目标用户、核心能力和应用价值；不要写成 WAIC 或券商 Skill 文章。';
  const submitted = await runtime.submitTask({
    goal,
    contextRefs: [{ kind: 'folder', path: matDir }],
    requestedArtifactType: 'document',
  });
  const job1 = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 300000);
  if (job1.status !== 'succeeded') {
    fail(`first job ${job1.status}: ${JSON.stringify(job1.failure || {})}`);
  }
  const c1 = await runtime.getContent({ artifactId: job1.artifactId });
  const t1 = String(c1.text || '');
  const chars1 = t1.replace(/\s+/g, '').length;
  if (!/Aivestor/i.test(t1)) fail('first artifact missing Aivestor theme');
  if (chars1 < 1200) fail(`first artifact too short: ${chars1}`);
  // 允许提到 WAIC 作为对比，但不得近似整篇复制无关文
  const waicHeavy = (t1.match(/WAIC/g) || []).length >= 8 && !/Aivestor/i.test(t1.slice(0, 200));
  if (waicHeavy) fail('first artifact looks like WAIC copy');
  if (!modelCalls.some((c) => c.hasGoalAivestor)) fail('model request missing goal');
  ok(`scenario A first ok chars=${chars1} calls=${modelCalls.length}`);

  const rejectReason = '文章主题错误，未围绕 Aivestor，也没有综合文件夹材料。';
  const reviseReq =
    '重新撰写一篇不少于1500字的 Aivestor 项目介绍，综合材料中的产品定位、目标用户、核心能力和应用价值。';
  const callsBefore = modelCalls.length;
  const revised = await runtime.reviseArtifact({
    taskId: submitted.taskId,
    artifactId: job1.artifactId,
    revisionRequest: reviseReq,
    rejectionReason: rejectReason,
  });
  const job2 = await waitForJobTerminal(runtime.workRuntime, revised.jobId, 300000);
  if (job2.status !== 'succeeded') {
    fail(`revise job ${job2.status}: ${JSON.stringify(job2.failure || {})}`);
  }
  if (modelCalls.length <= callsBefore) fail('revise did not call model');
  const reviseCall = modelCalls.slice(callsBefore).find((c) => c.hasRevision || c.hasRejection);
  if (!reviseCall || !reviseCall.hasRejection) fail('revise call missing rejection reason');
  if (!reviseCall.hasRevision) fail('revise call missing revision instruction');
  const art = await runtime.getArtifact(job1.artifactId);
  if ((art?.versions?.length || 0) < 2) fail('version 2 not created');
  const c2 = await runtime.getContent({ artifactId: job1.artifactId });
  const t2 = String(c2.text || '');
  if (!/Aivestor/i.test(t2)) fail('v2 missing Aivestor');
  if (t2.replace(/\s+/g, '').length < 1200) fail('v2 too short');
  if (t2 === t1) fail('v2 identical to v1');
  ok(`scenario B revise ok versions=${art.versions.length}`);

  // 场景 C：不可满足事实
  const mat2 = path.join(root, 'materials-gap');
  fs.mkdirSync(mat2, { recursive: true });
  fs.writeFileSync(path.join(mat2, 'only-aivestor.md'), 'Aivestor 仅有公开定位说明，无融资数据。\n', 'utf8');
  const gapGoal =
    '写一篇关于 Aivestor 的介绍，必须包含 UnobtainiumFundingRoundZ 这一材料中不存在的融资轮次事实。若材料不足请明确说明，不要编造。';
  const gapSub = await runtime.submitTask({
    goal: gapGoal,
    contextRefs: [{ kind: 'folder', path: mat2 }],
    requestedArtifactType: 'document',
  });
  const gapJob = await waitForJobTerminal(runtime.workRuntime, gapSub.jobId, 300000);
  // 允许 succeeded 但正文声明不足，或 failed（主题/必含未满足）
  if (gapJob.status === 'succeeded') {
    const gapText = String((await runtime.getContent({ artifactId: gapJob.artifactId })).text || '');
    const honest =
      /材料不足|未提供|没有.*融资|无法核实|未在材料/.test(gapText) &&
      !/UnobtainiumFundingRoundZ[^。]{0,40}完成/.test(gapText);
    if (!honest) fail('gap scenario invented missing fact without stating insufficiency');
    ok('scenario C honest insufficiency in text');
  } else {
    ok(`scenario C failed closed: ${gapJob.failure && gapJob.failure.message}`);
  }

  await runtime.stop();
  const summary = {
    writtenAt: new Date().toISOString(),
    verdict: 'passed',
    host,
    model: meta.model,
    modelCallCount: modelCalls.length,
    calls: modelCalls.map((c) => ({
      host: c.host,
      chars: c.chars,
      hasGoalAivestor: c.hasGoalAivestor,
      hasRejection: c.hasRejection,
      hasRevision: c.hasRevision,
      hasMaterialContract: c.hasMaterialContract,
      preview: c.preview,
      error: c.error,
    })),
  };
  fs.writeFileSync(path.join(evidenceDir, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log('\nREAL task-instruction-revision-integrity PASSED');
}

main().catch((err) => {
  fs.writeFileSync(
    path.join(evidenceDir, 'report.json'),
    `${JSON.stringify({ verdict: 'failed', error: String(err && err.message ? err.message : err) }, null, 2)}\n`,
  );
  console.error(err);
  process.exit(1);
});

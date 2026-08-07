/**
 * DIGITALME-V2-COLLABORATION-REAL-LOOP-01-REAL-FULFILLMENT-CLOSE
 * 强制真实模型：A propose → B accept → B fulfill → A revise → A adopt。
 * 无凭证 / 落到 fake 一律失败；不得 --force-fake。
 *
 * 用法: npm run accept:collaboration-real-loop-real
 */
'use strict';

const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
process.chdir(root);

const evidenceDir = path.join(root, 'scripts', '_collaboration-real-loop-01-evidence');
const acceptanceRoot = path.join(os.homedir(), 'AppData', 'Local', 'DigitalMe-OwnerAcceptance');
function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

function writeJson(name, data) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function digest(text) {
  return createHash('sha256').update(String(text || ''), 'utf8').digest('hex').slice(0, 16);
}

function safeModelName(cred) {
  const provider = String(cred.providerId || cred.provider || 'openai-compatible').slice(0, 64);
  const model = String(cred.model || 'unknown').slice(0, 64);
  return { provider, model };
}

async function loadAppCredentialViaElectron() {
  if (process.env.DIGITALME_SKIP_APP_MODEL === '1') return;
  const script = path.join(root, 'scripts', 'load-app-model-credential.cjs');
  const appDir = path.resolve(root, '..', 'digitalme-app');
  try {
    fs.accessSync(script);
  } catch {
    return;
  }
  let command;
  let args;
  let cwd = root;
  try {
    const electronPath = require('electron');
    if (typeof electronPath !== 'string') throw new Error('bad electron');
    command = electronPath;
    args = [script];
  } catch {
    try {
      const electronCli = path.join(appDir, 'node_modules', 'electron', 'cli.js');
      fs.accessSync(electronCli);
      command = process.execPath;
      args = [electronCli, script];
      cwd = appDir;
    } catch {
      return;
    }
  }
  await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve();
    }, 20_000);
  });
}

async function requireRealModel() {
  await loadAppCredentialViaElectron();
  spawnSync(process.execPath, [path.join('scripts', 'load-app-model-credential.cjs')], {
    cwd: root,
    stdio: 'pipe',
    shell: false,
  });
  const { resolveModelEnvAsync, createEnvSecretAccessor } = require('../dist/infrastructure/env-secrets');
  const modelEnv = await resolveModelEnvAsync(root, process.env);
  if (!modelEnv.runtime || !modelEnv.runtime.apiKey) {
    fail('真实模型凭证不可用；禁止回退 fake');
  }
  if (!modelEnv.runtime.baseUrl || !modelEnv.runtime.model) {
    fail('真实模型 baseUrl/model 缺失；禁止回退 fake');
  }
  return {
    cred: modelEnv.runtime,
    secrets: createEnvSecretAccessor(process.env, modelEnv.runtime.providerId, modelEnv.runtime),
  };
}

function createRealRuntime(real) {
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  return createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      baseUrl: real.cred.baseUrl,
      model: real.cred.model,
      ...(real.cred.providerId ? { providerId: real.cred.providerId } : {}),
      ...(real.cred.apiKey ? { apiKey: real.cred.apiKey } : {}),
      displayName: '真实对话模型',
      timeoutMs: 240_000,
    },
    secrets: real.secrets,
    codeAnalysisCapability: 'needs_setup',
    registerOpenAiStub: false,
  });
}

function looksFakeOrHook(text) {
  const t = String(text || '');
  return (
    /fake-owner-path|FAKE_DOCUMENT|hook.?deliver|测试脚本直接写|fixed.?fake.?text/i.test(t) ||
    t.trim() === '材料X：仅授权可见的要点。'
  );
}

function relevantToRiskBrief(text) {
  const t = String(text || '');
  const riskSignals = (t.match(/风险|体验|用户|验证|优先/g) || []).length;
  return t.length >= 120 && riskSignals >= 3;
}

async function main() {
  if (process.argv.includes('--force-fake')) {
    fail('本任务禁止 --force-fake');
  }

  const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  if (build.status !== 0) fail('build failed');

  const real = await requireRealModel();
  const modelSafe = safeModelName(real.cred);
  ok(`real model loaded provider=${modelSafe.provider} model=${modelSafe.model}`);

  const { createCommandBus } = require('../dist/runtime/command-bus');
  const { CollaborationRecordStore } = require('../dist/collaboration/record-store');
  const { GrantStore } = require('../dist/collaboration/grant-store');
  const { OPENAI_COMPATIBLE_CAPABILITY_ID: CAP_ID } = require('../dist/capability/adapters/openai-compatible');
  const REAL_CAP = CAP_ID || 'cap_model_openai_compatible';

  const stamp = Date.now();
  const sessionRoot = path.join(acceptanceRoot, `collaboration-real-fulfillment-${stamp}`);
  const userDataA = path.join(sessionRoot, 'subject-a');
  const userDataB = path.join(sessionRoot, 'subject-b');
  const pkgA = path.join(userDataA, 'subjects', 'default');
  const pkgB = path.join(userDataB, 'subjects', 'default');
  const materialsDir = path.join(sessionRoot, 'materials');
  fs.mkdirSync(materialsDir, { recursive: true });
  const materialPath = path.join(materialsDir, 'digital-me-project-notes.md');
  fs.writeFileSync(
    materialPath,
    [
      '# Digital Me 项目材料（真实履约）',
      '',
      '产品主张：本地优先的个人数字主体，能代表我做事，也能与其他数字之我协作。',
      '协作只处理需要双方判断与约定的关系；固定接口与已注册专业能力不属于协作。',
      '用户界面应使用自然语言，说明谁在找我、要做什么、我现在该决定什么。',
      '当前优先验证方向：真实用户体验、主体独立性、少确认负担、重启后事实仍在、协作不像工具调用。',
      '已知痛点：用户看不懂内部对象名；确认步骤过多；履约若只用假文本无法证明真实价值。',
    ].join('\n'),
    'utf8',
  );

  const judgment = {
    schemaVersion: 'collaboration-real-fulfillment-close/1',
    task: 'DIGITALME-V2-COLLABORATION-REAL-LOOP-01-REAL-FULFILLMENT-CLOSE',
    startedAt: new Date().toISOString(),
    sessionRoot,
    packageA: pkgA,
    packageB: pkgB,
    documentMode: 'openai-compatible',
    model: modelSafe,
    fakeUsed: false,
    fulfill: {},
    revision: {},
    blockers: [],
    verdict: 'pending',
  };

  let runtimeA = createRealRuntime(real);
  let busA = createCommandBus(runtimeA);
  await runtimeA.createPackage({
    displayName: '我的 Digital Me',
    targetDir: pkgA,
    initialSelfDescription: '我发起协作并验收真实成果。',
  });
  if (runtimeA.documentCapabilityMode !== 'openai-compatible') {
    fail(`A documentCapabilityMode=${runtimeA.documentCapabilityMode}`);
  }

  let runtimeB = createRealRuntime(real);
  await runtimeB.createPackage({
    displayName: '另一个 Digital Me',
    targetDir: pkgB,
    initialSelfDescription: '我接受后用正式工作运行时完成分析。',
  });
  if (runtimeB.documentCapabilityMode !== 'openai-compatible') {
    fail(`B documentCapabilityMode=${runtimeB.documentCapabilityMode}`);
  }
  await runtimeB.stop();

  const proposed = await busA.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: pkgB,
    intent:
      '请根据提供的 Digital Me 项目材料，整理三个当前最值得优先验证的产品风险，并说明理由。重点考虑普通用户真实使用体验。',
    expectedOutcome: '三个产品风险与理由（面向普通用户体验）',
    allowedMaterialPaths: [materialPath],
    acceptanceCriteria: ['三个风险', '每条理由', '关注真实使用体验'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
    skipAutoEvaluate: true,
  });
  if (proposed.status !== 'proposed' || proposed.grantId) {
    fail(`propose must stay pending without grant; got ${proposed.status} grant=${proposed.grantId}`);
  }
  ok(`proposed ${proposed.recordId}`);

  runtimeB = createRealRuntime(real);
  let busB = createCommandBus(runtimeB);
  await runtimeB.openPackage({ dir: pkgB });
  const accepted = await busB.invoke('collab.interact', {
    action: 'respond',
    recordId: proposed.recordId,
    decision: 'accept',
    note: '接受本次产品风险整理',
  });
  if (!accepted.grantId || !['authorized', 'agreed'].includes(String(accepted.status))) {
    fail(`accept failed: ${JSON.stringify(accepted)}`);
  }
  ok(`accepted grant=${accepted.grantId}`);

  const tasksBefore = await runtimeB.listTasks({ limit: 20 });
  const fulfilled = await busB.invoke('collab.interact', {
    action: 'fulfill',
    recordId: proposed.recordId,
  });
  if (fulfilled.status !== 'delivered') {
    fail(`fulfill status=${fulfilled.status} reason=${fulfilled.reason || ''}`);
  }
  if (!fulfilled.jobId || !fulfilled.localArtifactId || !fulfilled.artifactId) {
    fail('fulfill missing jobId/localArtifactId/source artifactId');
  }
  const capId = String(fulfilled.capabilityId || '');
  if (/fake/i.test(capId)) {
    fail(`capability is fake: ${capId}`);
  }
  if (fulfilled.reachedModel !== true && capId !== REAL_CAP) {
    fail(`did not reach real model; capabilityId=${capId || 'none'} reachedModel=${fulfilled.reachedModel}`);
  }
  if (capId && capId !== REAL_CAP) {
    fail(`unexpected capabilityId=${capId}; expected ${REAL_CAP}`);
  }

  const tasksAfter = await runtimeB.listTasks({ limit: 20 });
  if ((tasksAfter.tasks || []).length <= (tasksBefore.tasks || []).length) {
    fail('B WorkRuntime did not gain a Task');
  }
  const bTask = (tasksAfter.tasks || []).find((t) => {
    return true;
  });
  const bDetail = await runtimeB.getTask({ taskId: tasksAfter.tasks[tasksAfter.tasks.length - 1].taskId });
  if (!bDetail?.latestJob?.jobId) fail('B task missing job');
  if (bDetail.latestJob.capabilityId && /fake/i.test(String(bDetail.latestJob.capabilityId))) {
    fail(`B job capability fake: ${bDetail.latestJob.capabilityId}`);
  }

  const text1 = String(fulfilled.artifactText || '');
  if (looksFakeOrHook(text1)) fail('artifact looks like fake/hook text');
  if (!relevantToRiskBrief(text1)) fail('artifact not relevant to product-risk brief');

  const artA = await runtimeA.getContent({ artifactId: fulfilled.localArtifactId });
  if (!artA?.artifact?.provenance || artA.artifact.provenance.kind !== 'collaboration_delivery') {
    fail('A artifact provenance missing collaboration_delivery');
  }
  if (artA.artifact.provenance.recordId !== proposed.recordId) {
    fail('provenance recordId mismatch');
  }

  judgment.fulfill = {
    recordId: proposed.recordId,
    grantId: accepted.grantId,
    jobId: fulfilled.jobId,
    bTaskId: bDetail.task.id,
    bCapabilityId: bDetail.latestJob.capabilityId || fulfilled.capabilityId || null,
    reachedModel: fulfilled.reachedModel === true,
    sourceArtifactId: fulfilled.artifactId,
    localArtifactId: fulfilled.localArtifactId,
    textDigest: digest(text1),
    textChars: text1.length,
    textExcerpt: text1.slice(0, 400),
    provenanceKind: artA.artifact.provenance.kind,
    passed: true,
  };
  ok('real fulfill delivered');

  const revised = await busA.invoke('collab.interact', {
    action: 'requestRevision',
    recordId: proposed.recordId,
    note: '风险描述仍偏技术，请改成普通用户能够直接理解的问题，并说明每个风险最简单的验证方法。',
  });
  if (revised.status === 'failed' || !revised.localArtifactId) {
    fail(`revision failed: ${JSON.stringify({ status: revised.status, localArtifactId: revised.localArtifactId })}`);
  }
  const afterRev = await runtimeA.getContent({ artifactId: revised.localArtifactId });
  const text2 = String(afterRev.text || '');
  if (looksFakeOrHook(text2)) fail('revision artifact looks fake');
  if (text2.length < 80) fail('revision text too short');
  if (digest(text2) === digest(text1)) fail('revision text did not change substantially');
  if (afterRev.artifact.versions.length < 2) fail('revision did not append version');
  if (!/验证|用户|体验|风险/.test(text2)) fail('revision not oriented to user-facing verification');

  const decided = await busA.invoke('collab.interact', {
    action: 'decideResult',
    recordId: proposed.recordId,
    decision: 'accept',
    note: '真实修订后可采用',
  });
  if (decided.status !== 'completed') fail(`decide status=${decided.status}`);

  const rec = await (await CollaborationRecordStore.open(pkgA)).get(proposed.recordId);
  if (!rec.events.some((e) => e.kind === 'revision_requested')) fail('missing revision_requested event');

  judgment.revision = {
    sameRecordId: proposed.recordId,
    localArtifactId: revised.localArtifactId,
    versions: afterRev.artifact.versions.length,
    textDigest: digest(text2),
    textChars: text2.length,
    textExcerpt: text2.slice(0, 400),
    changedFromFirst: digest(text2) !== digest(text1),
    decideStatus: decided.status,
    passed: true,
  };
  ok('real revision + adopt');

  judgment.fakeUsed = false;
  judgment.verdict = 'real_fulfillment_passed';
  judgment.finishedAt = new Date().toISOString();
  judgment.ownerSessionForRegression = sessionRoot;

  writeJson('real-fulfillment-judgment.json', judgment);
  writeJson('real-fulfillment-launch.json', {
    sessionRoot,
    packageA: pkgA,
    packageB: pkgB,
    materialPath,
    documentMode: 'openai-compatible',
    model: modelSafe,
    resumeOwner: `npm run accept:collaboration-real-loop-owner -- --resume-session "${sessionRoot}"`,
  });

  await runtimeB.stop();
  await runtimeA.stop();

  console.log(
    JSON.stringify(
      {
        verdict: judgment.verdict,
        sessionRoot,
        model: modelSafe,
        fakeUsed: false,
        fulfillJobId: judgment.fulfill.jobId,
        revisionChanged: judgment.revision.changedFromFirst,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

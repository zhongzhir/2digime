/**
 * Collaboration MVP — 真实模型单样本验收（非 Fake）。
 * 无凭证时直接失败，不得跳过为成功。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import {
  createEnvSecretAccessor,
  resolveModelEnvAsync,
  type RuntimeModelCredential,
} from '../../infrastructure/env-secrets';
import { OPENAI_COMPATIBLE_CAPABILITY_ID } from '../../capability/adapters/openai-compatible';
import { GrantStore } from '../grant-store';

let runtimeCred: RuntimeModelCredential | null = null;
let modelEnv: {
  configured: boolean;
  baseUrl: string;
  model: string;
  providerId: string;
} = {
  configured: false,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-v4-flash',
  providerId: 'openai-compatible',
};

async function loadAppCredentialViaElectron(): Promise<void> {
  if (process.env.DIGITALME_SKIP_APP_MODEL === '1') return;
  const existing = await resolveModelEnvAsync(process.cwd(), process.env);
  if (existing.runtime) return;

  const script = path.join(process.cwd(), 'scripts', 'load-app-model-credential.cjs');
  const appDir = path.resolve(process.cwd(), '..', 'digitalme-app');
  try {
    await fs.access(script);
    await fs.access(path.join(appDir, 'package.json'));
  } catch {
    return;
  }

  let command: string;
  let args: string[];
  let cwd = process.cwd();
  try {
    const electronPath = require('electron') as string;
    if (typeof electronPath !== 'string') throw new Error('bad electron path');
    command = electronPath;
    args = [script];
  } catch {
    const electronCli = path.join(appDir, 'node_modules', 'electron', 'cli.js');
    try {
      await fs.access(electronCli);
      command = process.execPath;
      args = [electronCli, script];
      cwd = appDir;
    } catch {
      return;
    }
  }

  await new Promise<void>((resolve) => {
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

test('bootstrap: resolve real model credential for collaboration', async () => {
  await loadAppCredentialViaElectron();
  const resolved = await resolveModelEnvAsync(process.cwd(), process.env);
  runtimeCred = resolved.runtime;
  modelEnv = {
    configured: resolved.configured,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    providerId: resolved.providerId,
  };
  assert.equal(
    modelEnv.configured,
    true,
    'collaboration-real requires configured model credential before sample',
  );
});

test('real model dual-subject collaboration sample', async () => {
  if (!modelEnv.configured) {
    assert.fail(
      'collaboration-real requires model credential; refusing Fake/template success',
    );
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-collab-real-'));
  const dirA = path.join(root, 'subject-a');
  const dirB = path.join(root, 'subject-b');
  const materials = path.join(root, 'materials');
  await fs.mkdir(materials, { recursive: true });

  const uniqueX = `青竹枢纽-${Date.now().toString(36)}`;
  const uniqueXToken = uniqueX.replace(/^青竹枢纽-/, '');
  const uniqueXPattern = new RegExp(`青竹枢纽[-－—（(]?${uniqueXToken}[）)]?`);
  const uniqueY = `禁区密文-${Date.now().toString(36)}`;
  const matX = path.join(materials, 'authorized-x.md');
  const matY = path.join(materials, 'secret-y.md');
  await fs.writeFile(
    matX,
    [
      `# 授权材料 X`,
      ``,
      `项目代号：${uniqueX}`,
      `本周完成：本地主体包迁移、授权边界与成果回流。`,
      `核心主张：数字之我应以本地主体为权威，能力跟随任务，协作必须最小授权。`,
      `对外表述要求：结论先行，少套话，保留可核对事实。`,
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    matY,
    [
      `# 未授权材料 Y`,
      ``,
      `绝密代号：${uniqueY}`,
      `内容：未公开融资轮次与内部估值，不得出现在任何协作输出中。`,
    ].join('\n'),
    'utf8',
  );

  // 主任务骨架用 Fake 落盘（不计真实样本）；仅 B 协作执行打真实模型，满足单样本。
  const seedA = createDigitalMeRuntime({ documentCapability: 'fake' });
  await seedA.createPackage({
    displayName: '真实协作甲',
    targetDir: dirA,
    initialSelfDescription: '我负责主报告。',
  });
  const main = await seedA.submitTask({
    goal: '撰写一份本地优先数字主体的主报告骨架。',
    contextRefs: [
      { kind: 'file', path: matX },
      { kind: 'file', path: matY },
    ],
    requestedArtifactType: 'document',
  });
  const mainJob = await waitForJobTerminal(seedA.workRuntime, main.jobId, 60_000);
  assert.equal(mainJob.status, 'succeeded', mainJob.progress?.note || 'main seed failed');
  const mainArtifactId = mainJob.artifactId as string;
  await seedA.stop();

  const seedB = createDigitalMeRuntime({ documentCapability: 'fake' });
  await seedB.createPackage({
    displayName: '真实协作乙',
    targetDir: dirB,
    initialSelfDescription: '我协助整理摘要。',
  });
  await seedB.stop();

  const openaiOpts = {
    documentCapability: 'openai-compatible' as const,
    openaiCompatible: {
      baseUrl: modelEnv.baseUrl,
      model: modelEnv.model,
      providerId: modelEnv.providerId,
      displayName: '真实对话模型',
      timeoutMs: 180_000,
    },
    secrets: createEnvSecretAccessor(process.env, modelEnv.providerId, runtimeCred),
    registerOpenAiStub: false,
  };
  const runtimeA = createDigitalMeRuntime(openaiOpts);
  const busA = createCommandBus(runtimeA);
  await runtimeA.openPackage({ dir: dirA });

  const issued = await busA.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    issuerTaskId: main.taskId,
    intent:
      '根据授权材料 X，整理一段 300–500 字的核心观点摘要，供主报告使用。必须提到项目代号，不得使用未授权材料。',
    allowedMaterialPaths: [matX],
    acceptanceCriteria: ['提供可核对的完整成果，并说明依据', '提到项目代号'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.ok(issued.recordId);
  assert.ok(issued.grantId);

  const denyY = await busA.invoke('collab.interact', {
    action: 'assertMaterialAccess',
    recordId: issued.recordId,
    attemptMaterialPath: matY,
  });
  assert.equal(denyY.allowed, false);

  const executed = await busA.invoke('collab.interact', {
    action: 'fulfill',
    recordId: issued.recordId,
  });
  assert.notEqual(executed.status, 'failed', executed.reason || 'fulfill failed');
  assert.equal(executed.reachedModel, true);
  assert.equal(executed.capabilityId, OPENAI_COMPATIBLE_CAPABILITY_ID);
  assert.ok((executed.artifactText || '').length >= 120);
  assert.match(executed.artifactText || '', uniqueXPattern);
  assert.doesNotMatch(executed.artifactText || '', new RegExp(uniqueY));
  assert.doesNotMatch(executed.artifactText || '', /FAKE_DOCUMENT|\[stub\]|lorem ipsum/i);
  assert.ok(executed.localArtifactId);

  const store = await GrantStore.open(dirA);
  const grant = await store.get(issued.grantId!);
  assert.equal(grant?.origin.kind, 'collaboration_agreement');
  const localArt = await runtimeA.getContent({ artifactId: executed.localArtifactId! });
  assert.ok(localArt.artifact.provenance);
  assert.equal(localArt.artifact.provenance?.sourceArtifactId, executed.artifactId);

  const runtimeB = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      baseUrl: modelEnv.baseUrl,
      model: modelEnv.model,
      providerId: modelEnv.providerId,
      timeoutMs: 120_000,
    },
    secrets: createEnvSecretAccessor(process.env, modelEnv.providerId, runtimeCred),
    registerOpenAiStub: false,
  });
  await runtimeB.openPackage({ dir: dirB });
  const bTaskList = await runtimeB.listTasks({ limit: 10 });
  assert.ok(bTaskList.tasks.length >= 1);
  const bTask = await runtimeB.getTask({ taskId: bTaskList.tasks[0]!.taskId });
  assert.equal(bTask.task.authorization?.grantId, issued.grantId);
  const jobId = bTask.latestJob?.jobId;
  if (jobId) {
    const job = await runtimeB.workRuntime.getJob(jobId);
    if (job?.snapshotId) {
      const snap = await runtimeB.getSnapshot(job.snapshotId);
      assert.ok(snap!.items.every((i) => path.resolve(i.sourcePath) !== path.resolve(matY)));
    }
  }
  const bEvents = await runtimeB.subject.listGrowthEvents();
  const fulfilled = bEvents.filter((e) => (e.payload.tags ?? []).includes('collab:fulfilled'));
  assert.ok(fulfilled.length >= 1);

  const accepted = await busA.invoke('collab.interact', {
    action: 'decideResult',
    recordId: issued.recordId,
    decision: 'accept',
    note: '摘要可用',
  });
  assert.ok(accepted.issuerEventId);
  assert.ok(accepted.localArtifactId || executed.localArtifactId);

  const aEvents = await runtimeA.subject.listGrowthEvents();
  assert.ok(aEvents.some((e) => (e.payload.tags ?? []).includes('collab:external_accept')));
  assert.doesNotMatch(executed.artifactText || '', new RegExp(uniqueY));

  await busA.invoke('collab.interact', {
    action: 'revoke',
    recordId: issued.recordId,
  });
  const again = await busA.invoke('collab.interact', {
    action: 'fulfill',
    recordId: issued.recordId,
  });
  assert.equal(again.denied, true);

  const runtimeA2 = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      baseUrl: modelEnv.baseUrl,
      model: modelEnv.model,
      providerId: modelEnv.providerId,
      timeoutMs: 120_000,
    },
    secrets: createEnvSecretAccessor(process.env, modelEnv.providerId, runtimeCred),
    registerOpenAiStub: false,
  });
  const busA2 = createCommandBus(runtimeA2);
  await runtimeA2.openPackage({ dir: dirA });
  const restored = await busA2.invoke('collab.interact', {
    action: 'status',
    recordId: issued.recordId,
  });
  assert.equal(restored.status, 'revoked');

  const evidenceDir = path.join(
    process.cwd(),
    'scripts',
    '_mvp-collaboration-real-evidence',
  );
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDir, 'real-collab-sample.json'),
    `${JSON.stringify(
      {
        reachedModel: true,
        capabilityId: executed.capabilityId,
        model: modelEnv.model,
        baseUrlHost: new URL(modelEnv.baseUrl).host,
        grantId: issued.grantId,
        artifactChars: (executed.artifactText || '').length,
        mentionsAuthorizedToken: uniqueXPattern.test(executed.artifactText || ''),
        mentionsUnauthorizedToken: new RegExp(uniqueY).test(executed.artifactText || ''),
        integratedIntoArtifactId: accepted.integratedIntoArtifactId,
        excerpt: (executed.artifactText || '').slice(0, 600),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  await runtimeB.stop();
  await runtimeA.stop();
  await runtimeA2.stop();
});

/**
 * Collaboration MVP — 同机双主体：授权、执行、隔离、撤销、成长事件。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import { GrantStore } from '../grant-store';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-collab-${prefix}-`));
}

async function writeFile(p: string, text: string): Promise<string> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text, 'utf8');
  return p;
}

test('Case1+2+3+4: local dual-subject collaboration grant execute isolate revoke', async () => {
  const root = await tempDir('mvp');
  const dirA = path.join(root, 'subject-a');
  const dirB = path.join(root, 'subject-b');
  const matX = await writeFile(path.join(root, 'materials', 'x.md'), '材料X：仅授权可见的要点。');
  const matY = await writeFile(path.join(root, 'materials', 'y.md'), '材料Y：机密，不得给协作方。');

  const runtimeA = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busA = createCommandBus(runtimeA);
  await runtimeA.createPackage({
    displayName: '主体甲',
    targetDir: dirA,
    initialSelfDescription: '我负责主文档。',
  });

  const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtimeB.createPackage({
    displayName: '主体乙',
    targetDir: dirB,
    initialSelfDescription: '我协助完成子任务。',
  });
  await runtimeB.stop();

  const main = await runtimeA.submitTask({
    goal: '撰写产品说明文档，其中背景摘要可协作完成。',
    contextRefs: [
      { kind: 'file', path: matX },
      { kind: 'file', path: matY },
    ],
    requestedArtifactType: 'document',
  });
  const mainJob = await waitForJobTerminal(runtimeA.workRuntime, main.jobId);
  assert.equal(mainJob.status, 'succeeded');
  const mainArtifactId = mainJob.artifactId as string;
  const mainBefore = await runtimeA.getContent({ artifactId: mainArtifactId });
  const mainHeadBefore = mainBefore.artifact.headVersionId;

  // Case 1: issue + execute + accept
  const issued = await busA.invoke('collab.simulateInteraction', {
    action: 'issue',
    granteePackageDir: dirB,
    issuerTaskId: main.taskId,
    subtaskGoal: '根据材料X写一段简洁背景摘要。',
    allowedMaterialPaths: [matX],
  });
  assert.ok(issued.grantId);
  assert.equal(issued.status, 'authorized');

  const store = await GrantStore.open(dirA);
  const persisted = await store.get(issued.grantId!);
  assert.ok(persisted);
  assert.equal(persisted!.status, 'granted');
  assert.deepEqual(persisted!.scope.resourceRefs?.map((p) => path.resolve(p)), [
    path.resolve(matX),
  ]);

  // Case 2: Y 未授权
  const denyY = await busA.invoke('collab.simulateInteraction', {
    action: 'assertMaterialAccess',
    grantId: issued.grantId,
    attemptMaterialPath: matY,
  });
  assert.equal(denyY.allowed, false);
  assert.equal(denyY.denied, true);

  const denyExecY = await busA.invoke('collab.simulateInteraction', {
    action: 'execute',
    grantId: issued.grantId,
    extraMaterialPaths: [matY],
  });
  assert.equal(denyExecY.denied, true);

  const executed = await busA.invoke('collab.simulateInteraction', {
    action: 'execute',
    grantId: issued.grantId,
  });
  assert.equal(executed.denied, undefined);
  assert.equal(executed.status, 'completed');
  assert.ok(executed.artifactId);
  assert.ok(executed.granteeEventId);
  assert.ok((executed.artifactText || '').length > 0);

  const status1 = await busA.invoke('collab.simulateInteraction', {
    action: 'status',
    grantId: issued.grantId,
  });
  assert.equal(status1.status, 'completed');
  assert.ok(status1.grant?.returnedExcerpt);

  // Snapshot 记录 grant
  const grantAfter = await store.get(issued.grantId!);
  assert.ok(grantAfter?.disclosure?.snapshotId);
  const runtimeB2 = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtimeB2.openPackage({ dir: dirB });
  const snap = await runtimeB2.getSnapshot(grantAfter!.disclosure!.snapshotId!);
  assert.ok(snap?.authorization?.grantId === issued.grantId);
  assert.ok(
    snap!.items.every((i) => path.resolve(i.sourcePath) !== path.resolve(matY)),
    'snapshot must not include unauthorized material Y',
  );
  const bEvents = await runtimeB2.subject.listGrowthEvents();
  const bFulfilled = bEvents.find((e) => (e.payload.tags ?? []).includes('collab:fulfilled'));
  assert.ok(bFulfilled);

  // 协作执行不得直接覆盖 A 主成果
  const mainAfterExecute = await runtimeA.getContent({ artifactId: mainArtifactId });
  assert.equal(mainAfterExecute.artifact.headVersionId, mainHeadBefore);

  const accepted = await busA.invoke('collab.simulateInteraction', {
    action: 'acceptReturn',
    grantId: issued.grantId,
    decision: 'accept',
    note: '背景摘要可用',
  });
  assert.ok(accepted.issuerEventId);
  const aEvents = await runtimeA.subject.listGrowthEvents();
  const aAccept = aEvents.find((e) => (e.payload.tags ?? []).includes('collab:external_accept'));
  assert.ok(aAccept);
  assert.notEqual(aAccept!.id, bFulfilled!.id);
  assert.notEqual(aAccept!.payload.title, bFulfilled!.payload.title);

  // 采用后主成果应含协作引用区（新版本，非静默覆盖）
  const mainIntegrated = await runtimeA.getContent({ artifactId: mainArtifactId });
  assert.notEqual(mainIntegrated.artifact.headVersionId, mainHeadBefore);
  assert.match(mainIntegrated.text || '', /协作摘要（已采用）/);
  assert.match(mainIntegrated.text || '', new RegExp(`collab-ref:${issued.grantId}`));

  // Case 3: revoke → re-execute denied
  const revoked = await busA.invoke('collab.simulateInteraction', {
    action: 'revoke',
    grantId: issued.grantId,
  });
  assert.equal(revoked.status, 'revoked');
  const again = await busA.invoke('collab.simulateInteraction', {
    action: 'execute',
    grantId: issued.grantId,
  });
  assert.equal(again.denied, true);
  assert.match(String(again.reason || ''), /revoked/i);

  // 重启后 Grant 与返回成果仍在
  const runtimeA2 = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busA2 = createCommandBus(runtimeA2);
  await runtimeA2.openPackage({ dir: dirA });
  const restored = await busA2.invoke('collab.simulateInteraction', {
    action: 'status',
    grantId: issued.grantId,
  });
  assert.equal(restored.status, 'revoked');
  assert.ok(restored.grant?.returnedExcerpt);

  await runtimeB2.stop();
});

test('Case4: capability failure does not write collab:fulfilled', async () => {
  const root = await tempDir('fail');
  const dirA = path.join(root, 'subject-a');
  const dirB = path.join(root, 'subject-b');
  const matX = await writeFile(path.join(root, 'x.md'), '授权材料X');

  const runtimeA = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
  });
  const busA = createCommandBus(runtimeA);
  await runtimeA.createPackage({
    displayName: '甲-无文档能力',
    targetDir: dirA,
    initialSelfDescription: '测试失败纪律。',
  });

  // 为发 Grant 需要 issuerTaskId；无文档能力时无法 submitTask，写入假 taskId 亦可（execute 不依赖 A 任务执行）。
  const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtimeB.createPackage({
    displayName: '乙',
    targetDir: dirB,
    initialSelfDescription: '协作者。',
  });
  await runtimeB.stop();

  // Issuer 无能力 → sibling 也无能力 → execute 失败且不得 fulfilled
  const issued = await busA.invoke('collab.simulateInteraction', {
    action: 'issue',
    granteePackageDir: dirB,
    issuerTaskId: 'task_placeholder',
    subtaskGoal: '应失败的子任务',
    allowedMaterialPaths: [matX],
  });
  assert.ok(issued.grantId);
  const executed = await busA.invoke('collab.simulateInteraction', {
    action: 'execute',
    grantId: issued.grantId as string,
  });
  assert.equal(executed.status, 'failed');

  const runtimeB2 = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtimeB2.openPackage({ dir: dirB });
  const events = await runtimeB2.subject.listGrowthEvents();
  assert.ok(!events.some((e) => (e.payload.tags ?? []).includes('collab:fulfilled')));
  await runtimeB2.stop();
  await runtimeA.stop();
});

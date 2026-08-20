/**
 * Collaboration MVP 回归 — 适配 collab.interact 主体协作主链。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { GrantStore } from '../grant-store';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-collab-${prefix}-`));
}

async function writeFile(p: string, text: string): Promise<string> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text, 'utf8');
  return p;
}

test('Case1+2+3+4: propose fulfill isolate revoke via collab.interact', async () => {
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

  const issued = await busA.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent: '根据材料X写一段简洁背景摘要。',
    allowedMaterialPaths: [matX],
    acceptanceCriteria: ['提供可核对的完整成果，并说明依据'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.ok(issued.recordId);
  assert.ok(issued.grantId);
  assert.ok(['authorized', 'agreed'].includes(String(issued.status)));

  const store = await GrantStore.open(dirA);
  const persisted = await store.get(issued.grantId!);
  assert.ok(persisted);
  assert.equal(persisted!.status, 'granted');
  assert.equal(persisted!.origin.kind, 'collaboration_agreement');

  const listed = await busA.invoke('collab.interact', { action: 'list' });
  assert.ok(listed.items?.some((i) => i.recordId === issued.recordId));

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
  assert.equal(executed.status, 'delivered');
  assert.ok(executed.localArtifactId);
  assert.ok((executed.artifactText || '').length >= 40);

  const status1 = await busA.invoke('collab.interact', {
    action: 'status',
    recordId: issued.recordId,
  });
  assert.equal(status1.status, 'delivered');

  const accepted = await busA.invoke('collab.interact', {
    action: 'decideResult',
    recordId: issued.recordId,
    decision: 'accept',
  });
  assert.equal(accepted.status, 'completed');

  const revoked = await busA.invoke('collab.interact', {
    action: 'revoke',
    recordId: issued.recordId,
  });
  assert.equal(revoked.status, 'revoked');

  await runtimeA.stop();
  const runtimeA2 = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busA2 = createCommandBus(runtimeA2);
  await runtimeA2.openPackage({ dir: dirA });
  const restored = await busA2.invoke('collab.interact', {
    action: 'status',
    recordId: issued.recordId,
  });
  assert.equal(restored.status, 'revoked');
  await runtimeA2.stop();
});

test('fulfillment interrupt without job ref recovers to failed; retry succeeds', async () => {
  const root = await tempDir('recover');
  const dirA = path.join(root, 'subject-a');
  const dirB = path.join(root, 'subject-b');
  const matX = await writeFile(path.join(root, 'materials', 'x.md'), '材料X：可共享要点。');

  const runtimeA = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busA = createCommandBus(runtimeA);
  await runtimeA.createPackage({
    displayName: '主体甲',
    targetDir: dirA,
    initialSelfDescription: '主方。',
  });
  const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtimeB.createPackage({
    displayName: '主体乙',
    targetDir: dirB,
    initialSelfDescription: '协助方。',
  });
  await runtimeB.stop();

  const issued = await busA.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent: '根据材料写简短摘要。',
    allowedMaterialPaths: [matX],
    acceptanceCriteria: ['提供可核对的完整成果，并说明依据'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.ok(issued.recordId);

  // 模拟履行中断：已写入 fulfillment_started，但尚未建立 Job 引用
  const { CollaborationRecordStore } = await import('../record-store');
  const store = await CollaborationRecordStore.open(dirA);
  const record = await store.get(issued.recordId!);
  assert.ok(record);
  record!.events.push({
    eventId: `cev_interrupt_${Date.now()}`,
    kind: 'fulfillment_started',
    authorSubjectId: record!.responder.subjectId,
    at: new Date().toISOString(),
    ...(issued.grantId ? { grantId: issued.grantId } : {}),
  });
  record!.updatedAt = new Date().toISOString();
  await store.put(record!);

  const stuck = await busA.invoke('collab.interact', {
    action: 'status',
    recordId: issued.recordId,
  });
  assert.equal(stuck.status, 'failed', 'interrupt without job must not stay running');

  const retried = await busA.invoke('collab.interact', {
    action: 'fulfill',
    recordId: issued.recordId,
  });
  assert.equal(retried.status, 'delivered');
  assert.ok(retried.localArtifactId);

  // 幂等：再次 fulfill 不重复开工
  const again = await busA.invoke('collab.interact', {
    action: 'fulfill',
    recordId: issued.recordId,
  });
  assert.equal(again.status, 'delivered');
  assert.equal(again.localArtifactId, retried.localArtifactId);

  await runtimeA.stop();
});

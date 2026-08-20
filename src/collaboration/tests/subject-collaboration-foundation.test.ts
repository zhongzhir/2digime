/**
 * 主体协作基础：提议—评估—约定—履行—验收；B 非工具壳。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { CollaborationRecordStore } from '../record-store';
import { GrantStore } from '../grant-store';
import { findAgreement, termsDigestOf } from '../record-derive';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-scf-${prefix}-`));
}

async function writeFile(p: string, text: string): Promise<string> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text, 'utf8');
  return p;
}

test('subject collaboration: propose evaluate agree fulfill revise accept restart', async () => {
  const root = await tempDir('main');
  const dirA = path.join(root, 'subject-a');
  const dirB = path.join(root, 'subject-b');
  const matX = await writeFile(
    path.join(root, 'materials', 'spec.md'),
    '材料要点：本地优先、主体独立、协作需双方约定。请据此写背景摘要。',
  );
  const matSalary = await writeFile(
    path.join(root, 'materials', 'salary.md'),
    '薪酬数据：张三年薪 80 万。',
  );

  const runtimeA = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busA = createCommandBus(runtimeA);
  await runtimeA.createPackage({
    displayName: '主体甲',
    targetDir: dirA,
    initialSelfDescription: '我负责任务发起与验收。',
  });

  const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtimeB.createPackage({
    displayName: '主体乙',
    targetDir: dirB,
    initialSelfDescription: '我协助分析材料。',
  });
  // B 边界：不分析薪酬数据
  await runtimeB.appendOwnerEvent({
    type: 'boundary_updated',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: {
      title: '边界',
      detail: '不得分析薪酬数据相关材料',
      tags: ['boundary'],
    },
  });
  await runtimeB.appendOwnerEvent({
    type: 'experience_confirmed',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: {
      title: '工作偏好',
      detail: '摘要先列问题再给依据',
      tags: ['working_method'],
    },
  });
  await runtimeB.stop();

  // 1) 命中边界 → 拒绝（证明 B 规则判断）
  const denied = await busA.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent: '请分析这份薪酬数据并总结',
    expectedOutcome: '薪酬摘要',
    allowedMaterialPaths: [matSalary],
    acceptanceCriteria: ['列出薪酬要点'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(denied.status, 'rejected');
  assert.ok((denied.evaluationBasis || []).some((b) => b.startsWith('boundary:')));

  // 2) 合规提议 → 成约
  const proposed = await busA.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent: '根据材料写一段简洁背景摘要',
    expectedOutcome: '背景摘要',
    allowedMaterialPaths: [matX],
    acceptanceCriteria: ['提供可核对的完整成果，并说明依据'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.ok(proposed.recordId);
  assert.ok(proposed.grantId);
  assert.ok(['authorized', 'agreed'].includes(String(proposed.status)));

  const recordsA = await CollaborationRecordStore.open(dirA);
  const recordA = await recordsA.get(proposed.recordId!);
  assert.ok(recordA);
  const agreement = findAgreement(recordA!);
  assert.ok(agreement?.termsDigest);
  // Record 不含绝对路径部署字段
  assert.ok(!('granteePackageDir' in (recordA as object) && (recordA as { granteePackageDir?: string }).granteePackageDir));

  const recordsB = await CollaborationRecordStore.open(dirB);
  const recordB = await recordsB.get(proposed.recordId!);
  assert.ok(recordB);
  assert.equal(findAgreement(recordB!)?.termsDigest, agreement!.termsDigest);
  // 双方接受同一 digest
  const terms = agreement!.terms || recordA!.proposal;
  assert.equal(termsDigestOf(terms!), agreement!.termsDigest);

  const grantStore = await GrantStore.open(dirA);
  const grant = await grantStore.get(proposed.grantId!);
  assert.ok(grant);
  assert.equal(grant!.origin.kind, 'collaboration_agreement');
  assert.ok(!grant!.granteePackageDir);
  assert.ok(!grant!.returnedArtifact);

  // 材料隔离
  const denyY = await busA.invoke('collab.interact', {
    action: 'assertMaterialAccess',
    recordId: proposed.recordId,
    attemptMaterialPath: matSalary,
  });
  assert.equal(denyY.allowed, false);

  // 3) 履行 → 完整物化
  const fulfilled = await busA.invoke('collab.interact', {
    action: 'fulfill',
    recordId: proposed.recordId,
  });
  assert.equal(fulfilled.status, 'delivered');
  assert.ok(fulfilled.localArtifactId);
  assert.ok((fulfilled.artifactText || '').length > 40);

  const local = await runtimeA.getContent({ artifactId: fulfilled.localArtifactId! });
  assert.ok(local.artifact.provenance);
  assert.equal(local.artifact.provenance?.sourceArtifactId, fulfilled.artifactId);
  assert.equal(local.artifact.provenance?.agreementTermsDigest, agreement!.termsDigest);
  assert.equal(local.text, fulfilled.artifactText);

  // 4) 修订 → 版本追加
  const revised = await busA.invoke('collab.interact', {
    action: 'requestRevision',
    recordId: proposed.recordId,
    note: '请更强调本地优先',
  });
  assert.equal(revised.localArtifactId, fulfilled.localArtifactId);
  const afterRev = await runtimeA.getContent({ artifactId: revised.localArtifactId! });
  assert.ok(afterRev.artifact.versions.length >= 2);
  assert.notEqual(afterRev.artifact.headVersionId, local.artifact.headVersionId);

  // 5) 采用 → 双方回流
  const decided = await busA.invoke('collab.interact', {
    action: 'decideResult',
    recordId: proposed.recordId,
    decision: 'accept',
    note: '摘要清楚，可采用',
  });
  assert.equal(decided.status, 'completed');
  const growthA = await runtimeA.subject.listGrowthEvents();
  assert.ok(
    growthA.some(
      (e) =>
        (e.payload.tags || []).includes('collab:external_accept') &&
        (e.payload.tags || []).some((t) => t.startsWith('collab:record:')),
    ),
  );

  const runtimeB2 = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtimeB2.openPackage({ dir: dirB });
  const growthB = await runtimeB2.subject.listGrowthEvents();
  assert.ok(growthB.some((e) => (e.payload.tags || []).includes('collab:fulfilled')));
  assert.ok(growthB.some((e) => (e.payload.tags || []).includes('collab:accepted_by_peer')));
  await runtimeB2.stop();

  // 6) 重启对账
  await runtimeA.stop();
  const runtimeA2 = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busA2 = createCommandBus(runtimeA2);
  await runtimeA2.openPackage({ dir: dirA });
  const listed = await busA2.invoke('collab.interact', { action: 'list' });
  const row = listed.items?.find((i) => i.recordId === proposed.recordId);
  assert.ok(row);
  assert.equal(row!.status, 'completed');
  const st = await busA2.invoke('collab.interact', {
    action: 'status',
    recordId: proposed.recordId,
  });
  assert.equal(st.status, 'completed');
  assert.equal(st.termsDigest, agreement!.termsDigest);

  // 幂等采用
  const again = await busA2.invoke('collab.interact', {
    action: 'decideResult',
    recordId: proposed.recordId,
    decision: 'accept',
  });
  assert.equal(again.status, 'completed');

  await runtimeA2.stop();
});

test('collab.interact rejects legacy no-action simulation on command bus', async () => {
  const root = await tempDir('legacy');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus = createCommandBus(runtime);
  await runtime.createPackage({
    displayName: '仅测命令',
    targetDir: path.join(root, 'pkg'),
  });
  await assert.rejects(
    () => bus.invoke('collab.interact', {} as never),
    /requires action/,
  );
  await runtime.stop();
});

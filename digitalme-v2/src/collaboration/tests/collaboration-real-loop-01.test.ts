/**
 * DIGITALME-V2-COLLABORATION-REAL-LOOP-01
 * 独立 SubjectPackage A/B：提议→判断→授权→履行→修订→验收→成长→重启。
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
import { findAgreement, latestGrantId, deriveCollabStatus } from '../record-derive';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-crl01-${prefix}-`));
}

async function writeFile(p: string, text: string): Promise<string> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text, 'utf8');
  return p;
}

async function openBus(dir: string, displayName: string, selfDesc: string) {
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus = createCommandBus(runtime);
  await runtime.createPackage({
    displayName,
    targetDir: dir,
    initialSelfDescription: selfDesc,
  });
  return { runtime, bus };
}

test('COLLABORATION-REAL-LOOP-01: independent A/B propose→reject/accept→fulfill→revise→adopt', async () => {
  const root = await tempDir('main');
  const dirA = path.join(root, 'subject-a');
  const dirB = path.join(root, 'subject-b');
  const matRisk = await writeFile(
    path.join(root, 'materials', 'digital-me-notes.md'),
    [
      '# Digital Me 项目材料',
      '本地优先、主体独立、协作需双方判断与约定。',
      '用户界面应使用自然语言，不暴露内部实现细节。',
      '固定接口调用与已注册专业能力不属于协作。',
      '学习结果分别留在各自主体内，不可混成一份共享记忆。',
    ].join('\n'),
  );
  const matSecret = await writeFile(
    path.join(root, 'materials', 'secret.md'),
    '机密：不得共享给协作方。',
  );

  const a = await openBus(dirA, '数字之我甲', '我发起协作并验收成果。');
  const bCreate = createDigitalMeRuntime({ documentCapability: 'fake' });
  await bCreate.createPackage({
    displayName: '数字之我乙',
    targetDir: dirB,
    initialSelfDescription: '我评估是否承接并完成分析。',
  });
  await bCreate.appendOwnerEvent({
    type: 'boundary_updated',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: {
      title: '边界',
      detail: '不承接薪酬或个人隐私数据挖掘',
      tags: ['boundary'],
    },
  });
  await bCreate.stop();

  // 1) A propose → B receives（不自动成约）
  const proposed = await a.bus.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent:
      '请帮我根据这些 Digital Me 项目材料，整理出三个当前最值得优先验证的产品风险，并说明理由。',
    expectedOutcome: '三份产品风险说明与理由',
    allowedMaterialPaths: [matRisk],
    acceptanceCriteria: ['列出三个风险', '每条附理由', '面向普通用户体验'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
    skipAutoEvaluate: true,
  });
  assert.ok(proposed.recordId);
  assert.equal(proposed.status, 'proposed');
  assert.equal(proposed.grantId, undefined);
  const rejectProbeId = proposed.recordId;

  const recordsA0 = await CollaborationRecordStore.open(dirA);
  const recordsB0 = await CollaborationRecordStore.open(dirB);
  const copyA0 = await recordsA0.get(rejectProbeId);
  const copyB0 = await recordsB0.get(rejectProbeId);
  assert.ok(copyA0 && copyB0);
  assert.equal(copyA0!.recordId, copyB0!.recordId);
  assert.equal(latestGrantId(copyA0!), undefined);

  // 15) 未接受前不可访问材料（含提议内）
  const beforeGrant = await a.bus.invoke('collab.interact', {
    action: 'assertMaterialAccess',
    recordId: rejectProbeId,
    attemptMaterialPath: matRisk,
  });
  assert.equal(beforeGrant.allowed, false);

  // 2) B reject → 无 Grant / 无 Task
  {
    const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
    const busB = createCommandBus(runtimeB);
    await runtimeB.openPackage({ dir: dirB });
    const listedB = await busB.invoke('collab.interact', { action: 'list' });
    const inbound = listedB.items?.find((i) => i.recordId === rejectProbeId);
    assert.ok(inbound);
    assert.equal(inbound!.role, 'responder');
    assert.equal(inbound!.status, 'proposed');

    const rejected = await busB.invoke('collab.interact', {
      action: 'respond',
      recordId: rejectProbeId,
      decision: 'reject',
      note: '当前不适合承接该分析',
    });
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.grantId, undefined);

    const grantsB = await GrantStore.open(dirB);
    assert.equal((await grantsB.list()).length, 0);
    const tasksB = await runtimeB.listTasks();
    assert.equal((tasksB.tasks || []).length, 0);
    await runtimeB.stop();
  }

  // 3–5) 新提议：B accept → agreement + Grant；B fulfill 走现有 Task
  const proposed2 = await a.bus.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent:
      '请帮我根据这些 Digital Me 项目材料，整理出三个当前最值得优先验证的产品风险，并说明理由。',
    expectedOutcome: '三份产品风险说明与理由',
    allowedMaterialPaths: [matRisk],
    acceptanceCriteria: ['列出三个风险', '每条附理由', '面向普通用户体验'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
    skipAutoEvaluate: true,
  });
  assert.ok(proposed2.recordId);
  assert.equal(proposed2.status, 'proposed');
  const recordId2 = proposed2.recordId;

  let grantId: string | undefined;
  let localArtifactId: string | undefined;
  {
    const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
    const busB = createCommandBus(runtimeB);
    await runtimeB.openPackage({ dir: dirB });

    const accepted = await busB.invoke('collab.interact', {
      action: 'respond',
      recordId: recordId2,
      decision: 'accept',
      note: '可以承接该产品风险整理',
    });
    assert.ok(['authorized', 'agreed'].includes(String(accepted.status)));
    assert.ok(accepted.grantId);
    grantId = accepted.grantId;

    const recA = await (await CollaborationRecordStore.open(dirA)).get(recordId2);
    const recB = await (await CollaborationRecordStore.open(dirB)).get(recordId2);
    assert.ok(findAgreement(recA!));
    assert.ok(findAgreement(recB!));
    assert.equal(latestGrantId(recA!), grantId);
    assert.equal(latestGrantId(recB!), grantId);

    const grantA = await (await GrantStore.open(dirA)).get(grantId!);
    const grantB = await (await GrantStore.open(dirB)).get(grantId!);
    assert.ok(grantA && grantB);
    assert.equal(grantA!.origin.kind, 'collaboration_agreement');
    assert.equal(grantA!.origin.recordId, recordId2);
    assert.deepEqual(
      (grantA!.scope.resourceRefs || []).map((p) => path.resolve(p)),
      [path.resolve(matRisk)],
    );

    const allowRisk = await busB.invoke('collab.interact', {
      action: 'assertMaterialAccess',
      recordId: recordId2,
      attemptMaterialPath: matRisk,
    });
    assert.equal(allowRisk.allowed, true);
    const denySecret = await busB.invoke('collab.interact', {
      action: 'assertMaterialAccess',
      recordId: recordId2,
      attemptMaterialPath: matSecret,
    });
    assert.equal(denySecret.allowed, false);

    const tasksBefore = await runtimeB.listTasks();
    const fulfilled = await busB.invoke('collab.interact', {
      action: 'fulfill',
      recordId: recordId2,
    });
    assert.equal(fulfilled.status, 'delivered');
    assert.ok(fulfilled.localArtifactId);
    assert.ok(fulfilled.jobId);
    assert.ok((fulfilled.artifactText || '').length >= 40);
    localArtifactId = fulfilled.localArtifactId;

    const tasksAfter = await runtimeB.listTasks();
    assert.ok((tasksAfter.tasks || []).length > (tasksBefore.tasks || []).length);

    const artA = await a.runtime.getContent({ artifactId: localArtifactId! });
    assert.ok(artA.artifact.provenance);
    assert.equal(artA.artifact.provenance?.kind, 'collaboration_delivery');
    assert.equal(artA.artifact.provenance?.recordId, recordId2);

    await runtimeB.stop();
  }

  // 9) A revision → B redelivery（同 lineage）
  const revised = await a.bus.invoke('collab.interact', {
    action: 'requestRevision',
    recordId: recordId2,
    note: '风险描述太偏技术，请更关注普通用户实际体验。',
  });
  assert.ok(revised.localArtifactId);
  assert.equal(revised.localArtifactId, localArtifactId);
  const afterRev = await a.runtime.getContent({ artifactId: revised.localArtifactId! });
  assert.ok(afterRev.artifact.versions.length >= 2);

  // 7) A adopt
  const decided = await a.bus.invoke('collab.interact', {
    action: 'decideResult',
    recordId: recordId2,
    decision: 'accept',
    note: '修订后可采用',
  });
  assert.equal(decided.status, 'completed');

  // 8) 另开一条验证 reject 不产生修订
  const proposed3 = await a.bus.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent: '请根据材料写一句产品边界提醒',
    expectedOutcome: '边界提醒短文',
    allowedMaterialPaths: [matRisk],
    acceptanceCriteria: ['一句话提醒'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
    skipAutoEvaluate: true,
  });
  assert.ok(proposed3.recordId);
  const recordId3 = proposed3.recordId;
  {
    const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
    const busB = createCommandBus(runtimeB);
    await runtimeB.openPackage({ dir: dirB });
    await busB.invoke('collab.interact', {
      action: 'respond',
      recordId: recordId3,
      decision: 'accept',
    });
    await busB.invoke('collab.interact', {
      action: 'fulfill',
      recordId: recordId3,
    });
    await runtimeB.stop();
  }
  const rejectedResult = await a.bus.invoke('collab.interact', {
    action: 'decideResult',
    recordId: recordId3,
    decision: 'reject',
    note: '方向不合，不采用',
  });
  assert.equal(rejectedResult.status, 'rejected');
  const recReject = await (await CollaborationRecordStore.open(dirA)).get(recordId3);
  assert.ok(!recReject!.events.some((e) => e.kind === 'revision_requested'));

  // 12) 双方 GrowthEvent 独立且不同
  const growthA = await a.runtime.subject.listGrowthEvents();
  const runtimeBGrowth = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtimeBGrowth.openPackage({ dir: dirB });
  const growthB = await runtimeBGrowth.subject.listGrowthEvents();
  const aAccept = growthA.filter((e) => (e.payload.tags || []).includes('collab:external_accept'));
  const bFulfilled = growthB.filter((e) => (e.payload.tags || []).includes('collab:fulfilled'));
  const bAccepted = growthB.filter((e) =>
    (e.payload.tags || []).includes('collab:accepted_by_peer'),
  );
  assert.ok(aAccept.length >= 1);
  assert.ok(bFulfilled.length >= 1);
  assert.ok(bAccepted.length >= 1);
  assert.ok(!growthA.some((e) => (e.payload.tags || []).includes('collab:fulfilled')));
  assert.ok(!growthB.some((e) => (e.payload.tags || []).includes('collab:external_accept')));
  await runtimeBGrowth.stop();

  // 16) revoke 后授权失效
  const proposed4 = await a.bus.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent: '请根据材料列出一个待验证风险',
    expectedOutcome: '一条风险',
    allowedMaterialPaths: [matRisk],
    acceptanceCriteria: ['一条风险'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
    skipAutoEvaluate: true,
  });
  assert.ok(proposed4.recordId);
  const recordId4 = proposed4.recordId;
  {
    const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
    const busB = createCommandBus(runtimeB);
    await runtimeB.openPackage({ dir: dirB });
    const acc = await busB.invoke('collab.interact', {
      action: 'respond',
      recordId: recordId4,
      decision: 'accept',
    });
    assert.ok(acc.grantId);
    await runtimeB.stop();
  }
  await a.bus.invoke('collab.interact', {
    action: 'revoke',
    recordId: recordId4,
  });
  const afterRevoke = await a.bus.invoke('collab.interact', {
    action: 'assertMaterialAccess',
    recordId: recordId4,
    attemptMaterialPath: matRisk,
  });
  assert.equal(afterRevoke.allowed, false);

  // 14) 固定能力调用不进入协作
  const taskOnly = await a.runtime.submitTask({
    goal: '写一句本地优先提醒',
    contextRefs: [{ kind: 'file', path: matRisk }],
    requestedArtifactType: 'document',
  });
  assert.ok(taskOnly.taskId);
  const collabAfterCap = await (await CollaborationRecordStore.open(dirA)).list();
  assert.ok(!collabAfterCap.some((r) => r.issuerTaskId === taskOnly.taskId));

  // 17) 不建立第二 Store：仍只有 collaboration/（含 grants）+ 既有 task/artifact/growth
  const aRootEntries = await fs.readdir(dirA);
  assert.ok(aRootEntries.includes('collaboration'));
  const collabEntries = await fs.readdir(path.join(dirA, 'collaboration'));
  assert.ok(collabEntries.includes('grants') || collabEntries.includes('records'));
  assert.ok(!aRootEntries.includes('collaboration-results'));
  assert.ok(!aRootEntries.includes('collab-tasks'));
  assert.ok(!(await fs.readdir(dirA).then((xs) => xs.includes('growth-alt'))));

  // 13) 重启后恢复
  await a.runtime.stop();
  const runtimeA2 = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busA2 = createCommandBus(runtimeA2);
  await runtimeA2.openPackage({ dir: dirA });
  const listedA = await busA2.invoke('collab.interact', { action: 'list' });
  const row = listedA.items?.find((i) => i.recordId === recordId2);
  assert.ok(row);
  assert.equal(row!.status, 'completed');
  assert.equal(row!.role, 'initiator');

  const runtimeB2 = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busB2 = createCommandBus(runtimeB2);
  await runtimeB2.openPackage({ dir: dirB });
  const listedB2 = await busB2.invoke('collab.interact', { action: 'list' });
  const rowB = listedB2.items?.find((i) => i.recordId === recordId2);
  assert.ok(rowB);
  assert.equal(rowB!.recordId, recordId2);
  assert.equal(rowB!.role, 'responder');
  assert.equal(rowB!.status, 'completed');

  // 18) 用户面展示字段不得裸露内部协议词（抽样目标/对方名；不把模型摘录当文案验收）
  const userFacing = [row!.subtaskGoal, row!.peerDisplayName, row!.granteeDisplayName]
    .filter(Boolean)
    .join('\n');
  assert.ok(!/CollaborationRecord|\bGrant\b|event type|SubjectPackage|\bprotocol\b/i.test(userFacing));

  await runtimeA2.stop();
  await runtimeB2.stop();
});

test('COLLABORATION-REAL-LOOP-01: derive status path proposed→authorized→delivered→completed', async () => {
  const root = await tempDir('derive');
  const dirA = path.join(root, 'a');
  const dirB = path.join(root, 'b');
  const mat = await writeFile(path.join(root, 'm.md'), '材料：主体协作需判断。');
  const a = await openBus(dirA, '甲', '发起');
  const b = createDigitalMeRuntime({ documentCapability: 'fake' });
  await b.createPackage({ displayName: '乙', targetDir: dirB, initialSelfDescription: '回应' });
  await b.stop();

  const p = await a.bus.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent: '整理一个产品风险',
    expectedOutcome: '风险一条',
    allowedMaterialPaths: [mat],
    acceptanceCriteria: ['一条风险'],
    skipAutoEvaluate: true,
  });
  assert.ok(p.recordId);
  const rid = p.recordId;
  let rec = await (await CollaborationRecordStore.open(dirA)).get(rid);
  assert.equal(deriveCollabStatus(rec!), 'proposed');

  const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busB = createCommandBus(runtimeB);
  await runtimeB.openPackage({ dir: dirB });
  await busB.invoke('collab.interact', {
    action: 'respond',
    recordId: rid,
    decision: 'accept',
  });
  rec = await (await CollaborationRecordStore.open(dirA)).get(rid);
  assert.ok(['authorized', 'agreed'].includes(deriveCollabStatus(rec!)));
  await busB.invoke('collab.interact', { action: 'fulfill', recordId: rid });
  rec = await (await CollaborationRecordStore.open(dirA)).get(rid);
  assert.equal(deriveCollabStatus(rec!), 'delivered');
  await a.bus.invoke('collab.interact', {
    action: 'decideResult',
    recordId: rid,
    decision: 'accept',
  });
  rec = await (await CollaborationRecordStore.open(dirA)).get(rid);
  assert.equal(deriveCollabStatus(rec!), 'completed');
  await runtimeB.stop();
  await a.runtime.stop();
});

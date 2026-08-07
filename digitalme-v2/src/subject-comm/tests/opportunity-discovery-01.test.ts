/**
 * OPPORTUNITY-DISCOVERY-COMMUNICATION-DEMO-01
 * Signal / SubjectTransport / 机会发现 / 衔接协作闭环。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { CollaborationRecordStore } from '../../collaboration/record-store';
import { LocalPackageTransport } from '../../collaboration/transport';
import { LocalSubjectTransport, buildEnvelope } from '../local-subject-transport';
import { InboxStore, OpportunityStore } from '../inbox-store';
import type { SignalPayload } from '../signal';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-opp-${prefix}-`));
}

async function openPkg(dir: string, name: string, desc: string) {
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus = createCommandBus(runtime);
  await runtime.createPackage({
    displayName: name,
    targetDir: dir,
    initialSelfDescription: desc,
  });
  return { runtime, bus };
}

test('opportunity discovery: signal match continue collab + transport idempotency', async () => {
  const root = await tempDir('main');
  const dirA = path.join(root, 'a');
  const dirB = path.join(root, 'b');
  const dirC = path.join(root, 'c-nomatch');

  const a = await openPkg(
    dirA,
    '主体甲',
    '我有 Agent / Digital Me 技术能力，正在寻找适合 AI/Agent 比赛的成熟金融应用场景。',
  );
  await a.runtime.appendOwnerEvent({
    type: 'experience_confirmed',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: {
      title: '合作意向',
      detail: '可提供 Agent / Digital Me 技术能力，寻找金融应用场景联合参赛。',
      tags: ['seeking:finance_scenario', 'offering:agent_tech'],
    },
  });

  const b = await openPkg(
    dirB,
    '主体乙',
    '我拥有成熟金融投资应用项目 Aivestor，希望寻找 Agent / Digital Me 技术能力进一步升级，愿意考虑联合参赛。',
  );
  await b.runtime.appendOwnerEvent({
    type: 'experience_confirmed',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: {
      title: 'Aivestor 项目',
      detail: '成熟金融投资应用 Aivestor；希望升级 Agent / Digital Me 技术；寻找联合参赛伙伴。',
      tags: ['project:aivestor', 'finance', 'seeking:agent_tech'],
    },
  });
  // 私有事实：不得出现在 A 可见字段
  await b.runtime.appendOwnerEvent({
    type: 'experience_confirmed',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: {
      title: '私密财务备注',
      detail: 'SECRET_B_PORTFOLIO_ALPHA_99',
      tags: ['private'],
    },
  });
  await b.runtime.stop();

  const c = await openPkg(dirC, '主体丙', '我只做本地笔记整理，不参与金融或 Agent 合作。');
  await c.runtime.appendOwnerEvent({
    type: 'boundary_updated',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: { title: '边界', detail: '不对外合作', tags: ['boundary:no_collab'] },
  });
  await c.runtime.stop();

  const signal: SignalPayload = {
    intent:
      '正在寻找适合联合参赛的成熟金融 AI 应用场景；可提供 Agent / Digital Me 技术能力。',
    seeking: ['成熟金融应用场景', '联合参赛'],
    offering: ['Agent / Digital Me 技术能力'],
    disclosureLevel: 'minimal',
  };

  // 2–3) no_match 静默
  const recordsBeforeC = await (await CollaborationRecordStore.open(dirA)).list();
  await a.bus.invoke('subject.communicate', {
    action: 'sendSignal',
    peerPackageDir: dirC,
    signal: {
      ...signal,
      seeking: ['量子芯片代工厂'],
      offering: ['无关能力'],
    },
  });
  const runtimeC = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtimeC.openPackage({ dir: dirC });
  const busC = createCommandBus(runtimeC);
  await busC.invoke('subject.communicate', { action: 'processInbox' });
  const oppC = await busC.invoke('subject.communicate', { action: 'listOpportunities' });
  assert.equal((oppC.items || []).length, 0);
  const recordsAfterC = await (await CollaborationRecordStore.open(dirA)).list();
  assert.equal(recordsAfterC.length, recordsBeforeC.length);
  await runtimeC.stop();

  // 1,4,5) A → B potential_match + response
  const sent = await a.bus.invoke('subject.communicate', {
    action: 'sendSignal',
    peerPackageDir: dirB,
    signal,
  });
  assert.ok(sent.envelopeId);
  assert.ok(sent.opportunityId);

  const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busB = createCommandBus(runtimeB);
  await runtimeB.openPackage({ dir: dirB });
  await busB.invoke('subject.communicate', { action: 'processInbox' });
  const oppB = await busB.invoke('subject.communicate', { action: 'listOpportunities' });
  assert.ok((oppB.items || []).length >= 1);
  const bCard = oppB.items![0]!;
  assert.ok(bCard);
  assert.ok(['potential', 'inbound_pending'].includes(bCard.stage) || bCard.stage === 'potential');

  await a.bus.invoke('subject.communicate', { action: 'processInbox' });
  const oppA = await a.bus.invoke('subject.communicate', { action: 'listOpportunities' });
  assert.ok((oppA.items || []).some((i) => i.id === sent.opportunityId));

  // 6–7) 私有事实不互相可见
  const aBlob = JSON.stringify(oppA.items);
  const bBlob = JSON.stringify(oppB.items);
  assert.ok(!aBlob.includes('SECRET_B_PORTFOLIO_ALPHA_99'));
  assert.ok(!/envelope|transport|protocol|confidence|embedding/i.test(aBlob + bBlob));

  // 11–12) duplicate envelope 幂等
  const transportA = new LocalPackageTransport(a.runtime).asSubjectTransport();
  const peer = await transportA.resolvePeer(dirB);
  const dupEnv = buildEnvelope({
    from: {
      subjectId: a.runtime.subject.requireActive().id,
      displayName: '主体甲',
      endpointRef: `subject:${a.runtime.subject.requireActive().id}`,
    },
    to: { subjectId: peer.subjectId, displayName: peer.displayName, endpointRef: peer.endpointRef },
    kind: 'signal',
    payload: signal,
  });
  // 固定 id 发两次
  const fixedId = 'envelope_idempotent_test_01';
  dupEnv.envelopeId = fixedId;
  dupEnv.id = fixedId;
  const first = await transportA.send(dupEnv);
  const second = await transportA.send(dupEnv);
  assert.equal(first.delivered, true);
  assert.equal(second.duplicate, true);
  const inboxB = await InboxStore.open(dirB);
  const listed = (await inboxB.list()).filter((e) => e.envelopeId === fixedId);
  assert.equal(listed.length, 1);

  // 13) ACK ≠ business
  const ack = await busB.invoke('subject.communicate', {
    action: 'acknowledge',
    envelopeId: fixedId,
  });
  assert.equal(ack.ok, true);
  const stillNoCollabFromAck = await (await CollaborationRecordStore.open(dirB)).list();
  assert.ok(!stillNoCollabFromAck.some((r) => r.events.some((e) => e.kind === 'proposed' && e.note === fixedId)));

  // 8) 双方继续了解
  const bOppId = bCard.id;
  await busB.invoke('subject.communicate', {
    action: 'continueInterest',
    opportunityId: bOppId,
  });
  await a.bus.invoke('subject.communicate', { action: 'processInbox' });
  await a.bus.invoke('subject.communicate', {
    action: 'continueInterest',
    opportunityId: sent.opportunityId,
  });
  await busB.invoke('subject.communicate', { action: 'processInbox' });

  // 披露简介
  await busB.invoke('subject.communicate', {
    action: 'discloseBrief',
    opportunityId: bOppId,
  });
  await a.bus.invoke('subject.communicate', {
    action: 'discloseBrief',
    opportunityId: sent.opportunityId,
  });

  const oppA2 = await a.bus.invoke('subject.communicate', { action: 'listOpportunities' });
  const aCard2 = oppA2.items!.find((i) => i.id === sent.opportunityId)!;
  assert.ok(['mutual_interest', 'brief_shared', 'continued'].includes(aCard2.stage));

  // 9–10) 发起协作 → 现有 propose
  // 确保 mutual
  if (aCard2.stage === 'continued') {
    // force mutual via second continue round already done; startCollaboration checks peer continue
  }
  // 提升 stage：双方 disclose 后应为 brief_shared
  const start = await a.bus.invoke('subject.communicate', {
    action: 'startCollaboration',
    opportunityId: sent.opportunityId,
    intent: '基于发现的合作机会，一起整理联合参赛方案要点。',
  });
  assert.ok(start.recordId);
  const recordsA = await (await CollaborationRecordStore.open(dirA)).list();
  assert.ok(recordsA.some((r) => r.recordId === start.recordId));

  // 16) collaboration_sync 仍工作：B 有副本
  await busB.invoke('collab.interact', { action: 'reconcile', recordId: start.recordId });
  const recordsB = await (await CollaborationRecordStore.open(dirB)).list();
  assert.ok(recordsB.some((r) => r.recordId === start.recordId));

  // 15) LocalPackageTransport 实现 SubjectTransport
  const health = await a.bus.invoke('subject.communicate', { action: 'health' });
  assert.equal(health.mode, 'local_trusted');
  assert.equal(health.reachable, true);

  // 17) capability 调用不进 opportunity
  const task = await a.runtime.submitTask({
    goal: '写一句本地优先提醒',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  assert.ok(task.taskId);
  const oppAfterTask = await a.bus.invoke('subject.communicate', { action: 'listOpportunities' });
  assert.ok(!(oppAfterTask.items || []).some((i) => i.id === task.taskId));

  // 18–19) 无第二 collab/growth store 根目录
  const entriesA = await fs.readdir(dirA);
  assert.ok(entriesA.includes('collaboration'));
  assert.ok(!entriesA.includes('collaboration-results'));
  assert.ok(!entriesA.includes('growth-alt'));
  const collabEntries = await fs.readdir(path.join(dirA, 'collaboration'));
  assert.ok(collabEntries.includes('inbox') || collabEntries.includes('opportunities') || collabEntries.includes('records'));

  // 14) restart
  await a.runtime.stop();
  await runtimeB.stop();
  const a2 = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busA2 = createCommandBus(a2);
  await a2.openPackage({ dir: dirA });
  const oppRestart = await busA2.invoke('subject.communicate', { action: 'listOpportunities' });
  assert.ok((oppRestart.items || []).some((i) => i.id === sent.opportunityId));
  await a2.stop();
});

test('SubjectTransport LocalPackageTransport is SubjectTransport-backed', async () => {
  const root = await tempDir('st');
  const dir = path.join(root, 'p');
  const rt = createDigitalMeRuntime({ documentCapability: 'fake' });
  await rt.createPackage({
    displayName: '测',
    targetDir: dir,
    initialSelfDescription: '测',
  });
  const t = new LocalPackageTransport(rt);
  const st = t.asSubjectTransport();
  const h = await st.health();
  assert.equal(h.mode, 'local_trusted');
  await rt.stop();
});

test('opportunity is derived view: inbox survives delete; rebuild from envelope; no duplicate card', async () => {
  const root = await tempDir('truth');
  const dirA = path.join(root, 'a');
  const dirB = path.join(root, 'b');
  const a = await openPkg(dirA, '甲', '提供 Agent / Digital Me 技术，寻找金融场景联合参赛。');
  await a.runtime.appendOwnerEvent({
    type: 'experience_confirmed',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: {
      title: '技术',
      detail: 'Agent / Digital Me 技术能力',
      tags: ['offering:agent_tech'],
    },
  });
  const b = await openPkg(
    dirB,
    '乙',
    '拥有成熟金融投资应用 Aivestor，希望升级 Agent / Digital Me 技术，愿意联合参赛。',
  );
  await b.runtime.appendOwnerEvent({
    type: 'experience_confirmed',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: {
      title: 'Aivestor',
      detail: '成熟金融投资应用 Aivestor；希望升级 Agent 技术；联合参赛。',
      tags: ['finance', 'Aivestor'],
    },
  });
  await b.runtime.stop();

  const sent = await a.bus.invoke('subject.communicate', {
    action: 'sendSignal',
    peerPackageDir: dirB,
    signal: {
      intent: '寻找金融 AI 场景联合参赛；可提供 Agent 技术',
      seeking: ['成熟金融应用场景', '联合参赛'],
      offering: ['Agent / Digital Me 技术能力'],
      disclosureLevel: 'minimal',
    },
  });

  const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
  const busB = createCommandBus(runtimeB);
  await runtimeB.openPackage({ dir: dirB });
  await busB.invoke('subject.communicate', { action: 'processInbox' });
  const before = await busB.invoke('subject.communicate', { action: 'listOpportunities' });
  assert.ok((before.items || []).length >= 1);
  const cardId = before.items![0]!.id;
  const oppStore = await OpportunityStore.open(dirB);
  const card = await oppStore.get(cardId);
  assert.ok(card);
  assert.equal(card!.signalEnvelopeId, sent.envelopeId);
  assert.equal(card!.derivedFrom, 'signal_envelope');

  const inbox = await InboxStore.open(dirB);
  const env = await inbox.get(sent.envelopeId!);
  assert.ok(env);
  assert.equal(env!.kind, 'signal');

  await oppStore.deleteDerived(cardId);
  assert.equal((await oppStore.list()).length, 0);
  // 原始信封仍在
  assert.ok(await inbox.get(sent.envelopeId!));

  const { SignalOpportunityHost } = await import('../signal-host');
  const host = new SignalOpportunityHost(runtimeB);
  const rebuilt = await host.rebuildDerivedFromInbox();
  assert.ok(rebuilt.rebuilt >= 1);
  const afterCards = await oppStore.list();
  assert.ok(afterCards.some((i) => i.signalEnvelopeId === sent.envelopeId));
  assert.equal(afterCards.filter((i) => i.signalEnvelopeId === sent.envelopeId).length, 1);

  // duplicate delivery 不复制 opportunity
  const transportA = new LocalPackageTransport(a.runtime).asSubjectTransport();
  const peer = await transportA.resolvePeer(dirB);
  const selfId = a.runtime.subject.requireActive().id;
  const dup = buildEnvelope({
    from: {
      subjectId: selfId,
      displayName: '甲',
      endpointRef: `subject:${selfId}`,
    },
    to: { subjectId: peer.subjectId, displayName: peer.displayName, endpointRef: peer.endpointRef },
    kind: 'signal',
    payload: {
      intent: '重复投递',
      seeking: ['成熟金融应用场景'],
      offering: ['Agent / Digital Me 技术能力'],
      disclosureLevel: 'minimal',
    },
  });
  const fixedId = sent.envelopeId!;
  dup.envelopeId = fixedId;
  dup.id = fixedId;
  const again = await transportA.send(dup);
  assert.equal(again.duplicate, true);
  await busB.invoke('subject.communicate', { action: 'processInbox' });
  const listedCards = await oppStore.list();
  assert.equal(listedCards.filter((i) => i.signalEnvelopeId === fixedId).length, 1);

  await a.runtime.stop();
  await runtimeB.stop();
});

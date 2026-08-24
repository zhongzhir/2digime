/**
 * REAL-SUBJECT-COLLABORATION-02 — 两个真正独立 Digital Me runtime 的真实 subject-to-subject loop。
 *
 * 两个隔离实例（A / B）各自独立 userData / Subject Store / runtime / capability registry，
 * 经**真实 HTTP Relay transport（A2A）** 通信；不共享对象引用、不调用对方内存函数。
 *
 * 复用现有 CollaborationProposalTerms / AuthorizationGrant / remote-subject / A2A /
 * receipt-provenance / CTO review / Growth。0 新增 Store / 0 新永久 schema / 0 新状态机。
 *
 * 验证：
 *   CASE A  能力互补：A 提议 → B 依自己 subject 评估 accept → B 自行选能力执行 →
 *           → 经 Relay 交付 + provenance → A 本地 review → Owner 获得成果。
 *   CASE B  边界冲突：A 请求触碰 B 边界 → 真实远端 B decline → A 本地 fallback，任务不死亡。
 *   最小披露：捕获 B 实际收到的网络 payload，证明只发 goal/材料/约束，不发完整 SubjectPackage。
 *   独立成长：A/B 各自形成不同经验，cross_contamination=0。
 *   failure path：远端不可达 → A 本地 fallback，用户面无协议/HTTP/内部错误。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { CollaborationRecordStore } from '../record-store';
import { GrantStore } from '../grant-store';
import { findAgreement, latestDelivery, latestTerms } from '../record-derive';
import { createRelayServer, FileRelayStore } from '../../relay-service/server';
import { createTestCommCipher, CommIdentityStore } from '../../subject-comm/identity-store';
import { remoteEndpointRef } from '../../subject-comm/endpoint';
import { InboxStore } from '../../subject-comm/inbox-store';
import { LocalCollaborationHost } from '../local-collaboration';
import { LocalPackageTransport } from '../transport';
import { RelayTransport } from '../../subject-comm/relay-transport';
import { setCommCipher } from '../../subject-comm/transport-factory';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-rsc02-${prefix}-`));
}

async function openPkg(dir: string, name: string) {
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus = createCommandBus(runtime);
  await runtime.createPackage({
    displayName: name,
    targetDir: dir,
    initialSelfDescription: `${name} 独立 runtime。`,
  });
  return { runtime, bus, dir };
}

async function listenRelay(dataDir: string): Promise<{ server: Server; relayUrl: string }> {
  await fs.mkdir(dataDir, { recursive: true });
  const store = new FileRelayStore(dataDir);
  const { server } = createRelayServer({ store, host: '127.0.0.1', port: 0 });
  const addr = await new Promise<{ port: number }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      if (a && typeof a === 'object') resolve({ port: a.port });
      else reject(new Error('no address'));
    });
    server.on('error', reject);
  });
  return { server, relayUrl: `http://127.0.0.1:${addr.port}` };
}

async function pairOnRelay(
  a: { runtime: ReturnType<typeof createDigitalMeRuntime>; bus: ReturnType<typeof createCommandBus> },
  b: { runtime: ReturnType<typeof createDigitalMeRuntime>; bus: ReturnType<typeof createCommandBus> },
  relayUrl: string,
) {
  await a.bus.invoke('subject.communicate', { action: 'configureRelay', relayUrl });
  await b.bus.invoke('subject.communicate', { action: 'configureRelay', relayUrl });
  const inviteA = await a.bus.invoke('subject.communicate', { action: 'createInvite' });
  const accepted = await b.bus.invoke('subject.communicate', {
    action: 'acceptInvite',
    inviteJson: inviteA.inviteJson!,
  });
  await a.bus.invoke('subject.communicate', {
    action: 'acceptInvite',
    inviteJson: accepted.inviteJson!,
  });
}

/** A（市场验证型）：目标=快速验证市场；允许可逆试错。 */
async function buildSubjectA(
  runtime: ReturnType<typeof createDigitalMeRuntime>,
): Promise<void> {
  await runtime.appendOwnerEvent({
    type: 'goal_updated',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: { title: '当前目标：快速验证市场', detail: '用最小可验证路径确认目标市场', tags: ['goal', '市场验证'] },
  });
  await runtime.appendOwnerEvent({
    type: 'boundary_updated',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: { title: '边界', detail: '允许小范围可逆的实验性变更', tags: ['boundary'] },
  });
}

/** B（可靠交付型）：目标=可靠交付；边界=不得直接公开发布测试结果。 */
async function buildSubjectB(
  runtime: ReturnType<typeof createDigitalMeRuntime>,
): Promise<void> {
  await runtime.appendOwnerEvent({
    type: 'goal_updated',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: { title: '当前目标：可靠产品交付', detail: '关键路径宁可慢不可错', tags: ['goal', '可靠交付'] },
  });
  await runtime.appendOwnerEvent({
    type: 'experience_confirmed',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: { title: '经验：验证门禁有效', detail: '发布前设置验证门禁显著降低回归', tags: ['document', '可靠交付'] },
  });
  await runtime.appendOwnerEvent({
    type: 'boundary_updated',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: { title: '边界', detail: '不得直接公开发布测试结果', tags: ['boundary'] },
  });
}

async function peerRef(
  dir: string,
  cipher: ReturnType<typeof createTestCommCipher>,
): Promise<string> {
  const id = new CommIdentityStore(dir, cipher);
  const peer = (await id.listPeers())[0];
  assert.ok(peer, 'peer should be paired');
  return remoteEndpointRef(peer!.endpointId);
}

/** 读取 B 实际收到的 collaboration_sync 明文 payload（网络层 E2EE 解密后）。 */
async function receivedSyncPayloads(dirB: string) {
  const inbox = await InboxStore.open(dirB);
  const items = await inbox.list();
  return items.filter((e) => e.kind === 'collaboration_sync');
}

test('REAL-SUBJECT-COLLAB-02 CASE A: A↔B 经真实 Relay 完成主体间协作 + 最小披露 + 独立成长', async () => {
  const root = await tempDir('caseA');
  const cipher = createTestCommCipher();
  setCommCipher(cipher);
  const { server, relayUrl } = await listenRelay(path.join(root, 'relay'));
  const dirA = path.join(root, 'subject-a');
  const dirB = path.join(root, 'subject-b');

  const matSpec = await (async () => {
    const p = path.join(root, 'materials', 'spec.md');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(
      p,
      '产品 X 参数：电池 5000mAh，重量 198g，屏幕 6.7 英寸 OLED，支持 5G，售价 3999 元。',
      'utf8',
    );
    return p;
  })();
  const matPrefs = await (async () => {
    const p = path.join(root, 'materials', 'private-prefs.md');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, 'A 私人偏好：喜欢蓝色，与协作无关。', 'utf8');
    return p;
  })();

  let a: Awaited<ReturnType<typeof openPkg>> | null = null;
  let b: Awaited<ReturnType<typeof openPkg>> | null = null;
  try {
    a = await openPkg(dirA, '数字之我A');
    b = await openPkg(dirB, '数字之我B');
    await buildSubjectA(a.runtime);
    await buildSubjectB(b.runtime);
    await pairOnRelay(a, b, relayUrl);

    const peerBRef = await peerRef(dirA, cipher);
    const relayA = new RelayTransport({ packageRoot: dirA, cipher, relayUrl });
    const hostA = new LocalCollaborationHost(
      a.runtime,
      new LocalPackageTransport(a.runtime, { relay: relayA }),
    );

    // A 向 B 提议（最小授权：只发 goal + 必要材料 + 约束）。
    const proposed = await hostA.propose({
      responderEndpointRef: peerBRef,
      skipAutoEvaluate: true,
      proposal: {
        intent: '请根据产品参数材料整理一份市场研究要点，并说明关键卖点。',
        expectedOutcome: '市场研究要点',
        offeredMaterials: [{ path: matSpec }],
        acceptanceCriteria: ['列出要点', '说明依据'],
        deadline: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    assert.equal(proposed.status, 'proposed');
    const recordId = proposed.recordId;

    // 最小披露：B 实际收到的网络 payload 只含 goal + 必要材料 + 约束，不含 SubjectPackage/偏好。
    await b.bus.invoke('subject.communicate', { action: 'pullRemote' });
    const syncs = await receivedSyncPayloads(dirB);
    assert.ok(syncs.length >= 1, 'B 至少收到一次 collaboration_sync');
    const payloadText = JSON.stringify(syncs);
    assert.ok(/市场研究要点/.test(payloadText), 'goal 已发送');
    assert.ok(/spec\.md/.test(payloadText), '必要材料（spec.md）已发送');
    assert.ok(!/喜欢蓝色/.test(payloadText), '无关偏好未发送');
    assert.ok(!/private-prefs/.test(payloadText), '私人偏好材料未发送');
    assert.ok(!/SubjectPackage|subject-context|userProfile|memory/.test(payloadText), '完整 SubjectPackage 未发送');

    // B 依自己 subject 评估 → accept（不触碰 B 边界）→ 成约 + 授权。
    const evaluated = await b.bus.invoke('collab.interact', {
      action: 'evaluate',
      recordId,
    });
    assert.ok(['authorized', 'agreed'].includes(String(evaluated.status)), `evaluate=${evaluated.status}`);
    assert.ok(evaluated.grantId, '成约后签发授权');

    // B 自行组织能力执行 → 经 Relay 交付 + provenance。
    const fulfilled = await b.bus.invoke('collab.interact', {
      action: 'fulfill',
      recordId,
    });
    assert.equal(fulfilled.status, 'delivered');
    assert.ok(fulfilled.artifactId, 'B 生成成果 artifact');
    assert.ok((fulfilled.artifactText || '').length >= 40, 'B 交付成果内容');

    // A 拉取并本地物化 → 本地 review（Relay 异步，轮询至物化完成）。
    await a.bus.invoke('subject.communicate', { action: 'pullRemote' });
    let stA: { status?: string; localArtifactId?: string } | null = null;
    let localArtifactId: string | undefined;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 30000) {
      await a.bus.invoke('subject.communicate', { action: 'pullRemote' }).catch(() => undefined);
      stA = await a.bus.invoke('collab.interact', { action: 'status', recordId });
      // 物化以 A 本地 Artifact 落地为准（不依赖 status 投影字段）。
      const recP = await (await CollaborationRecordStore.open(dirA)).get(recordId);
      localArtifactId = [...(recP?.events ?? [])]
        .reverse()
        .find((e) => e.localArtifactId)?.localArtifactId;
      if (stA.status === 'delivered' && localArtifactId) break;
      await new Promise((r) => setTimeout(r, 80));
    }
    assert.equal(stA?.status, 'delivered', `A status=${stA?.status}`);
    assert.ok(localArtifactId, 'A 已物化 B 的成果');
    const local = await a.runtime.getContent({ artifactId: localArtifactId! });
    assert.equal(local.artifact.provenance?.kind, 'collaboration_delivery');
    assert.equal(local.artifact.provenance?.sourceSubjectId, (await (await CollaborationRecordStore.open(dirA)).get(recordId))!.responder.subjectId);

    // A 本地 review → 采用 → Owner 获得结果。
    const decided = await a.bus.invoke('collab.interact', {
      action: 'decideResult',
      recordId,
      decision: 'accept',
      note: '研究要点清楚，采用。',
    });
    assert.equal(decided.status, 'completed');

    // 主体隔离：A 与 B 各自独立 Store；A 事实不进 B，B 事实不进 A。
    const recA = await (await CollaborationRecordStore.open(dirA)).get(recordId);
    const recB = await (await CollaborationRecordStore.open(dirB)).get(recordId);
    assert.ok(recA && recB, '双方各自持有协作记录副本');
    assert.equal(findAgreement(recA!)?.termsDigest, findAgreement(recB!)?.termsDigest);
    const grantId = recA!.events.find((e) => e.kind === 'grant_issued')?.grantId;
    assert.ok(grantId);
    assert.ok(await (await GrantStore.open(dirA)).get(grantId!));
    assert.ok(await (await GrantStore.open(dirB)).get(grantId!));

    // 独立成长：A 形成 external_accept，B 形成 fulfilled；cross_contamination=0。
    const growthA = await a.runtime.subject.listGrowthEvents();
    const growthB = await b.runtime.subject.listGrowthEvents();
    assert.ok(growthA.some((e) => (e.payload.tags || []).includes('collab:external_accept')), 'A 形成协作采用经验');
    assert.ok(growthB.some((e) => (e.payload.tags || []).includes('collab:fulfilled')), 'B 形成履行经验');
    assert.ok(!growthA.some((e) => (e.payload.tags || []).includes('collab:fulfilled')), 'A 不混入 B 的履行经验');
    assert.ok(!growthB.some((e) => (e.payload.tags || []).includes('collab:external_accept')), 'B 不混入 A 的采用经验');
  } finally {
    setCommCipher(null);
    if (a) await a.runtime.stop().catch(() => undefined);
    if (b) await b.runtime.stop().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('REAL-SUBJECT-COLLAB-02 CASE B: 真实远端 B 边界冲突 → decline → A 本地 fallback', async () => {
  const root = await tempDir('caseB');
  const cipher = createTestCommCipher();
  setCommCipher(cipher);
  const { server, relayUrl } = await listenRelay(path.join(root, 'relay'));
  const dirA = path.join(root, 'subject-a');
  const dirB = path.join(root, 'subject-b');

  const matTest = await (async () => {
    const p = path.join(root, 'materials', 'test-results.md');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, '测试结果：通过 42 项，失败 3 项；覆盖率 91%。', 'utf8');
    return p;
  })();

  let a: Awaited<ReturnType<typeof openPkg>> | null = null;
  let b: Awaited<ReturnType<typeof openPkg>> | null = null;
  try {
    a = await openPkg(dirA, '数字之我A');
    b = await openPkg(dirB, '数字之我B');
    await buildSubjectA(a.runtime);
    await buildSubjectB(b.runtime);
    await pairOnRelay(a, b, relayUrl);

    const peerBRef = await peerRef(dirA, cipher);
    const relayA = new RelayTransport({ packageRoot: dirA, cipher, relayUrl });
    const hostA = new LocalCollaborationHost(
      a.runtime,
      new LocalPackageTransport(a.runtime, { relay: relayA }),
    );

    // A 请求直接公开发布测试结果 → 触碰 B 边界。远端由 B 依自己 subject 评估。
    const proposed = await hostA.propose({
      responderEndpointRef: peerBRef,
      skipAutoEvaluate: true,
      proposal: {
        intent: '请直接公开发布测试结果给用户。',
        expectedOutcome: '已发布',
        offeredMaterials: [{ path: matTest }],
        acceptanceCriteria: ['公开发布'],
        deadline: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    assert.equal(proposed.status, 'proposed');

    // B 拉取并对该提议运行 subject 评估 → 依自身边界 reject（非 transport 预置拒绝）。
    await b.bus.invoke('subject.communicate', { action: 'pullRemote' });
    const evaluated = await b.bus.invoke('collab.interact', {
      action: 'evaluate',
      recordId: proposed.recordId,
    });
    assert.equal(evaluated.status, 'rejected', '真实远端 B 依自身边界拒绝');
    assert.ok(
      (evaluated.evaluationBasis || []).some((x: string) => x.startsWith('boundary:')),
      '拒绝依据来自 B 自身边界',
    );

    // A 拉取看到拒绝 → 无授权。
    await a.bus.invoke('subject.communicate', { action: 'pullRemote' });
    const stA = await a.bus.invoke('collab.interact', { action: 'status', recordId: proposed.recordId });
    assert.equal(stA.status, 'rejected');
    assert.ok(!stA.grantId, '拒绝时不签发授权');

    // B 不是 A 的下属 Agent：无成约授权。
    const grants = await (await GrantStore.open(dirA)).list();
    assert.ok(!grants.some((g) => g.origin.kind === 'collaboration_agreement'));

    // A 接受事实并本地 fallback → 任务不死亡。
    const fallback = await a.runtime.submitTask({
      goal: '本地整理测试结果要点并标注需要验证的风险。',
      contextRefs: [{ kind: 'file', path: matTest }],
      requestedArtifactType: 'document',
    });
    assert.ok(fallback.taskId && fallback.jobId);
    const job = await a.runtime.getJob(fallback.jobId);
    // 等待终态
    const started = Date.now();
    let st = job?.status;
    while ((st === 'queued' || st === 'running') && Date.now() - started < 30000) {
      await new Promise((r) => setTimeout(r, 50));
      st = (await a.runtime.getJob(fallback.jobId))?.status;
    }
    assert.equal(st, 'succeeded', 'A 本地 fallback 完成，协作失败未杀死任务');
    assert.ok((await a.runtime.getJob(fallback.jobId))?.artifactId);
  } finally {
    setCommCipher(null);
    if (a) await a.runtime.stop().catch(() => undefined);
    if (b) await b.runtime.stop().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('REAL-SUBJECT-COLLAB-02 failure: 远端 B 不可达 → A 本地 fallback，用户面无协议/HTTP/内部错误', async () => {
  const root = await tempDir('failure');
  const cipher = createTestCommCipher();
  setCommCipher(cipher);
  const { server, relayUrl } = await listenRelay(path.join(root, 'relay'));
  const dirA = path.join(root, 'subject-a');
  const dirB = path.join(root, 'subject-b');

  const mat = await (async () => {
    const p = path.join(root, 'materials', 'brief.md');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, '市场简讯：目标用户对快速可验证方案有明确需求。', 'utf8');
    return p;
  })();

  let a: Awaited<ReturnType<typeof openPkg>> | null = null;
  let b: Awaited<ReturnType<typeof openPkg>> | null = null;
  try {
    a = await openPkg(dirA, '数字之我A');
    b = await openPkg(dirB, '数字之我B');
    await buildSubjectA(a.runtime);
    await pairOnRelay(a, b, relayUrl);

    // 中断 transport：关闭 Relay，远端 B 不可达。
    await new Promise<void>((resolve) => server.close(() => resolve()));

    // A 检查远端可达性 → 不可达。
    const health = await a.bus.invoke('subject.communicate', { action: 'health' });
    assert.equal(health.reachable, false, '远端不可达');

    // A 本地 fallback 完成目标（用户面自然结果，不暴露协议/HTTP/内部错误）。
    const fallback = await a.runtime.submitTask({
      goal: '整理市场简讯要点，说明关键信息。',
      contextRefs: [{ kind: 'file', path: mat }],
      requestedArtifactType: 'document',
    });
    assert.ok(fallback.taskId && fallback.jobId);
    const started = Date.now();
    let st = (await a.runtime.getJob(fallback.jobId))?.status;
    while ((st === 'queued' || st === 'running') && Date.now() - started < 30000) {
      await new Promise((r) => setTimeout(r, 50));
      st = (await a.runtime.getJob(fallback.jobId))?.status;
    }
    assert.equal(st, 'succeeded', '远端不可达时 A 本地 fallback 完成');
    const jobFinal = await a.runtime.getJob(fallback.jobId);
    const content = await a.runtime.getContent({ artifactId: jobFinal!.artifactId! });
    const userText = content.text || '';
    assert.ok(userText.length >= 20, '用户面有自然结果');
    // 用户面文档不得裸露协议/HTTP/内部错误。
    assert.ok(!/HTTP|Relay|relay|adapter|A2A|ECONNREFUSED|Error:|stack|failed|失败/i.test(userText), '用户面不暴露协议/HTTP/内部错误');
  } finally {
    setCommCipher(null);
    if (a) await a.runtime.stop().catch(() => undefined);
    if (b) await b.runtime.stop().catch(() => undefined);
  }
});

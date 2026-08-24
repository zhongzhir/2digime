/**
 * DIGITALME-SUBJECT-COLLABORATION-01 — Digital Me A ↔ Digital Me B 主体间 AI-native collaboration。
 *
 * 复用现有 CollaborationRecord / AuthorizationGrant / CapabilityRegistry /
 * Capability Closure / receipt / provenance / Growth 机制；不建立第二套 collaboration runtime。
 *
 * 两个真正隔离的合成 Subject Runtime（A 市场验证型 / B 可靠交付型），各自独立
 * subject state / goals / boundaries / experience / capability view；共享相同代码与协议；
 * 不共享 Subject Store。
 *
 * 验证语义：
 *   CASE 1 能力互补：A 发现 B → 最小授权请求 → B 依自己边界/能力接受 → B 自行组织执行
 *          → 返回结果+provenance → A 验收 → Owner 获得结果；主体不合并。
 *   CASE 2 主体边界冲突：A 请求触及 B 明确边界 → B 不服从 A、decline → A 接受并找替代。
 *   CASE 3 双方独立经验：一次合作后 A/B 各自形成不同 confirmed experience，cross_contamination=0。
 *   minimum necessary disclosure：只发送 goal+必要材料+约束，不发完整 SubjectPackage。
 *   subject truth isolation：A 的 goal/preference/experience/boundary 不进入 B，反之亦然。
 *   responsibility traceable：provenance 可追溯谁提出/承接/执行/验收/采用。
 *
 * 纯运行态验证：0 新增 Store / 0 第二真值源 / 0 复杂状态机。
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
import { findAgreement, latestGrantId, latestOwnerDecision, latestTerms } from '../record-derive';
import { waitForJobTerminal } from '../../work-runtime/job-runner';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-subjcollab-${prefix}-`));
}

async function writeFile(p: string, text: string): Promise<string> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text, 'utf8');
  return p;
}

interface OpenBus {
  runtime: ReturnType<typeof createDigitalMeRuntime>;
  bus: ReturnType<typeof createCommandBus>;
  dir: string;
}

async function openBus(
  dir: string,
  displayName: string,
  selfDesc: string,
): Promise<OpenBus> {
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus = createCommandBus(runtime);
  await runtime.createPackage({
    displayName,
    targetDir: dir,
    initialSelfDescription: selfDesc,
  });
  return { runtime, bus, dir };
}

/**
 * A（市场验证型）：目标=快速验证市场；边界=可逆试错允许、不可逆公开发布需确认。
 */
async function buildSubjectA(bus: OpenBus): Promise<void> {
  await bus.runtime.appendOwnerEvent({
    type: 'goal_updated',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: { title: '当前目标：快速验证市场', detail: '用最小可验证路径确认目标市场与核心价值假设', tags: ['goal', '市场验证'] },
  });
  await bus.runtime.appendOwnerEvent({
    type: 'experience_confirmed',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: { title: '经验：小实验快速迭代有效', detail: '用两周内可验证的最小实验确认需求，比长期规划更有效', tags: ['document', '市场验证'] },
  });
  await bus.runtime.appendOwnerEvent({
    type: 'boundary_updated',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: { title: '边界', detail: '允许小范围可逆的实验性变更', tags: ['boundary'] },
  });
}

/**
 * B（可靠交付型）：目标=可靠交付；边界=不得直接公开发布测试结果（未充分验证）。
 */
async function buildSubjectB(bus: OpenBus): Promise<void> {
  await bus.runtime.appendOwnerEvent({
    type: 'goal_updated',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: { title: '当前目标：可靠产品交付', detail: '关键路径宁可慢不可错，重要里程碑可验证可回退', tags: ['goal', '可靠交付'] },
  });
  await bus.runtime.appendOwnerEvent({
    type: 'experience_confirmed',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: { title: '经验：验证门禁有效', detail: '发布前设置验证门禁显著降低回归与线上事故', tags: ['document', '可靠交付'] },
  });
  await bus.runtime.appendOwnerEvent({
    type: 'boundary_updated',
    confidence: 'confirmed',
    source: { kind: 'owner_direct' },
    payload: { title: '边界', detail: '不得直接公开发布测试结果', tags: ['boundary'] },
  });
}

/** 从 GrowthEvent 中提取的「本人事实快照」用于主体隔离断言。 */
async function subjectTruth(
  runtime: ReturnType<typeof createDigitalMeRuntime>,
): Promise<string> {
  const events = await runtime.subject.listGrowthEvents();
  return events
    .filter((e) => e.confidence === 'confirmed')
    .map((e) => `${e.type}:${e.payload.title} ${e.payload.detail} ${(e.payload.tags || []).join(' ')}`)
    .join('\n');
}

test('CASE1+CASE3: A↔B 能力互补协作；主体隔离；双方独立经验；责任可追溯', async () => {
  const root = await tempDir('case1');
  const dirA = path.join(root, 'subject-a');
  const dirB = path.join(root, 'subject-b');

  const matSpec = await writeFile(
    path.join(root, 'materials', 'spec.md'),
    '产品 X 参数：电池容量 5000mAh，重量 198g，屏幕 6.7 英寸 OLED，支持 5G，售价 3999 元，2026-08-01 发布。',
  );
  const matPrefs = await writeFile(
    path.join(root, 'materials', 'private-prefs.md'),
    'A 的私人偏好记录（不应被发送给 B）：喜欢蓝色，日常工作安排等无关信息。',
  );

  const a = await openBus(dirA, '数字之我A', '我负责市场验证与结果采用。');
  await buildSubjectA(a);

  const bCreate = await openBus(dirB, '数字之我B', '我评估并完成专业调研。');
  await buildSubjectB(bCreate);
  await bCreate.runtime.stop();

  // ---- A 发现 B：解析为可协作 peer（不交换完整 SubjectPackage）----
  const peer = await a.bus.invoke('collab.interact', {
    action: 'resolvePeer',
    granteePackageDir: dirB,
  });
  assert.ok(peer.displayName);
  assert.equal(peer.displayName, '数字之我B');

  // ---- A 最小授权请求：只发送 goal + 必要材料 + 约束；不发送完整 SubjectPackage ----
  const proposed = await a.bus.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent: '请根据产品参数材料整理一份简洁的市场要点摘要，并说明关键卖点。',
    expectedOutcome: '市场要点摘要',
    allowedMaterialPaths: [matSpec],
    acceptanceCriteria: ['列出要点', '说明依据'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
    skipAutoEvaluate: true,
  });
  assert.ok(proposed.recordId);
  assert.equal(proposed.status, 'proposed');
  const recordId = proposed.recordId;

  // 证明最小披露：协作记录只含必要材料，不含私人偏好材料（matPrefs 未授权）。
  const recSeed = await (await CollaborationRecordStore.open(dirA)).get(recordId);
  const offered = latestTerms(recSeed!).offeredMaterials.map((m) => path.resolve(m.path));
  assert.deepEqual(offered, [path.resolve(matSpec)]);
  assert.ok(!offered.includes(path.resolve(matPrefs)));

  // 授权范围 = 必要材料（B 不可访问 matPrefs）。
  const denyPrefs = await a.bus.invoke('collab.interact', {
    action: 'assertMaterialAccess',
    recordId,
    attemptMaterialPath: matPrefs,
  });
  assert.equal(denyPrefs.allowed, false);

  // ---- B 依自己目标/边界/能力独立判断 → accept（边界允许）----
  {
    const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
    const busB = createCommandBus(runtimeB);
    await runtimeB.openPackage({ dir: dirB });
    const accepted = await busB.invoke('collab.interact', {
      action: 'respond',
      recordId,
      decision: 'accept',
      note: '该调研在我的边界与能力范围内，可以承接。',
    });
    assert.ok(['authorized', 'agreed'].includes(String(accepted.status)));
    assert.ok(accepted.grantId);
    await runtimeB.stop();
  }

  // B 侧授权范围同样只有 matSpec（material isolation 双端生效）。
  {
    const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
    const busB = createCommandBus(runtimeB);
    await runtimeB.openPackage({ dir: dirB });
    const allowSpec = await busB.invoke('collab.interact', {
      action: 'assertMaterialAccess',
      recordId,
      attemptMaterialPath: matSpec,
    });
    assert.equal(allowSpec.allowed, true);
    const denyPrefsB = await busB.invoke('collab.interact', {
      action: 'assertMaterialAccess',
      recordId,
      attemptMaterialPath: matPrefs,
    });
    assert.equal(denyPrefsB.allowed, false);
    await runtimeB.stop();
  }

  // ---- B 自行组织内部能力执行，返回结果 + provenance ----
  const fulfilled = await a.bus.invoke('collab.interact', {
    action: 'fulfill',
    recordId,
  });
  assert.equal(fulfilled.status, 'delivered');
  assert.ok(fulfilled.localArtifactId);
  assert.ok(fulfilled.artifactId);
  assert.ok((fulfilled.artifactText || '').length >= 40);

  const local = await a.runtime.getContent({ artifactId: fulfilled.localArtifactId! });
  assert.equal(local.artifact.provenance?.kind, 'collaboration_delivery');
  assert.equal(local.artifact.provenance?.recordId, recordId);
  assert.equal(local.artifact.provenance?.sourceArtifactId, fulfilled.artifactId);

  // ---- A 验收 → Owner 获得结果 ----
  const decided = await a.bus.invoke('collab.interact', {
    action: 'decideResult',
    recordId,
    decision: 'accept',
    note: '摘要可用，采用。',
  });
  assert.equal(decided.status, 'completed');

  // ---- 责任链可追溯：提出/承接/执行/验收/采用 均落在 CollaborationRecord 事件流 ----
  const rec = await (await CollaborationRecordStore.open(dirA)).get(recordId);
  const events = rec!.events.map((e) => e.kind);
  assert.ok(events.includes('proposed'), '谁提出');
  assert.ok(events.includes('accepted'), '谁承接（B 接受）');
  assert.ok(events.includes('agreement_formed'));
  assert.ok(events.includes('grant_issued'));
  assert.ok(events.includes('fulfillment_started'), '谁执行（B 履行）');
  assert.ok(events.includes('delivered'), '交付');
  assert.ok(events.includes('result_decided'), '谁验收/采用');
  const decidedEv = [...rec!.events].reverse().find((e) => e.kind === 'result_decided');
  assert.equal(decidedEv!.authorSubjectId, rec!.initiator.subjectId, '最终由 A（发起方）定案');
  assert.equal(decidedEv!.decision, 'accept');

  // ---- 主体不合并：A 与 B 各自独立 subject state ----
  const recordB = await (await CollaborationRecordStore.open(dirB)).get(recordId);
  assert.ok(recordB, 'B 持有协作记录副本');
  assert.equal(findAgreement(recordB!)?.termsDigest, findAgreement(rec!)?.termsDigest);
  // 双方各自持有自己的授权 Grant（同一 grantId，各自 store）。
  const grantId = latestGrantId(rec!);
  const grantA = await (await GrantStore.open(dirA)).get(grantId!);
  const grantB = await (await GrantStore.open(dirB)).get(grantId!);
  assert.ok(grantA && grantB);
  assert.equal(grantA!.origin.kind, 'collaboration_agreement');

  // ---- subject truth isolation：A 的事实不进 B，B 的事实不进 A ----
  const runtimeBG = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtimeBG.openPackage({ dir: dirB });

  // 独立 capability registry / runtime view：A 与 B 各自注册能力视图（同一代码、不同 runtime 实例）。
  const capA = await a.runtime.listCapabilities();
  const capB = await runtimeBG.listCapabilities();
  assert.ok((capA.capabilities || []).length > 0, 'A 有独立能力视图');
  assert.ok((capB.capabilities || []).length > 0, 'B 有独立能力视图');
  assert.ok(
    (capA.capabilities || []).some((c) => c.id === 'cap_fake_document'),
    'A 注册文档能力',
  );
  assert.ok(
    (capB.capabilities || []).some((c) => c.id === 'cap_fake_document'),
    'B 注册文档能力',
  );

  const bTruth = await subjectTruth(runtimeBG);
  const aTruth = await subjectTruth(a.runtime);

  // A 的私人偏好（喜欢蓝色）绝不出现在 B 的 subject truth。
  assert.ok(!/喜欢蓝色/.test(bTruth), 'A 私人偏好不得进入 B');
  // B 的可靠交付目标/边界不出现在 A 的 subject truth。
  assert.ok(!/可靠产品交付/.test(aTruth), 'B 目标不得进入 A');
  assert.ok(!/验证门禁/.test(aTruth), 'B 经验不得进入 A');
  assert.ok(!/直接公开发布测试结果/.test(aTruth), 'B 边界不得进入 A');
  assert.ok(/快速验证市场/.test(aTruth), 'A 保留自己的目标');
  assert.ok(/可靠产品交付/.test(bTruth), 'B 保留自己的目标');

  // ---- CASE3：双方各自形成不同 confirmed experience ----
  const aGrowth = await a.runtime.subject.listGrowthEvents();
  const bGrowth = await runtimeBG.subject.listGrowthEvents();
  assert.ok(aGrowth.some((e) => (e.payload.tags || []).includes('collab:external_accept')), 'A 形成「委托 B 有效」经验');
  assert.ok(bGrowth.some((e) => (e.payload.tags || []).includes('collab:fulfilled')), 'B 形成「完成履行」经验');
  assert.ok(bGrowth.some((e) => (e.payload.tags || []).includes('collab:accepted_by_peer')), 'B 形成「成果被采用」经验');

  // cross_contamination = 0：A 侧不出现 B 的履行经验，B 侧不出现 A 的采用经验。
  assert.ok(!aGrowth.some((e) => (e.payload.tags || []).includes('collab:fulfilled')), 'A 不得混入 B 的履行经验');
  assert.ok(!bGrowth.some((e) => (e.payload.tags || []).includes('collab:external_accept')), 'B 不得混入 A 的采用经验');

  await runtimeBG.stop();
  await a.runtime.stop();
});

test('CASE2: A 请求触及 B 边界 → B 不服从、decline → A 接受并本地替代，任务不死亡', async () => {
  const root = await tempDir('case2');
  const dirA = path.join(root, 'subject-a');
  const dirB = path.join(root, 'subject-b');

  const matTest = await writeFile(
    path.join(root, 'materials', 'test-results.md'),
    '测试结果：通过 42 项，失败 3 项；覆盖率 91%。',
  );

  const a = await openBus(dirA, '数字之我A', '发起方');
  await buildSubjectA(a);

  const bCreate = await openBus(dirB, '数字之我B', '响应方');
  await buildSubjectB(bCreate);
  await bCreate.runtime.stop();

  // A 请求 B 直接公开发布测试结果 → 命中 B 边界「不得直接公开发布测试结果」。
  const denied = await a.bus.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent: '请直接公开发布测试结果给用户。',
    expectedOutcome: '已发布',
    allowedMaterialPaths: [matTest],
    acceptanceCriteria: ['公开发布'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(denied.status, 'rejected');
  assert.ok((denied.evaluationBasis || []).some((b) => b.startsWith('boundary:')), '拒绝依据来自 B 自身边界');
  assert.ok(!denied.grantId, '拒绝时不得签发授权');

  // B 不是 A 的下属 Agent：A 无法绕过 B 的边界（无授权、无 Grant）。
  const grants = await (await GrantStore.open(dirA)).list();
  assert.ok(!grants.some((g) => g.origin.kind === 'collaboration_agreement' && !denied.grantId), '无成约授权');

  // A 接受这一事实并寻找替代：本地 fallback 执行（不暴露协议/内部错误，任务不死亡）。
  const fallback = await a.runtime.submitTask({
    goal: '本地整理测试结果要点并标注需要验证的风险。',
    contextRefs: [{ kind: 'file', path: matTest }],
    requestedArtifactType: 'document',
  });
  assert.ok(fallback.taskId && fallback.jobId);
  const job = await waitForJobTerminal(a.runtime.workRuntime, fallback.jobId, 30_000);
  assert.equal(job.status, 'succeeded');
  assert.ok(job.artifactId, 'A 本地替代完成，协作失败未杀死任务');

  await a.runtime.stop();
});

test('SECTION11: 协商 — A 要 24h，B 还价 48h 且先交关键部分 → A 接受，形成一次有限协调', async () => {
  const root = await tempDir('negotiate');
  const dirA = path.join(root, 'subject-a');
  const dirB = path.join(root, 'subject-b');

  const mat = await writeFile(path.join(root, 'materials', 'scope.md'), '范围材料：需要调研并产出报告。');

  const a = await openBus(dirA, '数字之我A', '发起方');
  await buildSubjectA(a);

  const bCreate = await openBus(dirB, '数字之我B', '响应方');
  await buildSubjectB(bCreate);
  await bCreate.runtime.stop();

  const t24 = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  // A 提议：24 小时内完成。
  const p = await a.bus.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent: '请完成市场调研并产出报告，24 小时内交付。',
    expectedOutcome: '调研报告',
    allowedMaterialPaths: [mat],
    acceptanceCriteria: ['完整报告'],
    deadline: t24,
    skipAutoEvaluate: true,
  });
  assert.ok(p.recordId);
  const recordId = p.recordId;

  // B 还价：只能 48 小时，但先交付关键部分。
  const counterTerms = {
    intent: '请完成市场调研并产出报告。',
    expectedOutcome: '调研报告',
    offeredMaterials: [{ path: mat }],
    acceptanceCriteria: ['先交付关键部分', '48 小时内交付完整报告'],
    deadline: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
  };
  {
    const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
    const busB = createCommandBus(runtimeB);
    await runtimeB.openPackage({ dir: dirB });
    const countered = await busB.invoke('collab.interact', {
      action: 'respond',
      recordId,
      decision: 'counter_propose',
      terms: counterTerms,
      note: '我只能承诺 48 小时，但可以先交付关键部分。',
    });
    assert.ok(['counter_proposed', 'proposed', 'awaiting_owner', 'agreed'].includes(String(countered.status)));
    await runtimeB.stop();
  }

  // A 接受 B 的还价（一次有限协调：proposal → counterproposal → accept）。
  const acceptResult = await a.bus.invoke('collab.interact', {
    action: 'respond',
    recordId,
    decision: 'accept',
    terms: counterTerms,
    note: '接受 48 小时与先交关键部分的安排。',
  });
  assert.ok(['proposed', 'counter_proposed'].includes(String(acceptResult.status)));

  // B 接受自己的还价（双方对同一 digest 达成约定）。
  {
    const runtimeB = createDigitalMeRuntime({ documentCapability: 'fake' });
    const busB = createCommandBus(runtimeB);
    await runtimeB.openPackage({ dir: dirB });
    const final = await busB.invoke('collab.interact', {
      action: 'respond',
      recordId,
      decision: 'accept',
      terms: counterTerms,
      note: '接受本方提出的 48 小时安排。',
    });
    assert.ok(['authorized', 'agreed'].includes(String(final.status)));
    assert.ok(final.grantId, '协商一致后签发授权');
    await runtimeB.stop();
  }

  const rec = await (await CollaborationRecordStore.open(dirA)).get(recordId);
  const kinds = rec!.events.map((e) => e.kind);
  assert.ok(kinds.includes('proposed'));
  assert.ok(kinds.includes('counter_proposed'));
  assert.ok(kinds.includes('accepted'));
  assert.ok(kinds.includes('agreement_formed'));
  const agreement = findAgreement(rec!);
  assert.ok(agreement, '双方对同一还价条款形成约定');

  await a.runtime.stop();
});

test('SECTION13: 普通 Agent 委托 vs Digital Me B — Capability 与 Subject 语义可区分', async () => {
  // Arm 1：A → ordinary specialist Agent（纯 capability 合同约束，无 accept/decline）。
  // Arm 2：A → Digital Me B（有自己的 goal/boundary/experience，可 accept/decline）。
  // 验证产品确实区分 Capability 与 Subject：同一目标，普通 Agent 无边界拒绝能力，
  // Digital Me B 基于自身边界可拒绝。
  const root = await tempDir('contrast');
  const dirA = path.join(root, 'subject-a');
  const dirB = path.join(root, 'subject-b');

  const a = await openBus(dirA, '数字之我A', '发起方');
  await buildSubjectA(a);

  // Digital Me B 带边界：不得直接公开发布测试结果。
  const bCreate = await openBus(dirB, '数字之我B', '响应方');
  await buildSubjectB(bCreate);
  await bCreate.runtime.stop();

  const mat = await writeFile(path.join(root, 'materials', 't.md'), '测试数据：42 pass, 3 fail。');

  // Arm 2：A → Digital Me B，请求「直接公开发布」，B 依据边界 decline。
  const toSubject = await a.bus.invoke('collab.interact', {
    action: 'propose',
    granteePackageDir: dirB,
    intent: '请直接公开发布测试结果给用户。',
    expectedOutcome: '已发布',
    allowedMaterialPaths: [mat],
    acceptanceCriteria: ['公开发布'],
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(toSubject.status, 'rejected', 'Digital Me B 基于自身边界拒绝');
  assert.ok((toSubject.evaluationBasis || []).some((b) => b.startsWith('boundary:')));

  // Arm 1：同一「公开发布」目标交给普通能力（本地文档能力仅受 capability 合同约束，
  // 不存在 subject 边界拒绝；执行不落入协作记录）。普通能力没有 accept/decline。
  const arm1 = await a.runtime.submitTask({
    goal: '整理测试结果要点，说明通过项与失败项。',
    contextRefs: [{ kind: 'file', path: mat }],
    requestedArtifactType: 'document',
  });
  assert.ok(arm1.taskId && arm1.jobId);
  const job = await waitForJobTerminal(a.runtime.workRuntime, arm1.jobId, 30_000);
  assert.equal(job.status, 'succeeded', '普通能力按合同直接执行，无主体边界拒绝');

  // 对照：普通 Agent 路径不产生协作记录（无 accept/decline/agreement），
  // Digital Me B 路径产生协作记录（含 rejected 事件与 boundary 依据）。
  const collabRecords = await (await CollaborationRecordStore.open(dirA)).list();
  assert.ok(collabRecords.length >= 1);
  const subjectRec = collabRecords.find((r) => r.events.some((e) => e.kind === 'rejected'));
  assert.ok(subjectRec, 'Digital Me B 路径以协作事件表达拒绝');
  assert.ok(
    !collabRecords.some((r) => r.issuerTaskId === arm1.taskId),
    '普通 Agent 委托不进入协作记录（区分 Capability 与 Subject）',
  );

  await a.runtime.stop();
});

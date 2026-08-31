/**
 * 任务对话身份捕获：captureKey 必须按本轮 userTurnId 逐轮唯一，
 * 同一任务的第二次姓名纠正进入 supersede，而不是被当成重复捕获跳过。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { workConverseIdentityCaptureKey } from '../../work-runtime/work-converse';
import { distillCandidatesFromText, extractExplicitSelfName } from '../../subject-core/candidate-distill';
import { applyCorrectionSupersede } from '../../subject-core/correction-supersede';
import type { GrowthEvent } from '../../subject-core/growth-event';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-idcap-${prefix}-`));
}

async function waitFor(fn: () => Promise<boolean>, label: string, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout: ${label}`);
}

test('extractExplicitSelfName 识别纠正性「应该叫」', () => {
  assert.equal(extractExplicitSelfName('我叫张三'), '张三');
  assert.equal(extractExplicitSelfName('不是，应该叫李四'), '李四');
  assert.equal(extractExplicitSelfName('这个函数应该叫 parse'), null);
});

test('同一任务先「我叫张三」再「不是，应该叫李四」，第二次进入 supersede', async () => {
  const distilled = distillCandidatesFromText({
    subjectId: 'subj_x',
    text: '不是，应该叫李四',
    sourceKind: 'conversation',
  });
  assert.ok(distilled.some((e) => e.type === 'identity_clarified' && e.payload.detail.includes('李四')));

  const dir = await tempDir('correct');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '测试', targetDir: path.join(dir, 'pkg') });

  const first = await runtime.converse({ text: '我叫张三' });
  assert.ok(first.userTurnId, '第一轮必须返回 userTurnId');
  const firstKey = `captureKey:${workConverseIdentityCaptureKey(first.userTurnId)}`;
  await waitFor(async () => {
    const events = await runtime.subject.listGrowthEvents();
    const facts = ((await runtime.getOverview()).userVisibleFacts || [])
      .map((f: { text: string }) => f.text)
      .join('\n');
    return (
      events.some(
        (e) =>
          e.type === 'identity_clarified' &&
          e.confidence === 'confirmed' &&
          (e.payload.tags || []).includes(firstKey),
      ) && /张三/.test(facts)
    );
  }, '第一轮姓名进入已经了解');

  const old = (await runtime.subject.listGrowthEvents()).find(
    (e) => e.type === 'identity_clarified' && e.payload.detail.includes('张三') && e.confidence === 'confirmed',
  );
  assert.ok(old, '应已确认张三');

  const second = await runtime.converse({ taskId: first.taskId, text: '不是，应该叫李四' });
  assert.ok(second.userTurnId);
  assert.notEqual(second.userTurnId, first.userTurnId);
  const secondKey = `captureKey:${workConverseIdentityCaptureKey(second.userTurnId)}`;
  await waitFor(async () => {
    const events = await runtime.subject.listGrowthEvents();
    return events.some(
      (e) =>
        e.type === 'identity_clarified' &&
        e.payload.detail.includes('李四') &&
        (e.payload.tags || []).includes(secondKey) &&
        e.payload.relation?.supersedes === old!.id,
    );
  }, '第二次进入 supersede 链');

  const li = (await runtime.subject.listGrowthEvents()).find(
    (e) => e.type === 'identity_clarified' && e.payload.detail.includes('李四'),
  );
  assert.equal(li?.payload.relation?.supersedes, old!.id);
  await waitFor(async () => {
    const derived = await runtime.subject.getDerived();
    const facts = ((await runtime.getOverview()).userVisibleFacts || [])
      .map((f: { text: string }) => f.text)
      .join('\n');
    return derived.inactiveEventIds.includes(old!.id) && /李四/.test(facts) && !/张三/.test(facts);
  }, '李四取代张三');
  await runtime.stop();
});

test('重放同一个 turnId 不得重复写入', async () => {
  const dir = await tempDir('replay');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '测试', targetDir: path.join(dir, 'pkg') });
  const first = await runtime.converse({ text: '我叫张三' });
  assert.ok(first.userTurnId);
  const key = workConverseIdentityCaptureKey(first.userTurnId);
  const keyTag = `captureKey:${key}`;
  await waitFor(async () => {
    const events = await runtime.subject.listGrowthEvents();
    return events.some(
      (e) =>
        e.type === 'identity_clarified' &&
        e.confidence === 'confirmed' &&
        (e.payload.tags || []).includes(keyTag),
    );
  }, '等待首次捕获');
  const before = (await runtime.subject.listGrowthEvents()).filter((e) =>
    (e.payload.tags || []).includes(keyTag),
  ).length;
  const replay = await runtime.captureSubjectInput({
    text: '我叫张三',
    sourceKind: 'conversation',
    taskId: first.taskId,
    captureKey: key,
  });
  assert.equal(replay.idempotent, true);
  const after = (await runtime.subject.listGrowthEvents()).filter((e) =>
    (e.payload.tags || []).includes(keyTag),
  ).length;
  assert.equal(after, before);
  await runtime.stop();
});

test('不同 turnId 的两次身份说明不得互相阻断', async () => {
  const dir = await tempDir('turns');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '测试', targetDir: path.join(dir, 'pkg') });
  const first = await runtime.converse({ text: '我叫张三' });
  assert.ok(first.userTurnId);
  await waitFor(async () => {
    const events = await runtime.subject.listGrowthEvents();
    return events.some(
      (e) =>
        e.type === 'identity_clarified' &&
        e.confidence === 'confirmed' &&
        e.payload.detail.includes('张三'),
    );
  }, '等待张三');
  const second = await runtime.converse({ taskId: first.taskId, text: '我叫王五' });
  assert.ok(second.userTurnId);
  assert.notEqual(second.userTurnId, first.userTurnId);
  const wangKey = `captureKey:${workConverseIdentityCaptureKey(second.userTurnId)}`;
  await waitFor(async () => {
    const events = await runtime.subject.listGrowthEvents();
    return events.some(
      (e) =>
        e.type === 'identity_clarified' &&
        e.payload.detail.includes('王五') &&
        (e.payload.tags || []).includes(wangKey),
    );
  }, '等待王五，不得被第一轮 captureKey 阻断');
  const names = (await runtime.subject.listGrowthEvents()).filter((e) => e.type === 'identity_clarified');
  assert.ok(names.some((e) => e.payload.detail.includes('张三')));
  assert.ok(names.some((e) => e.payload.detail.includes('王五')));
  await runtime.stop();
});

test('高风险身份仍需确认', async () => {
  const dir = await tempDir('risk');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '测试', targetDir: path.join(dir, 'pkg') });
  const cap = await runtime.captureSubjectInput({
    text: '我叫张三，身份证 110101199001011234',
    sourceKind: 'conversation',
    captureKey: workConverseIdentityCaptureKey('turn_high_risk_id'),
  });
  const identity = (await runtime.subject.listGrowthEvents()).find((e) => e.type === 'identity_clarified');
  assert.ok(identity);
  assert.notEqual(identity!.confidence, 'confirmed');
  assert.ok(
    (cap.confirmationSuggestedEventIds || []).includes(identity!.id) ||
      identity!.payload.tags?.includes('needs_confirmation'),
    `高风险身份应待确认，tags=${(identity!.payload.tags || []).join(',')}`,
  );
  const facts = ((await runtime.getOverview()).userVisibleFacts || [])
    .map((f: { text: string }) => f.text)
    .join('\n');
  assert.doesNotMatch(facts, /110101199001011234/);
  await runtime.stop();
});

test('applyCorrectionSupersede 对 self_name 写入 supersedes', () => {
  const oldConfirmed: GrowthEvent = {
    id: 'ge_old',
    subjectId: 'subj_x',
    occurredAt: '2026-01-01T00:00:00.000Z',
    type: 'identity_clarified',
    source: { kind: 'owner_direct' },
    payload: {
      title: '姓名',
      detail: '张三',
      tags: ['self_name', '身份'],
    },
    confidence: 'confirmed',
  };
  const candidate: GrowthEvent = {
    id: 'ge_new',
    subjectId: 'subj_x',
    occurredAt: '2026-01-02T00:00:00.000Z',
    type: 'identity_clarified',
    source: { kind: 'owner_direct' },
    payload: {
      title: '姓名',
      detail: '李四',
      tags: ['self_name', '身份', 'silent_ok'],
    },
    confidence: 'candidate',
  };
  const { changed } = applyCorrectionSupersede({
    text: '不是，应该叫李四',
    events: [candidate],
    existingEvents: [oldConfirmed],
  });
  assert.equal(changed, 1);
  assert.equal(candidate.payload.relation?.supersedes, 'ge_old');
});

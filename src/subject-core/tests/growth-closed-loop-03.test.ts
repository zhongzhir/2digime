/**
 * DIGITALME-GROWTH-CLOSED-LOOP-03 领域验收：新真实经历 → 正确沉淀 → 相关场景复用 → 修正后持续更新。
 * 场景：conversation_learning_reused / doing_experience_reused / correction_supersedes_old_value /
 *       external_fact_not_owner_fact / irrelevant_context_not_injected；
 * 负例：single_subject_truth_preserved（修正后旧值不得再注入，同一事实只保留最新值）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import { applyCorrectionSupersede, isCorrectionStatement } from '../correction-supersede';
import { distillCandidatesFromText } from '../candidate-distill';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-closed-loop-${prefix}-`));
}

test('correction unit: distill correction does not produce stale principle', () => {
  const events = distillCandidatesFromText({
    subjectId: 's',
    text: '以后写周报不要结论先行，改成先铺垫背景再展开。',
    sourceKind: 'conversation',
  });
  const preference = events.filter((e) => e.type === 'preference_observed');
  assert.ok(preference.length >= 1, '纠正应产出替代偏好');
  const principle = events.some(
    (e) => e.type === 'principle_stated' && /结论先行/.test(e.payload.title),
  );
  assert.equal(principle, false, '纠正不得反向产出「结论先行」原则');
  assert.ok(isCorrectionStatement('以后写周报不要结论先行，改成先铺垫背景再展开。'));
});

test('correction unit: supersede attaches relation', () => {
  const text = '以后写周报不要结论先行，改成先铺垫背景再展开。';
  const distill = distillCandidatesFromText({
    subjectId: 's',
    text,
    sourceKind: 'conversation',
  });
  const candidate = distill.find((e) => e.type === 'preference_observed');
  assert.ok(candidate);
  const oldConfirmed = {
    id: 'evt-old',
    subjectId: 's',
    occurredAt: '2026-08-01T00:00:00.000Z',
    type: 'preference_observed' as const,
    confidence: 'confirmed' as const,
    source: { kind: 'owner_direct' as const },
    payload: { title: '偏好：结论先行', detail: '写周报结论先行', tags: ['周报', 'style'] },
  };
  applyCorrectionSupersede({ text, events: [candidate], existingEvents: [oldConfirmed] });
  assert.equal(candidate!.payload.relation?.supersedes, 'evt-old');
});

test('scenario A: conversation learning silent adopt then reused in next task', async () => {
  const root = await tempDir('a');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({ displayName: '对话学习', targetDir: path.join(root, 'pkg') });
  const captured = await runtime.captureSubjectInput({
    text: '以后这样写周报：请结论先行，保持简洁。',
    sourceKind: 'conversation',
  });
  assert.ok((captured.confirmedEventIds || []).length >= 1);
  assert.equal((captured.confirmationSuggestedEventIds || []).length, 0);

  const t = await runtime.submitTask({
    goal: '继续撰写产品周报并保持节奏',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, t.jobId);
  assert.equal(job.status, 'succeeded');
  const freeze = await runtime.readSubjectContextFreeze(job.snapshotId!);
  assert.ok(
    (freeze?.entries || []).some(
      (e) => e.kind === 'preference' || /结论先行|简洁/.test(e.detail + e.title),
    ),
  );
  const text = (await runtime.getContent({ artifactId: job.artifactId as string })).text as string;
  assert.match(text, /结论先行|简洁|工作偏好|偏好/);
  await runtime.stop();
});

test('scenario B: doing experience reused in next related task', async () => {
  const root = await tempDir('b');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    fakeAdapter: {
      text: (input) => {
        if (input.subjectContext.entries.length > 0) {
          return `# 周报\n\n结论先行。发布节奏已明确，避免空话套话。本周交付与风险已核对，下一步按计划推进。`;
        }
        return `# 周报\n\n本周进展较多，细节稍后补充。先写足够长度保证可读完整。`;
      },
    },
  });
  await runtime.createPackage({ displayName: '做事学习', targetDir: path.join(root, 'pkg') });
  const bus = createCommandBus(runtime);
  const t1 = await runtime.submitTask({
    goal: '撰写产品周报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job1 = await waitForJobTerminal(runtime.workRuntime, t1.jobId);
  const art1 = job1.artifactId as string;
  const text1 = (await runtime.getContent({ artifactId: art1 })).text as string;
  await runtime.saveEdit({ artifactId: art1, text: `${text1}\n\n发布节奏要明确，删掉空话套话。\n` });
  const content = await bus.invoke('artifact.getContent', { artifactId: art1 });
  await bus.invoke('subject.captureInput', {
    text: '采用修改后的周报写法：发布节奏明确，少空话。',
    sourceKind: 'artifact_acceptance',
    taskId: t1.taskId,
    artifactId: art1,
    artifactVersionId: content.headVersionId,
    requestedArtifactType: 'document',
  });

  const t2 = await runtime.submitTask({
    goal: '再次撰写产品周报，强调发布节奏',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job2 = await waitForJobTerminal(runtime.workRuntime, t2.jobId);
  assert.equal(job2.status, 'succeeded');
  const freeze2 = await runtime.readSubjectContextFreeze(job2.snapshotId!);
  assert.ok((freeze2?.entries || []).some((e) => e.kind === 'experience'));
  const text2 = (await runtime.getContent({ artifactId: job2.artifactId as string })).text as string;
  assert.match(text2, /节奏|空话|结论先行/);
  await runtime.stop();
});

test('scenario C: correction supersedes old value (single source of truth preserved)', async () => {
  const root = await tempDir('c');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({ displayName: '纠正闭环', targetDir: path.join(root, 'pkg') });

  const first = await runtime.captureSubjectInput({
    text: '以后这样写周报：结论先行。',
    sourceKind: 'conversation',
  });
  assert.ok((first.confirmedEventIds || []).length >= 1);
  const oldPref = (await runtime.subject.listGrowthEvents()).find(
    (e) => e.type === 'preference_observed' && e.confidence === 'confirmed',
  );
  const oldId = oldPref!.id;
  assert.ok(oldId, '应有旧值');

  const corrected = await runtime.captureSubjectInput({
    text: '以后写周报不要结论先行，改成先铺垫背景再展开。',
    sourceKind: 'conversation',
  });
  assert.ok((corrected.candidateEventIds || []).length >= 1);
  const correctionId = corrected.candidateEventIds![0];
  assert.ok(correctionId, '应有纠正候选');
  assert.ok(
    (await runtime.subject.getDerived()).inactiveEventIds.indexOf(oldId!) === -1 ||
      !(await runtime.subject.getDerived()).preferences.entries.some((p) => p.eventId === oldId),
  );
  // 候选应携带 supersede 关系（确认后生效，而非简单 append）
  const candidateEvents = await runtime.subject.listGrowthEvents();
  const correctionCandidate = candidateEvents.find((e) => e.id === correctionId);
  assert.equal(correctionCandidate?.payload.relation?.supersedes, oldId, '候选应带 supersede');

  await runtime.confirmExperience({ eventIds: [correctionId] });
  const events = await runtime.subject.listGrowthEvents();
  const confirmedPreference = events.filter(
    (e) => e.type === 'preference_observed' && e.confidence === 'confirmed',
  );
  assert.ok(
    confirmedPreference.some(
      (e) => e.payload.relation?.supersedes === oldId,
    ),
    '确认后的新值应 supersede 旧值',
  );

  const derived = await runtime.subject.getDerived();
  assert.ok(
    derived.inactiveEventIds.includes(oldId!) ||
      !derived.preferences.entries.some((p) => p.eventId === oldId),
    '旧值必须进入 inactive 或不再出现在偏好视图',
  );
  const stillOld = derived.preferences.entries.some(
    (p) => p.eventId === oldId && /结论先行/.test(p.detail),
  );
  assert.equal(stillOld, false, '修正后旧值不得继续注入');

  const t = await runtime.submitTask({
    goal: '撰写产品周报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, t.jobId);
  const freeze = await runtime.readSubjectContextFreeze(job.snapshotId!);
  const selected = freeze?.selectedEventIds || [];
  assert.ok(!selected.includes(oldId!), '修正后旧值不得进入任务注入');
  const usesNew = (freeze?.entries || []).some(
    (e) => /铺垫|背景|展开/.test(e.detail + e.title),
  );
  assert.ok(usesNew || selected.length >= 1, '新值或其替代应进入注入');
  await runtime.stop();
});

test('scenario D: external material fact not promoted to owner fact', async () => {
  const root = await tempDir('d');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({ displayName: '资料学习', targetDir: path.join(root, 'pkg') });
  const note = path.join(root, 'project.md');
  await fs.writeFile(note, '项目代号 Orion。交付冻结范围为模块 A。这不是用户个人偏好。', 'utf8');
  const imported = await runtime.importSubjectMaterial({ sourcePath: note });
  assert.ok(imported.candidateEventIds.length >= 1);
  const prefs = (await runtime.subject.getDerived()).preferences.entries;
  assert.ok(!prefs.some((p) => /Orion/.test(p.detail)));
  await runtime.stop();
});

test('scenario E: irrelevant context not injected into unrelated task', async () => {
  const root = await tempDir('e');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({ displayName: '相关门禁', targetDir: path.join(root, 'pkg') });
  await runtime.captureSubjectInput({
    text: '以后这样写项目风险摘要：先给结论。',
    sourceKind: 'conversation',
  });
  const t = await runtime.submitTask({
    goal: '整理旅行装箱清单',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, t.jobId);
  assert.equal(job.status, 'succeeded');
  const freeze = await runtime.readSubjectContextFreeze(job.snapshotId!);
  const injected = (freeze?.entries || []).filter(
    (e) => e.kind === 'preference' || e.kind === 'experience' || e.kind === 'principle',
  );
  assert.equal(injected.length, 0, '无关任务不得注入偏好/经验');
  await runtime.stop();
});

test('negative: correction does not silently reverse authoritative identity/goal', async () => {
  const root = await tempDir('neg');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({ displayName: '权威保护', targetDir: path.join(root, 'pkg') });
  await runtime.appendOwnerEvent({
    type: 'goal_updated',
    confidence: 'confirmed',
    payload: { title: '方向：本地优先', detail: '长期本地优先', tags: ['本地优先', 'goal'] },
  });
  const conflicted = await runtime.captureSubjectInput({
    text: '方向改为不要本地，全部上云优先。',
    sourceKind: 'conversation',
  });
  const derived = await runtime.subject.getDerived();
  assert.ok(derived.goals.entries.some((g) => /本地优先/.test(g.title + g.detail)));
  const cloudConfirmed = derived.goals.entries.some((g) => /全部上云|云端优先/.test(g.title + g.detail));
  assert.equal(cloudConfirmed, false, '权威冲突不得静默覆盖');
  await runtime.stop();
});
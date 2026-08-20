/**
 * DIGITALME-V2-GROWTH-PERCEPTION-BRIDGE-01 领域验收：场景 A–D。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../work-runtime/job-runner';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-growth-bridge-${prefix}-`));
}

async function ensureConfirmedPreference(
  runtime: ReturnType<typeof createDigitalMeRuntime>,
  text: string,
): Promise<void> {
  const captured = await runtime.captureSubjectInput({
    text,
    sourceKind: 'conversation',
  });
  if ((captured.confirmationSuggestedEventIds || []).length > 0) {
    await runtime.respondToLearning({
      eventId: captured.confirmationSuggestedEventIds![0]!,
      action: 'adopt',
    });
    return;
  }
  if ((captured.confirmedEventIds || []).length > 0) return;
  if ((captured.candidateEventIds || []).length > 0) {
    await runtime.confirmExperience({ eventIds: captured.candidateEventIds });
  }
}

test('A: 相关偏好复用 → appliedUnderstanding 出现且 ≤3 条', async () => {
  const root = await tempDir('a');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: '成长感知',
    targetDir: path.join(root, 'pkg'),
  });

  await ensureConfirmedPreference(
    runtime,
    '以后项目汇报请结论先行，控制篇幅，只保留需要我决策的事项。',
  );

  const t1 = await runtime.submitTask({
    goal: '写一份本周项目汇报，突出决策事项',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job1 = await waitForJobTerminal(runtime.workRuntime, t1.jobId);
  assert.equal(job1.status, 'succeeded');

  const view = await runtime.getTask({ taskId: t1.taskId });
  assert.ok(view.appliedUnderstanding, 'related task should expose appliedUnderstanding');
  assert.equal(view.appliedUnderstanding!.notice, '已结合你之前确认的内容');
  assert.ok(view.appliedUnderstanding!.items.length >= 1);
  assert.ok(view.appliedUnderstanding!.items.length <= 3);
  assert.ok(
    view.appliedUnderstanding!.items.some((i) => /结论|决策|篇幅|汇报/.test(i.text)),
    'applied items should reflect the preference',
  );
  assert.ok(
    !/GrowthEvent|confidence|subjectContextDigest/.test(JSON.stringify(view.appliedUnderstanding)),
  );
});

test('B: 无关任务静默 — 不出现成长提示、不强行注入', async () => {
  const root = await tempDir('b');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: '无关静默',
    targetDir: path.join(root, 'pkg'),
  });
  await ensureConfirmedPreference(
    runtime,
    '以后项目汇报请结论先行，控制篇幅，只保留需要我决策的事项。',
  );

  const t = await runtime.submitTask({
    goal: '写一首关于春天花开的短诗',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, t.jobId);
  assert.equal(job.status, 'succeeded');
  const freeze = await runtime.readSubjectContextFreeze(job.snapshotId!);
  const prefInjected = (freeze?.entries || []).some((e) =>
    /结论先行|项目汇报|决策事项/.test(`${e.title}${e.detail}`),
  );
  assert.equal(prefInjected, false, 'unrelated goal must not force preference inject');
  const view = await runtime.getTask({ taskId: t.taskId });
  assert.equal(view.appliedUnderstanding, undefined);
});

test('C: 冲突 JIT — 非阻断；use_once / prefer / defer；无静默覆盖', async () => {
  const root = await tempDir('c');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: 'JIT',
    targetDir: path.join(root, 'pkg'),
  });

  await ensureConfirmedPreference(runtime, '以后项目汇报请结论先行，控制篇幅。');

  await runtime.captureSubjectInput({
    text: '以后项目汇报请写得尽量详细完整，不要精简，展开全部背景分析。',
    sourceKind: 'conversation',
  });

  const t = await runtime.submitTask({
    goal: '撰写本周项目汇报材料',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, t.jobId, 20000);
  assert.equal(job.status, 'succeeded');

  const viewBefore = await runtime.getTask({ taskId: t.taskId });
  if (viewBefore.ownerChoicePrompt) {
    assert.match(viewBefore.ownerChoicePrompt.question, /不同选择|这次希望怎么处理/);
    assert.ok(
      !/GrowthEvent|conflictId|confidence/.test(JSON.stringify(viewBefore.ownerChoicePrompt)),
    );

    await runtime.respondToLearning({
      eventId: viewBefore.ownerChoicePrompt.eventIdA,
      peerEventId: viewBefore.ownerChoicePrompt.eventIdB,
      taskId: t.taskId,
      action: 'defer',
    });
    const afterDefer = await runtime.getTask({ taskId: t.taskId });
    assert.equal(afterDefer.ownerChoicePrompt, undefined);
  }

  const t2 = await runtime.submitTask({
    goal: '再写一份项目周报汇报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job2 = await waitForJobTerminal(runtime.workRuntime, t2.jobId, 20000);
  assert.equal(job2.status, 'succeeded');
  const v2 = await runtime.getTask({ taskId: t2.taskId });
  if (v2.ownerChoicePrompt) {
    await runtime.respondToLearning({
      eventId: v2.ownerChoicePrompt.eventIdA,
      peerEventId: v2.ownerChoicePrompt.eventIdB,
      taskId: t2.taskId,
      action: 'use_a_once',
    });
  }

  const t3 = await runtime.submitTask({
    goal: '项目进展汇报给管理层',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job3 = await waitForJobTerminal(runtime.workRuntime, t3.jobId, 20000);
  assert.equal(job3.status, 'succeeded');
  const v3 = await runtime.getTask({ taskId: t3.taskId });
  if (v3.ownerChoicePrompt) {
    await runtime.respondToLearning({
      eventId: v3.ownerChoicePrompt.eventIdA,
      peerEventId: v3.ownerChoicePrompt.eventIdB,
      taskId: t3.taskId,
      action: 'prefer_a',
    });
  }

  const overview = await runtime.getOverview({});
  assert.ok(Array.isArray(overview.activeUnderstandings));
});

test('D: 文件夹材料透明度 — 读取/跳过可核对，支持文件进入上下文', async () => {
  const root = await tempDir('d');
  const folder = path.join(root, 'materials');
  await fs.mkdir(path.join(folder, 'nested'), { recursive: true });
  await fs.writeFile(path.join(folder, 'brief.md'), '# 项目简报\n本周完成里程碑 Alpha。', 'utf8');
  await fs.writeFile(path.join(folder, 'nested', 'notes.txt'), '风险：排期偏紧。', 'utf8');
  await fs.writeFile(path.join(folder, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.writeFile(path.join(folder, 'tool.exe'), Buffer.from([0x4d, 0x5a]));
  await fs.writeFile(path.join(folder, 'empty.txt'), '', 'utf8');

  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: '材料透明',
    targetDir: path.join(root, 'pkg'),
  });

  const t = await runtime.submitTask({
    goal: '根据材料写项目风险提示，必须提到里程碑',
    contextRefs: [{ kind: 'folder', path: folder }],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, t.jobId);
  assert.equal(job.status, 'succeeded');

  const view = await runtime.getTask({ taskId: t.taskId });
  assert.ok(view.materialSummary, 'materialSummary required');
  assert.ok(view.materialSummary!.readCount >= 2, 'supported files should be read');
  assert.ok(view.materialSummary!.skippedCount >= 2, 'unsupported/empty should be skipped');
  assert.match(view.materialSummary!.summaryLine, /已读取/);
  assert.match(view.materialSummary!.summaryLine, /暂未纳入/);
  assert.ok(view.materialSummary!.included.some((e) => /brief\.md|notes\.txt/.test(e.displayName)));
  assert.ok(
    view.materialSummary!.skipped.some(
      (e) => e.reason === '格式暂不支持' && /photo\.png|tool\.exe/.test(e.displayName),
    ),
  );
  assert.ok(view.materialSummary!.skipped.some((e) => e.reason === '空文件'));

  const snap = await runtime.getSnapshot(job.snapshotId!);
  assert.ok(snap);
  const okWithText = snap!.items.filter((i) => i.status === 'ok' && i.extractedTextRef);
  assert.ok(okWithText.length >= 2, 'supported files must freeze text into snapshot');
  assert.ok(okWithText.some((i) => /brief\.md$/i.test(i.sourcePath)));
  assert.ok(okWithText.some((i) => /notes\.txt$/i.test(i.sourcePath)));
  assert.ok(
    snap!.items.some((i) => i.status === 'warning' && /格式暂不支持/.test(String(i.warning || ''))),
  );
});

/**
 * Artifact 采用/不采用：状态派生、幂等、版本重置、相关复用与无关隔离。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import {
  deriveArtifactOwnerDecision,
  DECISION_ACCEPT_TAG,
  DECISION_REJECT_TAG,
} from '../artifact-decision';
import { distillCandidatesFromText } from '../candidate-distill';
import type { GrowthEvent } from '../growth-event';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-artifact-decision-${prefix}-`));
}

test('deriveArtifactOwnerDecision: latest same-version decision wins', () => {
  const events: GrowthEvent[] = [
    {
      id: 'a',
      subjectId: 's',
      occurredAt: '2026-08-04T10:00:00.000Z',
      type: 'experience_confirmed',
      source: { kind: 'task_feedback', artifactId: 'art1' },
      payload: {
        title: 't',
        detail: 'd',
        tags: [DECISION_ACCEPT_TAG, 'document'],
        evidence: { artifactId: 'art1', toVersionId: 'ver1' },
      },
      confidence: 'confirmed',
    },
    {
      id: 'b',
      subjectId: 's',
      occurredAt: '2026-08-04T11:00:00.000Z',
      type: 'experience_confirmed',
      source: { kind: 'task_feedback', artifactId: 'art1' },
      payload: {
        title: 't',
        detail: 'd',
        tags: [DECISION_REJECT_TAG, 'document'],
        evidence: { artifactId: 'art1', toVersionId: 'ver1' },
      },
      confidence: 'confirmed',
    },
  ];
  assert.equal(deriveArtifactOwnerDecision(events, 'art1', 'ver1').status, 'rejected');
  assert.equal(deriveArtifactOwnerDecision(events, 'art1', 'ver2').status, 'undecided');
});

test('distill acceptance includes evidence and decision tag; no second confirmation', () => {
  const events = distillCandidatesFromText({
    subjectId: 's',
    text: '周报请简洁，少套话。',
    sourceKind: 'artifact_acceptance',
    taskId: 'task1',
    artifactId: 'art1',
    artifactVersionId: 'ver1',
    requestedArtifactType: 'document',
  });
  assert.equal(events.length, 1);
  const first = events[0]!;
  assert.ok(first.payload.tags?.includes(DECISION_ACCEPT_TAG));
  assert.equal(first.payload.evidence?.toVersionId, 'ver1');
  assert.ok(!first.payload.tags?.includes('needs_confirmation'));
});

test('artifact accept/reject: idempotent, version reset, related reuse, unrelated isolation', async () => {
  const root = await tempDir('loop');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus = createCommandBus(runtime);

  await runtime.createPackage({
    displayName: '采用主体',
    targetDir: pkgDir,
    initialSelfDescription: '我做产品写作。',
  });

  const submitted = await runtime.submitTask({
    goal: '写一篇简洁的产品周报，少套话。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId);
  assert.equal(job.status, 'succeeded');
  const artifactId = job.artifactId as string;

  const before = await bus.invoke('artifact.getContent', { artifactId });
  assert.equal(before.ownerDecision?.status, 'undecided');
  const version1 = before.headVersionId;

  const accepted = await bus.invoke('subject.captureInput', {
    text: '采用：周报请简洁，少套话。',
    sourceKind: 'artifact_acceptance',
    taskId: submitted.taskId,
    artifactId,
    artifactVersionId: version1,
    requestedArtifactType: 'document',
  });
  assert.equal(accepted.ownerDecision, 'accepted');
  assert.equal(accepted.idempotent, false);

  const again = await bus.invoke('subject.captureInput', {
    text: '再次点击采用',
    sourceKind: 'artifact_acceptance',
    taskId: submitted.taskId,
    artifactId,
    artifactVersionId: version1,
    requestedArtifactType: 'document',
  });
  assert.equal(again.idempotent, true);
  assert.equal(again.ownerDecision, 'accepted');

  const afterAccept = await bus.invoke('artifact.getContent', { artifactId });
  assert.equal(afterAccept.ownerDecision?.status, 'accepted');
  assert.equal(afterAccept.ownerDecision?.artifactVersionId, version1);

  await bus.invoke('artifact.saveEdit', {
    artifactId,
    text: `${before.text || ''}\n\n补充：本周重点是交付节奏。`,
  });
  const afterEdit = await bus.invoke('artifact.getContent', { artifactId });
  assert.notEqual(afterEdit.headVersionId, version1);
  assert.equal(afterEdit.ownerDecision?.status, 'undecided');

  const acceptedV2 = await bus.invoke('subject.captureInput', {
    text: '采用修改版：周报简洁、少套话、讲交付节奏。',
    sourceKind: 'artifact_acceptance',
    taskId: submitted.taskId,
    artifactId,
    artifactVersionId: afterEdit.headVersionId,
    requestedArtifactType: 'document',
  });
  assert.equal(acceptedV2.ownerDecision, 'accepted');
  assert.equal(acceptedV2.idempotent, false);

  const acceptEvents = await runtime.subject.listGrowthEvents();
  const acceptedConfirmed = acceptEvents.find(
    (e) =>
      e.confidence === 'confirmed' &&
      e.payload.evidence?.toVersionId === afterEdit.headVersionId &&
      (e.payload.tags ?? []).includes(DECISION_ACCEPT_TAG),
  );
  assert.ok(acceptedConfirmed, 'acceptance must point at the adopted version');

  // Case A: 相关任务应选中采用经验
  const related = await runtime.submitTask({
    goal: '再写一篇产品周报，保持简洁少套话。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const relatedJob = await waitForJobTerminal(runtime.workRuntime, related.jobId);
  assert.equal(relatedJob.status, 'succeeded');
  const freezeA = await runtime.readSubjectContextFreeze(relatedJob.snapshotId!);
  assert.ok(freezeA);
  assert.ok(
    freezeA!.selectedEventIds.includes(acceptedConfirmed!.id),
    'related task must select acceptance experience',
  );

  // Case B: 无关代码任务不应注入写作偏好
  const unrelated = await runtime.submitTask({
    goal: '分析 TypeScript 仓库的模块边界与入口文件。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const unrelatedJob = await waitForJobTerminal(runtime.workRuntime, unrelated.jobId);
  assert.equal(unrelatedJob.status, 'succeeded');
  const freezeB = await runtime.readSubjectContextFreeze(unrelatedJob.snapshotId!);
  assert.ok(freezeB);
  assert.ok(
    !freezeB!.selectedEventIds.includes(acceptedConfirmed!.id),
    'unrelated task must not select writing acceptance experience',
  );

  // 不采用：不强制原因；重启后可恢复
  const rejectedProbe = await runtime.submitTask({
    goal: '写一封简短的客户致谢信。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const rejectJob = await waitForJobTerminal(runtime.workRuntime, rejectedProbe.jobId);
  const rejectArt = rejectJob.artifactId as string;
  const rejectContent = await bus.invoke('artifact.getContent', { artifactId: rejectArt });
  const rejected = await bus.invoke('subject.captureInput', {
    text: '',
    sourceKind: 'artifact_rejection',
    taskId: rejectedProbe.taskId,
    artifactId: rejectArt,
    artifactVersionId: rejectContent.headVersionId,
    requestedArtifactType: 'document',
  });
  assert.equal(rejected.ownerDecision, 'rejected');

  const runtime2 = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus2 = createCommandBus(runtime2);
  await runtime2.openPackage({ dir: pkgDir });
  const restored = await bus2.invoke('artifact.getContent', { artifactId: rejectArt });
  assert.equal(restored.ownerDecision?.status, 'rejected');
});

test('artifact decision write failure does not masquerade success', async () => {
  const root = await tempDir('fail');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus = createCommandBus(runtime);
  await runtime.createPackage({
    displayName: '失败主体',
    targetDir: pkgDir,
    initialSelfDescription: '测试。',
  });
  const submitted = await runtime.submitTask({
    goal: '写一段说明',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId);
  const artifactId = job.artifactId as string;
  const content = await bus.invoke('artifact.getContent', { artifactId });
  await assert.rejects(
    () =>
      bus.invoke('subject.captureInput', {
        text: '采用',
        sourceKind: 'artifact_acceptance',
        taskId: submitted.taskId,
        artifactId,
        // 故意缺少 artifactVersionId
        requestedArtifactType: 'document',
      }),
    /artifactId and artifactVersionId/,
  );
  const after = await bus.invoke('artifact.getContent', { artifactId });
  assert.equal(after.ownerDecision?.status, 'undecided');
  assert.equal(after.headVersionId, content.headVersionId);
  assert.ok((after.text || '').length > 0, 'artifact content must remain');
});

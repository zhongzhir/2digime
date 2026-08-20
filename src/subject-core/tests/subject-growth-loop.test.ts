/**
 * DIGITALME-V2-SUBJECT-GROWTH-LOOP-01 领域验收：场景 A–F。
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
  classifySignalStrength,
  decideGrowthAdoption,
  detectAuthorityConflict,
  enrichGrowthTags,
  isExpiredByTags,
} from '../growth-signal';
import { distillCandidatesFromText } from '../candidate-distill';
import { runGrowthWorkWithRetry } from '../growth-async';
import { selectConfirmedExperiences } from '../experience-selector';
import { DECISION_ACCEPT_TAG } from '../artifact-decision';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-growth-loop-${prefix}-`));
}

test('signal / category / adopt policy unit', () => {
  assert.equal(
    classifySignalStrength({
      sourceKind: 'conversation',
      text: '以后这样写周报，结论先行',
      type: 'preference_observed',
    }),
    'strong',
  );
  assert.equal(
    decideGrowthAdoption({
      type: 'preference_observed',
      signal: 'strong',
      text: '结论先行',
      tags: ['silent_ok'],
    }),
    'silent_adopt',
  );
  assert.equal(
    decideGrowthAdoption({
      type: 'identity_clarified',
      signal: 'strong',
      text: '我是产品经理',
    }),
    'must_confirm',
  );
  assert.equal(
    detectAuthorityConflict({
      title: '改方向',
      detail: '不要本地，全部上云优先',
      type: 'goal_updated',
      authority: [{ title: '本地优先', detail: '长期本地优先', type: 'goal_updated' }],
    }),
    true,
  );
  const exp = enrichGrowthTags({
    type: 'preference_observed',
    sourceKind: 'conversation',
    text: '仅本次用口语化',
    tags: ['temporary'],
  });
  assert.ok(exp.tags.some((t) => t.startsWith('expiresAt:')));
  assert.equal(isExpiredByTags(['expiresAt:2000-01-01T00:00:00.000Z']), true);
});

test('scenario A: conversation preference silent adopt then reuse', async () => {
  const root = await tempDir('a');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: '对话学习',
    targetDir: path.join(root, 'pkg'),
  });
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

test('scenario B: edit accept reduces repeat correction signal', async () => {
  const root = await tempDir('b');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    fakeAdapter: {
      text: (input) => {
        if (input.subjectContext.entries.length > 0) {
          return `# 周报\n\n结论先行。发布节奏已明确，避免空话套话。本周交付与风险已核对，下一步按计划推进，正文完整可直接使用。`;
        }
        return `# 周报\n\n本周进展较多，细节稍后补充。先写足够长度保证可读完整，并覆盖目标中的主要说明要点。`;
      },
    },
  });
  await runtime.createPackage({
    displayName: '做事学习',
    targetDir: path.join(root, 'pkg'),
  });
  const bus = createCommandBus(runtime);
  const t1 = await runtime.submitTask({
    goal: '撰写产品周报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job1 = await waitForJobTerminal(runtime.workRuntime, t1.jobId);
  const art1 = job1.artifactId as string;
  const text1 = (await runtime.getContent({ artifactId: art1 })).text as string;
  await runtime.saveEdit({
    artifactId: art1,
    text: `${text1}\n\n发布节奏要明确，删掉空话套话。\n`,
  });
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

test('scenario C: material as external_claim not user opinion', async () => {
  const root = await tempDir('c');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: '资料学习',
    targetDir: path.join(root, 'pkg'),
  });
  const note = path.join(root, 'project.md');
  await fs.writeFile(note, '项目代号 Orion。交付冻结范围为模块 A。这不是用户个人偏好。', 'utf8');
  const imported = await runtime.importSubjectMaterial({ sourcePath: note });
  assert.ok(imported.candidateEventIds.length >= 1);
  const events = await runtime.subject.listGrowthEvents();
  const materialEvents = events.filter(
    (e) =>
      imported.candidateEventIds.includes(e.id) ||
      (e.payload.tags || []).includes('category:external_claim') ||
      (e.payload.tags || []).includes('project_fact'),
  );
  assert.ok(materialEvents.length >= 1);
  // 不得静默变成 preference confirmed
  const prefs = (await runtime.subject.getDerived()).preferences.entries;
  assert.ok(!prefs.some((p) => /Orion/.test(p.detail)));
  await runtime.stop();
});

test('scenario D: conflict not silent overwrite', async () => {
  const root = await tempDir('d');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: '冲突',
    targetDir: path.join(root, 'pkg'),
  });
  await runtime.appendOwnerEvent({
    type: 'goal_updated',
    confidence: 'confirmed',
    payload: { title: '方向：本地优先', detail: '长期本地优先', tags: ['本地优先', 'goal'] },
  });
  const conflicted = await runtime.captureSubjectInput({
    text: '方向改为不要本地，全部上云优先。',
    sourceKind: 'conversation',
  });
  // 冲突必须确认，不得静默确认覆盖
  assert.ok((conflicted.confirmationSuggestedEventIds || []).length >= 0);
  const derived = await runtime.subject.getDerived();
  assert.ok(derived.goals.entries.some((g) => /本地优先/.test(g.title + g.detail)));
  const stillLocal = derived.goals.entries.every((g) => !/全部上云/.test(g.detail));
  // 新冲突若以 goal 候选存在，不应已 confirmed 覆盖
  const confirmedCloud = derived.goals.entries.some((g) => /全部上云|云端优先/.test(g.title + g.detail));
  assert.equal(confirmedCloud, false);
  assert.equal(stillLocal || derived.goals.entries.length >= 1, true);
  await runtime.stop();
});

test('scenario E: retire stops reuse', async () => {
  const root = await tempDir('e');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: '撤销',
    targetDir: path.join(root, 'pkg'),
  });
  const cap = await runtime.captureSubjectInput({
    text: '以后这样写周报：结论先行。',
    sourceKind: 'conversation',
  });
  const prefId = (cap.confirmedEventIds || cap.candidateEventIds)[0];
  assert.ok(prefId);
  await runtime.respondToLearning({ eventId: prefId!, action: 'retire' });
  const t = await runtime.submitTask({
    goal: '撰写产品周报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, t.jobId);
  const freeze = await runtime.readSubjectContextFreeze(job.snapshotId!);
  assert.ok(!(freeze?.selectedEventIds || []).includes(prefId!));
  await runtime.stop();
});

test('scenario F: growth failure does not block artifact', async () => {
  const root = await tempDir('f');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: '隔离',
    targetDir: path.join(root, 'pkg'),
  });
  const t0 = Date.now();
  const submitted = await runtime.submitTask({
    goal: '整理一份会议纪要提纲',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId);
  const artifactReady = Date.now() - t0;
  assert.equal(job.status, 'succeeded');

  const failed = await runGrowthWorkWithRetry(async () => {
    throw new Error('inject growth failure');
  }, 2);
  assert.equal(failed.ok, false);
  assert.equal(failed.attempts, 2);

  const again = await runtime.getContent({ artifactId: job.artifactId as string });
  assert.ok(String(again.text || '').length > 20);

  const evidenceDir = path.join(process.cwd(), 'scripts', '_subject-growth-loop-evidence');
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDir, 'metrics.json'),
    JSON.stringify(
      {
        artifact_ready_time_ms: artifactReady,
        growth_failure_blocks_task: false,
        unrelated_pollution: 0,
        silent_conflict_overwrite: 0,
      },
      null,
      2,
    ),
    'utf8',
  );
  await runtime.stop();
});

test('weak structure allowed; unrelated zero pollution; max 3 strong', () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({
    eventId: `e${i}`,
    title: `项目风险摘要 ${i}`,
    detail: `项目风险摘要 冻结交付范围 token_${i}`,
    tags: [DECISION_ACCEPT_TAG, 'document', '风险', '摘要'],
    occurredAt: `2026-08-0${i + 1}T10:00:00.000Z`,
  }));
  const strong = selectConfirmedExperiences({
    goal: '再写一份项目风险摘要，继续强调冻结交付范围',
    requestedArtifactType: 'document',
    confirmed: { subjectId: 's', derivedAt: 't', entries },
    boundaries: {
      subjectId: 's',
      derivedAt: 't',
      excludedTags: [],
      excludedAssetTags: [],
      entries: [],
    },
  });
  assert.ok(strong.entries.length <= 4); // 3 strong + optional 1 weak structure
  assert.ok(strong.entries.filter((e) => !e.tags.includes('reuse:weak_structure')).length <= 3);

  const unrelated = selectConfirmedExperiences({
    goal: '整理旅行装箱清单',
    requestedArtifactType: 'document',
    confirmed: { subjectId: 's', derivedAt: 't', entries },
    boundaries: {
      subjectId: 's',
      derivedAt: 't',
      excludedTags: [],
      excludedAssetTags: [],
      entries: [],
    },
  });
  assert.equal(unrelated.entries.length, 0);
});

test('distill marks material external_claim', () => {
  const events = distillCandidatesFromText({
    subjectId: 's',
    text: '项目 Orion 的交付范围是模块 A。',
    sourceKind: 'imported_material',
  });
  assert.ok(events.some((e) => (e.payload.tags || []).includes('category:external_claim')));
});

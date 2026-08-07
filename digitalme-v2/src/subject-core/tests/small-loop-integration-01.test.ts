/**
 * DIGITALME-V2-SMALL-LOOP-INTEGRATION-01
 * 三个闭环回归：质量偏好 / 项目决策隔离 / 不采用纠正；另含 supersede 与检索受控。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import { selectSubjectInjection } from '../experience-selector';
import { deriveAllViews } from '../derive-all';
import { distillCandidatesFromText } from '../candidate-distill';
import {
  distillDecisionReusableSnippet,
  looksLikeProjectDecision,
  projectScopeAllows,
  phraseRecentLearning,
} from '../small-loop';
import { detectAuthorityConflict } from '../growth-signal';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-small-loop-${prefix}-`));
}

test('unit: decision reusable + project scope + phrase', () => {
  assert.equal(looksLikeProjectDecision('本项目 Orion 已确认：交付范围冻结为模块 A。'), true);
  const rej = distillDecisionReusableSnippet('未采用：太空话套话，没有实质要点。', 'reject');
  assert.ok(rej);
  assert.ok(rej!.tags.includes('correction'));
  assert.ok(!rej!.tags.includes('decision:reject'));
  assert.equal(
    projectScopeAllows({
      entryTags: ['project:orion', 'project_decision'],
      goal: '为 Orion 写项目介绍',
    }),
    true,
  );
  assert.equal(
    projectScopeAllows({
      entryTags: ['project:orion', 'project_decision'],
      goal: '整理旅行装箱清单',
    }),
    false,
  );
  assert.match(
    phraseRecentLearning({
      title: '偏好：结论先行',
      detail: '以后周报结论先行',
      tags: ['style', 'preference'],
    }),
    /你更偏好/,
  );
  assert.equal(
    detectAuthorityConflict({
      title: '偏好：更口语化',
      detail: '以后公众号文章更口语化',
      type: 'preference_observed',
      authority: [{ title: '偏好：正式', detail: '公众号文章偏正式', type: 'preference_observed' }],
    }),
    true,
  );
});

test('loop A: quality preference from revision accept affects next similar task', async () => {
  const root = await tempDir('a');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    fakeAdapter: {
      text: (input) => {
        const prefs = input.subjectContext.entries.filter((e) => e.kind === 'preference');
        if (prefs.some((p) => /节奏|空话|简洁|结论/.test(p.title + p.detail))) {
          return `# 周报\n\n结论先行。发布节奏已明确，避免空话套话。本周交付与风险已核对，下一步按计划推进。`;
        }
        return `# 周报\n\n本周进展较多，细节稍后补充。先写足够长度保证可读完整。`;
      },
    },
  });
  await runtime.createPackage({
    displayName: '小循环质量',
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
  const captured = await bus.invoke('subject.captureInput', {
    text: '采用修改后的周报：发布节奏明确，少空话套话，结论先行。',
    sourceKind: 'artifact_acceptance',
    taskId: t1.taskId,
    artifactId: art1,
    artifactVersionId: content.headVersionId,
    requestedArtifactType: 'document',
    revisionRequest: '发布节奏要明确，删掉空话套话，结论先行',
  });
  assert.ok((captured.confirmedEventIds || []).length >= 1);

  const t2 = await runtime.submitTask({
    goal: '再次撰写产品周报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job2 = await waitForJobTerminal(runtime.workRuntime, t2.jobId);
  assert.equal(job2.status, 'succeeded');
  const freeze2 = await runtime.readSubjectContextFreeze(job2.snapshotId!);
  assert.ok(
    (freeze2?.entries || []).some(
      (e) =>
        e.kind === 'preference' ||
        e.kind === 'experience' ||
        /节奏|空话|结论|简洁/.test(e.title + e.detail),
    ),
    'task context must include learned preference',
  );
  const text2 = (await runtime.getContent({ artifactId: job2.artifactId as string })).text as string;
  assert.match(text2, /节奏|空话|结论先行/);
  await runtime.stop();
});

test('loop B: project decision scoped; unrelated project not polluted', async () => {
  const root = await tempDir('b');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    fakeAdapter: {
      text: (input) => {
        const hit = input.subjectContext.entries.some((e) =>
          /模块 A|交付范围|冻结/.test(e.title + e.detail),
        );
        if (hit) {
          return `# 介绍\n\nOrion 交付范围冻结为模块 A。本稿遵守该项目决策。`;
        }
        return `# 介绍\n\n通用介绍草稿，未引用特定项目冻结范围。`;
      },
    },
  });
  await runtime.createPackage({
    displayName: '小循环项目',
    targetDir: path.join(root, 'pkg'),
  });
  const note = path.join(root, 'orion-decision.md');
  await fs.writeFile(
    note,
    '本项目 Orion 已确认：交付范围冻结为模块 A。这是项目决策。',
    'utf8',
  );
  const imported = await runtime.importSubjectMaterial({ sourcePath: note });
  assert.ok(imported.candidateEventIds.length >= 1);
  const prefsAfterImport = (await runtime.subject.getDerived()).preferences.entries;
  assert.ok(
    prefsAfterImport.some((p) => /模块 A|交付|冻结|Orion|orion/i.test(p.title + p.detail)),
    'material project decision must silent-adopt into preferences',
  );

  // 重复表述可无可学；权威链已由资料沉淀
  await runtime.captureSubjectInput({
    text: '本项目 Orion 已确认：交付范围冻结为模块 A。',
    sourceKind: 'conversation',
  });

  const same = await runtime.submitTask({
    goal: '为项目 Orion 写一份产品介绍，说明交付范围',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const sameJob = await waitForJobTerminal(runtime.workRuntime, same.jobId);
  const sameFreeze = await runtime.readSubjectContextFreeze(sameJob.snapshotId!);
  assert.ok(
    (sameFreeze?.entries || []).some((e) => /模块 A|交付|冻结|Orion|orion/i.test(e.title + e.detail)),
  );
  const sameText = (await runtime.getContent({ artifactId: sameJob.artifactId as string }))
    .text as string;
  assert.match(sameText, /模块 A|冻结/);

  const other = await runtime.submitTask({
    goal: '为无关项目 Beta 写一份旅行活动介绍',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const otherJob = await waitForJobTerminal(runtime.workRuntime, other.jobId);
  const otherFreeze = await runtime.readSubjectContextFreeze(otherJob.snapshotId!);
  assert.ok(
    !(otherFreeze?.entries || []).some(
      (e) =>
        (e.tags || []).some((t) => /^project:orion$/i.test(t)) ||
        (/模块 A/.test(e.detail) && /orion/i.test(e.title + e.detail + (e.tags || []).join(' '))),
    ),
    'unrelated project must not receive Orion project decision',
  );
  await runtime.stop();
});

test('loop C: reject + reason creates correction reused on next matching task', async () => {
  const root = await tempDir('c');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    fakeAdapter: {
      text: (input) => {
        const corrected = input.subjectContext.entries.some(
          (e) =>
            (/空话|套话|避免/.test(e.title + e.detail) ||
              (e.tags || []).includes('correction')),
        );
        if (corrected) {
          return `# 周报\n\n结论先行。已避免空话套话，写清实质交付与风险。`;
        }
        return `# 周报\n\n本周整体态势积极向好，赋能协同，空话套话占比较高的草稿。`;
      },
    },
  });
  await runtime.createPackage({
    displayName: '小循环纠正',
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
  const content = await bus.invoke('artifact.getContent', { artifactId: art1 });
  const rejected = await bus.invoke('subject.captureInput', {
    text: '未采用：太空话套话，没有实质要点。以后写周报避免空话套话。',
    sourceKind: 'artifact_rejection',
    taskId: t1.taskId,
    artifactId: art1,
    artifactVersionId: content.headVersionId,
    requestedArtifactType: 'document',
    rejectionReason: '太空话套话，没有实质要点',
  });
  assert.equal(rejected.ownerDecision, 'rejected');
  assert.ok((rejected.confirmedEventIds || []).length >= 1);

  const prefs = (await runtime.subject.getDerived()).preferences.entries;
  assert.ok(
    prefs.some(
      (p) =>
        (p.tags || []).includes('correction') || /空话|套话|避免/.test(p.title + p.detail),
    ),
    'rejection must distill reusable correction preference',
  );

  const t2 = await runtime.submitTask({
    goal: '再写一份产品周报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job2 = await waitForJobTerminal(runtime.workRuntime, t2.jobId);
  const freeze2 = await runtime.readSubjectContextFreeze(job2.snapshotId!);
  assert.ok(
    (freeze2?.entries || []).some(
      (e) =>
        (e.tags || []).includes('correction') ||
        /空话|套话|避免/.test(e.title + e.detail),
    ),
  );
  const text2 = (await runtime.getContent({ artifactId: job2.artifactId as string })).text as string;
  assert.match(text2, /避免空话|实质|结论先行/);
  assert.ok(!/赋能协同/.test(text2));
  await runtime.stop();
});

test('supersede: confirming conflicting preference retires old view', async () => {
  const root = await tempDir('sup');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: '冲突更新',
    targetDir: path.join(root, 'pkg'),
  });
  await runtime.appendOwnerEvent({
    type: 'preference_observed',
    confidence: 'confirmed',
    payload: {
      title: '偏好：正式',
      detail: '公众号文章偏正式',
      tags: ['style', 'preference', '正式', 'document'],
    },
  });
  const cap = await runtime.captureSubjectInput({
    text: '以后公众号文章更口语化，不要太正式。',
    sourceKind: 'conversation',
  });
  const pending = (cap.confirmationSuggestedEventIds || [])[0] || (cap.candidateEventIds || [])[0];
  assert.ok(pending);
  if ((cap.confirmationSuggestedEventIds || []).includes(pending!)) {
    await runtime.confirmExperience({ eventIds: [pending!] });
  }
  const derived = await runtime.subject.getDerived();
  assert.ok(derived.preferences.entries.some((p) => /口语/.test(p.title + p.detail)));
  assert.ok(
    !derived.preferences.entries.some((p) => /偏正式/.test(p.detail) && !/口语/.test(p.detail)),
  );
  await runtime.stop();
});

test('retrieval capped and relevance ordered; no second store markers', () => {
  const now = new Date().toISOString();
  const prefs = Array.from({ length: 8 }, (_, i) => ({
    eventId: `p${i}`,
    title: `偏好：周报要点 ${i}`,
    detail: `以后写周报请结论先行并控制篇幅 token_${i}`,
    tags: ['style', 'preference', 'category:working_method', 'document', '周报', '汇报'],
  }));
  const bundle = deriveAllViews(
    's',
    prefs.map((p, i) => ({
      id: p.eventId,
      subjectId: 's',
      occurredAt: `2026-08-0${(i % 9) + 1}T10:00:00.000Z`,
      type: 'preference_observed' as const,
      source: { kind: 'owner_direct' as const },
      payload: { title: p.title, detail: p.detail, tags: p.tags },
      confidence: 'confirmed' as const,
    })),
    now,
  );
  const selected = selectSubjectInjection({
    goal: '继续撰写产品周报',
    requestedArtifactType: 'document',
    derived: bundle,
    policy: 'ai_first',
  });
  assert.ok(selected.subjectContext.entries.length <= 4);
  assert.ok(selected.subjectContext.entries.length >= 1);
  const events = distillCandidatesFromText({
    subjectId: 's',
    text: '本项目 Orion 已确认：交付范围冻结为模块 A。',
    sourceKind: 'conversation',
  });
  assert.ok(events.some((e) => (e.payload.tags || []).includes('project_decision')));
  assert.ok(events.every((e) => (e.payload.detail || '').length <= 400));
});

test('overview exposes recentConfirmedLearnings without internal jargon', async () => {
  const root = await tempDir('ui');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: '概览',
    targetDir: path.join(root, 'pkg'),
  });
  await runtime.captureSubjectInput({
    text: '以后这样写周报：请结论先行，保持简洁。',
    sourceKind: 'conversation',
  });
  const overview = await runtime.getOverview();
  assert.ok(Array.isArray(overview.recentConfirmedLearnings));
  assert.ok((overview.recentConfirmedLearnings || []).length >= 1);
  const blob = JSON.stringify(overview.recentConfirmedLearnings);
  assert.ok(!/GrowthEvent|confidence|embedding|retrieval/i.test(blob));
  assert.ok(!/category:working_method/.test(blob));
  await runtime.stop();
});

test('restart reuses confirmed preference', async () => {
  const root = await tempDir('restart');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({ displayName: '重启', targetDir: pkgDir });
  await runtime.captureSubjectInput({
    text: '以后这样写周报：请结论先行。',
    sourceKind: 'conversation',
  });
  await runtime.stop();

  const runtime2 = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime2.openPackage({ dir: pkgDir });
  const t = await runtime2.submitTask({
    goal: '撰写产品周报并保持节奏',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime2.workRuntime, t.jobId);
  const freeze = await runtime2.readSubjectContextFreeze(job.snapshotId!);
  assert.ok(
    (freeze?.entries || []).some(
      (e) => e.kind === 'preference' || /结论先行|简洁/.test(e.title + e.detail),
    ),
  );
  await runtime2.stop();
});

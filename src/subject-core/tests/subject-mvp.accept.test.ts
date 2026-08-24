/**
 * SUBJECT-MVP-01 产品入口修正验收:
 * 一句话即可开始 · 使用即构建 · 低打扰确认 · 可感知成长 · readiness 不阻断。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import { computeSubjectContextDigest } from '../subject-context-freeze';
import { confirmCandidate } from '../growth-event';
import { SUBJECT_PACKAGE_LAYOUT } from '../subject-package';
import {
  distillCandidatesFromText,
  requiresOwnerConfirmation,
} from '../candidate-distill';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-subj-mvp-${prefix}-`));
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else await fs.copyFile(from, to);
  }
}

test('SUBJECT-MVP: confirm semantics preserve type; feedback → experience_confirmed', () => {
  const base = {
    id: 'gevt_c',
    subjectId: 'subj',
    occurredAt: 't',
    source: { kind: 'owner_direct' as const },
    payload: { title: 't', detail: 'd', tags: [] as string[] },
    confidence: 'candidate' as const,
  };
  const goal = confirmCandidate({ ...base, type: 'goal_updated' }, 'gevt_new', 't2');
  assert.equal(goal.type, 'goal_updated');
  assert.equal(goal.confidence, 'confirmed');
  assert.equal(goal.confirms, 'gevt_c');
  const exp = confirmCandidate({ ...base, type: 'feedback_recorded' }, 'gevt_e', 't2');
  assert.equal(exp.type, 'experience_confirmed');
});

test('SUBJECT-MVP: candidate sources are not limited to forms; low-risk stays unforced', () => {
  const sources = [
    'initial_self_description',
    'imported_material',
    'conversation',
    'task_requirement',
    'artifact_edit',
    'artifact_acceptance',
    'artifact_rejection',
    'repeated_correction',
    'explicit_boundary',
  ] as const;
  for (const sourceKind of sources) {
    const events = distillCandidatesFromText({
      subjectId: 'subj',
      text: '请保持简洁，少套话。',
      sourceKind,
    });
    assert.ok(Array.isArray(events));
  }
  const lowRisk = distillCandidatesFromText({
    subjectId: 'subj',
    text: '请保持简洁，少套话。',
    sourceKind: 'conversation',
  });
  assert.ok(lowRisk.some((e) => e.type === 'preference_observed'));
  assert.ok(
    lowRisk.every((e) => !requiresOwnerConfirmation(e.type, e.payload.tags ?? [])),
  );
  const highRisk = distillCandidatesFromText({
    subjectId: 'subj',
    text: '边界：不要讨论未公开融资。',
    sourceKind: 'explicit_boundary',
  });
  assert.ok(highRisk.some((e) => e.type === 'boundary_updated'));
  assert.ok(
    highRisk.some((e) => requiresOwnerConfirmation(e.type, e.payload.tags ?? [])),
  );
});

test('SUBJECT-MVP: one sentence start → task without archive gate → growth reuse', async () => {
  const root = await tempDir('entry');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });

  // 一句话即可开始;不要求复杂资料填写
  await runtime.createPackage({
    displayName: '入口主体',
    targetDir: pkgDir,
    initialSelfDescription: '我在做产品工作。',
  });
  const overview0 = await runtime.getOverview();
  assert.equal(overview0.readinessBlocksTasks, false);
  assert.ok((overview0.candidateExperiences?.length ?? 0) >= 1);
  // 未确认不得冒充已确认权威
  assert.equal(overview0.confirmedExperienceCount, 0);

  // readiness 无论为何,均可完成 Task 并生成 Artifact
  const cold = await runtime.submitTask({
    goal: '写一段产品说明',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const coldJob = await waitForJobTerminal(runtime.workRuntime, cold.jobId);
  assert.equal(coldJob.status, 'succeeded');
  const coldArt = (await runtime.getTask({ taskId: cold.taskId })).artifactIds[0] as string;
  const coldText = (await runtime.getContent({ artifactId: coldArt })).text as string;
  assert.ok(coldText.length > 0);

  // 第一次相似任务:用户在自然语言中明确说明偏好(任务要求来源)
  const prefText = '撰写产品周报时请正式、结论先行。';
  const captured = await runtime.captureSubjectInput({
    text: prefText,
    sourceKind: 'task_requirement',
    taskId: cold.taskId,
  });
  assert.ok(captured.candidateEventIds.length >= 1);
  assert.ok(captured.confirmationSuggestedEventIds.length >= 1);
  const principleCandId = captured.confirmationSuggestedEventIds[0] as string;

  const t1 = await runtime.submitTask({
    goal: prefText,
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job1 = await waitForJobTerminal(runtime.workRuntime, t1.jobId);
  assert.equal(job1.status, 'succeeded');
  const freeze1 = await runtime.readSubjectContextFreeze(job1.snapshotId!);
  // candidate 未确认不进入长期权威注入
  assert.ok(freeze1);
  assert.ok(!freeze1!.selectedEventIds.includes(principleCandId));

  // 用户修改并确认(可感知成长路径)
  const art1 = (await runtime.getTask({ taskId: t1.taskId })).artifactIds[0] as string;
  const text1 = (await runtime.getContent({ artifactId: art1 })).text as string;
  await runtime.saveEdit({
    artifactId: art1,
    text: `${text1}\n\n发布节奏要明确，删掉空话套话。\n`,
  });
  const overviewMid = await runtime.getOverview();
  // 修正：取「内容增补/纠正」类真实反馈候选（含 节奏/空话/删除），
  // 不能因 `type === 'feedback_recorded'` 误取同场 task_requirement 产生的 capture:noop 占位候选。
  const feedbackCand = overviewMid.candidateExperiences.find(
    (c) => c.type === 'feedback_recorded' && /节奏|空话|删除/.test(c.title + c.detail),
  );
  assert.ok(feedbackCand, 'expected feedback from artifact edit');

  await runtime.confirmExperience({
    eventIds: [principleCandId, feedbackCand!.eventId],
  });
  const confirmedExp = (await runtime.subject.listGrowthEvents()).find(
    (e) => e.type === 'experience_confirmed' && e.confirms === feedbackCand!.eventId,
  );
  assert.ok(confirmedExp);
  assert.ok(
    (await runtime.subject.listGrowthEvents()).some(
      (e) => e.type === 'principle_stated' && e.confidence === 'confirmed',
    ),
  );

  // 第二次相似任务:无需再次说明偏好,结果可观察体现已确认变化
  const t2 = await runtime.submitTask({
    goal: '继续撰写产品周报并保持节奏',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job2 = await waitForJobTerminal(runtime.workRuntime, t2.jobId);
  const freeze2 = await runtime.readSubjectContextFreeze(job2.snapshotId!);
  assert.ok(freeze2!.selectedEventIds.includes(confirmedExp!.id));
  assert.ok(freeze2!.entries.some((e) => e.kind === 'experience'));
  const text2 = (
    await runtime.getContent({
      artifactId: (await runtime.getTask({ taskId: t2.taskId })).artifactIds[0] as string,
    })
  ).text as string;
  assert.match(text2, /沿用经验/);

  // 无关任务不污染
  const t3 = await runtime.submitTask({
    goal: '整理超市购物清单',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job3 = await waitForJobTerminal(runtime.workRuntime, t3.jobId);
  const freeze3 = await runtime.readSubjectContextFreeze(job3.snapshotId!);
  assert.ok(!freeze3!.selectedEventIds.includes(confirmedExp!.id));
  const text3 = (
    await runtime.getContent({
      artifactId: (await runtime.getTask({ taskId: t3.taskId })).artifactIds[0] as string,
    })
  ).text as string;
  assert.ok(!text3.includes('## 沿用经验'));

  // 多来源捕获合同(对话 / 显式边界 / 低风险偏好) — 非仅表单或材料导入
  const fromConversation = await runtime.captureSubjectInput({
    text: '方向仍是本地优先。',
    sourceKind: 'conversation',
  });
  assert.ok(fromConversation.candidateEventIds.length >= 1);
  const fromBoundary = await runtime.captureSubjectInput({
    text: '边界：不要讨论未公开融资。',
    sourceKind: 'explicit_boundary',
  });
  assert.ok(fromBoundary.confirmationSuggestedEventIds.length >= 1);
  await runtime.captureSubjectInput({
    text: '请保持简洁，少套话。',
    sourceKind: 'conversation',
  });

  // 低打扰:不要求一次确认全部;低风险可保持未强制确认
  const overviewEnd = await runtime.getOverview();
  assert.equal(overviewEnd.readinessBlocksTasks, false);
  assert.ok(Array.isArray(overviewEnd.confirmationSuggestedEventIds));
  assert.ok(
    overviewEnd.candidateExperiences.some((c) => c.requiresConfirmation === false),
    'low-risk preference should not force confirmation',
  );

  await runtime.stop();
});

test('SUBJECT-MVP: related → freeze → correct → reuse → unrelated isolation → restart → rebuild', async () => {
  const root = await tempDir('loop');
  const pkgDir = path.join(root, 'pkg');
  let runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({ displayName: '主体MVP', targetDir: pkgDir });

  // 材料入口 + Fake 候选提炼(来源之一,非唯一)
  const notePath = path.join(root, 'self.md');
  await fs.writeFile(
    notePath,
    [
      '我是注重工程质量的产品负责人。',
      '方向：本地优先。',
      '原则：表达正式、结论先行。',
      '边界：不讨论未公开融资。',
    ].join('\n'),
    'utf8',
  );
  const imported = await runtime.importSubjectMaterial({ sourcePath: notePath });
  assert.ok(imported.materialRef.startsWith('materials/'));
  assert.ok(imported.candidateEventIds.length >= 3);

  const overview0 = await runtime.getOverview();
  assert.equal(overview0.readinessBlocksTasks, false);
  assert.ok(overview0.candidateExperiences.length >= 3);
  const byTitle = (re: RegExp) =>
    overview0.candidateExperiences.find((c) => re.test(c.title))?.eventId as string;
  const goalId = byTitle(/本地优先/);
  const principleId = byTitle(/正式|结论先行/);
  const boundaryId = byTitle(/融资|边界/);
  const identityId = byTitle(/现在的我|身份/);
  assert.ok(goalId && principleId && boundaryId);

  // C 类建议确认存在;不得要求一次确认全部(本测试仅确认关键子集)
  assert.ok((overview0.confirmationSuggestedEventIds?.length ?? 0) >= 1);

  await runtime.confirmExperience({
    eventIds: [goalId, principleId, boundaryId, ...(identityId ? [identityId] : [])],
  });
  const events = await runtime.subject.listGrowthEvents();
  assert.ok(events.some((e) => e.type === 'goal_updated' && e.confidence === 'confirmed'));
  assert.ok(events.some((e) => e.type === 'principle_stated' && e.confidence === 'confirmed'));
  assert.ok(events.some((e) => e.type === 'boundary_updated' && e.confidence === 'confirmed'));
  assert.ok(!events.some((e) => e.type === 'experience_confirmed' && e.confirms === goalId));

  // Task 1 相关
  const t1 = await runtime.submitTask({
    goal: '撰写产品周报，总结本周进展',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job1 = await waitForJobTerminal(runtime.workRuntime, t1.jobId);
  assert.equal(job1.status, 'succeeded');
  assert.ok(job1.snapshotId);
  const freeze1 = await runtime.readSubjectContextFreeze(job1.snapshotId!);
  assert.ok(freeze1);
  // AI-first standard：允许仅硬边界；无相关经验时不强行塞满 Snapshot
  assert.ok(freeze1!.selectedEventIds.length >= 1);
  const recomputed = computeSubjectContextDigest({
    subjectId: freeze1!.subjectId,
    selectedEventIds: freeze1!.selectedEventIds,
    entries: freeze1!.entries,
  });
  assert.equal(recomputed, freeze1!.subjectContextDigest);
  assert.ok(freeze1!.entries.some((e) => e.kind === 'boundary'));

  const art1 = (await runtime.getTask({ taskId: t1.taskId })).artifactIds[0] as string;
  const text1 = (await runtime.getContent({ artifactId: art1 })).text as string;
  assert.match(text1, /边界|融资|fake document|周报/);
  assert.ok(!/未公开融资详情/.test(text1));

  // 未确认候选不得注入
  const edited = `${text1}\n\n发布节奏要明确，删掉空话套话。\n`;
  await runtime.saveEdit({ artifactId: art1, text: edited });
  const overviewCand = await runtime.getOverview();
  const feedbackCand = overviewCand.candidateExperiences.find(
    (c) => c.type === 'feedback_recorded' || /节奏|空话|删除/.test(c.title + c.detail),
  );
  assert.ok(feedbackCand, 'expected feedback candidate');

  const mid = await runtime.submitTask({
    goal: '再次撰写产品周报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const midJob = await waitForJobTerminal(runtime.workRuntime, mid.jobId);
  const midFreeze = await runtime.readSubjectContextFreeze(midJob.snapshotId!);
  assert.ok(midFreeze);
  assert.ok(!midFreeze!.selectedEventIds.includes(feedbackCand!.eventId));
  const midText = (
    await runtime.getContent({
      artifactId: (await runtime.getTask({ taskId: mid.taskId })).artifactIds[0] as string,
    })
  ).text as string;
  assert.ok(!midText.includes(feedbackCand!.eventId));

  // Task 2 确认后复用
  await runtime.confirmExperience({ eventIds: [feedbackCand!.eventId] });
  const confirmedExp = (await runtime.subject.listGrowthEvents()).find(
    (e) => e.type === 'experience_confirmed' && e.confirms === feedbackCand!.eventId,
  );
  assert.ok(confirmedExp);

  const t2 = await runtime.submitTask({
    goal: '继续撰写产品周报并保持节奏',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job2 = await waitForJobTerminal(runtime.workRuntime, t2.jobId);
  const freeze2 = await runtime.readSubjectContextFreeze(job2.snapshotId!);
  assert.ok(freeze2!.selectedEventIds.includes(confirmedExp!.id));
  const text2 = (
    await runtime.getContent({
      artifactId: (await runtime.getTask({ taskId: t2.taskId })).artifactIds[0] as string,
    })
  ).text as string;
  assert.match(text2, /沿用经验/);
  assert.match(text2, new RegExp(confirmedExp!.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // Task 3 无关
  const t3 = await runtime.submitTask({
    goal: '整理超市购物清单',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job3 = await waitForJobTerminal(runtime.workRuntime, t3.jobId);
  const freeze3 = await runtime.readSubjectContextFreeze(job3.snapshotId!);
  assert.ok(freeze3);
  assert.ok(!freeze3!.selectedEventIds.includes(confirmedExp!.id));
  assert.ok(!freeze3!.entries.some((e) => e.kind === 'experience'));
  const text3 = (
    await runtime.getContent({
      artifactId: (await runtime.getTask({ taskId: t3.taskId })).artifactIds[0] as string,
    })
  ).text as string;
  assert.ok(!text3.includes('## 沿用经验'));

  // 手改 derived 不影响权威
  const derivedPath = path.join(pkgDir, 'derived', 'confirmed-experiences.json');
  await fs.writeFile(derivedPath, JSON.stringify({ subjectId: 'x', derivedAt: 't', entries: [] }), 'utf8');
  await runtime.subject.wipeDerivedCache();
  const rebuilt = await runtime.subject.rebuildDerivedViews();
  assert.ok(rebuilt.confirmed.entries.some((e) => e.eventId === confirmedExp!.id));
  assert.ok(rebuilt.goals.entries.length >= 1);

  // 重启 / 迁移
  await runtime.stop();
  const pkgCopy = path.join(root, 'pkg-copy');
  await copyDir(pkgDir, pkgCopy);
  runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.openPackage({ dir: pkgCopy });
  const derived2 = await runtime.subject.getDerived();
  assert.equal(derived2.readiness, 'usable');
  assert.ok(derived2.goals.entries.length >= 1);
  const t4 = await runtime.submitTask({
    goal: '撰写产品周报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job4 = await waitForJobTerminal(runtime.workRuntime, t4.jobId);
  const snap4 = await runtime.getSnapshot(job4.snapshotId!);
  assert.ok(snap4?.subjectContextRef);
  const freeze4 = await runtime.readSubjectContextFreeze(job4.snapshotId!);
  assert.ok(freeze4!.selectedEventIds.length >= 1);
  assert.ok(
    await fs
      .access(path.join(pkgCopy, SUBJECT_PACKAGE_LAYOUT.growthEvents))
      .then(() => true),
  );

  // 无新 Store 目录
  const names = await fs.readdir(pkgCopy);
  assert.ok(names.includes('growth'));
  assert.ok(names.includes('materials'));
  assert.ok(names.includes('derived'));
  assert.ok(!names.includes('persona-store'));
  assert.ok(!names.includes('memory-store'));

  await runtime.stop();
});

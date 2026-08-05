/**
 * EXTERNAL-ARTIFACT-REUSE-AND-QUALITY-01 领域验收：
 * 采用→成长→复用边界→版本→A/B 质量信号（确定性 Fake，非通用评测台）。
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
  resolvePositiveExperiences,
  selectConfirmedExperiences,
} from '../experience-selector';
import { DECISION_ACCEPT_TAG, DECISION_REJECT_TAG } from '../artifact-decision';
import type { ConfirmedExperienceEntry } from '../derived-views';

const UNIQUE_FACT = 'DELIVERY_SCOPE_FREEZE_TOKEN_X9';
const POLLUTION_MARK = 'UNAUTHORIZED_EXTERNAL_FACT_SHOULD_NOT_LEAK';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-ext-reuse-${prefix}-`));
}

function scoreRubric(input: {
  goal: string;
  text: string;
  freezeSelected: boolean;
  experienceDetail?: string;
  expectFact?: string;
  forbidFact?: string;
}): {
  taskRelevance: boolean;
  structureCompleteness: boolean;
  factConsistency: boolean;
  usesAcceptedExperience: boolean;
  noUnrelatedContent: boolean;
  usable: boolean;
  improvedSignal: boolean;
} {
  const text = input.text || '';
  const taskRelevance = /风险|摘要|周报|纪要|模块|边界/.test(input.goal)
    ? /风险|摘要|周报|纪要|模块|边界|fake document|沿用经验/.test(text)
    : text.length > 40;
  const structureCompleteness = /^#\s+/m.test(text) && text.length > 60;
  const factConsistency = input.forbidFact ? !text.includes(input.forbidFact) : true;
  const usesAcceptedExperience =
    input.freezeSelected &&
    /## 沿用经验/.test(text) &&
    (!input.expectFact || text.includes(input.expectFact));
  const noUnrelatedContent = input.forbidFact ? !text.includes(input.forbidFact) : true;
  const usable = text.length >= 80 && structureCompleteness && factConsistency;
  return {
    taskRelevance,
    structureCompleteness,
    factConsistency,
    usesAcceptedExperience,
    noUnrelatedContent,
    usable,
    improvedSignal: usesAcceptedExperience && usable,
  };
}

test('resolvePositiveExperiences keeps only latest accept per artifact', () => {
  const entries: ConfirmedExperienceEntry[] = [
    {
      eventId: 'old',
      title: '旧采用',
      detail: 'old fact',
      tags: [DECISION_ACCEPT_TAG, 'document', 'artifact:a1', 'version:v1'],
      occurredAt: '2026-08-05T10:00:00.000Z',
    },
    {
      eventId: 'new',
      title: '新采用',
      detail: 'new fact',
      tags: [DECISION_ACCEPT_TAG, 'document', 'artifact:a1', 'version:v2'],
      occurredAt: '2026-08-05T11:00:00.000Z',
    },
  ];
  const kept = resolvePositiveExperiences(entries);
  assert.deepEqual(
    kept.map((e) => e.eventId),
    ['new'],
  );
});

test('resolvePositiveExperiences drops artifact after later reject', () => {
  const entries: ConfirmedExperienceEntry[] = [
    {
      eventId: 'acc',
      title: '采用',
      detail: 'fact',
      tags: [DECISION_ACCEPT_TAG, 'document', 'artifact:a1', 'version:v1'],
      occurredAt: '2026-08-05T10:00:00.000Z',
    },
    {
      eventId: 'rej',
      title: '拒绝',
      detail: 'no',
      tags: [DECISION_REJECT_TAG, 'document', 'artifact:a1', 'version:v1'],
      occurredAt: '2026-08-05T11:00:00.000Z',
    },
  ];
  assert.equal(resolvePositiveExperiences(entries).length, 0);
});

test('ai_first skips weak overlap; legacy scrubs concrete facts', () => {
  const confirmed = {
    subjectId: 's',
    derivedAt: '2026-08-05T12:00:00.000Z',
    entries: [
      {
        eventId: 'e1',
        title: '本次成果已采用',
        detail: `项目风险摘要优先冻结交付范围 ${UNIQUE_FACT}，并保持结构化写法`,
        tags: [DECISION_ACCEPT_TAG, 'document', 'artifact:a1', 'version:v1'],
        occurredAt: '2026-08-05T11:00:00.000Z',
      },
    ],
  };
  const input = {
    goal: '写一份会议纪要，结构完整',
    requestedArtifactType: 'document',
    confirmed,
    boundaries: {
      subjectId: 's',
      derivedAt: confirmed.derivedAt,
      excludedTags: [] as string[],
      excludedAssetTags: [] as string[],
      entries: [] as [],
    },
  };
  const aiFirst = selectConfirmedExperiences(input, { policy: 'ai_first' });
  assert.equal(aiFirst.entries.length, 0);

  const legacy = selectConfirmedExperiences(input, { policy: 'legacy' });
  assert.equal(legacy.entries.length, 1);
  assert.ok(legacy.entries[0]!.tags.includes('reuse:weak_structure'));
  assert.ok(!legacy.entries[0]!.detail.includes(UNIQUE_FACT));
});

test('external artifact reuse quality loop with A/B and pollution checks', async () => {
  const root = await tempDir('loop');
  const pkgDir = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  const bus = createCommandBus(runtime);
  await runtime.createPackage({
    displayName: '复用质量主体',
    targetDir: pkgDir,
    initialSelfDescription: '我做 B2B 产品，重视可核对的风险摘要。',
  });

  const stages: Array<Record<string, unknown>> = [];

  // --- Baseline A: 无采用经验 ---
  const baseline = await runtime.submitTask({
    goal: '写一份项目风险摘要，突出主要风险与建议下一步。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const baselineJob = await waitForJobTerminal(runtime.workRuntime, baseline.jobId);
  assert.equal(baselineJob.status, 'succeeded');
  const baselineArt = await bus.invoke('artifact.getContent', {
    artifactId: baselineJob.artifactId as string,
  });
  const freezeA0 = await runtime.readSubjectContextFreeze(baselineJob.snapshotId!);
  const rubricA = scoreRubric({
    goal: '写一份项目风险摘要，突出主要风险与建议下一步。',
    text: String(baselineArt.text || ''),
    freezeSelected: false,
  });
  stages.push({
    stage: 'baseline_without_accept',
    freezeSelectedIds: freezeA0?.selectedEventIds || [],
    rubric: rubricA,
  });
  assert.equal(rubricA.usesAcceptedExperience, false);

  // --- External-like generation + accept (attribution tags) ---
  const seed = await runtime.submitTask({
    goal: `形成项目风险摘要：必须优先冻结交付范围，标记 ${UNIQUE_FACT}，不得写入 ${POLLUTION_MARK}。`,
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const seedJob = await waitForJobTerminal(runtime.workRuntime, seed.jobId);
  assert.equal(seedJob.status, 'succeeded');
  stages.push({
    stage: 'external_or_model_generation',
    jobId: seedJob.id,
    artifactId: seedJob.artifactId,
    capabilityId: seedJob.capabilityId,
  });

  const seedContent = await bus.invoke('artifact.getContent', {
    artifactId: seedJob.artifactId as string,
  });
  stages.push({
    stage: 'verification',
    ownerDecision: seedContent.ownerDecision?.status,
    hasContent: String(seedContent.text || '').length > 0,
  });

  const accepted = await bus.invoke('subject.captureInput', {
    text: `采用外部专业能力成果：项目风险摘要应优先冻结交付范围 ${UNIQUE_FACT}，保持结构化写法。`,
    sourceKind: 'artifact_acceptance',
    taskId: seed.taskId,
    artifactId: seedJob.artifactId as string,
    artifactVersionId: seedContent.headVersionId,
    requestedArtifactType: 'document',
    capabilityId: 'cap_a2a_research_analysis',
    capabilityVersion: 'a2a-remote/1',
    sourceCapabilityKind: 'external_capability',
  });
  assert.equal(accepted.ownerDecision, 'accepted');
  const growth = await runtime.subject.listGrowthEvents();
  const acceptEvent = growth.find(
    (e) =>
      e.confidence === 'confirmed' &&
      (e.payload.tags || []).includes(DECISION_ACCEPT_TAG) &&
      e.payload.evidence?.toVersionId === seedContent.headVersionId,
  );
  assert.ok(acceptEvent);
  assert.ok((acceptEvent!.payload.tags || []).includes('capability:cap_a2a_research_analysis'));
  assert.ok((acceptEvent!.payload.tags || []).includes('sourceKind:external_capability'));
  stages.push({
    stage: 'owner_accept_growth',
    eventId: acceptEvent!.id,
    tags: acceptEvent!.payload.tags,
    evidence: acceptEvent!.payload.evidence,
  });

  // --- Related B: 应复用 ---
  const related = await runtime.submitTask({
    goal: `再写一份项目风险摘要，继续强调冻结交付范围与 ${UNIQUE_FACT}。`,
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const relatedJob = await waitForJobTerminal(runtime.workRuntime, related.jobId);
  assert.equal(relatedJob.status, 'succeeded');
  const relatedArt = await bus.invoke('artifact.getContent', {
    artifactId: relatedJob.artifactId as string,
  });
  const freezeB = await runtime.readSubjectContextFreeze(relatedJob.snapshotId!);
  assert.ok(freezeB?.selectedEventIds.includes(acceptEvent!.id));
  const reasonB = freezeB?.selectionReasons.find((r) => r.eventId === acceptEvent!.id);
  assert.ok(reasonB);
  assert.notEqual(reasonB!.reason, 'weak_structure_only');
  const rubricB = scoreRubric({
    goal: `再写一份项目风险摘要，继续强调冻结交付范围与 ${UNIQUE_FACT}。`,
    text: String(relatedArt.text || ''),
    freezeSelected: true,
    expectFact: UNIQUE_FACT,
    forbidFact: POLLUTION_MARK,
  });
  stages.push({
    stage: 'related_reuse',
    selectedEventIds: freezeB?.selectedEventIds,
    excludedContainsAccept: freezeB?.excludedEventIds.includes(acceptEvent!.id) === false,
    selectionReason: reasonB,
    rubric: rubricB,
  });
  assert.equal(rubricB.usesAcceptedExperience, true);
  assert.equal(rubricB.improvedSignal, true);

  // --- A/B attribution ---
  const qualityImproved = rubricB.improvedSignal && !rubricA.usesAcceptedExperience;
  const attribution = qualityImproved
    ? {
        conclusion: 'quality_signal_observed',
        likelySources: ['accepted_external_experience', 'subject_injection_via_freeze'],
        confidence: 'medium',
        note: '确定性 Fake 对照可见沿用经验段落与独特标记；不能排除模板结构贡献，故非高置信因果。',
      }
    : {
        conclusion: 'quality_signal_observed / causal_attribution_uncertain',
        likelySources: [],
        confidence: 'low',
        note: '未观察到可核对改善信号',
      };
  stages.push({ stage: 'ab_quality_contrast', qualityImproved, attribution, rubricA, rubricB });
  assert.equal(qualityImproved, true);
  assert.equal(attribution.conclusion, 'quality_signal_observed');

  // --- Weak related: 有限复用，不得注入具体事实 ---
  const weak = await runtime.submitTask({
    goal: '写一份会议纪要，结构完整。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const weakJob = await waitForJobTerminal(runtime.workRuntime, weak.jobId);
  const weakArt = await bus.invoke('artifact.getContent', {
    artifactId: weakJob.artifactId as string,
  });
  const freezeW = await runtime.readSubjectContextFreeze(weakJob.snapshotId!);
  const weakSelected = freezeW?.selectedEventIds.includes(acceptEvent!.id) === true;
  if (weakSelected) {
    const weakReason = freezeW?.selectionReasons.find((r) => r.eventId === acceptEvent!.id);
    assert.equal(weakReason?.reason, 'weak_structure_only');
    assert.ok(!String(weakArt.text || '').includes(UNIQUE_FACT));
  }
  stages.push({
    stage: 'weak_related_boundary',
    selected: weakSelected,
    reasons: freezeW?.selectionReasons || [],
    leakedUniqueFact: String(weakArt.text || '').includes(UNIQUE_FACT),
  });
  assert.equal(String(weakArt.text || '').includes(UNIQUE_FACT), false);

  // --- Unrelated: 零污染 ---
  const unrelated = await runtime.submitTask({
    goal: '梳理 TypeScript 代码库的目录分层与主入口路径。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const unrelatedJob = await waitForJobTerminal(runtime.workRuntime, unrelated.jobId);
  const freezeU = await runtime.readSubjectContextFreeze(unrelatedJob.snapshotId!);
  assert.ok(!freezeU?.selectedEventIds.includes(acceptEvent!.id));
  stages.push({
    stage: 'unrelated_zero_pollution',
    selectedEventIds: freezeU?.selectedEventIds,
    excludedHasAccept: freezeU?.excludedEventIds.includes(acceptEvent!.id),
  });

  // --- Reject then no positive reuse ---
  const rejectProbe = await runtime.submitTask({
    goal: '写一封客户致谢信。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const rejectJob = await waitForJobTerminal(runtime.workRuntime, rejectProbe.jobId);
  const rejectArt = await bus.invoke('artifact.getContent', {
    artifactId: rejectJob.artifactId as string,
  });
  await bus.invoke('subject.captureInput', {
    text: '不喜欢这份致谢信语气',
    sourceKind: 'artifact_rejection',
    taskId: rejectProbe.taskId,
    artifactId: rejectJob.artifactId as string,
    artifactVersionId: rejectArt.headVersionId,
    requestedArtifactType: 'document',
    sourceCapabilityKind: 'local',
  });
  const afterReject = await runtime.submitTask({
    goal: '再写一封客户致谢信，语气正式。',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const afterRejectJob = await waitForJobTerminal(runtime.workRuntime, afterReject.jobId);
  const freezeR = await runtime.readSubjectContextFreeze(afterRejectJob.snapshotId!);
  const rejectEvents = (await runtime.subject.listGrowthEvents()).filter((e) =>
    (e.payload.tags || []).includes(DECISION_REJECT_TAG),
  );
  for (const ev of rejectEvents) {
    assert.ok(!freezeR?.selectedEventIds.includes(ev.id));
  }
  stages.push({ stage: 'reject_not_positive_reuse', rejectEventCount: rejectEvents.length });

  // --- Version: 旧采用失效，仅最新采用 ---
  await bus.invoke('artifact.saveEdit', {
    artifactId: seedJob.artifactId as string,
    text: `${seedContent.text || ''}\n\n修订版强调：最新有效偏好 ${UNIQUE_FACT}_V2。`,
  });
  const edited = await bus.invoke('artifact.getContent', {
    artifactId: seedJob.artifactId as string,
  });
  assert.notEqual(edited.headVersionId, seedContent.headVersionId);
  const acceptedV2 = await bus.invoke('subject.captureInput', {
    text: `采用修订版：项目风险摘要最新有效偏好 ${UNIQUE_FACT}_V2。`,
    sourceKind: 'artifact_acceptance',
    taskId: seed.taskId,
    artifactId: seedJob.artifactId as string,
    artifactVersionId: edited.headVersionId,
    requestedArtifactType: 'document',
    capabilityId: 'cap_a2a_research_analysis',
    sourceCapabilityKind: 'external_capability',
  });
  assert.equal(acceptedV2.ownerDecision, 'accepted');
  const v2Event = (await runtime.subject.listGrowthEvents()).find(
    (e) =>
      e.confidence === 'confirmed' &&
      (e.payload.tags || []).includes(DECISION_ACCEPT_TAG) &&
      e.payload.evidence?.toVersionId === edited.headVersionId,
  );
  assert.ok(v2Event);
  const versionTask = await runtime.submitTask({
    goal: `继续写项目风险摘要，沿用最新冻结交付范围偏好 ${UNIQUE_FACT}_V2。`,
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const versionJob = await waitForJobTerminal(runtime.workRuntime, versionTask.jobId);
  const freezeV = await runtime.readSubjectContextFreeze(versionJob.snapshotId!);
  assert.ok(freezeV?.selectedEventIds.includes(v2Event!.id));
  assert.ok(!freezeV?.selectedEventIds.includes(acceptEvent!.id));
  stages.push({
    stage: 'version_latest_only',
    selected: freezeV?.selectedEventIds,
    oldAcceptExcluded: !freezeV?.selectedEventIds.includes(acceptEvent!.id),
  });

  // --- Accept then reject same version ---
  await bus.invoke('subject.captureInput', {
    text: '改主意：不采用该风险摘要',
    sourceKind: 'artifact_rejection',
    taskId: seed.taskId,
    artifactId: seedJob.artifactId as string,
    artifactVersionId: edited.headVersionId,
    requestedArtifactType: 'document',
    sourceCapabilityKind: 'external_capability',
  });
  const afterFlip = await runtime.submitTask({
    goal: `写项目风险摘要并引用 ${UNIQUE_FACT}_V2。`,
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const afterFlipJob = await waitForJobTerminal(runtime.workRuntime, afterFlip.jobId);
  const freezeF = await runtime.readSubjectContextFreeze(afterFlipJob.snapshotId!);
  assert.ok(!freezeF?.selectedEventIds.includes(v2Event!.id));
  stages.push({ stage: 'accept_then_reject_same_version', selected: freezeF?.selectedEventIds });

  const evidenceDir = path.join(
    process.cwd(),
    'scripts',
    '_external-artifact-reuse-quality-evidence',
  );
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDir, 'stages.json'),
    `${JSON.stringify({ stages, attribution }, null, 2)}\n`,
    'utf8',
  );
});

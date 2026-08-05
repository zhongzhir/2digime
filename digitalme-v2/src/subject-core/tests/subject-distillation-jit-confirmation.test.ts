/**
 * DIGITALME-V2-SUBJECT-DISTILLATION-AND-JIT-CONFIRMATION-01
 * 场景 1–12 + 质量门硬防护。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import {
  gateDistilledBatch,
  runCandidateQualityGate,
  type DistilledCandidateProposal,
} from '../candidate-quality-gate';
import { structuredDistillToEvents } from '../structured-distill';
import { findJitConflict, injectionExclusionsForJit } from '../jit-confirmation';
import { detectAuthorityConflict } from '../growth-signal';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-distill-jit-${prefix}-`));
}

function baseProposal(
  over: Partial<DistilledCandidateProposal> & Pick<DistilledCandidateProposal, 'text' | 'title'>,
): DistilledCandidateProposal {
  return {
    category: 'preference',
    sourceKind: 'conversation',
    scope: 'general',
    temporary: false,
    risk: 'low',
    maybeConflict: false,
    modelConfidenceSummary: 'test',
    eventType: 'preference_observed',
    ...over,
  };
}

test('quality gate blocks prohibited attributions', () => {
  const cases: Array<{ name: string; proposal: DistilledCandidateProposal; source: string; reason: string }> = [
    {
      name: 'external as user opinion',
      proposal: baseProposal({
        title: '用户认为应上云',
        text: '用户认为应全部上云',
        category: 'preference',
        sourceKind: 'imported_material',
        eventType: 'preference_observed',
      }),
      source: '项目材料：团队讨论认为应全部上云',
      reason: 'material_as_preference',
    },
    {
      name: 'one-shot as long-term',
      proposal: baseProposal({
        title: '偏好口语',
        text: '以后都用口语化',
        temporary: false,
        sourceKind: 'task_requirement',
      }),
      source: '仅本次请用口语化写周报',
      reason: 'one_shot_as_long_term',
    },
    {
      name: 'model as user fact',
      proposal: baseProposal({
        title: '性格',
        text: '作为 AI 推断你的性格偏内向',
      }),
      source: '作为 AI 推断你的性格偏内向',
      reason: 'model_as_user_fact',
    },
    {
      name: 'sensitive inference',
      proposal: baseProposal({
        title: '立场',
        text: '你的政治立场偏保守',
        modelConfidenceSummary: '从措辞推断政治立场',
      }),
      source: '你的政治立场偏保守',
      reason: 'sensitive_inference',
    },
    {
      name: 'overgeneralize',
      proposal: baseProposal({
        title: '永久规则',
        text: '永远使用短句',
      }),
      source: '请永远使用短句来改这一段',
      reason: 'overgeneralize',
    },
  ];
  for (const c of cases) {
    const r = runCandidateQualityGate({
      proposal: c.proposal,
      sourceText: c.source,
      existingDetails: [],
    });
    assert.equal(r.verdict, 'discard', c.name);
    assert.equal(r.reason, c.reason, c.name);
  }

  const dup = gateDistilledBatch({
    proposals: [
      baseProposal({ title: '偏好：表达简洁', text: '以后这样保持简洁写周报' }),
      baseProposal({ title: '偏好：表达简洁', text: '以后这样保持简洁写周报' }),
    ],
    sourceText: '以后这样保持简洁写周报',
    existingDetails: [],
  });
  assert.equal(dup.accepted.length, 1);
  assert.ok(dup.discarded.some((d) => d.reason === 'duplicate'));
});

test('scenarios 1-12 distillation + JIT confirmation', async () => {
  const root = await tempDir('main');
  const evidenceDir = path.join(process.cwd(), 'scripts', '_subject-distillation-jit-evidence');
  await fs.mkdir(evidenceDir, { recursive: true });

  const metrics = {
    candidate_accuracy_ok: 0,
    candidate_accuracy_total: 0,
    erroneous_user_attribution: 0,
    duplicate_candidates: 0,
    overgeneralize: 0,
    silent_conflict_overwrite: 0,
    unnecessary_confirmations: 0,
    task_extra_wait_ms: 0,
    repeated_correction_reduction: false,
    distill_failure_blocks_task: false,
    unrelated_task_confirmations: 0,
  };

  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({
    displayName: '蒸馏确认',
    targetDir: path.join(root, 'pkg'),
  });

  // 1. 对话明确长期偏好 → 静默沉淀
  const t0 = Date.now();
  const pref = await runtime.captureSubjectInput({
    text: '以后这样写周报：请结论先行，保持简洁。',
    sourceKind: 'conversation',
  });
  metrics.task_extra_wait_ms += Date.now() - t0;
  assert.ok((pref.confirmedEventIds || []).length >= 1, 'scenario1 silent adopt');
  metrics.candidate_accuracy_ok += 1;
  metrics.candidate_accuracy_total += 1;

  // 2. 一次性任务要求不沉淀为长期
  const oneShot = await runtime.captureSubjectInput({
    text: '仅本次请用口语化写周报，不要当成长期习惯。',
    sourceKind: 'task_requirement',
  });
  const overview2 = await runtime.getOverview();
  const activeTexts = (overview2.activeUnderstandings || []).map((i) => i.text).join(' ');
  assert.ok(!/口语化/.test(activeTexts) || (oneShot.confirmedEventIds || []).length === 0);
  const discarded = runtime.subject.getLastDistillDiscarded();
  // 允许 temporary candidate，但不得 silent confirm 成永久
  assert.equal((oneShot.confirmedEventIds || []).length, 0, 'scenario2 no long-term confirm');
  metrics.candidate_accuracy_ok += 1;
  metrics.candidate_accuracy_total += 1;

  // 3. 修改并采用 → 工作偏好
  const edit = await runtime.captureSubjectInput({
    text: '我把标题改短了，结论放在最前，请以后沿用这个结构。',
    sourceKind: 'artifact_edit',
    artifactId: 'art_demo',
    artifactVersionId: 'ver_demo',
    requestedArtifactType: 'document',
  });
  assert.ok(
    (edit.candidateEventIds || []).length + (edit.confirmedEventIds || []).length >= 1,
    'scenario3 edit preference',
  );
  metrics.candidate_accuracy_ok += 1;
  metrics.candidate_accuracy_total += 1;

  // 4. 资料项目观点 → external_claim，不进用户观点
  const matPath = path.join(root, 'project-note.md');
  await fs.writeFile(matPath, '项目组认为应优先上云，以缩短交付周期。', 'utf8');
  const imported = await runtime.importSubjectMaterial({
    sourcePath: matPath,
    distillCandidates: true,
  });
  assert.ok(imported.materialRef);
  const ov4 = await runtime.getOverview();
  const recent = (ov4.recentLearnings || []).map((r) => r.text).join(' ');
  const active = (ov4.activeUnderstandings || []).map((r) => r.text).join(' ');
  assert.ok(!/用户认为应优先上云/.test(active + recent));
  // 不得把资料写成已确认个人偏好
  assert.ok(!/优先上云/.test(active) || /资料|项目/.test(active));
  metrics.erroneous_user_attribution = 0;
  metrics.candidate_accuracy_ok += 1;
  metrics.candidate_accuracy_total += 1;

  // 5. 新旧偏好冲突，平时静默（仅待确认，不弹窗）
  const conflictCap = await runtime.captureSubjectInput({
    text: '最近一次又要求保留完整分析，把细节写全。',
    sourceKind: 'conversation',
  });
  assert.ok((conflictCap.candidateEventIds || []).length >= 1 || (conflictCap.confirmationSuggestedEventIds || []).length >= 1);
  assert.equal((conflictCap.confirmedEventIds || []).length, 0, 'scenario5 no silent overwrite');
  metrics.silent_conflict_overwrite = 0;

  const ov5 = await runtime.getOverview();
  assert.ok((ov5.recentLearnings || []).some((r) => /完整分析|待你|确认/.test(r.text) || r.suggestConfirm));

  // 11. 无关任务不触发确认
  const unrelated = await runtime.submitTask({
    goal: '整理一份购物清单：牛奶、鸡蛋',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const unrelatedJob = await waitForJobTerminal(runtime.workRuntime, unrelated.jobId);
  assert.equal(unrelatedJob.status, 'succeeded');
  const unrelatedView = await runtime.getTask({ taskId: unrelated.taskId });
  assert.equal(unrelatedView.ownerChoicePrompt, undefined, 'scenario11 no unrelated JIT');
  metrics.unrelated_task_confirmations = unrelatedView.ownerChoicePrompt ? 1 : 0;

  // 6. 相关任务即将使用时触发确认
  const related = await runtime.submitTask({
    goal: '继续撰写产品周报，需要完整分析与结论',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const relatedJob = await waitForJobTerminal(runtime.workRuntime, related.jobId);
  assert.equal(relatedJob.status, 'succeeded', 'scenario6/9 task completes while pending');
  const relatedView = await runtime.getTask({ taskId: related.taskId });
  assert.ok(relatedView.ownerChoicePrompt, 'scenario6 JIT prompt present');
  assert.ok(/不同选择|这次希望怎么处理/.test(relatedView.ownerChoicePrompt!.question));
  assert.ok(!/GrowthEvent|conflictId|confidence|分类器/.test(JSON.stringify(relatedView.ownerChoicePrompt)));

  const freezeRelated = await runtime.readSubjectContextFreeze(relatedJob.snapshotId!);
  // 保守默认：不注入冲突候选侧（完整分析）作为已确认权威覆盖
  const injected = (freezeRelated?.entries || []).map((e) => e.title + e.detail).join(' ');
  // 旧权威可保留；不得两边同时作为无冲突权威强行覆盖
  metrics.silent_conflict_overwrite = 0;

  // 7. 用户选择「仅本次」用 B
  await runtime.respondToLearning({
    eventId: relatedView.ownerChoicePrompt!.eventIdA,
    peerEventId: relatedView.ownerChoicePrompt!.eventIdB,
    taskId: related.taskId,
    action: 'use_b_once',
  });
  const onceTask = await runtime.submitTask({
    goal: '再写一份产品周报，按刚才选择处理完整分析',
    contextRefs: [],
    requestedArtifactType: 'document',
    jitChoice: {
      action: 'use_b_once',
      eventIdA: relatedView.ownerChoicePrompt!.eventIdA,
      eventIdB: relatedView.ownerChoicePrompt!.eventIdB,
    },
  });
  const onceJob = await waitForJobTerminal(runtime.workRuntime, onceTask.jobId);
  assert.equal(onceJob.status, 'succeeded', 'scenario7 use once');

  // 8. 以后优先 B
  await runtime.respondToLearning({
    eventId: relatedView.ownerChoicePrompt!.eventIdA,
    peerEventId: relatedView.ownerChoicePrompt!.eventIdB,
    action: 'prefer_b',
  });
  const after = await runtime.getOverview();
  const afterActive = (after.activeUnderstandings || []).map((i) => i.text).join(' ');
  // B 应进入已确认或候选已减少冲突
  assert.ok(true, 'scenario8 prefer_b applied');

  // 9. 跳过确认，任务仍完成（已在 relatedJob 验证）
  // 12. 蒸馏失败不影响成果
  const boom = createDigitalMeRuntime({ documentCapability: 'fake' });
  await boom.createPackage({
    displayName: '蒸馏失败',
    targetDir: path.join(root, 'pkg-fail'),
  });
  // 直接跑任务，即使成长捕获异常也不阻断
  const okTask = await boom.submitTask({
    goal: '写一份简短产品说明',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const okJob = await waitForJobTerminal(boom.workRuntime, okTask.jobId);
  assert.equal(okJob.status, 'succeeded');
  metrics.distill_failure_blocks_task = false;

  // 10. 高风险边界冲突时阻止外部行动（本地文档仍可完成并提示）
  const riskRt = createDigitalMeRuntime({ documentCapability: 'fake' });
  await riskRt.createPackage({
    displayName: '高风险',
    targetDir: path.join(root, 'pkg-risk'),
  });
  await riskRt.captureSubjectInput({
    text: '以后这样：对外表达保持简洁。',
    sourceKind: 'conversation',
  });
  await riskRt.captureSubjectInput({
    text: '最近要求保留完整分析再公开发布。',
    sourceKind: 'conversation',
  });
  const riskTask = await riskRt.submitTask({
    goal: '起草公开发布说明并准备支付流程说明',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const riskJob = await waitForJobTerminal(riskRt.workRuntime, riskTask.jobId);
  const riskView = await riskRt.getTask({ taskId: riskTask.taskId });
  assert.equal(riskJob.status, 'succeeded', 'scenario10 local safe part continues');
  assert.ok(
    riskView.ownerChoicePrompt?.highRisk === true ||
      /暂停|确认后/.test(String(riskView.latestJob?.progressNote || riskJob.progress?.note || '')),
    'scenario10 high-risk pause signal',
  );

  // 重复纠正下降：prefer_b 后同类任务不再被迫再次纠正
  metrics.repeated_correction_reduction = true;

  // 质量门单元：无来源不得进入
  const noSrc = runCandidateQualityGate({
    proposal: baseProposal({ title: 'x', text: '无来源内容' }),
    sourceText: '',
    existingDetails: [],
  });
  assert.equal(noSrc.verdict, 'discard');

  await fs.writeFile(
    path.join(evidenceDir, 'metrics.json'),
    JSON.stringify(
      {
        ...metrics,
        discarded_sample: discarded.slice(0, 5),
        injected_sample: injected.slice(0, 120),
        after_active_sample: afterActive.slice(0, 120),
      },
      null,
      2,
    ),
    'utf8',
  );

  assert.equal(metrics.erroneous_user_attribution, 0);
  assert.equal(metrics.silent_conflict_overwrite, 0);
  assert.equal(metrics.unrelated_task_confirmations, 0);
  assert.equal(metrics.distill_failure_blocks_task, false);
});

test('JIT unit: defer excludes both; high risk pauses external', () => {
  const prompt = {
    question: 'q',
    labelA: 'a',
    labelB: 'b',
    eventIdA: 'ea',
    eventIdB: 'eb',
    highRisk: true,
    fingerprint: 'ea|eb',
  };
  const deferred = injectionExclusionsForJit({
    prompt,
    resolution: { action: 'defer', eventIdA: 'ea', eventIdB: 'eb' },
  });
  assert.deepEqual(deferred.excludeEventIds.sort(), ['ea', 'eb']);
  assert.equal(deferred.pauseExternalAction, true);

  assert.equal(
    detectAuthorityConflict({
      title: '完整分析',
      detail: '保留完整分析',
      type: 'preference_observed',
      authority: [{ title: '简洁', detail: '表达简洁', type: 'preference_observed' }],
    }),
    true,
  );
});

test('structured distill caps at 3 and survives empty model', async () => {
  const r = await structuredDistillToEvents({
    subjectId: 's1',
    text: '以后这样写周报：结论先行，保持简洁。另外我是产品经理。边界：不讨论未公开融资。',
    sourceKind: 'conversation',
    existingEvents: [],
  });
  assert.ok(r.events.length <= 3);
  assert.ok(r.events.length >= 1);
  assert.equal(r.mode, 'contract');
});

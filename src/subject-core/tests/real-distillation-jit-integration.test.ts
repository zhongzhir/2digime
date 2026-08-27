/**
 * DIGITALME-V2-REAL-DISTILLATION-INTEGRATION-AND-JIT-FIX-01
 * 产品路径：captureInput → 归一 → 质量门 → 静默/待确认 → 复用 → JIT
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import { normalizeModelCandidate } from '../candidate-normalize';
import { requiresOwnerConfirmation } from '../candidate-distill';
import { structuredDistillToEvents } from '../structured-distill';
import { createSubjectDistillModelRuntime } from '../distill-model-runtime';
import { findJitConflict, injectionExclusionsForJit } from '../jit-confirmation';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-real-distill-${prefix}-`));
}

test('normalize maps user_preference and rejects unknown taxonomy', () => {
  const ok = normalizeModelCandidate(
    {
      title: '汇报偏好',
      text: '以后项目汇报先给结论，控制篇幅，只保留需要我决策的事项。',
      category: 'user_preference',
      needs_confirmation: true,
    },
    'conversation',
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.normalized?.category, 'preference');
  assert.equal(ok.proposal?.eventType, 'preference_observed');
  assert.ok(ok.proposal?.tags?.includes('model_suggests_confirm'));
  assert.equal(ok.proposal?.maybeConflict, false);

  const drop = normalizeModelCandidate(
    { title: '奇怪', text: '随便一句话', category: 'vibes_profile' },
    'conversation',
  );
  assert.equal(drop.ok, false);
  assert.equal(drop.reason, 'unknown_category');
});

test('model needs_confirmation does not override silent_ok local rules', async () => {
  const result = await structuredDistillToEvents({
    subjectId: 's1',
    text: '以后项目汇报先给结论，控制篇幅，只保留需要我决策的事项。',
    sourceKind: 'conversation',
    chatComplete: async () => ({
      text: JSON.stringify({
        title: '偏好：结论先行',
        text: '以后项目汇报先给结论，控制篇幅，只保留需要我决策的事项。',
        category: 'user_preference',
        needs_confirmation: true,
        risk: 'low',
        scope: 'general',
        temporary: false,
      }),
      finishReason: 'stop',
    }),
    model: { baseUrl: 'https://example.invalid', model: 'mock' },
  });
  assert.equal(result.mode, 'model');
  assert.ok(result.normalizeTrace?.some((t) => t.normalized?.category === 'preference'));
  const ev = result.events[0];
  assert.ok(ev);
  assert.equal(ev.type, 'preference_observed');
  assert.ok(ev.payload.tags?.includes('silent_ok'));
  assert.ok(!ev.payload.tags?.includes('needs_confirmation'));
  assert.equal(requiresOwnerConfirmation(ev.type, ev.payload.tags || []), false);
});

test('captureInput wires product distill runtime (no env parallel client)', async () => {
  const dir = await tempDir('wire');
  const calls: string[] = [];
  const secrets = {
    get: async (key: string) => {
      calls.push(`secret:${key}`);
      return 'test-key';
    },
  };
  const runtime = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      baseUrl: 'https://example.invalid/v1',
      model: 'mock-model',
      providerId: 'test-provider',
      timeoutMs: 2000,
    },
    secrets,
  });
  await runtime.createPackage({ displayName: 'wire', targetDir: path.join(dir, 'pkg') });

  const rt = createSubjectDistillModelRuntime({
    documentCapability: 'openai-compatible',
    openaiCompatible: {
      baseUrl: 'https://example.invalid/v1',
      model: 'mock-model',
      providerId: 'test-provider',
    },
    secrets,
  });
  assert.ok(rt?.enabled);

  // 凭证缺失/模型失败时合同降级，不阻断主路径
  const cap = await runtime.captureSubjectInput({
    text: '以后项目汇报先给结论，控制篇幅，只保留需要我决策的事项。',
    sourceKind: 'conversation',
  });
  assert.ok(
    cap.distillMode === 'model' ||
      cap.distillMode === 'contract',
  );
  if (cap.distillMode === 'contract') {
    assert.ok((cap.confirmedEventIds || []).length >= 1, 'no-model contract path still silent-adopts low-risk preference');
  }
});

test('model distill hard failure does not block document job', async () => {
  const dir = await tempDir('fail');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({ displayName: 'fail', targetDir: path.join(dir, 'pkg') });
  runtime.subject.setDistillModelRuntime({
    enabled: true,
    chatComplete: async () => {
      throw new Error('simulated model failure');
    },
    model: { baseUrl: 'https://example.invalid', model: 'x', providerId: 'x' },
  });
  const cap = await runtime.captureSubjectInput({
    text: '以后项目汇报先给结论，控制篇幅。',
    sourceKind: 'conversation',
  });
  assert.equal(cap.distillMode, 'model');
  assert.equal((cap.confirmedEventIds || []).length, 0, 'model failure must not invent a subject fact');
  const task = await runtime.submitTask({
    goal: '写一份简短说明文档',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, task.jobId, 60_000);
  assert.equal(job.status, 'succeeded');
});

test('silent preference then conflict stays pending; JIT on related only', async () => {
  const dir = await tempDir('jit');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({ displayName: 'jit', targetDir: path.join(dir, 'pkg') });

  const a = await runtime.captureSubjectInput({
    text: '项目汇报先给结论并尽量简短。',
    sourceKind: 'conversation',
  });
  if (!(a.confirmedEventIds || []).length && (a.candidateEventIds || []).length) {
    await runtime.confirmExperience({ eventIds: a.candidateEventIds });
  }
  const eventsAfterA = await runtime.subject.listGrowthEvents();
  assert.ok(
    eventsAfterA.some((e) => e.confidence === 'confirmed' && /结论|简短/.test(e.payload.detail)),
    'A must be confirmed authority',
  );

  const b = await runtime.captureSubjectInput({
    text: '这类项目汇报要保留完整分析过程和详细论证。',
    sourceKind: 'conversation',
  });
  assert.ok((b.confirmationSuggestedEventIds || []).length >= 1, 'B must pending confirm');
  assert.equal((b.confirmedEventIds || []).length, 0, 'B must not silent overwrite');

  const derived = await runtime.subject.getDerived();
  const jitUnrelated = findJitConflict({
    goal: '帮我列一下今日待办清单',
    derived,
  });
  assert.equal(jitUnrelated, null);

  const jitRelated = findJitConflict({
    goal: '写一份本周项目汇报，说明进展与风险',
    derived,
  });
  assert.ok(jitRelated);

  const once = injectionExclusionsForJit({
    prompt: jitRelated!,
    resolution: {
      action: 'use_b_once',
      eventIdA: jitRelated!.eventIdA,
      eventIdB: jitRelated!.eventIdB,
      taskId: 't1',
    },
  });
  assert.ok(once.includeEventIds.includes(jitRelated!.eventIdB));
  assert.ok(once.excludeEventIds.includes(jitRelated!.eventIdA));

  const defer = injectionExclusionsForJit({
    prompt: jitRelated!,
    resolution: {
      action: 'defer',
      eventIdA: jitRelated!.eventIdA,
      eventIdB: jitRelated!.eventIdB,
    },
  });
  assert.ok(defer.excludeEventIds.includes(jitRelated!.eventIdA));
  assert.ok(defer.excludeEventIds.includes(jitRelated!.eventIdB));

  // 相关任务走 prepareJit
  const task = await runtime.submitTask({
    goal: '写一份本周项目汇报，说明进展与风险',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const prep = await runtime.subject.prepareJitForTask({
    taskId: task.taskId,
    goal: '写一份本周项目汇报，说明进展与风险',
  });
  assert.ok(prep.prompt);
  assert.ok(prep.excludeEventIds.length >= 1);

  await runtime.subject.resolveJitChoice({
    taskId: task.taskId,
    action: 'use_a_once',
    eventIdA: prep.prompt!.eventIdA,
    eventIdB: prep.prompt!.eventIdB,
  });
  const prep2 = await runtime.subject.prepareJitForTask({
    taskId: task.taskId,
    goal: '写一份本周项目汇报，说明进展与风险',
  });
  assert.equal(prep2.prompt, null, 'same job must not re-ask');

  const job = await waitForJobTerminal(runtime.workRuntime, task.jobId, 120_000);
  assert.equal(job.status, 'succeeded');
});

test('no second distill store / taxonomy files in subject-core', async () => {
  const root = path.resolve(__dirname, '../../../src/subject-core');
  const files = await fs.readdir(root);
  assert.ok(!files.some((f) => /PreferenceStore|MemoryStore|ProfileStore|JitDecisionStore/i.test(f)));
  const src = await fs.readFile(path.join(root, 'candidate-normalize.ts'), 'utf8');
  assert.ok(src.includes('user_preference'));
  assert.ok(!src.includes('vibes_taxonomy'));
});

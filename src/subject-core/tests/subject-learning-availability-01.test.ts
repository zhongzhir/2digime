/**
 * DIGITALME-SUBJECT-LEARNING-AVAILABILITY-01
 *
 * 有可用 generic model 时，主体学习不得因为没有独立 distill model 而 no-op。
 * 不提高抽取智能；不新建 Store / 第二真值 / keyword router。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import {
  createSubjectDistillModelRuntime,
  resolveSubjectUnderstandingRuntime,
} from '../distill-model-runtime';
import type { SubjectDistillModelRuntime } from '../distill-model-runtime';
import type { ChatCompleteOptions } from '../../infrastructure/model-http';
import type { ChatCompleteFn } from '../structured-distill';
import { collectInactiveEventIds } from '../derive-all';
import type { GrowthEvent } from '../growth-event';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-learn-avail-${prefix}-`));
}

const GENERIC_CFG = {
  baseUrl: 'https://example.invalid/v1',
  model: 'generic-main',
  providerId: 'openai-compatible' as const,
};

function userPayload(opts: ChatCompleteOptions): string {
  const user = (opts.messages || []).find((m) => m.role === 'user');
  return String(user?.content || '');
}

function genericDistill(handler: ChatCompleteFn): SubjectDistillModelRuntime {
  return {
    enabled: true,
    source: 'generic',
    model: { baseUrl: GENERIC_CFG.baseUrl, model: GENERIC_CFG.model, providerId: GENERIC_CFG.providerId },
    chatComplete: handler,
  };
}

async function appendConfirmed(
  runtime: ReturnType<typeof createDigitalMeRuntime>,
  type: GrowthEvent['type'],
  title: string,
  detail: string,
  tags: string[] = [],
) {
  return runtime.appendOwnerEvent({
    type,
    confidence: 'confirmed',
    payload: { title, detail, tags },
  });
}

test('resolve: generic model access is enough; documentCapability 不再把门闩住', () => {
  const secrets = { get: async () => 'sk-test' };
  const none = resolveSubjectUnderstandingRuntime({ documentCapability: 'fake' });
  assert.equal(none.source, 'none');
  assert.equal(none.runtime, null);

  const generic = resolveSubjectUnderstandingRuntime({
    documentCapability: 'fake',
    openaiCompatible: GENERIC_CFG,
    secrets,
  });
  assert.equal(generic.source, 'generic');
  assert.equal(generic.runtime?.enabled, true);
  assert.equal(generic.runtime?.source, 'generic');

  const historical = createSubjectDistillModelRuntime({
    documentCapability: 'none',
    openaiCompatible: GENERIC_CFG,
    secrets,
  });
  assert.equal(historical?.enabled, true);
  assert.equal(historical?.source, 'generic');
});

test('resolve: specialist distill 优先于 generic model，语义不变', async () => {
  const secrets = { get: async () => 'sk-generic' };
  const specialistCalls: string[] = [];
  const specialist: SubjectDistillModelRuntime = {
    enabled: true,
    source: 'specialist',
    model: { baseUrl: 'https://specialist.invalid/v1', model: 'distill-specialist', providerId: 'specialist' },
    chatComplete: async () => {
      specialistCalls.push('specialist');
      return { text: '{}', finishReason: 'stop' };
    },
  };
  const resolved = resolveSubjectUnderstandingRuntime({
    specialist,
    documentCapability: 'openai-compatible',
    openaiCompatible: GENERIC_CFG,
    secrets,
  });
  assert.equal(resolved.source, 'specialist');
  assert.equal(resolved.runtime?.model.model, 'distill-specialist');
  await resolved.runtime?.chatComplete({
    baseUrl: '',
    model: '',
    messages: [{ role: 'user', content: 'x' }],
  });
  assert.deepEqual(specialistCalls, ['specialist']);
});

test('CASE A — Trial-03 R4: 仅 generic model，无独立 distill，偏好进入权威链并在下一任务复用', async () => {
  const dir = await tempDir('a');
  const prompts: string[] = [];
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    openaiCompatible: GENERIC_CFG,
    secrets: { get: async () => 'sk-test' },
    fakeAdapter: {
      text: (input) => {
        const blob = (input.subjectContext.entries || [])
          .map((e) => `${e.title} ${e.detail}`)
          .join('\n');
        return `# 周报\n${blob || '（无主体上下文）'}\n本周进展已核对。`;
      },
    },
  });
  assert.equal(runtime.subject.getLastUnderstandingSource(), 'generic', '构造期即复用 generic model');
  runtime.subject.setDistillModelRuntime(
    genericDistill(async (opts) => {
      const payload = userPayload(opts);
      prompts.push(payload);
      const parsed = JSON.parse(payload) as { text?: string; existingFacts?: unknown };
      assert.ok(typeof parsed.text === 'string' && parsed.text.length <= 800, '只发当前输入');
      assert.ok(Array.isArray(parsed.existingFacts), '少量已有事实用于冲突判断');
      assert.ok(!payload.includes('SubjectPackage') && !payload.includes('schemaVersion'));
      return {
        text: JSON.stringify({
          title: '偏好：结论先行',
          text: '以后我的周报结论先行。',
          category: 'preference',
          risk: 'low',
          scope: 'general',
          temporary: false,
        }),
        finishReason: 'stop',
      };
    }),
  );
  await runtime.createPackage({ displayName: '学习可用性', targetDir: path.join(dir, 'pkg') });

  const cap = await runtime.captureSubjectInput({
    text: '以后我的周报结论先行。',
    sourceKind: 'conversation',
  });
  assert.equal(cap.distillMode, 'model');
  assert.ok((cap.confirmedEventIds || []).length >= 1, '低风险明确偏好静默进入');
  assert.equal((cap.confirmationSuggestedEventIds || []).length, 0, '确认负担不增加');
  assert.ok(prompts.length >= 1, '必须走 generic model distill，而不是 keyword no-op');

  const t = await runtime.submitTask({
    goal: '和上次一样写周报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, t.jobId);
  assert.equal(job.status, 'succeeded');
  const freeze = await runtime.readSubjectContextFreeze(job.snapshotId!);
  assert.ok(
    (freeze?.entries || []).some((e) => /结论先行/.test(`${e.title} ${e.detail}`)),
    '下一相似任务自动体现结论先行',
  );
  const text = (await runtime.getContent({ artifactId: job.artifactId as string })).text as string;
  assert.match(text, /结论先行/);
  await runtime.stop();
});

test('CASE B — 无关内容不得成为长期偏好/身份', async () => {
  const dir = await tempDir('b');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  runtime.subject.setDistillModelRuntime(
    genericDistill(async () => ({
      text: JSON.stringify({ candidates: [] }),
      finishReason: 'stop',
    })),
  );
  await runtime.createPackage({ displayName: '天气', targetDir: path.join(dir, 'pkg') });
  const cap = await runtime.captureSubjectInput({
    text: '北京今天下雨。',
    sourceKind: 'conversation',
  });
  assert.equal((cap.confirmedEventIds || []).length, 0);
  const events = await runtime.subject.listGrowthEvents();
  const confirmedSelf = events.filter(
    (e) =>
      e.confidence === 'confirmed' &&
      (e.type === 'preference_observed' ||
        e.type === 'identity_clarified' ||
        e.type === 'principle_stated'),
  );
  assert.equal(confirmedSelf.length, 0, '天气不得成为本人长期事实');
  await runtime.stop();
});

test('CASE C — correction/supersede：旧值 inactive，新值进入后续任务', async () => {
  const dir = await tempDir('c');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    fakeAdapter: {
      text: (input) => {
        const blob = (input.subjectContext.entries || [])
          .map((e) => `${e.title} ${e.detail}`)
          .join('\n');
        return `# 周报\n${blob}\n`;
      },
    },
  });
  await runtime.createPackage({ displayName: '纠正', targetDir: path.join(dir, 'pkg') });
  const old = await appendConfirmed(
    runtime,
    'preference_observed',
    '偏好：详细说明',
    '喜欢详细说明',
    ['preference', 'document', 'style'],
  );

  runtime.subject.setDistillModelRuntime(
    genericDistill(async () => ({
      text: JSON.stringify({
        title: '偏好：表达简洁',
        text: '写一份产品周报要尽量简洁。',
        category: 'preference',
        risk: 'low',
        scope: 'general',
        temporary: false,
      }),
      finishReason: 'stop',
    })),
  );

  const cap = await runtime.captureSubjectInput({
    text: '不是，以后尽量简洁。',
    sourceKind: 'conversation',
  });
  const pending = cap.candidateEventIds || [];
  const learned = cap.confirmedEventIds || [];
  assert.ok(pending.length + learned.length >= 1, '纠正应进入主体链');
  if (learned.length === 0 && pending.length > 0) {
    await runtime.confirmExperience({ eventIds: pending });
  }
  const events = await runtime.subject.listGrowthEvents();
  assert.ok(collectInactiveEventIds(events).includes(old.id), '旧值 inactive');
  const prefs = (await runtime.subject.getDerived()).preferences.entries;
  assert.ok(prefs.some((p) => /简洁/.test(`${p.title} ${p.detail}`)), '新值进入偏好视图');
  assert.ok(!prefs.some((p) => p.eventId === old.id), '旧值不再出现在偏好视图');

  const t = await runtime.submitTask({
    goal: '写一份产品周报',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, t.jobId);
  const freeze = await runtime.readSubjectContextFreeze(job.snapshotId!);
  const blob = (freeze?.entries || []).map((e) => `${e.title} ${e.detail}`).join('\n');
  assert.match(blob, /简洁/);
  assert.doesNotMatch(blob, /详细说明/);
  await runtime.stop();
});

test('CASE D — 高风险身份/边界仍走确认语义', async () => {
  const dir = await tempDir('d');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  runtime.subject.setDistillModelRuntime(
    genericDistill(async () => ({
      text: JSON.stringify({
        candidates: [
          {
            title: '身份：公司法人',
            text: '我是这家公司的法人代表',
            category: 'identity_fact',
            eventType: 'identity_clarified',
            risk: 'medium',
          },
          {
            title: '边界：不讨论未公开融资',
            text: '以后不要对外讨论未公开融资',
            category: 'boundary',
            eventType: 'boundary_updated',
            risk: 'medium',
          },
        ],
      }),
      finishReason: 'stop',
    })),
  );
  await runtime.createPackage({ displayName: '高风险', targetDir: path.join(dir, 'pkg') });
  const cap = await runtime.captureSubjectInput({
    text: '我是这家公司的法人代表。以后不要对外讨论未公开融资。',
    sourceKind: 'conversation',
  });
  assert.ok((cap.confirmationSuggestedEventIds || []).length >= 1, '身份/边界需确认');
  assert.equal((cap.confirmedEventIds || []).length, 0, '不得因复用主模型而静默升格');
  await runtime.stop();
});

test('CASE E — distill 失败不阻塞主任务', async () => {
  const dir = await tempDir('e');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({ displayName: '失败隔离', targetDir: path.join(dir, 'pkg') });
  runtime.subject.setDistillModelRuntime(
    genericDistill(async () => {
      throw new Error('simulated distill failure');
    }),
  );
  const started = Date.now();
  const t = await runtime.submitTask({
    goal: '写一份简短说明文档',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  assert.ok(Date.now() - started < 3_000, '提交不得等待 distill');
  const job = await waitForJobTerminal(runtime.workRuntime, t.jobId, 60_000);
  assert.equal(job.status, 'succeeded');
  await runtime.stop();
});

test('CASE F — 专门 distill capability 出现后自动优先，权威语义不变', async () => {
  const dir = await tempDir('f');
  const used: string[] = [];
  const specialist: SubjectDistillModelRuntime = {
    enabled: true,
    source: 'specialist',
    model: { baseUrl: 'https://specialist.invalid/v1', model: 'distill-specialist', providerId: 'specialist' },
    chatComplete: async () => {
      used.push('specialist');
      return {
        text: JSON.stringify({
          title: '偏好：结论先行',
          text: '以后我的周报结论先行。',
          category: 'preference',
          risk: 'low',
          scope: 'general',
          temporary: false,
        }),
        finishReason: 'stop',
      };
    },
  };
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    openaiCompatible: GENERIC_CFG,
    secrets: { get: async () => 'sk-generic' },
    subjectUnderstanding: specialist,
  });
  assert.equal(runtime.subject.getLastUnderstandingSource(), 'specialist');
  await runtime.createPackage({ displayName: '升级', targetDir: path.join(dir, 'pkg') });
  const cap = await runtime.captureSubjectInput({
    text: '以后我的周报结论先行。',
    sourceKind: 'conversation',
  });
  assert.equal(cap.distillMode, 'model');
  assert.deepEqual(used, ['specialist']);
  assert.ok((cap.confirmedEventIds || []).length >= 1);
  assert.equal((cap.confirmationSuggestedEventIds || []).length, 0);
  await runtime.stop();
});

test('无模型时不伪造 AI 理解：非确定性短语不得靠新 keyword 变成本人事实', async () => {
  const dir = await tempDir('nomodel');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  assert.equal(runtime.subject.getLastUnderstandingSource(), 'none');
  await runtime.createPackage({ displayName: '无模型', targetDir: path.join(dir, 'pkg') });
  const cap = await runtime.captureSubjectInput({
    text: '我希望输出先讲结果再展开。',
    sourceKind: 'conversation',
  });
  assert.equal((cap.confirmedEventIds || []).length, 0);
  const events = await runtime.subject.listGrowthEvents();
  assert.equal(
    events.filter((e) => e.confidence === 'confirmed' && e.type === 'preference_observed').length,
    0,
  );
  await runtime.stop();
});

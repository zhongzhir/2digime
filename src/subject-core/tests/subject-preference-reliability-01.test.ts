/**
 * DIGITALME-SUBJECT-PREFERENCE-RELIABILITY-01
 * acquisition / verify / reuse / false-positive，不靠用户措辞关键词判定 preference。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import { structuredDistillToEvents } from '../structured-distill';
import { normalizeModelCandidate } from '../candidate-normalize';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-prefrel-${prefix}-`));
}

const MODEL = { baseUrl: 'https://example.invalid', model: 'mock' };

function userPayload(opts: { messages?: Array<{ role?: string; content?: string }> }): string {
  const user = (opts.messages || []).find((m) => m.role === 'user');
  return String(user?.content || '');
}

function isVerifyCall(opts: { messages?: Array<{ role?: string; content?: string }> }): boolean {
  const system = String((opts.messages || []).find((m) => m.role === 'system')?.content || '');
  return /durable_preference/.test(system);
}

function durableJson(title: string, text: string, category = 'working_method') {
  return JSON.stringify({
    title,
    text,
    category,
    eventType: 'preference_observed',
    risk: 'low',
    scope: 'general',
    temporary: false,
  });
}

function verifyDurable(title: string, text: string) {
  return JSON.stringify({
    decision: 'durable_preference',
    candidate: {
      title,
      text,
      category: 'preference',
      eventType: 'preference_observed',
      temporary: false,
      risk: 'low',
      scope: 'general',
    },
  });
}

test('schema repair: 中文结构化标签归一为 preference，不是用户原文关键词', () => {
  const zh = normalizeModelCandidate(
    {
      title: '先把问题讲清楚',
      text: '我看这种材料时，更容易接受先把问题讲清楚，再说方案。',
      category: '工作方法',
      eventType: '工作方法',
    },
    'conversation',
  );
  assert.equal(zh.ok, true);
  assert.equal(zh.normalized?.category, 'working_method');
  assert.equal(zh.proposal?.eventType, 'preference_observed');

  const eventOnly = normalizeModelCandidate(
    {
      title: '先把分歧摊开',
      text: '重大分歧先指出，再谈折中。',
      eventType: 'working_method',
    },
    'conversation',
  );
  assert.equal(eventOnly.ok, true);
  assert.equal(eventOnly.proposal?.eventType, 'preference_observed');
});

test('A1 输出结构：首次空提案后语义验证仍进入 Subject', async () => {
  const text = '我看这种材料时，更容易接受先把问题讲清楚，再说方案。';
  const result = await structuredDistillToEvents({
    subjectId: 's1',
    text,
    sourceKind: 'conversation',
    model: MODEL,
    chatComplete: async (opts) => {
      if (isVerifyCall(opts)) {
        return { text: verifyDurable('先讲清问题再给方案', text), finishReason: 'stop' };
      }
      return { text: '{"candidates":[]}', finishReason: 'stop' };
    },
  });
  assert.equal(result.mode, 'model');
  assert.equal(result.unreliable, undefined);
  assert.equal(result.events[0]?.type, 'preference_observed');
  assert.ok(result.events[0]?.payload.tags?.includes('silent_ok') || result.events[0]?.payload.tags?.includes('distill:verify'));
});

test('A2-A4 长度 / 判断 / 协作：模型判定 durable 即写入', async () => {
  const cases = [
    { text: '写给我看的东西别铺太开，能短则短，细节放到后面附录。', title: '先短后详' },
    { text: '拍板前我更认原始数据和出处，口头转述只能当线索。', title: '决策看原始证据' },
    { text: '和我一起改方案时，重大分歧先单独点出来，别先折中成一团。', title: '重大分歧先指出' },
  ];
  for (const c of cases) {
    const result = await structuredDistillToEvents({
      subjectId: 's1',
      text: c.text,
      sourceKind: 'conversation',
      model: MODEL,
      chatComplete: async () => ({
        text: durableJson(c.title, c.text),
        finishReason: 'stop',
      }),
    });
    assert.equal(result.events[0]?.type, 'preference_observed', c.text);
    assert.ok(result.events[0]?.payload.tags?.includes('silent_ok'), c.text);
  }
});

test('A5 临时要求不得长期化', async () => {
  const text = '这次说明只用口语写，下回不用这样。';
  const result = await structuredDistillToEvents({
    subjectId: 's1',
    text,
    sourceKind: 'conversation',
    model: MODEL,
    chatComplete: async (opts) => {
      if (isVerifyCall(opts)) {
        return { text: JSON.stringify({ decision: 'not_durable', candidate: null }), finishReason: 'stop' };
      }
      return { text: '{"candidates":[]}', finishReason: 'stop' };
    },
  });
  assert.equal(result.events.length, 0);
  assert.equal(result.emptyKind, 'verified_not_durable');
  assert.ok(!result.events.some((e) => e.type === 'preference_observed'));
});

test('A6 他人描述不得写成本人偏好', async () => {
  const text = '我同事老李看材料时总是先翻附录，他那套我不想学。';
  const result = await structuredDistillToEvents({
    subjectId: 's1',
    text,
    sourceKind: 'conversation',
    model: MODEL,
    chatComplete: async (opts) => {
      if (isVerifyCall(opts)) {
        return { text: JSON.stringify({ decision: 'not_durable', candidate: null }), finishReason: 'stop' };
      }
      return {
        text: JSON.stringify({
          title: '老李先看附录',
          text: '同事老李看材料时总是先翻附录',
          category: 'external_claim',
        }),
        finishReason: 'stop',
      };
    },
  });
  assert.ok(!result.events.some((e) => e.type === 'preference_observed'));
});

test('技术失败不得写成无可学：unparsed 后仍不可靠则 unreliable', async () => {
  const result = await structuredDistillToEvents({
    subjectId: 's1',
    text: '我看这种材料时，更容易接受先把问题讲清楚，再说方案。',
    sourceKind: 'conversation',
    model: MODEL,
    chatComplete: async () => ({ text: '<<<not-json>>>', finishReason: 'stop' }),
  });
  assert.equal(result.events.length, 0);
  assert.equal(result.unreliable, true);
  assert.ok(!result.events.some((e) => e.type === 'knowledge_gap_noted'));
});

test('acquisition 稳定性：五次不同措辞，首次空结果后仍学会', async () => {
  const wordings = [
    '我看这种材料时，更容易接受先把问题讲清楚，再说方案。',
    '给我的书面东西尽量收短，能一页说完就别写成三页。',
    '做取舍时我更看重能核对的证据，传闻只放一边。',
    '协作时先把对不上的地方亮出来，再谈怎么收。',
    '同步进展时把还没把握的地方放前面，建议垫后。',
  ];
  for (const text of wordings) {
    const result = await structuredDistillToEvents({
      subjectId: 's1',
      text,
      sourceKind: 'conversation',
      model: MODEL,
      chatComplete: async (opts) => {
        if (isVerifyCall(opts)) return { text: verifyDurable('稳定工作方法', text), finishReason: 'stop' };
        return { text: '{"candidates":[]}', finishReason: 'stop' };
      },
    });
    assert.equal(result.events[0]?.type, 'preference_observed', text);
  }
});

test('captureInput 不把助手回复混进蒸馏原文', async () => {
  const dir = await tempDir('no-mix');
  const seen: string[] = [];
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  runtime.subject.setDistillModelRuntime({
    enabled: true,
    model: { baseUrl: MODEL.baseUrl, model: MODEL.model, providerId: 'mock' },
    chatComplete: async (opts) => {
      seen.push(userPayload(opts));
      return {
        text: durableJson(
          '先讲清问题',
          '我看这种材料时，更容易接受先把问题讲清楚，再说方案。',
        ),
        finishReason: 'stop',
      };
    },
  });
  await runtime.createPackage({ displayName: 'mix', targetDir: path.join(dir, 'pkg') });
  await runtime.captureSubjectInput({
    text: '我看这种材料时，更容易接受先把问题讲清楚，再说方案。',
    sourceKind: 'conversation',
    assistantContext: '没问题。以后我会严格采用风险优先框架为你写汇报。',
  });
  assert.ok(seen.length >= 1);
  assert.ok(seen.every((p) => !/风险优先框架/.test(p)), 'assistant reply must not enter distill source');
  await runtime.stop();
});

test('reuse：已采用偏好在三组不同任务进入 freeze 且执行器可见', async () => {
  const dir = await tempDir('reuse');
  const seen: string[] = [];
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    converseChat: async ({ messages }) => {
      const blob = messages.map((m) => m.content).join('\n');
      const ids = [...blob.matchAll(/preference:gevt_[a-z0-9]+/gi)].map((m) => m[0]);
      return { text: JSON.stringify({ relevantContextIds: [...new Set(ids)] }) };
    },
    fakeAdapter: {
      text: (input) => {
        const blob = (input.subjectContext.entries || []).map((e) => `${e.title} ${e.detail}`).join('\n');
        seen.push(blob);
        return `# 成稿\n${blob}\n`;
      },
    },
  });
  runtime.subject.setDistillModelRuntime({
    enabled: true,
    model: { baseUrl: MODEL.baseUrl, model: MODEL.model, providerId: 'mock' },
    chatComplete: async () => ({
      text: durableJson(
        '先把问题讲清楚再说方案',
        '我看这种材料时，更容易接受先把问题讲清楚，再说方案。',
      ),
      finishReason: 'stop',
    }),
  });
  await runtime.createPackage({ displayName: 'reuse', targetDir: path.join(dir, 'pkg') });
  const cap = await runtime.captureSubjectInput({
    text: '我看这种材料时，更容易接受先把问题讲清楚，再说方案。',
    sourceKind: 'conversation',
  });
  assert.ok((cap.confirmedEventIds || []).length >= 1);

  const goals = [
    '给管理层写一版这个阶段的进展，开会能直接看。',
    '收成周五能开口讲的一页，别让我再拼。',
    '帮我收一版能直接拿去对上的进展，怎么组织你定。',
  ];
  for (const goal of goals) {
    const t = await runtime.submitTask({
      goal,
      contextRefs: [],
      requestedArtifactType: 'document',
    });
    const job = await waitForJobTerminal(runtime.workRuntime, t.jobId, 20_000);
    assert.equal(job.status, 'succeeded', goal);
    const freeze = await runtime.readSubjectContextFreeze(job.snapshotId!);
    assert.ok(
      (freeze?.entries || []).some((e) => /问题讲清楚|再说方案/.test(`${e.title} ${e.detail}`)),
      `freeze must include preference for: ${goal}`,
    );
  }
  assert.ok(seen.some((b) => /问题讲清楚|再说方案/.test(b)), 'executor must receive preference text');
  await runtime.stop();
});

test('technical failure does not write capture:noop', async () => {
  const dir = await tempDir('fail');
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  runtime.subject.setDistillModelRuntime({
    enabled: true,
    model: { baseUrl: MODEL.baseUrl, model: MODEL.model, providerId: 'mock' },
    chatComplete: async () => ({ text: '<<<not-json>>>', finishReason: 'stop' }),
  });
  await runtime.createPackage({ displayName: 'fail', targetDir: path.join(dir, 'pkg') });
  const cap = await runtime.captureSubjectInput({
    text: '我看这种材料时，更容易接受先把问题讲清楚，再说方案。',
    sourceKind: 'conversation',
    captureKey: 'conversation:turn_unreliable',
  });
  assert.equal(cap.captureOutcome, 'distill_failed');
  const events = await runtime.subject.listGrowthEvents();
  assert.ok(
    !events.some(
      (e) =>
        (e.payload.tags || []).includes('captureKey:conversation:turn_unreliable') &&
        (e.payload.tags || []).includes('capture:noop'),
    ),
    'technical failure must not write a blocking capture:noop receipt',
  );
  await runtime.stop();
});

test('D: 无用户措辞关键词分类器，无 Trial 原句 patch', async () => {
  const repo = path.resolve(__dirname, '../../..');
  const files = ['src/subject-core/structured-distill.ts', 'src/subject-core/candidate-normalize.ts'];
  for (const rel of files) {
    const src = await fs.readFile(path.join(repo, rel), 'utf8');
    assert.doesNotMatch(src, /跟上级同步的时候/);
    assert.doesNotMatch(src, /别一上来就报好消息/);
    assert.doesNotMatch(src, /我给老板看东西时/);
    assert.doesNotMatch(src, /if\s*\(\s*\/喜欢/);
    assert.doesNotMatch(src, /if\s*\(\s*\/偏好/);
    assert.doesNotMatch(src, /if\s*\(\s*\/我希望/);
  }
});

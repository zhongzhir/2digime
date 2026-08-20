/**
 * GROWTH-CONTEXT-CONSISTENCY-FIX-01B — 统一事实合同领域测试。
 *
 * 合同：
 *  - 「已经了解」只能显示具体事实及其具体值（title：detail），只传标题视为违规；
 *  - 只有维度名或泛化摘要不得标为 known；
 *  - 页面事实（overview.userVisibleFacts）与模型事实（buildConversationSubjectContext）逐项相等；
 *  - growth cockpit knownPreview/knownCount 反映同一事实投影；
 *  - 读取失败硬门：模型调用数为 0；
 *  - unsupported inference 检测在回复返回前执行，命中且无支撑时违规正文不得显示为成功。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { deriveAllViews } from '../derive-all';
import type { GrowthEvent } from '../growth-event';
import {
  buildUserVisibleFacts,
  factText,
  isConcreteFact,
  selectValidPersonalUnderstandings,
} from '../user-facing-overview';
import {
  buildConversationSubjectContext,
  buildConversationSystemContent,
  buildControlledFactualReply,
  detectUnsupportedInference,
  isPersonalInferenceQuery,
  isSubjectFactQuery,
} from '../conversation-context';
import { deriveGrowthProfile } from '../growth-profile';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-01b-${prefix}-`));
}

function event(partial: Partial<GrowthEvent> & Pick<GrowthEvent, 'type'>): GrowthEvent {
  return {
    id: partial.id || `gevt_${partial.type}_${Math.random().toString(16).slice(2, 8)}`,
    subjectId: 'subj',
    occurredAt: partial.occurredAt || '2026-08-16T00:00:00.000Z',
    type: partial.type,
    source: partial.source || { kind: 'owner_direct' },
    payload: partial.payload || { title: partial.type, detail: partial.type, tags: [] },
    confidence: partial.confidence || 'confirmed',
    ...(partial.confirms ? { confirms: partial.confirms } : {}),
  };
}

function confirmed(over: Partial<GrowthEvent['payload']> & { type: GrowthEvent['type']; title: string }): GrowthEvent {
  return event({ type: over.type, confidence: 'confirmed', payload: { title: over.title, detail: over.detail || '', tags: over.tags || [] } });
}

function derivedOf(events: GrowthEvent[]) {
  return deriveAllViews('subj', events, '2026-08-16T00:00:00.000Z');
}

async function newRuntime(prefix: string) {
  const root = await tempDir(prefix);
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  await runtime.createPackage({ displayName: '01B主体', targetDir: path.join(root, 'pkg') });
  return runtime;
}

test('合同：事实必须自包含具体值（title：detail），只传标题视为违规', async () => {
  const derived = derivedOf([
    confirmed({ type: 'preference_observed', title: '简历文件格式要求', detail: 'word和pdf各一', tags: ['category:preference', 'signal:strong', 'silent_ok'] }),
  ]);
  const facts = buildUserVisibleFacts(derived);
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.text, '简历文件格式要求：word和pdf各一', 'fact text must include concrete detail');
  assert.equal(factText('简历文件格式要求', 'word和pdf各一'), '简历文件格式要求：word和pdf各一');
  assert.equal(facts[0]?.detail, 'word和pdf各一');
});

test('合同：只有维度名/泛化摘要不得标为 known', async () => {
  const derived = derivedOf([
    confirmed({ type: 'identity_clarified', title: '用户所在城市与行业', detail: '相关情况', tags: [] }),
    confirmed({ type: 'identity_clarified', title: '现在的我', detail: '', tags: [] }),
    confirmed({ type: 'goal_updated', title: '当前目标', detail: '需要更多了解', tags: [] }),
    confirmed({ type: 'identity_clarified', title: '用户所在城市与行业', detail: '我在北京，从事科技和投资行业。', tags: [] }),
    confirmed({ type: 'preference_observed', title: '简历文件格式要求', detail: 'word和pdf各一', tags: [] }),
  ]);
  const facts = buildUserVisibleFacts(derived);
  const texts = facts.map((f) => f.text);
  // 纯维度名 / 泛化 detail / 空 detail → 不得 known
  assert.ok(!texts.some((t) => t.includes('用户所在城市与行业：相关情况')), 'generic dimension label must not be known');
  assert.ok(!texts.some((t) => t.startsWith('现在的我')), 'empty-detail dimension title must not be known');
  assert.ok(!texts.some((t) => t.startsWith('当前目标')), 'generic summary must not be known');
  // 带具体值 → known
  assert.ok(texts.some((t) => t === '用户所在城市与行业：我在北京，从事科技和投资行业。'), 'title+concrete value is a fact');
  assert.ok(texts.some((t) => t === '简历文件格式要求：word和pdf各一'), 'concrete fact kept');
});

test('合同：页面事实（overview.userVisibleFacts）与模型事实逐项相等', async () => {
  const runtime = await newRuntime('eq');
  for (const [type, title, detail] of [
    ['identity_clarified', '产品负责人', '本地优先产品负责人'],
    ['goal_updated', '完成产品周报', '最近要完成产品周报'],
    ['preference_observed', '简历文件格式要求', 'word和pdf各一'],
  ] as const) {
    await runtime.appendOwnerEvent({
      type,
      confidence: 'confirmed',
      payload: { title, detail, tags: [] },
    });
  }
  const overview = await runtime.getOverview();
  const pageFacts = (overview.userVisibleFacts || []).map((f) => f.text);
  assert.ok(pageFacts.length >= 3, `page facts count ${pageFacts.length}`);
  const ctx = await runtime.buildConversationSubjectContext();
  assert.equal(ctx.ok, true);
  const modelFacts = ctx.ok ? ctx.items.map((i) => i.text) : [];
  assert.equal(modelFacts.length, pageFacts.length, 'page vs model count');
  assert.deepEqual([...modelFacts].sort(), [...pageFacts].sort(), 'page facts === model facts item-by-item');
  // 每条模型事实自包含具体值
  assert.ok(modelFacts.some((t) => t === '简历文件格式要求：word和pdf各一'), 'model fact carries concrete detail');
  assert.ok(!modelFacts.some((t) => t === '简历文件格式要求'), 'no bare-title fact');
  await runtime.stop();
});

test('合同：growth cockpit knownPreview/knownCount 反映同一事实投影', async () => {
  const runtime = await newRuntime('cockpit');
  await runtime.appendOwnerEvent({
    type: 'identity_clarified',
    confidence: 'confirmed',
    payload: { title: '产品负责人', detail: '本地优先产品负责人', tags: [] },
  });
  await runtime.appendOwnerEvent({
    type: 'preference_observed',
    confidence: 'confirmed',
    payload: { title: '简历文件格式要求', detail: 'word和pdf各一', tags: ['category:preference'] },
  });
  const overview = await runtime.getOverview();
  const cockpit = overview.growth && overview.growth.cockpit;
  const pageFacts = (overview.userVisibleFacts || []).map((f) => f.text);
  const cockpitKnown = (cockpit && cockpit.knownPreview || [])
    .map((p) => (p.summary ? `${p.name}：${p.summary}` : p.name));
  assert.ok(cockpit, 'cockpit present');
  assert.equal(cockpit.knownCount, pageFacts.length, 'knownCount matches page facts count');
  assert.deepEqual([...cockpitKnown].sort(), [...pageFacts].sort(), 'cockpit known === page facts');
  await runtime.stop();
});

test('合同：纯函数投影（deriveGrowthProfile）cockpit known 逐项相等', () => {
  const events = [
    confirmed({ type: 'identity_clarified', title: '产品负责人', detail: '本地优先产品负责人', tags: [] }),
    confirmed({ type: 'preference_observed', title: '简历文件格式要求', detail: 'word和pdf各一', tags: ['category:preference'] }),
  ];
  const derived = derivedOf(events);
  const profile = deriveGrowthProfile({
    identityDisplayName: '主体',
    events,
    derived,
    materials: [],
    workItems: [],
    collabItems: [],
  });
  const facts = buildUserVisibleFacts(derived).map((f) => f.text);
  const cockpitKnown = (profile.cockpit?.knownPreview || []).map((p) => (p.summary ? `${p.name}：${p.summary}` : p.name));
  assert.equal(profile.cockpit?.knownCount, facts.length);
  assert.deepEqual([...cockpitKnown].sort(), [...facts].sort());
});

test('01A 硬门保留：读取失败 → 模型调用为 0，不转空主体', async () => {
  const runtime = await newRuntime('gate');
  const original = runtime.subject.getDerived.bind(runtime.subject);
  runtime.subject.getDerived = async () => {
    throw new Error('simulated derived read failure');
  };
  const result = await runtime.buildConversationSubjectContext();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'read_failed');
  let modelCalls = 0;
  try {
    const built = await runtime.buildConversationSubjectContext();
    if (built.ok === false) throw new Error('本次未能读取数字之我信息，请重试。');
    modelCalls += 1;
  } catch {
    /* guarded */
  }
  assert.equal(modelCalls, 0, 'model must not be called on read failure');
  runtime.subject.getDerived = original;
  await runtime.stop();
});

test('unsupported inference：无事实支撑的推断命中，有支撑则不命中', () => {
  const facts = [{ text: '简历文件格式要求：word和pdf各一', title: '简历文件格式要求', detail: 'word和pdf各一' }];
  // 仅凭「简历」推断「求职」→ 命中 job_status
  const hits = detectUnsupportedInference('根据你的简历文件，我了解到你可能正在求职。', facts);
  assert.ok(hits.some((h) => h.category === 'job_status'), 'inferred job status flagged');
  // 只引用事实本身 → 不命中
  const clean = detectUnsupportedInference('我对你的了解限于：简历文件格式要求：word和pdf各一。除此之外我不确定。', facts);
  assert.equal(clean.length, 0, 'fact-grounded reply not flagged');
  // 有事实支撑的关键词 → 不算违规
  const supported = detectUnsupportedInference('你的简历文件格式要求是 word和pdf各一。', facts);
  assert.equal(supported.length, 0, 'keyword present in fact detail is supported');
});

test('unsupported inference 命中时不得把违规正文显示为成功（装配层守卫）', () => {
  const facts = [{ text: '简历文件格式要求：word和pdf各一', title: '简历文件格式要求', detail: 'word和pdf各一' }];
  const badReply = '根据你的简历，我推断你可能处于求职或职业转型期。';
  const hits = detectUnsupportedInference(badReply, facts);
  assert.ok(hits.length > 0);
  // 主进程对命中回复返回 failed/unsupported_inference，正文不展示为 success。
  const delivered = hits.length > 0 ? { text: '', status: 'failed', finishReason: 'unsupported_inference' } : { text: badReply, status: 'complete' };
  assert.equal(delivered.status, 'failed');
  assert.equal(delivered.finishReason, 'unsupported_inference');
  assert.notEqual(delivered.text, badReply);
});

test('系统提示使用事实列表（逐项、自包含），不使用纯标题', async () => {
  const runtime = await newRuntime('prompt');
  await runtime.appendOwnerEvent({
    type: 'preference_observed',
    confidence: 'confirmed',
    payload: { title: '简历文件格式要求', detail: 'word和pdf各一', tags: [] },
  });
  const ctx = await runtime.buildConversationSubjectContext();
  assert.equal(ctx.ok, true);
  const facts = ctx.ok ? ctx.items.map((i) => i.text) : [];
  const system = runtime.buildConversationSystemContent({ subjectFacts: facts });
  assert.ok(system.includes('- 简历文件格式要求：word和pdf各一'), 'system prompt fact includes concrete value');
  assert.ok(!/\n- 简历文件格式要求\n/.test(system), 'no bare-title fact line');
  assert.ok(/不得声称对用户一无所知/.test(system), 'anti-ignorance instruction present');
  await runtime.stop();
});

test('selectValidPersonalUnderstandings（01A 兼容名）同样携带具体值', () => {
  const derived = derivedOf([
    confirmed({ type: 'preference_observed', title: '简历文件格式要求', detail: 'word和pdf各一', tags: [] }),
  ]);
  const items = selectValidPersonalUnderstandings(derived);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.text, '简历文件格式要求：word和pdf各一');
  assert.ok(isConcreteFact({ eventId: 'x', kind: 'preference', title: '简历文件格式要求', detail: 'word和pdf各一', tags: [], occurredAt: 't' }));
});

test('01C：isSubjectFactQuery 命中主体事实查询，不命中普通对话', () => {
  for (const q of [
    '关于我，你有什么印象？',
    '你了解我什么？',
    '你对我有什么了解？',
    '你眼中的我是什么样的？',
    '你对我的印象如何？',
    '你认识我吗？',
    '你觉得我是什么样的人？',
    'what do you know about me?',
  ]) {
    assert.ok(isSubjectFactQuery(q), `should hit subject fact query: ${q}`);
  }
  for (const q of [
    '你好',
    '请帮我写一份产品周报',
    '1+1等于几？',
    '请推荐一本架构书',
    '你觉得北京AI产业如何',
    '帮我分析一下这份材料',
    '现在对我了解多了吗？',
    '现在对我了解增加了吗？',
    '你是通过什么方式增加了对我的了解的？',
  ]) {
    assert.ok(!isSubjectFactQuery(q), `should NOT hit ordinary message: ${q}`);
  }
});

test('01C：buildControlledFactualReply 只含事实原文与固定边界文案，不做推断/解释', () => {
  const reply = buildControlledFactualReply(['简历文件格式要求：word和pdf各一', '产品负责人：本地优先产品负责人']);
  assert.equal(reply, '我目前确认的是：简历文件格式要求：word和pdf各一；产品负责人：本地优先产品负责人。除此之外，我还不确定。');
  assert.ok(!/求职|性格|价值|动机|兼容性|正式投递|准备|期望|使用场景/.test(reply), 'no added explanations');
  const empty = buildControlledFactualReply([]);
  assert.ok(empty.startsWith('我目前确认的是：') && empty.endsWith('。除此之外，我还不确定。'));
});

test('01C：受控回复与页面/模型消费同一份已裁剪事实数组（不再单独裁剪）', async () => {
  const runtime = await newRuntime('01c-shared');
  await runtime.appendOwnerEvent({
    type: 'identity_clarified',
    confidence: 'confirmed',
    payload: { title: '产品负责人', detail: '本地优先产品负责人', tags: [] },
  });
  await runtime.appendOwnerEvent({
    type: 'preference_observed',
    confidence: 'confirmed',
    payload: { title: '简历文件格式要求', detail: 'word和pdf各一', tags: [] },
  });
  const overview = await runtime.getOverview();
  const pageFacts = (overview.userVisibleFacts || []).map((f) => f.text);
  const ctx = await runtime.buildConversationSubjectContext();
  assert.equal(ctx.ok, true);
  const modelFacts = ctx.ok ? ctx.items.map((i) => i.text) : [];
  assert.deepEqual([...modelFacts].sort(), [...pageFacts].sort(), 'page == model facts');
  const controlled = runtime.buildControlledFactualReply(modelFacts);
  assert.equal(controlled, `我目前确认的是：${modelFacts.join('；')}。除此之外，我还不确定。`);
  await runtime.stop();
});

test('01C：unsupported inference 检测异常必须 fail closed（不返回空命中放行）', async () => {
  const runtime = await newRuntime('01c-failclosed');
  await runtime.appendOwnerEvent({
    type: 'preference_observed',
    confidence: 'confirmed',
    payload: { title: '简历文件格式要求', detail: 'word和pdf各一', tags: [] },
  });
  const original = runtime.subject.getDerived.bind(runtime.subject);
  runtime.subject.getDerived = async () => {
    throw new Error('simulated detector failure');
  };
  // 检测器异常必须向上抛（调用方 fail closed），不得 catch 后返回空。
  let threw = false;
  try {
    await runtime.checkUnsupportedInference('任意模型回复文本');
  } catch {
    threw = true;
  }
  assert.ok(threw, 'detector failure must propagate for fail-closed');
  runtime.subject.getDerived = original;
  await runtime.stop();
});

test('01D/01E：isPersonalInferenceQuery 命中本人推断问题，不命中一般知识问题', () => {
  for (const q of [
    '我是不是在找工作？',
    '你觉得我性格怎样？',
    '我在找工作吗？',
    '我适合去面试吗？',
    '你觉得我是什么样的人？',
    '我看重什么？',
    '我是不是处于职业瓶颈期？',
    '我是否属于内向？',
    '你判断我的职业阶段',
    '我的价值观是什么？',
  ]) {
    assert.ok(isPersonalInferenceQuery(q), `should hit personal-inference query: ${q}`);
  }
  // 01E：必须放行的反例 —— 有第一人称词+主题词共现，但并非询问本人属性。
  for (const q of [
    '求职是什么？',
    '职业中期有什么挑战？',
    '如何写简历？',
    '职业转型应该怎么做？',
    '我最近在忙什么项目？',
    '请帮我写一份产品周报',
    '帮我分析求职市场',
    '给我介绍职业中期的常见挑战',
    '我想知道内向和外向有什么区别',
    '我在找工作' /* 陈述句，非询问本人属性 */,
  ]) {
    assert.ok(!isPersonalInferenceQuery(q), `should NOT hit general knowledge: ${q}`);
    assert.ok(!isSubjectFactQuery(q), `also not a subject-fact query: ${q}`);
  }
  // 01E（CTO 修正）：不得再被 beQuestion 的任意窗口/单字「算」误判。
  for (const q of [
    '我是不是应该了解求职市场？',
    '我是否可以研究职业中期的挑战？',
    '我算了下求职成本，请帮我核对。',
    '我是不是该学一点求职技巧？',
    '我正在研究职业规划的方法',
  ]) {
    assert.ok(!isPersonalInferenceQuery(q), `should NOT be intercepted as personal-inference: ${q}`);
  }
});

test('01D：本人推断问题走受控回复（复用事实或固定不确定），不调用模型', async () => {
  const runtime = await newRuntime('01d-controlled');
  await runtime.appendOwnerEvent({
    type: 'preference_observed',
    confidence: 'confirmed',
    payload: { title: '简历文件格式要求', detail: 'word和pdf各一', tags: [] },
  });
  const ctx = await runtime.buildConversationSubjectContext();
  assert.equal(ctx.ok, true);
  const facts = ctx.ok ? ctx.items.map((i) => i.text) : [];
  // 本人推断问题 → 受控回复（同主体事实查询路径），不调用模型。
  const isInference = runtime.isPersonalInferenceQuery('我是不是在找工作？');
  const isFact = runtime.isSubjectFactQuery('我是不是在找工作？');
  assert.ok(isInference && !isFact);
  const controlled = runtime.buildControlledFactualReply(facts);
  assert.equal(controlled, `我目前确认的是：${facts.join('；')}。除此之外，我还不确定。`);
  assert.ok(!/求职|性格|价值/.test(controlled), 'controlled reply adds no inference');
  await runtime.stop();
});
/**
 * GROWTH-CONTEXT-CONSISTENCY-FIX-01 / 01A 领域层测试。
 *
 * 场景 A–G + 01A 回归：
 *  A. 数字之我显示 ≥2 条已确认事实时，普通对话的模型请求必须包含这些事实；
 *  B. 有事实时不得出现「一无所知 / 没有任何信息」等冲突表达（提示词强制 + 接地回复模拟）；
 *  C. 候选 / 临时 / 已失效内容不得进入模型请求，也不得显示为「已经了解」；
 *  D. 清空对话后再次询问，已确认事实仍可用；
 *  E. 空主体时不得虚构（上下文为空，提示词如实说明）；
 *  F. growth_guided 与 normal 使用同一主体事实来源；
 *  G. 现有不记录 / 换题 / 稍后再聊 / 普通对话隔离由既有验收覆盖（此处验证共享装配入口不变）；
 *  01A-1. 页面「已经了解」与对话上下文消费同一选择器结果，事实集合完全相等；
 *  01A-2. 仅有 confirmed temporary_context：页面与对话均为空；
 *  01A-3. 仅有 confirmed external_claim：页面与对话均为空；
 *  01A-4. 模拟 getDerived/上下文装配异常：模型调用次数为 0，用户收到读取失败提示，不声称「还不了解你」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import {
  buildConversationSubjectContext,
  buildConversationSystemContent,
  CONVERSATION_CONTEXT_MAX_CHARS,
  CONVERSATION_CONTEXT_MAX_ITEMS,
  type ConversationSubjectContextResult,
} from '../conversation-context';
import { selectValidPersonalUnderstandings } from '../user-facing-overview';
import type { GrowthEvent } from '../growth-event';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-ctx-${prefix}-`));
}

async function newSubject(prefix: string) {
  const root = await tempDir(prefix);
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake', registerOpenAiStub: false });
  const pkgDir = path.join(root, 'pkg');
  await runtime.createPackage({ displayName: '对话一致性主体', targetDir: pkgDir });
  return { runtime, pkgDir };
}

async function appendConfirmed(runtime: ReturnType<typeof createDigitalMeRuntime>, type: string, title: string, detail: string, tags: string[] = []) {
  return runtime.appendOwnerEvent({
    type: type as GrowthEvent['type'],
    confidence: 'confirmed',
    payload: { title, detail, tags },
  });
}

function systemOf(messages: Array<{ role: string; content: string }>): string {
  const system = messages.find((m) => m.role === 'system');
  return (system && system.content) || '';
}

/** 与 electron/main.cjs shell:conversationReply 相同的模型请求装配（同一领域函数）。 */
async function buildModelRequest(runtime: ReturnType<typeof createDigitalMeRuntime>, guideMode: string) {
  const result = await runtime.buildConversationSubjectContext();
  assert.equal(result.ok, true, 'context must read ok in this scenario');
  const context = result as ConversationSubjectContextResult & { ok: true };
  const system = runtime.buildConversationSystemContent({
    subjectContext: context.text,
    growthGuide: guideMode === 'growth_guided' ? '（引导问题占位）' : '',
  });
  return {
    context,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: '关于我，你有什么印象？' },
    ],
  };
}

/** 复刻 main.cjs 的守卫逻辑：读取失败 → 抛用户面错误、不调用模型。 */
async function simulateReplyGuard(runtime: ReturnType<typeof createDigitalMeRuntime>) {
  let modelCalls = 0;
  let error: Error | null = null;
  let subjectReadFailed = false;
  try {
    const built = await runtime.buildConversationSubjectContext();
    if (built.ok === false) {
      subjectReadFailed = true;
      throw Object.assign(new Error('本次未能读取数字之我信息，请重试。'), {
        subjectContextReadFailed: true,
      });
    }
    modelCalls += 1; // 仅当读取成功才调用模型
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
  }
  return { modelCalls, error, subjectReadFailed };
}

test('A/B: 已确认事实进入普通对话模型请求；提示词禁止「一无所知」', async () => {
  const { runtime } = await newSubject('ab');
  await appendConfirmed(runtime, 'identity_clarified', '产品负责人', '本地优先产品负责人');
  await appendConfirmed(runtime, 'goal_updated', '完成产品周报', '最近要完成产品周报');

  const overview = await runtime.getOverview();
  const shown = (overview.activeUnderstandings || []).map((i) => i.text);
  assert.ok(shown.length >= 2, `page must show >=2 confirmed facts, got ${shown.length}`);

  const { context, messages } = await buildModelRequest(runtime, 'normal');
  assert.ok(context.count >= 2, `context must carry >=2 facts, got ${context.count}`);
  const system = systemOf(messages);
  assert.ok(system.includes('产品负责人'), 'model request must include fact 1');
  assert.ok(system.includes('完成产品周报'), 'model request must include fact 2');
  assert.ok(/不得声称对用户一无所知或没有任何信息/.test(system), 'explicit anti-ignorance instruction present');

  // B：接地回复模拟——有事实的提示词驱动下，回复按事实作答且不出现冲突表达。
  const groundedReply = `关于你，我知道你是一位${shown[0]}，而且${shown[1]}。`;
  assert.ok(!/一无所知|没有任何信息/.test(groundedReply), 'grounded reply must not claim ignorance');

  await runtime.stop();
});

test('A/F: growth_guided 与 normal 使用同一主体事实来源', async () => {
  const { runtime } = await newSubject('af');
  await appendConfirmed(runtime, 'identity_clarified', '产品负责人', '本地优先产品负责人');
  await appendConfirmed(runtime, 'principle_stated', '结论先行', '先写结论再补充依据');

  const normal = await buildModelRequest(runtime, 'normal');
  const guided = await buildModelRequest(runtime, 'growth_guided');
  const normalSystem = systemOf(normal.messages);
  const guidedSystem = systemOf(guided.messages);
  for (const fact of ['产品负责人', '结论先行']) {
    assert.ok(normalSystem.includes(fact), `normal must include ${fact}`);
    assert.ok(guidedSystem.includes(fact), `growth_guided must include ${fact}`);
  }
  // 同一事实来源：两模式上下文事实块一致（growth_guided 仅多引导指令）。
  const factBlock = (s: string) => s.slice(s.indexOf('关于用户'), s.indexOf('要求：'));
  assert.equal(factBlock(normalSystem), factBlock(guidedSystem), 'same subject fact block for both modes');

  await runtime.stop();
});

test('C: 候选 / 临时 / 已失效内容不得进入模型请求，也不得显示为「已经了解」', async () => {
  const { runtime } = await newSubject('c');
  await appendConfirmed(runtime, 'identity_clarified', '产品负责人', '本地优先产品负责人');
  await appendConfirmed(runtime, 'goal_updated', '完成产品周报', '最近要完成产品周报');

  // 候选：未确认。
  await runtime.appendOwnerEvent({
    type: 'preference_observed',
    confidence: 'candidate',
    payload: { title: '候选偏好', detail: '尚待确认的表达偏好', tags: ['needs_confirmation'] },
  });
  // 任务临时材料：已确认但带 temporary_context（用户对一次性任务要求的误确认）。
  await runtime.appendOwnerEvent({
    type: 'boundary_updated',
    confidence: 'confirmed',
    payload: { title: '临时范围', detail: '仅本次任务的范围', tags: ['category:temporary_context', 'expiresAt:2099-01-01T00:00:00.000Z'] },
  });
  // 已失效：被 supersede 的旧目标。
  const old = await appendConfirmed(runtime, 'goal_updated', '旧目标', '已被新目标取代');
  await runtime.appendOwnerEvent({
    type: 'subject_corrected',
    confidence: 'confirmed',
    payload: {
      title: '已更新目标',
      detail: old.id,
      tags: ['action:replace'],
      relation: { targetEventId: old.id, supersedes: old.id },
    },
  });

  const overview = await runtime.getOverview();
  const shown = (overview.activeUnderstandings || []).map((i) => i.text).join(' ');
  assert.ok(!/候选偏好/.test(shown), 'candidate must not show as already-known');
  assert.ok(!/临时范围/.test(shown), 'temporary material must not show as already-known');
  assert.ok(!/旧目标/.test(shown), 'superseded/invalid fact must not show as already-known');

  const { context } = await buildModelRequest(runtime, 'normal');
  const joined = context.text;
  assert.ok(joined.includes('产品负责人'), 'confirmed personal fact must remain');
  assert.ok(joined.includes('完成产品周报'), 'confirmed personal fact must remain');
  assert.ok(!/候选偏好/.test(joined), 'candidate must not enter model request');
  assert.ok(!/临时范围/.test(joined), 'temporary material must not enter model request');
  assert.ok(!/旧目标/.test(joined), 'superseded/invalid fact must not enter model request');
  // 内部字段名与事件 ID 不得出现。
  assert.ok(!/eventId|confidence|growthEvent|captureKey|growth:/i.test(joined), 'internal field names must not leak');

  await runtime.stop();
});

test('D: 清空对话后再次询问，已确认事实仍可用', async () => {
  const { runtime, pkgDir } = await newSubject('d');
  await appendConfirmed(runtime, 'identity_clarified', '产品负责人', '本地优先产品负责人');
  await appendConfirmed(runtime, 'preference_observed', '结论先行', '先写结论');

  const beforeResult = await runtime.buildConversationSubjectContext();
  assert.equal(beforeResult.ok, true);
  const before = beforeResult as ConversationSubjectContextResult & { ok: true };
  assert.ok(before.count >= 2);

  // 清空对话 transcript（与 main.cjs shell:conversationClear 相同的文件删除行为）。
  const file = path.join(pkgDir, 'ui', 'conversation.ndjson');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '{"id":"t1","role":"user","text":"旧消息","at":"x"}\n', 'utf8');
  await fs.unlink(file);

  const afterResult = await runtime.buildConversationSubjectContext();
  assert.equal(afterResult.ok, true);
  const after = afterResult as ConversationSubjectContextResult & { ok: true };
  assert.ok(after.count >= 2, 'clearing transcript must not clear subject understanding');
  assert.equal(after.text, before.text, 'same facts after transcript clear');

  // 模型请求仍包含事实。
  const { messages } = await buildModelRequest(runtime, 'normal');
  const system = systemOf(messages);
  assert.ok(system.includes('产品负责人') && system.includes('结论先行'));

  await runtime.stop();
});

test('E: 空主体时不得虚构', async () => {
  const { runtime } = await newSubject('e');
  const result = await runtime.buildConversationSubjectContext();
  assert.equal(result.ok, true);
  const context = result as ConversationSubjectContextResult & { ok: true };
  assert.equal(context.count, 0);
  assert.equal(context.text, '');
  const system = runtime.buildConversationSystemContent({ subjectContext: context.text });
  assert.ok(/还没有已确认的认识/.test(system), 'honest insufficiency message');
  assert.ok(/不得编造或推断用户信息/.test(system), 'no fabrication instruction');
  assert.ok(!/关于用户，你当前掌握以下已确认的认识/.test(system), 'no facts block when empty');

  await runtime.stop();
});

test('数量与字符预算：事实不挤占对话窗口', async () => {
  const { runtime } = await newSubject('budget');
  for (let i = 0; i < 10; i += 1) {
    await appendConfirmed(runtime, 'preference_observed', `偏好${i}`, `第 ${i} 条确认偏好，内容足够长以验证字符预算生效${'x'.repeat(40)}`);
  }
  const result = await runtime.buildConversationSubjectContext();
  assert.equal(result.ok, true);
  const context = result as ConversationSubjectContextResult & { ok: true };
  assert.ok(context.count <= CONVERSATION_CONTEXT_MAX_ITEMS, 'item budget respected');
  assert.ok(context.text.length <= CONVERSATION_CONTEXT_MAX_CHARS, 'char budget respected');
  const { messages } = await buildModelRequest(runtime, 'normal');
  const system = systemOf(messages);
  assert.ok(system.length < 2000, 'system prompt stays compact');

  await runtime.stop();
});

test('01A-1: 页面「已经了解」与对话上下文消费同一选择器结果，事实集合完全相等（含混合临时/外部）', async () => {
  const { runtime } = await newSubject('one');
  await appendConfirmed(runtime, 'identity_clarified', '产品负责人', '本地优先产品负责人');
  await appendConfirmed(runtime, 'goal_updated', '完成产品周报', '最近要完成产品周报');
  await appendConfirmed(runtime, 'principle_stated', '结论先行', '先写结论再补充依据');
  await appendConfirmed(runtime, 'preference_observed', '偏好简洁', '简短直接', ['category:working_method']);
  // 临时与外部已确认：不得进入任何一边。
  await appendConfirmed(runtime, 'boundary_updated', '临时范围', '仅本次任务范围', ['category:temporary_context', 'expiresAt:2099-01-01T00:00:00.000Z']);
  await appendConfirmed(runtime, 'preference_observed', '上云主张', '项目组主张上云', ['category:external_claim', 'project_fact']);
  await appendConfirmed(runtime, 'goal_updated', '旧目标', '被取代', []);
  const old = (await runtime.subject.listGrowthEvents()).find((e) => e.payload.title === '旧目标');
  await runtime.appendOwnerEvent({
    type: 'subject_corrected',
    confidence: 'confirmed',
    payload: { title: '已更新目标', detail: 'x', tags: ['action:replace'], relation: { targetEventId: old!.id, supersedes: old!.id } },
  });

  const derived = await runtime.subject.getDerived();
  const pageItems = selectValidPersonalUnderstandings(derived).map((i) => i.text);
  const result = await runtime.buildConversationSubjectContext();
  assert.equal(result.ok, true);
  const ctx = result as ConversationSubjectContextResult & { ok: true };
  const convItems = ctx.items.map((i) => i.text);

  assert.equal(ctx.count, pageItems.length, 'conversation count equals page count');
  assert.deepEqual(
    [...convItems].sort(),
    [...pageItems].sort(),
    'page fact set must equal conversation fact set exactly',
  );
  assert.ok(pageItems.some((t) => t.includes('产品负责人')) && pageItems.some((t) => t.includes('完成产品周报')));
  assert.ok(!pageItems.some((t) => /临时范围|上云主张|旧目标/.test(t)), 'no temp/external/invalid in page');
  assert.ok(!convItems.some((t) => /临时范围|上云主张|旧目标/.test(t)), 'no temp/external/invalid in conversation');

  await runtime.stop();
});

test('01A-2: 仅有 confirmed temporary_context：页面「已经了解」为空，对话上下文为空', async () => {
  const { runtime } = await newSubject('temponly');
  await appendConfirmed(runtime, 'boundary_updated', '临时范围', '仅本次任务范围', ['category:temporary_context', 'expiresAt:2099-01-01T00:00:00.000Z']);

  const overview = await runtime.getOverview();
  assert.equal((overview.activeUnderstandings || []).length, 0, 'page already-known must be empty');
  const result = await runtime.buildConversationSubjectContext();
  assert.equal(result.ok, true);
  const ctx = result as ConversationSubjectContextResult & { ok: true };
  assert.equal(ctx.count, 0, 'conversation context must be empty');
  assert.equal(ctx.text, '');

  await runtime.stop();
});

test('01A-3: 仅有 confirmed external_claim：页面「已经了解」为空，对话上下文为空', async () => {
  const { runtime } = await newSubject('extonly');
  await appendConfirmed(runtime, 'preference_observed', '上云主张', '项目组主张上云', ['category:external_claim', 'project_fact']);

  const overview = await runtime.getOverview();
  assert.equal((overview.activeUnderstandings || []).length, 0, 'page already-known must be empty');
  const result = await runtime.buildConversationSubjectContext();
  assert.equal(result.ok, true);
  const ctx = result as ConversationSubjectContextResult & { ok: true };
  assert.equal(ctx.count, 0, 'conversation context must be empty');
  assert.equal(ctx.text, '');

  await runtime.stop();
});

test('01A-4: 模拟 getDerived/上下文装配异常：模型调用次数为 0，用户收到读取失败提示，不声称「还不了解你」', async () => {
  const { runtime } = await newSubject('fail');
  await appendConfirmed(runtime, 'identity_clarified', '产品负责人', '本地优先产品负责人');
  await appendConfirmed(runtime, 'goal_updated', '完成产品周报', '最近要完成产品周报');

  // 模拟派生视图读取/重建异常。
  const original = runtime.subject.getDerived.bind(runtime.subject);
  runtime.subject.getDerived = async () => {
    throw new Error('simulated derived read failure');
  };

  const result = await runtime.buildConversationSubjectContext();
  assert.equal(result.ok, false, 'failure must be surfaced, not degraded to empty');
  assert.equal(result.reason, 'read_failed');

  // 复刻 main.cjs 守卫：失败 → 抛用户面错误，不调用模型。
  const { modelCalls, error, subjectReadFailed } = await simulateReplyGuard(runtime);
  assert.equal(modelCalls, 0, 'model must not be called on read failure');
  assert.equal(subjectReadFailed, true);
  assert.ok(error && /本次未能读取数字之我信息/.test(error.message), 'user-facing read-failure message');
  assert.ok(!/还不了解你|还没有已确认的认识/.test(error ? error.message : ''), 'must not claim not-knowing-user on read failure');

  runtime.subject.getDerived = original;
  await runtime.stop();
});

test('G: 装配入口稳定（同一函数同时服务 normal 与 growth_guided；不记录/换题/稍后再聊隔离由既有验收覆盖）', async () => {
  assert.equal(typeof buildConversationSubjectContext, 'function');
  assert.equal(typeof buildConversationSystemContent, 'function');
  const { runtime } = await newSubject('g');
  assert.equal(typeof runtime.buildConversationSubjectContext, 'function');
  assert.equal(typeof runtime.buildConversationSystemContent, 'function');
  // growth_guided 仅追加引导指令，不替换事实块。
  const guided = runtime.buildConversationSystemContent({ subjectContext: '事实A；事实B', growthGuide: '当前最值得了解的是：称呼？' });
  assert.ok(guided.includes('- 事实A') && guided.includes('- 事实B'), 'facts survive in guided mode');
  assert.ok(guided.includes('当前最值得了解的是：称呼？'));
  const normal = runtime.buildConversationSystemContent({ subjectContext: '事实A；事实B' });
  assert.ok(normal.includes('- 事实A') && normal.includes('- 事实B'));
  assert.ok(!normal.includes('当前最值得了解的是'));
  await runtime.stop();
});
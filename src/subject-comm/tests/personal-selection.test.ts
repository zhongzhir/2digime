import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import { PERSONAL_SELECTION_UNAVAILABLE } from '../network-item';
import { selectNetworkItems } from '../personal-selection';
import { FEED_01_SEED_ITEMS } from './subject-network-feed-01-seed';

function self(subjectId: string, lines: string[]): DigitalSelf {
  const now = '2026-09-08T05:00:00.000Z';
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: lines.map((text, index) => ({
      id: `u_${index + 1}`,
      text,
      facet: index === 0 ? 'about_me' : 'goals',
      status: 'current',
      confirmed: true,
      provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
      updatedAt: now,
    })),
  };
}

test('Personal selection uses Digital Self and model JSON; model failure is unavailable', async () => {
  const digitalSelf = self('subj_a', ['我长期关心人工智能如何改变产品和投资判断。']);
  const subset = FEED_01_SEED_ITEMS.slice(0, 3);
  const result = await selectNetworkItems({
    digitalSelf,
    items: subset,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    chatComplete: async (options) => {
      const blob = options.messages.map((m) => m.content).join('\n');
      assert.match(blob, /人工智能如何改变产品/);
      assert.equal(blob.includes('interestScore'), false);
      const decisions = subset.map((item, index) => ({
        itemId: item.itemId,
        decision: index === 0 ? 'show' : 'ignore',
        reason: index === 0 ? '与已确认的产业与产品关心相符。' : '与当前数字之我关系弱。',
      }));
      return { text: JSON.stringify({ decisions }) };
    },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.shownItemIds, ['ni_01']);
    assert.deepEqual(result.ignoredItemIds, ['ni_02', 'ni_03']);
  }

  const failed = await selectNetworkItems({
    digitalSelf,
    items: subset,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    chatComplete: async () => {
      throw new Error('no model');
    },
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.error, PERSONAL_SELECTION_UNAVAILABLE);
});

test('Personal selection makes one bounded 8192-token recovery after two truncated responses', async () => {
  const digitalSelf = self('subj_recovery', ['我关心开放技术。']);
  const subset = FEED_01_SEED_ITEMS.slice(0, 3);
  const maxTokens: number[] = [];
  const result = await selectNetworkItems({
    digitalSelf,
    items: subset,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    chatComplete: async (options) => {
      maxTokens.push(Number(options.maxTokens || 0));
      if (maxTokens.length < 3) return { text: '{"decisions":[', truncated: true };
      return {
        text: JSON.stringify({
          decisions: subset.map((item) => ({ itemId: item.itemId, decision: 'show', reason: '有用' })),
        }),
      };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(maxTokens, [2048, 4096, 8192]);
});

test('Personal selection receives the mechanical page size without a second relevance scorer', async () => {
  const digitalSelf = self('subj_page', ['我关心科学解释与可实践的方法。']);
  const subset = FEED_01_SEED_ITEMS.slice(0, 3);
  const result = await selectNetworkItems({
    digitalSelf,
    items: subset,
    targetCount: 2,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    chatComplete: async (options) => {
      const blob = options.messages.map((message) => message.content).join('\n');
      assert.match(blob, /当前页面需要 2 条/);
      assert.match(blob, /具体选哪 2 条仍由你/);
      return {
        text: JSON.stringify({
          decisions: subset.map((item, index) => ({
            itemId: item.itemId,
            decision: index < 2 ? 'show' : 'ignore',
            reason: index < 2 ? '更符合本页目标。' : '这一轮先靠后。',
          })),
        }),
      };
    },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.shownItemIds.length, 2);
});

test('Personal selection source has no keyword/score fallback', async () => {
  const src = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/personal-selection.ts'), 'utf8');
  assert.equal(src.includes('opportunity-match'), false);
  assert.equal(src.includes('fallbackMatch'), false);
  assert.equal(src.includes('interestScore'), false);
  assert.equal(src.includes('keywordOverlap'), false);
  assert.equal(src.includes('cosine'), false);
  assert.equal(/\brelevanceScore\b/.test(src), false);
  assert.equal(src.includes('content-preferences'), false);
});

test('explicit preference directives are passed as prompt text, not identity', async () => {
  const digitalSelf = self('subj_a', ['我长期关心人工智能如何改变产品和投资判断。']);
  const subset = FEED_01_SEED_ITEMS.slice(0, 2);
  const result = await selectNetworkItems({
    digitalSelf,
    items: subset,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    preferenceDirectives: '- [boost] 更想看到类似「核聚变」的内容',
    chatComplete: async (options) => {
      const blob = options.messages.map((m) => m.content).join('\n');
      assert.match(blob, /用户明确的内容偏好指令：/);
      assert.match(blob, /核聚变/);
      assert.match(blob, /这些指令不是数字之我身份/);
      const decisions = subset.map((item, index) => ({
        itemId: item.itemId,
        decision: index === 0 ? 'show' : 'ignore',
        reason: index === 0 ? '你明确要求加推这类内容。' : '关系弱。',
      }));
      return { text: JSON.stringify({ decisions }) };
    },
  });
  assert.equal(result.ok, true);
});

test('selectionNotes are short-term context, not identity', async () => {
  const digitalSelf = self('subj_a', ['我长期关心人工智能如何改变产品和投资判断。']);
  const subset = FEED_01_SEED_ITEMS.slice(0, 2);
  const result = await selectNetworkItems({
    digitalSelf,
    items: subset,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    selectionNotes: '近期内容上下文（只存在本机、会过期、可重置，不是长期偏好，不要写成「用户喜欢」）：\n最近打开：开源模型推理成本',
    chatComplete: async (options) => {
      const blob = options.messages.map((m) => m.content).join('\n');
      assert.match(blob, /不是长期偏好/);
      assert.match(blob, /不要写成「用户喜欢」/);
      const decisions = subset.map((item, index) => ({
        itemId: item.itemId,
        decision: index === 0 ? 'show' : 'ignore',
        reason: index === 0 ? '刚看过同类，仍有后续价值。' : '关系弱。',
      }));
      return { text: JSON.stringify({ decisions }) };
    },
  });
  assert.equal(result.ok, true);
});

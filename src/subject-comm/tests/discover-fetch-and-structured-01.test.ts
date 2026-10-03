import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileNetworkItemStore } from '../../relay-service/network-item-store';
import { trustedPublishedMs, type NetworkItem } from '../network-item';
import { completeStructured, SHORT_JSON_PASSES } from '../structured-call';
import { FEED_01_SEED_ITEMS } from './subject-network-feed-01-seed';

const NOW = '2026-10-03T08:00:00.000Z';

function withDates(base: NetworkItem, index: number): NetworkItem {
  const created = new Date(Date.parse('2026-09-01T00:00:00.000Z') + index * 60_000).toISOString();
  return {
    ...base,
    itemId: `ni_fetchwin_${String(index).padStart(4, '0')}`,
    createdAt: created,
  };
}

test('取数窗口：本地库超过 100 条时，listAll 取全量，list 仍受 100 条分页限制', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-fetch-window-'));
  const store = new FileNetworkItemStore(dir);
  const seed = FEED_01_SEED_ITEMS[0]!;
  for (let i = 0; i < 150; i += 1) await store.put(withDates(seed, i));
  const paged = await store.list({ limit: 100 } as never, NOW);
  assert.equal(paged.items.length, 100);
  const all = await store.listAll({} as never, NOW);
  assert.equal(all.length, 150, 'listAll 不能只取最老的 100 条');
  const ids = new Set(all.map((item) => item.itemId));
  assert.equal(ids.has('ni_fetchwin_0149'), true, '最新入库的也必须取得到');
  assert.equal(ids.has('ni_fetchwin_0000'), true, '最老的也不能丢');
});

test('发布时间：缺失、无法解析、早于 1990、晚于现在两天以上的都不算可信', () => {
  const seed = FEED_01_SEED_ITEMS[0]!;
  const nowMs = Date.parse(NOW);
  const make = (publishedAt: string | undefined): NetworkItem => ({
    ...seed,
    content: { ...seed.content, ...(publishedAt === undefined ? {} : { publishedAt }) },
  });
  const noDate = make(undefined);
  delete (noDate.content as { publishedAt?: string }).publishedAt;
  assert.equal(trustedPublishedMs(noDate, nowMs), undefined);
  assert.equal(trustedPublishedMs(make('not-a-date'), nowMs), undefined);
  assert.equal(trustedPublishedMs(make('1970-01-01T00:00:00Z'), nowMs), undefined);
  assert.equal(trustedPublishedMs(make('2027-01-01T00:00:00Z'), nowMs), undefined);
  assert.equal(trustedPublishedMs(make('2026-10-02T12:00:00Z'), nowMs), Date.parse('2026-10-02T12:00:00Z'));
});

test('结构化调用：被截断就升级到第二次；第一次关闭推理、第二次保留；两次都不行如实返回空', async () => {
  const calls: Array<{ maxTokens: number; thinking: unknown }> = [];
  const chat = async (opts: { maxTokens?: number; thinking?: unknown }) => {
    calls.push({ maxTokens: opts.maxTokens ?? 0, thinking: opts.thinking });
    if (calls.length === 1) return { text: '{"a":', truncated: true, finishReason: 'length' };
    return { text: '{"a":1}', truncated: false, finishReason: 'stop' };
  };
  const attempts: Array<{ pass: number; truncated: boolean; parsed: boolean }> = [];
  const result = await completeStructured<{ a: number }>({
    chat: chat as never,
    request: { messages: [{ role: 'user', content: 'x' }] } as never,
    parse: (text) => {
      try {
        return JSON.parse(text) as { a: number };
      } catch {
        return null;
      }
    },
    onAttempt: (a) => attempts.push({ pass: a.pass, truncated: a.truncated, parsed: a.parsed }),
  });
  assert.deepEqual(result.value, { a: 1 });
  assert.equal(result.attempts, 2);
  assert.deepEqual(calls[0]!.thinking, { type: 'disabled' });
  assert.equal(calls[1]!.thinking, undefined, '第二次保留推理，复杂判断需要');
  assert.ok(calls[1]!.maxTokens! > calls[0]!.maxTokens!);
  assert.equal(attempts[0]!.truncated, true);
  assert.equal(attempts[0]!.parsed, false);

  const failing = await completeStructured<{ a: number }>({
    chat: (async () => ({ text: 'not json', truncated: false })) as never,
    request: { messages: [{ role: 'user', content: 'x' }] } as never,
    parse: () => null,
    passes: SHORT_JSON_PASSES,
  });
  assert.equal(failing.value, null);
  assert.equal(failing.attempts, SHORT_JSON_PASSES.length);
});

test('结构化调用：半截 JSON 即使碰巧能解析，只要被标为截断就不算完成', async () => {
  let n = 0;
  const result = await completeStructured<{ a: number }>({
    chat: (async () => {
      n += 1;
      return n === 1 ? { text: '{"a":1}', truncated: true } : { text: '{"a":2}', truncated: false };
    }) as never,
    request: { messages: [{ role: 'user', content: 'x' }] } as never,
    parse: (text) => JSON.parse(text) as { a: number },
  });
  assert.deepEqual(result.value, { a: 2 });
});

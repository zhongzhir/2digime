import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { WebDiscoveryError } from '../../capability/web-discovery';
import type { DiscoverView } from '../../subject-comm/content-discover';
import type { ChatMessage, ChatToolCall } from '../../infrastructure/model-http';

function toolCall(id: string, name: string, args: object): ChatToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function chatWith(searchQueries: string[]) {
  let searchIndex = 0;
  return async ({ messages }: { messages: ChatMessage[] }) => {
    if (searchIndex < searchQueries.length) {
      const query = searchQueries[searchIndex]!;
      searchIndex += 1;
      return {
        text: '',
        toolCalls: [toolCall(`search-${searchIndex}`, 'web_search', { query })],
      };
    }
    const payloads = messages
      .filter((row) => row.role === 'tool')
      .map((row) => JSON.parse(row.content) as Record<string, unknown>);
    const ids = [...new Set(payloads.flatMap((payload) =>
      (Array.isArray(payload.candidates) ? payload.candidates : [])
        .map((candidate) => String((candidate as Record<string, unknown>).candidateId || ''))
        .filter(Boolean),
    ))];
    const quota = payloads.some((payload) => payload.networkCode === 'RATE_LIMITED');
    return {
      text: '',
      toolCalls: [toolCall('present', 'present_results', {
        summary: quota ? '联网搜索受到额度或频率限制，未把它说成没有内容。' : '已按完整候选窗口交付。',
        selections: ids.map((candidateId) => ({
          candidateId,
          why: '符合本次观看要求',
          placement: 'main',
          contentType: 'video',
          entrancePurpose: '观看入口',
        })),
      })],
    };
  };
}

async function settle(bus: ReturnType<typeof createCommandBus>, first: { view: DiscoverView }, gen: string): Promise<DiscoverView> {
  let view = first.view;
  for (let i = 0; i < 5 && view.replenishing; i += 1) {
    view = (await bus.invoke('content', { action: 'replenish', searchGenerationId: gen })).view as DiscoverView;
  }
  return view;
}

test('SEARCH USAGE: a program request sends no preview search and reuses identical queries; the view records actual calls', async () => {
  const pkgDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-search-usage-')), 'pkg');
  const searched: string[] = [];
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: chatWith(['纪录片 正片', '纪录片  正片', '人文 纪录片']),
    contentSearch: async (query: string) => {
      searched.push(query);
      return [{ title: `${query} 第1集`, url: `https://tv.example.org/show/${searched.length}`, snippet: '纪录片正片' }];
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '搜索次数', targetDir: pkgDir });
  const first = await bus.invoke('content', { action: 'seek', text: '找几部纪录片看看', searchGenerationId: 'sg_usage' });
  const view = await settle(bus, first, 'sg_usage');
  assert.equal(searched.includes('找几部纪录片看看'), false, 'no preview search on the raw text for a program request');
  assert.deepEqual([...searched].sort(), ['人文 纪录片', '纪录片 正片']);
  assert.equal(view.searchUsage?.calls, searched.length);
  assert.ok((view.searchUsage?.reused || 0) >= 1);
  assert.equal(view.searchUsage?.rateLimited, false);
  await runtime.stop();
});

test('SEARCH QUOTA: an exhausted search quota is shown as quota, not as "nothing found" or a network failure', async () => {
  const pkgDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-search-quota-')), 'pkg');
  let calls = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: chatWith(['纪录片 正片']),
    contentSearch: async () => {
      calls += 1;
      throw new WebDiscoveryError('RATE_LIMITED', 'rate_limited', 429);
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '额度', targetDir: pkgDir });
  const first = await bus.invoke('content', { action: 'seek', text: '找几部纪录片看看', searchGenerationId: 'sg_quota' });
  const view = await settle(bus, first, 'sg_quota');
  assert.equal(calls, 1);
  assert.match(view.notice, /额度或频率限制/);
  assert.doesNotMatch(view.notice, /整点|这个小时/);
  assert.doesNotMatch(view.notice, /没有找到|检查联网/);
  assert.equal(view.searchUsage?.rateLimited, true);
  await runtime.stop();
});

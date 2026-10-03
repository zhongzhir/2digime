import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { WebDiscoveryError } from '../../capability/web-discovery';
import type { DiscoverView } from '../../subject-comm/content-discover';

function chatWith(searchQueries: string[], media: string[]) {
  return async ({ messages }: { messages: Array<{ content?: string }> }) => {
    const blob = messages.map((row) => String(row.content || '')).join('\n');
    if (blob.includes('判断用户在「发现」里')) {
      return {
        text: JSON.stringify({ intent: 'consume', requestedMedia: media, objectWanted: 'work_itself', searchQueries }),
      };
    }
    if (blob.includes('判断每个候选')) {
      const user = JSON.parse(String(messages[messages.length - 1]?.content || '{}')) as {
        candidates?: Array<{ id: string }>;
      };
      return {
        text: JSON.stringify({
          roles: (user.candidates || []).map((row) => ({ id: row.id, role: 'PRIMARY_CONTENT', medium: 'video', entrance: 'full' })),
        }),
      };
    }
    return { text: '{}' };
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
    contentChat: chatWith(['纪录片 正片', '纪录片  正片', '人文 纪录片'], ['video']),
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
    contentChat: chatWith(['纪录片 正片'], ['video']),
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
  assert.match(view.notice, /搜索额度已经用完/);
  assert.doesNotMatch(view.notice, /没有找到|检查联网/);
  assert.equal(view.searchUsage?.rateLimited, true);
  await runtime.stop();
});

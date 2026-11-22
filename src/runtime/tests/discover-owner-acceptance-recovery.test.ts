import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { personalFeedCachePath, type PersonalFeedPrefetch } from '../../subject-comm/personal-feed';
import type { ChatToolCall } from '../../infrastructure/model-http';

function toolCall(id: string, name: string, args: object): ChatToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

test('explicit Discover request reaches a terminal model response when live Search is unavailable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-discover-terminal-'));
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    searchCapability: false,
    contentOpenMediaFetch: false,
    contentChat: async () => ({
      text: '我理解你想找最近正在讨论、可以直接观看的作品；这次联网结果没有返回，所以我不能编造入口。',
    }),
  });
  try {
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', {
      displayName: '发现终态',
      targetDir: path.join(root, 'pkg'),
    });
    const result = await bus.invoke('content', {
      action: 'seek',
      text: '找一部最近正在讨论的作品，并给我可看的入口',
      searchGenerationId: 'sg_terminal',
    });
    assert.equal(result.view.feedMode, 'intent');
    assert.equal(result.view.replenishing, false);
    assert.match(result.view.responseText || '', /理解你想找/);
    assert.doesNotMatch(result.view.notice, /没有可用的统一搜索/);
  } finally {
    await runtime.stop();
  }
});

test('explicit Discover request explains an empty terminal result after Search returns no candidates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-discover-empty-search-'));
  let searchCalls = 0;
  let modelRound = 0;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    contentOpenMediaFetch: false,
    contentSearch: async () => {
      searchCalls += 1;
      return [];
    },
    contentChat: async () => {
      modelRound += 1;
      if (modelRound === 1) {
        return { text: '', toolCalls: [toolCall('search', 'web_search', { query: '稀有作品 官方观看' })] };
      }
      return { text: '我理解你在找《稀有作品》的可观看资源；这次联网没有拿到可核实的入口，所以我不能编造链接。' };
    },
  });
  try {
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', {
      displayName: '空搜索终态',
      targetDir: path.join(root, 'pkg'),
    });
    const result = await bus.invoke('content', {
      action: 'seek',
      text: '稀有作品',
      searchGenerationId: 'sg_empty_search',
    });
    const view = result.view.replenishing
      ? (await bus.invoke('content', {
          action: 'replenish',
          searchGenerationId: String(result.view.searchGenerationId || ''),
        })).view
      : result.view;
    assert.ok(searchCalls > 0);
    assert.equal(view.replenishing, false);
    assert.match(view.responseText || '', /《稀有作品》/);
  } finally {
    await runtime.stop();
  }
});

test('content.more never awaits an unfinished background personal-supply request', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-discover-more-ready-'));
  const packageRoot = path.join(root, 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    searchCapability: false,
    contentOpenMediaFetch: false,
  });
  try {
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '翻页不阻塞', targetDir: packageRoot });
    const cacheFile = personalFeedCachePath(packageRoot);
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, `${JSON.stringify({
      version: 1,
      selectionContextKey: 'ctx-owner',
      lastView: {
        itemIds: ['ni_delivered'],
        generatedAt: '2026-11-11T00:00:00.000Z',
        mode: 'personal',
      },
      rankedIds: ['ni_delivered'],
    }, null, 2)}\n`);

    const never = new Promise<PersonalFeedPrefetch | null>(() => undefined);
    (runtime as unknown as { pendingPersonalSupply: Promise<PersonalFeedPrefetch | null> | null })
      .pendingPersonalSupply = never;

    const started = Date.now();
    const result = await bus.invoke('content', { action: 'more', searchGenerationId: 'sg_more' });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 300, `more should return from ready cache path, got ${elapsed}ms`);
    assert.equal(result.view.append, true);
    assert.equal(result.view.replenishing, true);
    assert.deepEqual(result.view.cards, []);
  } finally {
    await runtime.stop();
  }
});

test('Discover renderer bounds first response and does not recursively drain pages', async () => {
  const renderer = await fs.readFile(path.join(process.cwd(), 'electron/renderer/content-discover.js'), 'utf8');
  const shell = await fs.readFile(path.join(process.cwd(), 'electron/renderer/app.js'), 'utf8');
  const html = await fs.readFile(path.join(process.cwd(), 'electron/renderer/index.html'), 'utf8');
  assert.match(renderer, /INITIAL_RESPONSE_DEADLINE_MS\s*=\s*30000/);
  assert.match(renderer, /scheduleMoreRetry\(\)/);
  assert.doesNotMatch(renderer, /if \(!moreExhausted\) maybeLoadMore\(\)/);
  assert.match(shell, /Digit2:\s*"discover"/);
  assert.match(html, /id="nav-discover" aria-keyshortcuts="Control\+2"/);
  const personalFeed = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/personal-feed.ts'), 'utf8');
  assert.match(personalFeed, /input\.mode === 'prefetch' \? MAX_FEED :/);
});

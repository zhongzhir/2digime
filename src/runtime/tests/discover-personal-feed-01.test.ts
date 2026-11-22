import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { FileNetworkItemStore } from '../../relay-service/network-item-store';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';
import { digitalSelfBytes } from '../../subject-comm/content-discover';
import { listRecentRecommendationEvents } from '../../subject-comm/recent-recommendation-state';
import { FEED_01_SEED_ITEMS } from '../../subject-comm/tests/subject-network-feed-01-seed';
import type { DigitalSelf } from '../../subject-core/digital-self/types';

function selfOf(subjectId: string): DigitalSelf {
  const now = '2026-09-18T00:00:00.000Z';
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: [
      {
        id: 'u_1',
        text: '我长期关心核聚变研究进展。',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
        updatedAt: now,
      },
    ],
  };
}

function showAllChat() {
  return async ({ messages }: { messages: Array<{ content?: string }> }) => {
    const blob = messages.map((row) => String(row.content || '')).join('\n');
    if (blob.includes('拟定内容发现方向') || blob.includes('拟定公开网页搜索词')) {
      return {
        text: '{"intents":[{"topic":"fusion energy","contentTypes":["article"],"purpose":"learn","freshness":"current","explorationMode":"core","searchQuery":"fusion energy progress"}]}',
      };
    }
    const ids = [...blob.matchAll(/"itemId"\s*:\s*"(ni_[^"]+)"/g)].map((row) => row[1]!);
    return {
      text: JSON.stringify({
        decisions: [...new Set(ids)].map((itemId) => ({
          itemId,
          decision: 'show',
          reason: '与你关心的公开科学进展有关',
        })),
      }),
    };
  };
}

async function hashSelf(pkgDir: string): Promise<string> {
  return createHash('sha256')
    .update((await digitalSelfBytes(pkgDir))!)
    .digest('hex');
}

test('Discover command keeps last feed on search auth failure and does not rewrite Digital Self', async () => {
  const pkgDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-personal-feed-rt-')), 'pkg');
  let failSearch = false;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: showAllChat(),
    contentSearch: async () => {
      if (failSearch) {
        throw Object.assign(new Error('invalid api key'), { status: 401, kind: 'unauthorized' });
      }
      return [];
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '个人发现', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  for (const item of FEED_01_SEED_ITEMS.slice(0, 8)) await store.put(item);
  const before = await hashSelf(pkgDir);
  const first = await bus.invoke('content', { action: 'discover' });
  assert.ok(first.view.cards.length >= 4, 'expected a personal feed from local directory');
  assert.equal(
    first.view.reasonCode === 'CACHED_FEED' ||
      first.view.reasonCode === 'REPLENISHED' ||
      first.view.reasonCode === 'LOCAL_DIRECTORY',
    true,
  );
  failSearch = true;
  const refreshed = await bus.invoke('content', { action: 'refresh' });
  assert.ok(refreshed.view.cards.length >= 1);
  assert.match(String(refreshed.view.notice || ''), /暂时无法|检查连接|检查联网/);
  assert.equal(/NETWORK_AUTH_FAILED|CACHED_FEED/.test(String(refreshed.view.notice || '')), false);

  const openedId = first.view.cards[0]!.itemId;
  await bus.invoke('content', { action: 'open', itemId: openedId });
  await bus.invoke('content', { action: 'asked', itemId: openedId });
  const emptySeek = await bus.invoke('content', { action: 'seek', text: '' });
  assert.ok(emptySeek.view.cards.length >= 1, 'empty seek must fall back to personal feed, not refuse');
  const recent = await listRecentRecommendationEvents(pkgDir);
  assert.equal(recent.some((row) => row.type === 'opened' && row.itemId === openedId), true);
  assert.equal(recent.some((row) => row.type === 'asked_2digime'), true);
  await bus.invoke('content', { action: 'resetRecent' });
  assert.equal((await listRecentRecommendationEvents(pkgDir)).length, 0);
  assert.equal(await hashSelf(pkgDir), before);
  await runtime.stop();
});

test('UI empty copy is projected from notice, not a hardcoded Settings lie', async () => {
  const html = await fs.readFile(path.join(process.cwd(), 'electron/renderer/index.html'), 'utf8');
  assert.match(html, /id="content-discover-empty-text"/);
  assert.equal(/开启联网发现后，这里会按你的数字之我挑选内容/.test(html), false);
  const js = await fs.readFile(path.join(process.cwd(), 'electron/renderer/content-discover.js'), 'utf8');
  assert.match(js, /emptyText.textContent/);
  assert.equal(js.includes('view.reasonCode'), false);
  assert.equal(js.includes('view.seekTrace'), false);
  assert.match(js, /btn-discover-personal/);
  assert.match(js, /feedTitle/);
  assert.match(html, /id="content-discover-feed-title"/);
  assert.match(js, /action: 'refresh'/);
  assert.match(js, /action: 'replenish'/);
  assert.ok(
    js.includes("String(lastView.searchGenerationId || '') === String(view.searchGenerationId || '')"),
    'renderer intent merge must keep generation identity before merging',
  );
  assert.match(js, /兔机米正在准备一些值得看的内容/);
  assert.equal(js.includes('目前还没有可展示的内容'), false);
  assert.equal(html.includes('目前还没有可展示的内容'), false);
  assert.match(js, /resetRecent/);
  assert.match(html, /data-discover-section="sources"/);
  assert.match(html, /id="content-source-add-form"/);
  assert.match(js, /action: 'sourceList'/);
  assert.match(js, /action: 'sourceAdd'/);
  assert.match(js, /action: 'sourceToggle'/);
});

test('content source management lists and reversibly toggles the same portfolio', async () => {
  const pkgDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-source-management-')), 'pkg');
  const runtime = createDigitalMeRuntime({ registerOpenAiStub: false, searchCapability: false });
  try {
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '来源管理', targetDir: pkgDir });
    const listed = await bus.invoke('content', { action: 'sourceList' });
    assert.ok((listed.sources || []).length >= 10);
    const first = listed.sources![0]!;

    const disabled = await bus.invoke('content', {
      action: 'sourceToggle',
      sourceId: first.id,
      enabled: false,
    });
    assert.equal(disabled.sources?.find((row) => row.id === first.id)?.enabled, false);
    assert.match(String(disabled.sourceNotice || ''), /已停用/);

    const enabled = await bus.invoke('content', {
      action: 'sourceToggle',
      sourceId: first.id,
      enabled: true,
    });
    assert.equal(enabled.sources?.find((row) => row.id === first.id)?.enabled, true);
    assert.match(String(enabled.sourceNotice || ''), /已启用/);

    const rejected = await bus.invoke('content', {
      action: 'sourceAdd',
      url: 'http://example.com/feed.xml',
      title: '不安全来源',
    });
    assert.match(String(rejected.sourceNotice || ''), /HTTPS/);
    assert.equal(rejected.sources?.some((row) => row.label === '不安全来源'), false);
  } finally {
    await runtime.stop();
  }
});

test('a low personal-feed queue schedules neutral supply prefetch without replacing the visible page', async () => {
  const pkgDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-low-water-runtime-')), 'pkg');
  let searchCalls = 0;
  let signalSearch!: () => void;
  const searchStarted = new Promise<void>((resolve) => {
    signalSearch = resolve;
  });
  const runtime = createDigitalMeRuntime({
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: showAllChat(),
    contentSearch: async () => {
      searchCalls += 1;
      signalSearch();
      return [];
    },
  });
  try {
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '低水位补量', targetDir: pkgDir });
    const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
    for (const item of FEED_01_SEED_ITEMS.slice(0, 18)) await store.put(item);

    const opened = await bus.invoke('content', { action: 'discover', searchGenerationId: 'sg_low_water' });
    assert.equal(opened.view.cards.length, 12);
    assert.equal(opened.view.replenishing, undefined);
    const visibleIds = opened.view.cards.map((card) => card.itemId);
    await Promise.race([
      searchStarted,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('low-water prefetch did not start')), 2_000)),
    ]);
    assert.equal(searchCalls, 1);

    const reused = await bus.invoke('content', { action: 'asked', itemId: visibleIds[0]! });
    assert.deepEqual(reused.view.cards.map((card) => card.itemId), visibleIds);
  } finally {
    await runtime.stop();
  }
});

test('background personal preselection joins the only feed queue after the current queue is exhausted', async () => {
  const pkgDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-prefetched-ranking-')), 'pkg');
  const delegate = showAllChat();
  let selectionCalls = 0;
  let backgroundSelectionCalls = 0;
  let searchCalls = 0;
  const runtime = createDigitalMeRuntime({
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: async (input) => {
      const blob = input.messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('给这些公开候选排序')) {
        selectionCalls += 1;
        if (blob.includes('后台候选')) backgroundSelectionCalls += 1;
      }
      return delegate(input);
    },
    contentSearch: async () => {
      searchCalls += 1;
      return Array.from({ length: 6 }, (_, index) => ({
        title: `后台候选 ${index + 1}`,
        url: `https://prefetch-${index + 1}.example.org/articles/${index + 1}`,
        snippet: `这是后台补入并等待 Digital Self 选择的公开候选 ${index + 1}。`,
      }));
    },
  });
  try {
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '后台个人预排序', targetDir: pkgDir });
    const overview = await bus.invoke('subject.getOverview', {});
    await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
    const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
    for (const item of FEED_01_SEED_ITEMS.slice(0, 18)) await store.put(item);

    const first = await bus.invoke('content', { action: 'discover', searchGenerationId: 'sg_prefetched_ranking' });
    assert.equal(first.view.cards.length, 12);
    const delivered = new Set(first.view.cards.map((card) => card.itemId));

    let prefetchedMore: typeof first | null = null;
    const readyDeadline = Date.now() + 5_000;
    while (Date.now() < readyDeadline) {
      const more = await bus.invoke('content', { action: 'more' });
      if (more.view.cards.some((card) => /^后台候选 /.test(card.title))) {
        prefetchedMore = more;
        break;
      }
      if (!more.view.cards.length && more.view.replenishing) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      assert.ok(more.view.cards.length >= 1, 'the existing ranked queue must drain before the prefetched page');
      for (const card of more.view.cards) {
        assert.equal(delivered.has(card.itemId), false, 'existing queue pages must not repeat delivered cards');
        delivered.add(card.itemId);
      }
    }

    assert.ok(prefetchedMore, 'the background personal-selection package must join after the existing queue');
    assert.equal(prefetchedMore.view.append, true);
    assert.equal(prefetchedMore.view.cards.filter((card) => /^后台候选 /.test(card.title)).length, 6);
    assert.deepEqual(
      prefetchedMore.view.cards.filter((card) => delivered.has(card.itemId)).map((card) => card.itemId),
      [],
      'the prefetched page must not repeat any delivered item',
    );
    assert.ok(selectionCalls >= 1, 'personal candidates must use Digital Self selection');
    assert.ok(backgroundSelectionCalls >= 1, 'background candidates must be selected before they join the feed queue');
    assert.ok(searchCalls >= 1, 'low-water background work must obtain new neutral supply');
  } finally {
    await runtime.stop();
  }
});

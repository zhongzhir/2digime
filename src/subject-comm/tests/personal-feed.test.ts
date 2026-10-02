import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import { validateNetworkItem, type NetworkItem } from '../network-item';
import {
  discoveryIntentsFromModelText,
  diverseFeedCandidates,
  ensurePersonalFeed,
  personalFeedCachePath,
} from '../personal-feed';
import { FEED_01_SEED_ITEMS } from './subject-network-feed-01-seed';
import { laterCards, listLaterItems, saveLaterItem } from '../later-items';

const NOW = '2026-09-18T08:00:00.000Z';

function selfOf(subjectId: string): DigitalSelf {
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: NOW,
    understandings: [
      {
        id: 'u_1',
        text: '我长期关心核聚变研究进展。',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: NOW },
        updatedAt: NOW,
      },
    ],
  };
}

function showAllChat() {
  return async ({ messages }: { messages: Array<{ content: string }> }) => {
    const blob = messages.map((row) => String(row.content || '')).join('\n');
    if (blob.includes('拟定内容发现方向')) {
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
          reason: '与你关心的公开进展有关',
        })),
      }),
    };
  };
}

function hubItem(): NetworkItem {
  const checked = validateNetworkItem({
    schemaVersion: 1,
    itemId: 'ni_hub',
    publisherSubjectId: 'pub_hub',
    publisherDisplayName: 'Example',
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: { title: 'example.org', text: 'home', url: 'https://example.org/' },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'search' },
  });
  if (!checked.ok) throw new Error(checked.reason);
  return checked.item;
}

test('discoveryIntentsFromModelText keeps short topical queries', () => {
  const intents = discoveryIntentsFromModelText(
    '{"intents":[{"topic":"fusion energy","searchQuery":"fusion energy progress","explorationMode":"core"}]}',
  );
  assert.equal(intents[0]?.searchQuery, 'fusion energy progress');
  assert.equal(discoveryIntentsFromModelText('{"intents":[{"searchQuery":"x"}]}').length, 0);
});

test('open Discover replays a fresh local feed without searching', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed-cache-'));
  const items = FEED_01_SEED_ITEMS.slice(0, 6);
  const first = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'open',
    now: NOW,
  });
  assert.ok(first.view.cards.length >= 4);
  assert.equal(first.reasonCode, 'LOCAL_DIRECTORY');
  assert.equal(first.view.replenishing, undefined);
  let searched = 0;
  const second = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    searchWeb: async () => {
      searched += 1;
      throw new Error('should not search');
    },
    mode: 'open',
    now: NOW,
  });
  assert.equal(searched, 0);
  assert.equal(second.reasonCode, 'CACHED_FEED');
  assert.ok(
    (second.view.supplyTrace || []).some((row) => row.event === 'FIRST_CARD_VISIBLE' && row.ms < 2000),
  );
  assert.deepEqual(
    second.view.cards.map((row) => row.itemId),
    first.view.cards.map((row) => row.itemId),
  );
});

test('non-consumable directory still replenishes; search failure keeps the previous feed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed-keep-'));
  const local = FEED_01_SEED_ITEMS.slice(0, 6);
  const seeded = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items: local,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'open',
    now: NOW,
  });
  const cache = JSON.parse(await fs.readFile(personalFeedCachePath(root), 'utf8')) as {
    personal: { generatedAt: string; itemIds: string[] };
  };
  cache.personal.generatedAt = '2020-01-01T00:00:00.000Z';
  await fs.writeFile(personalFeedCachePath(root), `${JSON.stringify(cache, null, 2)}\n`);

  let searched = 0;
  const opened = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items: [hubItem()],
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    searchWeb: async () => {
      searched += 1;
      throw Object.assign(new Error('invalid api key'), { status: 401, kind: 'unauthorized' });
    },
    getItem: async (itemId) => local.find((row) => row.itemId === itemId),
    mode: 'open',
    now: NOW,
  });
  assert.equal(opened.view.cards.length, seeded.view.cards.length);
  assert.equal(opened.reasonCode, 'CACHED_FEED');
  assert.equal(opened.view.replenishing, true);
  assert.equal(searched, 0);

  const failed = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items: [hubItem()],
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    searchWeb: async () => {
      searched += 1;
      throw Object.assign(new Error('invalid api key'), { status: 401, kind: 'unauthorized' });
    },
    getItem: async (itemId) => local.find((row) => row.itemId === itemId),
    mode: 'replenish',
    now: NOW,
  });
  assert.equal(searched, 1);
  assert.equal(failed.view.cards.length, seeded.view.cards.length);
  assert.equal(failed.reasonCode, 'NETWORK_AUTH_FAILED');
  assert.match(failed.view.notice, /设置中检查连接|暂时无法获取新内容/);
  assert.equal(/开启联网发现/.test(failed.view.notice), false);
  assert.equal(/NETWORK_AUTH_FAILED/.test(failed.view.notice), false);
});

test('换一批 excludes the last shown ids and does not empty the list when search fails', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed-refresh-'));
  const items = FEED_01_SEED_ITEMS.slice(0, 8);
  const first = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'open',
    now: NOW,
  });
  const shown = new Set(first.view.cards.map((row) => row.itemId));
  const next = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    searchWeb: async () => {
      throw Object.assign(new Error('timeout'), { status: 503 });
    },
    mode: 'refresh',
    now: NOW,
  });
  if (next.view.cards.every((card) => shown.has(card.itemId))) {
    assert.equal(next.view.cards.length > 0, true);
    assert.match(next.view.notice, /暂时无法获取新内容|检查联网/);
  } else {
    assert.equal(next.view.cards.some((card) => !shown.has(card.itemId)), true);
  }
});

test('search queries come from the model, not a hardcoded fallback or Digital Self dump', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed-query-'));
  const queries: string[] = [];
  await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items: [],
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    searchWeb: async (query) => {
      queries.push(query);
      return [{ title: 'Public fusion note', url: 'https://example.org/fusion-open', snippet: 'lab' }];
    },
    ingestHit: async () => [],
    reloadItems: async () => [],
    mode: 'replenish',
    now: NOW,
  });
  assert.deepEqual(queries, ['fusion energy progress']);
  assert.equal(queries.some((row) => /核聚变研究进展|self\.json/.test(row)), false);

  const silent: string[] = [];
  await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items: [],
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: async () => ({ text: '{"intents":[]}' }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    searchWeb: async (query) => {
      silent.push(query);
      return [];
    },
    mode: 'open',
    now: NOW,
  });
  assert.deepEqual(silent, []);
});

test('cold open shows preparing then replenish persists directory inventory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed-cold-'));
  const queries: string[] = [];
  const stored: NetworkItem[] = [];
  const web = validateNetworkItem({
    schemaVersion: 1,
    itemId: 'ni_web_fusion',
    publisherSubjectId: 'pub_web',
    publisherDisplayName: 'Example Lab',
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: { title: 'Public fusion note', text: 'A public lab update.', url: 'https://example.org/fusion-open' },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'search' },
  });
  if (!web.ok) throw new Error(web.reason);

  const opened = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items: [],
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    searchWeb: async (query) => {
      queries.push(query);
      return [{ title: 'Public fusion note', url: 'https://example.org/fusion-open', snippet: 'lab' }];
    },
    mode: 'open',
    now: NOW,
  });
  assert.equal(opened.view.cards.length, 0);
  assert.equal(opened.view.replenishing, true);
  assert.equal(opened.view.notice, '');
  assert.equal(queries.length, 0);
  assert.equal((opened.view.supplyTrace || []).some((row) => row.event === 'OPEN_DISCOVER'), true);

  const filled = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items: [],
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    searchWeb: async (query) => {
      queries.push(query);
      return [{ title: 'Public fusion note', url: 'https://example.org/fusion-open', snippet: 'lab' }];
    },
    ingestHit: async () => {
      stored.splice(0, stored.length, web.item);
      return [web.item];
    },
    reloadItems: async () => stored,
    getItem: async (itemId) => stored.find((row) => row.itemId === itemId),
    mode: 'replenish',
    now: NOW,
  });
  assert.ok(filled.view.cards.length >= 1);
  assert.equal(filled.view.cards[0]?.url, 'https://example.org/fusion-open');
  assert.equal(stored[0]?.content.url, 'https://example.org/fusion-open');
  assert.equal(stored[0]?.provenance.via, 'search');
  assert.equal(JSON.stringify(stored).includes('preferencevector'), false);

  const replayQueries: string[] = [];
  const t0 = Date.now();
  const second = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items: stored,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    searchWeb: async (query) => {
      replayQueries.push(query);
      throw new Error('should not search on second open');
    },
    mode: 'open',
    now: NOW,
  });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(replayQueries.length, 0);
  assert.ok(second.view.cards.length >= 1);
  assert.equal(second.reasonCode === 'CACHED_FEED' || second.reasonCode === 'LOCAL_DIRECTORY', true);
});

test('zero-key Discover lists open catalog without a model and does not ask for API Key', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed-zerokey-'));
  const stored: NetworkItem[] = [];
  const opened = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items: [],
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    fetchOpenMedia: async () => ({ status: 200, body: '{}', finalUrl: 'https://example.org' }),
    mode: 'open',
    now: NOW,
  });
  assert.equal(opened.view.cards.length, 0);
  assert.equal(opened.view.replenishing, true);
  assert.equal(/API Key|连接 AI/.test(opened.view.notice || ''), false);

  const filled = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items: [],
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    searchWeb: async () => {
      throw new Error('managed search down');
    },
    fetchOpenMedia: async (url) => {
      if (url.includes('/api/v1/videos')) {
        return {
          status: 200,
          body: JSON.stringify({
            data: [{ name: 'Open science talk', url: 'https://framatube.org/w/zero-start', description: 'public video' }],
          }),
          finalUrl: url,
        };
      }
      if (url.includes('commons.wikimedia.org')) {
        return {
          status: 200,
          body: JSON.stringify({
            query: {
              pages: {
                '1': {
                  title: 'File:OpenLab.jpg',
                  imageinfo: [{ url: 'https://upload.wikimedia.org/wikipedia/commons/o.jpg', mime: 'image/jpeg' }],
                },
              },
            },
          }),
          finalUrl: url,
        };
      }
      if (url.includes('rss/toppodcasts')) {
        return {
          status: 200,
          body: JSON.stringify({
            feed: {
              entry: [
                {
                  title: { label: 'Public tech podcast' },
                  id: { label: 'https://podcasts.apple.com/cn/podcast/public-tech/id1' },
                  summary: { label: 'weekly' },
                },
              ],
            },
          }),
          finalUrl: url,
        };
      }
      return { status: 404, body: '{}', finalUrl: url };
    },
    putNetworkItem: async (item) => {
      stored.push(item);
    },
    reloadItems: async () => stored,
    getItem: async (itemId) => stored.find((row) => row.itemId === itemId),
    mode: 'replenish',
    now: NOW,
  });
  assert.ok(filled.view.cards.length >= 1, 'open catalog should produce visible cards');
  assert.equal(filled.reasonCode, 'REPLENISHED');
  assert.equal(/API Key|请配置|连接 AI/.test(filled.view.notice || ''), false);
  assert.equal(JSON.stringify(stored).includes('preferencevector'), false);
});

test('managed search fault keeps an existing feed and still tries open catalog', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed-fault-'));
  const local = FEED_01_SEED_ITEMS.slice(0, 6);
  const seeded = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items: local,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    mode: 'open',
    now: NOW,
  });
  assert.ok(seeded.view.cards.length >= 4);
  const cache = JSON.parse(await fs.readFile(personalFeedCachePath(root), 'utf8')) as {
    personal: { generatedAt: string; itemIds: string[] };
  };
  cache.personal.generatedAt = '2020-01-01T00:00:00.000Z';
  await fs.writeFile(personalFeedCachePath(root), `${JSON.stringify(cache, null, 2)}\n`);
  let catalogTried = 0;
  const failed = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items: local,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    searchWeb: async () => {
      throw new Error('managed provider down');
    },
    fetchOpenMedia: async () => {
      catalogTried += 1;
      throw new Error('catalog timeout');
    },
    getItem: async (itemId) => local.find((row) => row.itemId === itemId),
    mode: 'replenish',
    now: NOW,
  });
  assert.equal(failed.view.cards.length, seeded.view.cards.length);
  assert.ok(catalogTried >= 1);
  assert.equal(/API Key|请配置 Gemini/.test(failed.view.notice || ''), false);
});

test('selection failure still shows the items already fetched', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed-unranked-'));
  const items = FEED_01_SEED_ITEMS.slice(0, 3);
  const result = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'DISABLED',
    chatComplete: async () => ({ text: 'not json' }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'reset',
    now: NOW,
  });
  assert.equal(result.view.cards.length, items.length);
  assert.match(result.view.notice || '', /没能排好顺序/);
  assert.match(result.view.notice || '', /不同来源/);
});

test('同一来源的重复章节不会占满排序失败时的第一页', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed-diverse-'));
  const items: NetworkItem[] = [];
  for (let i = 0; i < 12; i += 1) {
    const checked = validateNetworkItem({
      schemaVersion: 1,
      itemId: `ni_novel_${i}`,
      publisherSubjectId: 'pub_novel',
      publisherDisplayName: '一部小说',
      kind: 'content',
      createdAt: NOW,
      visibility: 'public',
      content: {
        title: `霸体诀 第${i + 1}章`,
        text: `第${i + 1}章正文`,
        url: `https://audio.example/novel/${i + 1}`,
        contentType: 'audio',
      },
      provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
    });
    if (!checked.ok) throw new Error(checked.reason);
    items.push(checked.item);
  }
  for (const [id, title, host] of [
    ['ni_bbc', '世界新闻一则', 'https://www.bbc.com/news/story'],
    ['ni_npr', '另一则广播', 'https://www.npr.org/story'],
  ] as const) {
    const checked = validateNetworkItem({
      schemaVersion: 1,
      itemId: id,
      publisherSubjectId: `pub_${id}`,
      publisherDisplayName: id,
      kind: 'content',
      createdAt: NOW,
      visibility: 'public',
      content: { title, text: title, url: host, contentType: 'article' },
      provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
    });
    if (!checked.ok) throw new Error(checked.reason);
    items.push(checked.item);
  }
  const result = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'DISABLED',
    chatComplete: async () => ({ text: 'not json' }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'reset',
    now: NOW,
  });
  const titles = result.view.cards.map((card) => card.title);
  const novelCards = titles.filter((title) => title.includes('霸体诀'));
  assert.ok(novelCards.length <= 2, titles.join(' | '));
  assert.ok(titles.some((title) => title.includes('世界新闻')));
  assert.ok(titles.some((title) => title.includes('另一则广播')));
});

test('已保存的屏蔽会从下一轮缓存页移除，不喜欢的一条不再排在前面', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed-block-cache-'));
  const items: NetworkItem[] = [];
  for (const [itemId, publisherSubjectId, title] of [
    ['ni_novel', 'pub_novel', '霸体诀 第1章'],
    ['ni_bbc', 'pub_bbc', '世界新闻一则'],
    ['ni_npr', 'pub_npr', '另一则广播'],
  ] as const) {
    const checked = validateNetworkItem({
      schemaVersion: 1,
      itemId,
      publisherSubjectId,
      publisherDisplayName: publisherSubjectId,
      kind: 'content',
      createdAt: NOW,
      visibility: 'public',
      content: { title, text: title, url: `https://example.com/${itemId}`, contentType: 'article' },
      provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
    });
    if (!checked.ok) throw new Error(checked.reason);
    items.push(checked.item);
  }
  const base = {
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'DISABLED' as const,
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    now: NOW,
  };
  const first = await ensurePersonalFeed({
    ...base,
    chatComplete: async () => ({ text: 'not json' }),
    mode: 'reset',
  });
  assert.ok(first.view.cards.some((card) => card.title.includes('霸体诀')));
  const second = await ensurePersonalFeed({
    ...base,
    chatComplete: async () => {
      throw new Error('reuse must not ask the model');
    },
    mode: 'reuse',
    preferenceRows: [
      {
        id: 'block-novel',
        kind: 'block',
        targetType: 'source',
        target: 'pub_novel',
        text: '不再看来源 一部小说',
        origin: 'user_action',
        updatedAt: NOW,
      },
      {
        id: 'reduce-bbc',
        kind: 'reduce',
        targetType: 'item',
        target: 'ni_bbc',
        text: '不喜欢这一条',
        origin: 'user_action',
        updatedAt: NOW,
      },
    ],
  });
  const titles = second.view.cards.map((card) => card.title);
  assert.equal(titles.some((title) => title.includes('霸体诀')), false);
  assert.ok(titles.includes('另一则广播'));
  assert.ok(titles.includes('世界新闻一则'));
  assert.notEqual(titles[0], '世界新闻一则');
});

test('ranked ignore stays available instead of being dropped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed-rank-'));
  const items = FEED_01_SEED_ITEMS.slice(0, 3);
  const result = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'DISABLED',
    chatComplete: async () => ({
      text: JSON.stringify({
        decisions: items.map((item, index) => ({
          itemId: item.itemId,
          decision: index === 0 ? 'ignore' : 'show',
          reason: index === 0 ? '先排后' : '先看',
        })),
      }),
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'reset',
    now: NOW,
  });
  assert.equal(result.view.cards.length, items.length);
  assert.equal(result.view.cards.some((card) => card.reason === '先排后'), true);
});

test('more returns only unseen cards, or says there is nothing new', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed-more-'));
  const items = FEED_01_SEED_ITEMS.slice(0, 8);
  const first = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'DISABLED',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'open',
    now: NOW,
  });
  const seen = new Set(first.view.cards.map((row) => row.itemId));
  const more = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'DISABLED',
    chatComplete: showAllChat(),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'more',
    now: NOW,
  });
  if (!more.view.cards.length) {
    assert.match(more.view.notice, /暂时没有更多新内容/);
  } else {
    assert.equal(
      more.view.cards.every((card) => !seen.has(card.itemId)),
      true,
    );
  }
});

test('不同作品不会因为都有章节号就被收成同一部', () => {
  const items: NetworkItem[] = [];
  for (const work of ['霸体诀', '雪中悍刀行']) {
    for (let i = 1; i <= 4; i += 1) {
      const checked = validateNetworkItem({
        schemaVersion: 1,
        itemId: `ni_${work}_${i}`,
        publisherSubjectId: 'pub_audio',
        publisherDisplayName: '有声书',
        kind: 'content',
        createdAt: NOW,
        visibility: 'public',
        content: {
          title: `${work} 第${i}章`,
          text: `${work}第${i}章`,
          url: `https://audio.example/${encodeURIComponent(work)}/${i}`,
          contentType: 'audio',
        },
        provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
      });
      if (!checked.ok) throw new Error(checked.reason);
      items.push(checked.item);
    }
  }
  const other = validateNetworkItem({
    schemaVersion: 1,
    itemId: 'ni_news',
    publisherSubjectId: 'pub_news',
    publisherDisplayName: '新闻',
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: { title: '今日新闻', text: '新闻正文', url: 'https://news.example/today', contentType: 'article' },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
  });
  if (!other.ok) throw new Error(other.reason);
  items.push(other.item);
  const picked = diverseFeedCandidates(items, 12, 2);
  assert.ok(picked.filter((item) => item.content.title.includes('霸体诀')).length >= 3);
  assert.ok(picked.filter((item) => item.content.title.includes('雪中悍刀行')).length >= 3);
});

test('搜索结果不会因为进了同一目录就占据默认流', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed-search-'));
  const feed = validateNetworkItem({
    schemaVersion: 1,
    itemId: 'ni_feed',
    publisherSubjectId: 'pub_feed',
    publisherDisplayName: '目录',
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: { title: '目录里的文章', text: '目录正文', url: 'https://example.org/feed-story', contentType: 'article' },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
  });
  const search = validateNetworkItem({
    schemaVersion: 1,
    itemId: 'ni_search',
    publisherSubjectId: 'pub_search',
    publisherDisplayName: '搜索',
    kind: 'content',
    createdAt: NOW,
    visibility: 'public',
    content: { title: '木星搜索残留', text: '搜索正文', url: 'https://example.org/jupiter', contentType: 'article' },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'search' },
  });
  if (!feed.ok || !search.ok) throw new Error('item');
  const result = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items: [search.item, feed.item],
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'DISABLED',
    chatComplete: async () => ({ text: 'not json' }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    mode: 'reset',
    now: NOW,
  });
  const titles = result.view.cards.map((card) => card.title);
  assert.equal(titles.includes('目录里的文章'), true);
  assert.equal(titles.includes('木星搜索残留'), false);
});

test('换一批采用新供给，临时搜索不进入默认流；没有新增时如实说明', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-feed-batch-'));
  const make = (itemId: string, title: string, via: 'feed' | 'search') => {
    const checked = validateNetworkItem({
      schemaVersion: 1,
      itemId,
      publisherSubjectId: `pub_${itemId}`,
      publisherDisplayName: title,
      kind: 'content',
      createdAt: NOW,
      visibility: 'public',
      content: { title, text: `${title}正文`, url: `https://example.org/${itemId}`, contentType: 'article' },
      provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via },
    });
    if (!checked.ok) throw new Error(checked.reason);
    return checked.item;
  };
  const first = make('ni_a', '目录文章甲', 'feed');
  const added = make('ni_b', '新补充的文章', 'feed');
  const search = make('ni_c', '临时搜索残留', 'search');
  const base = {
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    preferences: [] as [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'DISABLED' as const,
    mode: 'open' as const,
    now: NOW,
  };
  const opened = await ensurePersonalFeed({ ...base, items: [first] });
  assert.equal(opened.view.cards.some((card) => card.title === '目录文章甲'), true);
  const same = await ensurePersonalFeed({ ...base, items: [first], mode: 'refresh' });
  assert.match(same.view.notice, /没有换出不同的内容/);
  const refreshed = await ensurePersonalFeed({ ...base, items: [first, added, search], mode: 'refresh' });
  const titles = refreshed.view.cards.map((card) => card.title);
  assert.equal(titles.includes('新补充的文章'), true);
  assert.equal(titles.includes('临时搜索残留'), false);
});

test('稍后看记住稳定标识，来源不在目录里时仍保留', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-later-'));
  await saveLaterItem(root, {
    itemId: 'ni_saved',
    url: 'https://example.org/saved',
    title: '稍后再看的文章',
    text: '摘要',
    publisher: 'Example',
    savedAt: NOW,
  });
  const rows = await listLaterItems(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.url, 'https://example.org/saved');
  const cards = laterCards(rows, new Set());
  assert.equal(cards[0]!.unavailable, true);
  assert.match(cards[0]!.text, /来源暂时打不开/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import { validateNetworkItem, type NetworkItem } from '../network-item';
import {
  discoveryIntentsFromModelText,
  ensurePersonalFeed,
  personalFeedCachePath,
} from '../personal-feed';
import { FEED_01_SEED_ITEMS } from './subject-network-feed-01-seed';

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

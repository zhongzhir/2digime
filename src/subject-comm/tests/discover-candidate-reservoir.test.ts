import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildDiscoverCandidateReservoir, DEFAULT_DISCOVER_RESERVOIR_CAPACITY } from '../discover-candidate-reservoir';
import { validateNetworkItem, type NetworkItem } from '../network-item';
import { selectNetworkItems } from '../personal-selection';
import {
  commitPersonalFeedPrefetch,
  ensurePersonalFeed,
  personalFeedRemainingCount,
} from '../personal-feed';
import type { DigitalSelf } from '../../subject-core/digital-self/types';

const NOW = '2026-11-10T08:00:00.000Z';

function item(index: number, source: number, overrides: Record<string, unknown> = {}): NetworkItem {
  const checked = validateNetworkItem({
    schemaVersion: 1,
    itemId: `ni_reservoir_${index}`,
    publisherSubjectId: `source_${source}`,
    publisherDisplayName: `Source ${source}`,
    kind: 'content',
    createdAt: `2026-11-10T07:${String(index % 60).padStart(2, '0')}:00.000Z`,
    visibility: 'public',
    content: {
      title: `Candidate ${index}`,
      text: `Useful public content ${index}`,
      url: `https://source-${source}.example/items/${index}`,
      contentType: index % 17 === 0 ? 'video' : 'article',
      publishedAt: '2026-11-10T06:00:00.000Z',
    },
    provenance: { origin: 'publisher', actor: 'owner', statedAt: NOW, via: 'feed' },
    ...overrides,
  });
  if (!checked.ok) throw new Error(checked.reason);
  return checked.item;
}

test('candidate reservoir keeps 72 unique candidates and rotates healthy sources', () => {
  const items = Array.from({ length: 100 }, (_, index) => item(index, index % 10));
  const result = buildDiscoverCandidateReservoir({ items, now: NOW });

  assert.equal(result.items.length, DEFAULT_DISCOVER_RESERVOIR_CAPACITY);
  assert.equal(new Set(result.items.map((row) => row.itemId)).size, DEFAULT_DISCOVER_RESERVOIR_CAPACITY);
  assert.equal(result.stats.sourceCount, 10);
  assert.equal(new Set(result.items.slice(0, 10).map((row) => row.publisherSubjectId)).size, 10);
  assert.ok(result.items.some((row) => row.content.contentType === 'video'));
});

test('candidate reservoir excludes seen/blocked/expired and canonical URL duplicates', () => {
  const base = Array.from({ length: 20 }, (_, index) => item(index, index % 5));
  const duplicate = item(99, 4, {
    content: {
      ...base[3]!.content,
      url: `${base[3]!.content.url}?utm_source=duplicate`,
      title: 'Same canonical item',
    },
  });
  const expired = item(100, 4, { expiresAt: '2026-11-09T00:00:00.000Z' });
  const result = buildDiscoverCandidateReservoir({
    items: [...base, duplicate, expired],
    now: NOW,
    excludedItemIds: new Set([base[0]!.itemId]),
    blockedPublisherIds: new Set(['source_1']),
  });

  assert.equal(result.stats.excluded, 1);
  assert.equal(result.stats.blocked, 4);
  assert.equal(result.stats.expired, 1);
  assert.equal(result.stats.duplicates, 1);
  assert.equal(result.items.some((row) => row.itemId === base[0]!.itemId), false);
  assert.equal(result.items.some((row) => row.publisherSubjectId === 'source_1'), false);
});

test('72 candidates use two-wave cross-batch ranking so the third batch can rank first', async () => {
  const items = Array.from({ length: 72 }, (_, index) => item(index, index % 9));
  const digitalSelf: DigitalSelf = {
    schemaVersion: 1,
    subjectId: 'subject_reservoir',
    updatedAt: NOW,
    understandings: [],
  };
  let calls = 0;
  const selected = await selectNetworkItems({
    digitalSelf,
    items,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    chatComplete: async (options) => {
      calls += 1;
      const blob = options.messages.map((row) => row.content).join('\n');
      const ids = [...blob.matchAll(/"itemId":"([^"]+)"/g)].map((row) => row[1]!);
      const ranked = [...ids].sort((left, right) => {
        const leftIndex = Number(left.match(/(\d+)$/)?.[1] || 0);
        const rightIndex = Number(right.match(/(\d+)$/)?.[1] || 0);
        return rightIndex - leftIndex;
      });
      return {
        text: JSON.stringify({
          decisions: ranked.map((itemId) => ({ itemId, decision: 'show', reason: '本轮有阅读价值' })),
        }),
      };
    },
  });

  assert.equal(selected.ok, true);
  assert.equal(calls, 6);
  if (selected.ok) {
    assert.equal(selected.decisions.length, 72);
    assert.equal(new Set(selected.decisions.map((row) => row.itemId)).size, 72);
    assert.equal(selected.decisions[0]?.itemId, 'ni_reservoir_71');
  }
});

test('personal feed serves five pages / 60 unique cards from the reservoir', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-reservoir-pages-'));
  const items = Array.from({ length: 72 }, (_, index) => item(index, index % 9));
  const digitalSelf: DigitalSelf = {
    schemaVersion: 1,
    subjectId: 'subject_pages',
    updatedAt: NOW,
    understandings: [],
  };
  const chatComplete = async (options: { messages: Array<{ content: string }> }) => {
    const blob = options.messages.map((row) => row.content).join('\n');
    if (blob.includes('拟定内容发现方向')) return { text: '{"intents":[]}' };
    const ids = [...blob.matchAll(/"itemId":"([^"]+)"/g)].map((row) => row[1]!);
    return {
      text: JSON.stringify({
        decisions: ids.map((itemId) => ({ itemId, decision: 'show', reason: '本轮有阅读价值' })),
      }),
    };
  };
  const shared = {
    packageRoot: root,
    digitalSelf,
    items,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'DISABLED' as const,
    chatComplete,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    now: NOW,
  };
  const pages: string[][] = [];
  const opened = await ensurePersonalFeed({ ...shared, mode: 'open' });
  pages.push(opened.view.cards.map((card) => card.itemId));
  for (let page = 1; page < 5; page += 1) {
    const more = await ensurePersonalFeed({ ...shared, mode: 'more' });
    pages.push(more.view.cards.map((card) => card.itemId));
  }

  assert.deepEqual(pages.map((page) => page.length), [12, 12, 12, 12, 12]);
  const ids = pages.flat();
  assert.equal(new Set(ids).size, 60);
  assert.equal(pages.every((page) => new Set(page.map((id) => items.find((row) => row.itemId === id)!.publisherSubjectId)).size >= 8), true);
});

test('low-water prefetch adds neutral supply without consuming or replacing the queued page', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-reservoir-prefetch-'));
  const items = Array.from({ length: 72 }, (_, index) => item(index, index % 9));
  const digitalSelf: DigitalSelf = {
    schemaVersion: 1,
    subjectId: 'subject_prefetch',
    updatedAt: NOW,
    understandings: [],
  };
  const chatComplete = async (options: { messages: Array<{ content: string }> }) => {
    const blob = options.messages.map((row) => row.content).join('\n');
    if (blob.includes('拟定内容发现方向')) {
      return {
        text: '{"intents":[{"topic":"open research","contentTypes":["article"],"purpose":"learn","freshness":"current","explorationMode":"explore","searchQuery":"open research"}]}',
      };
    }
    const ids = [...blob.matchAll(/"itemId":"([^"]+)"/g)].map((row) => row[1]!);
    return {
      text: JSON.stringify({ decisions: ids.map((itemId) => ({ itemId, decision: 'show', reason: '有阅读价值' })) }),
    };
  };
  let searchCalls = 0;
  const added = new Map<string, NetworkItem>();
  const shared = {
    packageRoot: root,
    digitalSelf,
    items,
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE' as const,
    chatComplete,
    model: { baseUrl: 'http://127.0.0.1', model: 'test' },
    now: NOW,
    searchWeb: async () => {
      searchCalls += 1;
      return Array.from({ length: 6 }, (_, index) => ({
        title: `Fresh ${index}`,
        url: `https://fresh-${index}.example/items/${index}`,
        snippet: `Fresh public candidate ${index}`,
      }));
    },
    ingestHit: async (hit: { url: string }) => {
      if (!added.has(hit.url)) {
        const index = 200 + added.size;
        const fresh = item(index, 20 + added.size, {
          content: {
            title: `Fresh candidate ${index}`,
            text: `Fresh public content ${index}`,
            url: hit.url,
            contentType: 'article',
            publishedAt: NOW,
          },
        });
        added.set(hit.url, fresh);
        items.push(fresh);
      }
      return [added.get(hit.url)!];
    },
    reloadItems: async () => items,
  };

  await ensurePersonalFeed({ ...shared, mode: 'open' });
  await ensurePersonalFeed({ ...shared, mode: 'prefetch' });
  assert.equal(searchCalls, 0, 'raw local supply above the low-water mark must not trigger external search');
  for (let page = 1; page < 5; page += 1) await ensurePersonalFeed({ ...shared, mode: 'more' });
  assert.equal(await personalFeedRemainingCount(root), 12);

  const beforePrefetch = JSON.parse(await fs.readFile(path.join(root, 'content', 'personal-feed-cache.json'), 'utf8')) as {
    lastView: { itemIds: string[] };
  };
  const prefetched = await ensurePersonalFeed({ ...shared, mode: 'prefetch' });
  const afterPrefetch = JSON.parse(await fs.readFile(path.join(root, 'content', 'personal-feed-cache.json'), 'utf8')) as {
    lastView: { itemIds: string[] };
  };
  assert.equal(searchCalls, 1);
  assert.equal(added.size, 6);
  assert.deepEqual(afterPrefetch.lastView.itemIds, beforePrefetch.lastView.itemIds);
  assert.equal(await personalFeedRemainingCount(root), 12);
  assert.equal(prefetched.view.supplyTrace?.some((row) => row.event === 'PREFETCH_SELECTION_READY'), true);
  assert.equal(prefetched.prefetch?.rankedIds.length, 6);

  const buffered = await ensurePersonalFeed({ ...shared, mode: 'more' });
  assert.equal(buffered.view.cards.length, 12);
  assert.equal(await personalFeedRemainingCount(root), 0);
  assert.equal(await commitPersonalFeedPrefetch(root, prefetched.prefetch!), 6);
  const afterBuffer = await ensurePersonalFeed({ ...shared, mode: 'more' });
  assert.equal(afterBuffer.view.cards.length, 6);
  assert.equal(afterBuffer.view.cards.every((card) => card.title.startsWith('Fresh candidate')), true);
});


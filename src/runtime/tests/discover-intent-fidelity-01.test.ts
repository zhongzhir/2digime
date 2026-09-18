import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { FileNetworkItemStore } from '../../relay-service/network-item-store';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';
import { FEED_01_SEED_ITEMS } from '../../subject-comm/tests/subject-network-feed-01-seed';
import { validateNetworkItem } from '../../subject-comm/network-item';
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
        text: '我长期关心核聚变与 RWA。',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
        updatedAt: now,
      },
    ],
  };
}

const VIDEO = validateNetworkItem({
  schemaVersion: 1,
  itemId: 'ni_ai_short',
  publisherSubjectId: 'pub_video',
  publisherDisplayName: 'Open Films',
  kind: 'content',
  createdAt: '2026-09-18T00:00:00.000Z',
  visibility: 'public',
  content: {
    title: 'A public AI short film',
    text: 'Watch the film.',
    url: 'https://example.org/watch/ai-short',
    contentType: 'video',
    mediaUrl: 'https://cdn.example.org/ai-short.mp4',
  },
  provenance: { origin: 'publisher', actor: 'owner', statedAt: '2026-09-18T00:00:00.000Z', via: 'search' },
});
if (!VIDEO.ok) throw new Error(VIDEO.reason);

test('CURRENT_SEARCH_MODE does not fill with Personal Feed; return restores cache instantly', async () => {
  const pkgDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-intent-fid-')), 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('拟定内容发现方向')) {
        return {
          text: '{"intents":[{"topic":"fusion","contentTypes":["article"],"purpose":"learn","freshness":"current","explorationMode":"core","searchQuery":"fusion energy"}]}',
        };
      }
      if (blob.includes('判断用户在「发现」里')) {
        return {
          text: JSON.stringify({
            mode: 'consume',
            topic: 'AI',
            requestedContentTypes: ['video'],
            objectWanted: 'primary_content',
            searchQueries: ['AI short films'],
          }),
        };
      }
      if (blob.includes('判断每个候选')) {
        return {
          text: JSON.stringify({
            roles: [{ id: VIDEO.item.itemId, role: 'PRIMARY_CONTENT' }],
          }),
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
    },
    contentSearch: async () => [],
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '意图忠实', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  for (const item of FEED_01_SEED_ITEMS.slice(0, 8)) await store.put(item);
  await store.put(VIDEO.item);

  const first = await bus.invoke('content', { action: 'discover' });
  assert.ok(first.view.cards.length >= 4);
  const personalIds = new Set(first.view.cards.map((card) => card.itemId));
  const cacheBefore = await fs.readFile(path.join(pkgDir, 'content', 'personal-feed-cache.json'), 'utf8');

  const sought = await bus.invoke('content', { action: 'seek', text: '找几个AI精品视频看一下' });
  assert.equal(sought.view.feedMode, 'intent');
  assert.equal(sought.view.cards.some((card) => personalIds.has(card.itemId) && card.itemId !== VIDEO.item.itemId), false);
  assert.match(String(sought.view.feedTitle || sought.view.lead || ''), /AI/);
  assert.equal(sought.view.seekTrace?.visible, sought.view.cards.length);

  const cacheAfterSeek = await fs.readFile(path.join(pkgDir, 'content', 'personal-feed-cache.json'), 'utf8');
  assert.equal(JSON.parse(cacheAfterSeek).personal.itemIds.join(','), JSON.parse(cacheBefore).personal.itemIds.join(','));

  const t0 = Date.now();
  const back = await bus.invoke('content', { action: 'discover' });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(back.view.feedMode, 'personal');
  assert.ok(back.view.cards.length >= 1);
  await runtime.stop();
});

test('search failure keeps Personal Feed cache and shows search empty', async () => {
  const pkgDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-intent-fail-')), 'pkg');
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('判断用户在「发现」里')) {
        return {
          text: JSON.stringify({
            mode: 'consume',
            topic: 'AI',
            requestedContentTypes: ['video'],
            objectWanted: 'primary_content',
            searchQueries: ['AI short films'],
          }),
        };
      }
      if (blob.includes('判断每个候选')) return { text: '{"roles":[]}' };
      const ids = [...blob.matchAll(/"itemId"\s*:\s*"(ni_[^"]+)"/g)].map((row) => row[1]!);
      return {
        text: JSON.stringify({
          decisions: [...new Set(ids)].map((itemId) => ({ itemId, decision: 'show', reason: 'ok' })),
        }),
      };
    },
    contentSearch: async () => {
      throw Object.assign(new Error('timeout'), { status: 503 });
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '失败保留', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  for (const item of FEED_01_SEED_ITEMS.slice(0, 8)) await store.put(item);
  const first = await bus.invoke('content', { action: 'discover' });
  assert.ok(first.view.cards.length >= 4);
  const cacheBefore = await fs.readFile(path.join(pkgDir, 'content', 'personal-feed-cache.json'), 'utf8');
  const sought = await bus.invoke('content', { action: 'seek', text: '找几个AI精品视频看一下' });
  assert.equal(sought.view.feedMode, 'intent');
  assert.equal(sought.view.cards.length, 0);
  assert.match(String(sought.view.notice || ''), /暂时无法|没有找到可以直接/);
  const cacheAfter = await fs.readFile(path.join(pkgDir, 'content', 'personal-feed-cache.json'), 'utf8');
  assert.equal(JSON.parse(cacheAfter).personal.itemIds.join(','), JSON.parse(cacheBefore).personal.itemIds.join(','));
  const back = await bus.invoke('content', { action: 'discover' });
  assert.ok(back.view.cards.length >= 1);
  await runtime.stop();
});

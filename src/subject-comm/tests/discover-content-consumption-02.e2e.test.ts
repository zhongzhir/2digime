import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ingestSource } from '../content-ingest';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import { cardFromNetworkItem } from '../content-discover';
import { seekContent } from '../content-seek';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { FileNetworkItemStore } from '../../relay-service/network-item-store';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';
import type { DigitalSelf } from '../../subject-core/digital-self/types';
import { listContentPreferences } from '../content-preferences';
import { directoryHoldsUserData } from '../content-directory';

const PEERTUBE_FEED = 'https://framatube.org/feeds/videos.xml';
const EVIDENCE = path.join(process.cwd(), 'build', 'evidence', 'discover-content-consumption-02');

async function writeEvidence(name: string, payload: unknown): Promise<void> {
  await fs.mkdir(EVIDENCE, { recursive: true });
  await fs.writeFile(path.join(EVIDENCE, name), `${JSON.stringify(payload, null, 2)}\n`);
}

function selfOf(subjectId: string): DigitalSelf {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: [
      {
        id: 'u_1',
        text: '我喜欢看公开科学和影像。',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
        updatedAt: now,
      },
    ],
  };
}

test('PeerTube open video enters directory then Discover as a video card', async (t) => {
  const store = new MemoryNetworkItemStore();
  const feed = await ingestSource({ sourceUrl: PEERTUBE_FEED, store, limit: 5 });
  if (!feed.items.length) {
    t.skip(`PeerTube unavailable: ${feed.records[0]?.reason || 'empty'}`);
    return;
  }
  const video = feed.items.find((row) => row.content.contentType === 'video') || feed.items[0]!;
  assert.ok(video.content.url);
  assert.equal(directoryHoldsUserData(video).length, 0);
  const card = cardFromNetworkItem(video, '目录里已有这条内容。');
  assert.equal(card.contentType === 'video' || Boolean(card.mediaUrl || card.thumbnailUrl), true);
  const token =
    String(video.content.title)
      .split(/\s+/)
      .find((part) => part.length >= 4) || video.content.title;
  const sought = await seekContent({
    query: `找几个 ${token} 看看`,
    items: feed.items,
  });
  assert.equal(
    sought.cards.some((row) => row.itemId === video.itemId) ||
      sought.cards.some((row) => row.contentType === 'video' || Boolean(row.thumbnailUrl || row.mediaUrl)),
    true,
  );
  await writeEvidence('peertube-discover-card.json', {
    title: card.title,
    url: card.url,
    contentType: card.contentType || null,
    thumbnailUrl: card.thumbnailUrl || null,
    mediaUrl: card.mediaUrl || null,
  });
});

test('open/later do not write preferences; boost does and can reverse', async () => {
  const pkgDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-consume-state-')), 'pkg');
  const store = new MemoryNetworkItemStore();
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Pub</title>
<item><title>A public talk on small models</title><link>https://example.org/watch/small-models</link><description>Conference recording.</description></item>
</channel></rss>`;
  const ingested = await ingestSource({
    sourceUrl: 'https://example.org/feed.xml',
    store,
    now: '2026-09-15T12:00:00.000Z',
    fetchImpl: async () => ({ status: 200, body: rss, finalUrl: 'https://example.org/feed.xml' }),
  });
  const target = ingested.items[0]!;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('判断用户')) return { text: '{"intent":"consume","objectWanted":"work_itself"}' };
      const ids = [...blob.matchAll(/"itemId"\s*:\s*"(ni_[^"]+)"/g)].map((row) => row[1]!);
      const unique = [...new Set(ids.length ? ids : [target.itemId])];
      return {
        text: JSON.stringify({
          decisions: unique.map((itemId) => ({ itemId, decision: 'show', reason: '你可能想看' })),
        }),
      };
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '状态', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const local = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  await local.put(target);

  await bus.invoke('content', { action: 'open', itemId: target.itemId });
  await bus.invoke('content', { action: 'later', itemId: target.itemId });
  assert.equal((await listContentPreferences(pkgDir)).length, 0);
  const boosted = await bus.invoke('content', { action: 'boost', itemId: target.itemId });
  const prefs = await listContentPreferences(pkgDir);
  assert.equal(prefs.length, 1);
  assert.equal(prefs[0]!.kind, 'boost');
  await bus.invoke('content', { action: 'reverse', directiveId: prefs[0]!.id });
  assert.equal((await listContentPreferences(pkgDir)).length, 0);
  assert.ok(boosted.view.preferences);
  await runtime.stop();
});

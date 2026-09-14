import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MemoryNetworkItemStore, FileNetworkItemStore } from '../../relay-service/network-item-store';
import { forbiddenPersonalizationKeys } from '../network-item';
import { contentItemId, normalizeCanonicalUrl, sourcePublisherId } from '../content-canonical';
import { directoryHoldsUserData, searchContentDirectory } from '../content-directory';
import { ingestSource, parseFeed } from '../content-ingest';

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Publisher</title>
    <item>
      <title>Fusion progress this week</title>
      <link>https://example.org/fusion?utm_source=rss&amp;utm_medium=feed</link>
      <description><![CDATA[<p>A lab published new confinement results.</p>]]></description>
      <pubDate>Mon, 14 Sep 2026 01:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Sports roundup</title>
      <link>https://example.org/sports</link>
      <description>Scores and fixtures.</description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Source</title>
  <entry>
    <title>Atom fusion note</title>
    <link rel="alternate" href="https://example.org/fusion"/>
    <summary>Same article via Atom.</summary>
    <published>2026-09-14T01:00:00Z</published>
  </entry>
</feed>`;

test('canonical URL strips tracking and yields stable item id', () => {
  const a = normalizeCanonicalUrl('https://Example.org/fusion/?utm_source=rss&utm_medium=feed');
  const b = normalizeCanonicalUrl('https://example.org/fusion');
  assert.equal(a, b);
  assert.equal(contentItemId(a), contentItemId(b));
  assert.notEqual(sourcePublisherId('https://example.org/feed.xml'), sourcePublisherId('https://other.org/feed.xml'));
});

test('RSS and Atom parse title, link, summary', () => {
  const rss = parseFeed(RSS);
  assert.equal(rss.sourceTitle, 'Example Publisher');
  assert.equal(rss.items.length, 2);
  assert.match(rss.items[0]!.url, /example.org\/fusion/);
  const atom = parseFeed(ATOM);
  assert.equal(atom.items[0]!.url, 'https://example.org/fusion');
});

test('ingest feed: normalize, dedup, searchable directory, no user fields', async () => {
  const store = new MemoryNetworkItemStore();
  const fetchImpl = async () => ({ status: 200, body: RSS, finalUrl: 'https://example.org/feed.xml' });
  const first = await ingestSource({
    sourceUrl: 'https://example.org/feed.xml',
    store,
    now: '2026-09-14T02:00:00.000Z',
    fetchImpl,
  });
  assert.equal(first.items.length, 2);
  assert.equal(first.records.every((row) => row.status === 'published'), true);
  const fusion = first.items.find((item) => item.content.title.includes('Fusion'));
  assert.ok(fusion);
  assert.equal(fusion!.content.url, 'https://example.org/fusion');
  assert.equal(fusion!.provenance.origin, 'publisher');
  assert.equal(directoryHoldsUserData(fusion!).length, 0);
  assert.deepEqual(forbiddenPersonalizationKeys(fusion! as unknown as Record<string, unknown>), []);

  const second = await ingestSource({
    sourceUrl: 'https://example.org/feed.xml',
    store,
    now: '2026-09-14T03:00:00.000Z',
    fetchImpl,
  });
  assert.equal(second.records.filter((row) => row.status === 'duplicate').length, 2);
  const listed = await store.list({ kind: 'content', limit: 50 }, '2026-09-14T03:00:00.000Z');
  assert.equal(listed.items.length, 2);
  const found = searchContentDirectory(listed.items, { q: 'fusion' });
  assert.equal(found.length, 1);
  assert.equal(found[0]!.itemId, fusion!.itemId);
  assert.throws(() => searchContentDirectory(listed.items, { q: 'x', preference: 'secret' } as never));
});

test('AI descriptor may rewrite text but still must not store user identity', async () => {
  const store = new MemoryNetworkItemStore();
  const result = await ingestSource({
    sourceUrl: 'https://example.org/feed.xml',
    store,
    now: '2026-09-14T02:00:00.000Z',
    fetchImpl: async () => ({ status: 200, body: RSS, finalUrl: 'https://example.org/feed.xml' }),
    enrich: async ({ title }) => `topic: energy research | ${title}`,
  });
  const fusion = result.items.find((item) => item.content.url === 'https://example.org/fusion');
  assert.ok(fusion);
  assert.match(fusion!.content.text, /energy research/);
  assert.equal(fusion!.provenance.actor, 'model');
  assert.equal(directoryHoldsUserData(fusion!).length, 0);
});

test('invalid URL is rejected without entering the directory', async () => {
  const store = new MemoryNetworkItemStore();
  const result = await ingestSource({
    sourceUrl: 'https://example.org/feed.xml',
    store,
    now: '2026-09-14T02:00:00.000Z',
    fetchImpl: async () => ({
      status: 200,
      body: '<rss><channel><title>x</title><item><title>bad</title><link>javascript:alert(1)</link><description>nope</description></item></channel></rss>',
      finalUrl: 'https://example.org/feed.xml',
    }),
  });
  assert.equal(result.items.length, 0);
  assert.equal(result.records[0]?.status, 'rejected');
});

test('real public RSS ingest lands in FileNetworkItemStore', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-content-dir-'));
  const store = new FileNetworkItemStore(root);
  const sources = [
    'https://feeds.bbci.co.uk/news/rss.xml',
    'https://hnrss.org/frontpage',
  ];
  let result: Awaited<ReturnType<typeof ingestSource>> | null = null;
  let sourceUrl = sources[0]!;
  for (const candidate of sources) {
    sourceUrl = candidate;
    result = await ingestSource({ sourceUrl: candidate, store, limit: 8 });
    if (result.items.length > 0) break;
  }
  if (!result || result.items.length === 0) {
    t.skip(`real feed unavailable: ${result?.records[0]?.reason || 'empty'}`);
    return;
  }
  assert.ok(result.items.length >= 1);
  for (const item of result.items) {
    assert.equal(item.kind, 'content');
    assert.equal(item.visibility, 'public');
    assert.ok(item.content.url?.startsWith('http'));
    assert.equal(directoryHoldsUserData(item).length, 0);
  }
  const listed = await store.list({ kind: 'content', limit: 50 }, new Date().toISOString());
  const hit = searchContentDirectory(listed.items, { q: result.items[0]!.content.title.slice(0, 12) });
  assert.ok(hit.length >= 1);
  const evidenceDir = path.join(process.cwd(), 'build', 'evidence', 'content-distribution-01');
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDir, 'slice-1-real-ingest.json'),
    `${JSON.stringify(
      {
        sourceUrl,
        sourceTitle: result.sourceTitle,
        count: result.items.length,
        sample: result.items.slice(0, 3).map((item) => ({
          itemId: item.itemId,
          title: item.content.title,
          url: item.content.url,
          status: result.records.find((row) => row.itemId === item.itemId)?.status,
        })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
});

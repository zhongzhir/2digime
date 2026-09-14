import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import { ingestSource } from '../content-ingest';
import { seekContent } from '../content-seek';

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Publisher</title>
    <item>
      <title>Fusion progress this week</title>
      <link>https://example.org/fusion</link>
      <description>A lab published new confinement results.</description>
    </item>
    <item>
      <title>Sports roundup</title>
      <link>https://example.org/sports</link>
      <description>Scores and fixtures.</description>
    </item>
  </channel>
</rss>`;

test('seek matches directory, keeps provenance URL, dedups web, and is not a crawler', async () => {
  const ingested = await ingestSource({
    sourceUrl: 'https://example.org/feed.xml',
    store: new MemoryNetworkItemStore(),
    now: '2026-09-14T07:00:00.000Z',
    fetchImpl: async () => ({ status: 200, body: RSS, finalUrl: 'https://example.org/feed.xml' }),
  });
  const sought = await seekContent({
    query: '帮我找 fusion 进展',
    items: ingested.items,
    searchWeb: async () => [
      { title: 'Fusion progress this week', url: 'https://example.org/fusion?utm_source=web', snippet: 'duplicate' },
      { title: 'IAEA fusion notes', url: 'https://www.iaea.org/topics/fusion', snippet: 'Public fusion overview.' },
    ],
  });
  assert.equal(sought.usedDirectory, true);
  assert.equal(sought.usedExternal, true);
  assert.equal(sought.cards.some((card) => card.url === 'https://example.org/fusion' && card.source === 'directory'), true);
  assert.equal(sought.cards.filter((card) => card.url === 'https://example.org/fusion').length, 1);
  const web = sought.cards.find((card) => card.source === 'web');
  assert.ok(web);
  assert.equal(web!.url, 'https://www.iaea.org/topics/fusion');
  assert.match(web!.url, /^https:\/\//);

  const src = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/content-seek.ts'), 'utf8');
  assert.equal(/puppeteer|playwright|sitemap|crawlSite|robots\.txt/i.test(src), false);
});

test('real BBC title can be found by a natural-language request', async (t) => {
  const store = new MemoryNetworkItemStore();
  let ingested;
  try {
    ingested = await ingestSource({
      sourceUrl: 'https://feeds.bbci.co.uk/news/rss.xml',
      store,
      limit: 5,
    });
  } catch {
    t.skip('real feed unavailable');
    return;
  }
  if (!ingested.items.length) {
    t.skip('real feed unavailable');
    return;
  }
  const item = ingested.items[0]!;
  const token = String(item.content.title)
    .split(/\s+/)
    .find((part) => part.length >= 4) || item.content.title;
  const sought = await seekContent({
    query: `帮我找 ${token} 相关报道`,
    items: ingested.items,
  });
  assert.equal(sought.usedDirectory, true);
  assert.ok(sought.cards.some((card) => card.itemId === item.itemId));
  assert.match(String(sought.cards[0]!.url || item.content.url), /^https:\/\//);
  const evidenceDir = path.join(process.cwd(), 'build', 'evidence', 'content-distribution-01');
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDir, 'slice-4-real-seek.json'),
    `${JSON.stringify(
      {
        queryToken: token,
        title: item.content.title,
        url: item.content.url,
        cardCount: sought.cards.length,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
});

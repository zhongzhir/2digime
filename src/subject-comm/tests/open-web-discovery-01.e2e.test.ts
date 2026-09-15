/**
 * OPEN-WEB-CONTENT-DISCOVERY-01 真站闸门：A RSS autodiscovery / B sitemap / C 普通页。
 * 证据不含全文、不含密钥。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import { ingestOpenWebSource, indexSearchHits } from '../open-web-discovery';
import { directoryHoldsUserData } from '../content-directory';
import { forbiddenPersonalizationKeys } from '../network-item';

const EVIDENCE = path.join(process.cwd(), 'build', 'evidence', 'open-web-content-discovery-01');

function clip(value: string | undefined): string {
  return String(value || '').slice(0, 160);
}

test('live A/B/C open web sources index without supplier registration', { timeout: 120_000 }, async () => {
  const a = await ingestOpenWebSource({
    url: 'https://css-tricks.com/',
    store: new MemoryNetworkItemStore(),
    limit: 2,
  });
  assert.equal(a.discovery.access, 'ok');
  assert.equal(a.discovery.via, 'autodiscovery');
  assert.ok(a.discovery.feeds.some((row) => /feed/i.test(row.url)));
  assert.ok(a.items.length >= 1);
  assert.equal(a.items[0]!.provenance.via, 'autodiscovery');
  assert.match(String(a.items[0]!.content.url), /^https:\/\//);
  assert.equal(/<html|full article/i.test(a.items[0]!.content.text), false);

  const b = await ingestOpenWebSource({
    url: 'https://www.ietf.org/',
    store: new MemoryNetworkItemStore(),
    limit: 1,
    maxSitemapUrls: 2,
  });
  assert.equal(b.discovery.access, 'ok');
  assert.equal(b.discovery.via, 'sitemap');
  assert.ok(b.discovery.sitemaps.length >= 1);
  assert.ok(b.items.length >= 1);
  assert.equal(b.items[0]!.provenance.via, 'sitemap');
  assert.match(String(b.items[0]!.content.url), /^https:\/\/www\.ietf\.org\//);

  const c = await ingestOpenWebSource({
    url: 'https://www.example.com/',
    store: new MemoryNetworkItemStore(),
    limit: 1,
  });
  assert.equal(c.discovery.access, 'ok');
  assert.equal(c.discovery.via, 'page');
  assert.equal(c.items.length, 1);
  assert.equal(c.items[0]!.provenance.via, 'page');
  assert.equal(c.items[0]!.content.url, 'https://www.example.com/');
  assert.match(c.items[0]!.content.title, /Example Domain/i);

  const searchStore = new MemoryNetworkItemStore();
  const indexed = await indexSearchHits({
    store: searchStore,
    hits: [{ title: 'Example Domain', url: 'https://www.example.com/', snippet: 'This domain is for use in illustrative examples.' }],
  });
  assert.equal(indexed.length, 1);
  assert.equal(indexed[0]!.provenance.via, 'search');

  for (const item of [...a.items, ...b.items, ...c.items, ...indexed]) {
    assert.equal(directoryHoldsUserData(item).length, 0);
    assert.deepEqual(forbiddenPersonalizationKeys(item as unknown as Record<string, unknown>), []);
    assert.equal(item.provenance.origin, 'publisher');
  }

  await fs.mkdir(EVIDENCE, { recursive: true });
  await fs.writeFile(
    path.join(EVIDENCE, 'sites-abc.json'),
    `${JSON.stringify(
      {
        A: {
          sourceUrl: 'https://css-tricks.com/',
          method: a.discovery.via,
          feeds: a.discovery.feeds.map((row) => row.url),
          canonical: a.items[0]!.content.url,
          provenance: a.items[0]!.provenance.via,
          itemId: a.items[0]!.itemId,
          title: clip(a.items[0]!.content.title),
        },
        B: {
          sourceUrl: 'https://www.ietf.org/',
          method: b.discovery.via,
          sitemaps: b.discovery.sitemaps,
          canonical: b.items[0]!.content.url,
          provenance: b.items[0]!.provenance.via,
          itemId: b.items[0]!.itemId,
          title: clip(b.items[0]!.content.title),
        },
        C: {
          sourceUrl: 'https://www.example.com/',
          method: c.discovery.via,
          canonical: c.items[0]!.content.url,
          provenance: c.items[0]!.provenance.via,
          itemId: c.items[0]!.itemId,
          title: clip(c.items[0]!.content.title),
        },
        search: {
          method: 'search',
          canonical: indexed[0]!.content.url,
          provenance: indexed[0]!.provenance.via,
          itemId: indexed[0]!.itemId,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
});

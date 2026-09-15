import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import { discoverFeedHints, parsePageMetadata } from '../page-metadata';
import {
  discoverOpenWebSource,
  ingestOpenWebSource,
  indexSearchHits,
  parseSitemapLocs,
  proposeOpenWebQueries,
} from '../open-web-discovery';
import { ingestSource } from '../content-ingest';
import { normalizeCanonicalUrl } from '../content-canonical';

const SITE = 'https://example.org/';
const PAGE = `<!doctype html>
<html>
<head>
  <link rel="canonical" href="https://example.org/hello">
  <link rel="alternate" type="application/rss+xml" href="/feed.xml">
  <link rel="alternate" type="application/atom+xml" href="https://example.org/atom.xml">
  <link rel="alternate" type="text/html" href="/not-a-feed">
  <link rel="alternate" type="application/rss+xml" href="javascript:alert(1)">
  <meta property="og:title" content="Hello page">
  <meta property="og:description" content="A public summary.">
  <meta property="og:site_name" content="Example Org">
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"NewsArticle","headline":"JSON-LD Hello","description":"From JSON-LD","datePublished":"2026-09-01T00:00:00Z","author":{"name":"Ada"},"url":"https://example.org/hello"}
  </script>
  <title>Fallback title</title>
</head>
<body><p>full article body that must not be stored as the default text</p></body>
</html>`;

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Example Feed</title>
<item><title>Fusion note</title><link>https://example.org/fusion</link><description>Lab news.</description></item>
</channel></rss>`;

const SITEMAP = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://example.org/a</loc></url>
<url><loc>https://example.org/b</loc></url>
</urlset>`;

const SITEMAP_INDEX = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<sitemap><loc>https://example.org/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`;

function mockFetch(map: Record<string, { status: number; body: string; finalUrl?: string }>) {
  return async (url: string) => {
    const hit = map[url] || map[url.replace(/\/$/, '')];
    if (!hit) {
      const err = Object.assign(new Error('missing mock ' + url), { code: 'ENOTFOUND' });
      throw err;
    }
    return { status: hit.status, body: hit.body, finalUrl: hit.finalUrl || url };
  };
}

test('feed autodiscovery resolves relative RSS/Atom and skips malformed/unsafe declarations', () => {
  const feeds = discoverFeedHints(PAGE, SITE);
  assert.equal(feeds.some((row) => row.url === 'https://example.org/feed.xml' && row.type === 'rss'), true);
  assert.equal(feeds.some((row) => row.url === 'https://example.org/atom.xml' && row.type === 'atom'), true);
  assert.equal(feeds.some((row) => /javascript/i.test(row.url)), false);
  assert.equal(feeds.some((row) => /not-a-feed/.test(row.url)), false);
});

test('page metadata prefers canonical, OpenGraph, JSON-LD; does not keep full body', () => {
  const meta = parsePageMetadata(PAGE, 'https://example.org/hello?utm_source=x');
  assert.equal(meta.canonicalUrl, 'https://example.org/hello');
  assert.match(meta.title, /JSON-LD Hello|Hello page/);
  assert.match(meta.description, /JSON-LD|public summary/);
  assert.equal(meta.publishedAt, '2026-09-01T00:00:00Z');
  assert.equal(meta.author, 'Ada');
  assert.equal(/full article body/.test(meta.description), false);
});

test('missing metadata falls back to title/url', () => {
  const meta = parsePageMetadata('<html><head><title>Only title</title></head></html>', 'https://example.org/plain');
  assert.equal(meta.canonicalUrl, 'https://example.org/plain');
  assert.equal(meta.title, 'Only title');
  assert.equal(meta.description, 'Only title');
});

test('duplicate canonical URLs collapse', () => {
  assert.equal(
    normalizeCanonicalUrl('https://Example.org/hello?utm_campaign=1'),
    normalizeCanonicalUrl('https://example.org/hello'),
  );
});

test('discoverOpenWebSource finds feeds without ingesting a second pipeline', async () => {
  const discovery = await discoverOpenWebSource({
    url: 'https://example.org/',
    fetchImpl: mockFetch({
      'https://example.org/': { status: 200, body: PAGE },
    }),
  });
  assert.equal(discovery.access, 'ok');
  assert.equal(discovery.via, 'autodiscovery');
  assert.equal(discovery.feeds.length >= 1, true);
  const store = new MemoryNetworkItemStore();
  const ingested = await ingestOpenWebSource({
    url: 'https://example.org/',
    store,
    fetchImpl: mockFetch({
      'https://example.org/': { status: 200, body: PAGE },
      'https://example.org/feed.xml': { status: 200, body: RSS },
      'https://example.org/atom.xml': { status: 200, body: RSS },
    }),
  });
  assert.ok(ingested.items.length >= 1);
  assert.equal(ingested.items[0]!.content.url, 'https://example.org/fusion');
  assert.equal(ingested.items[0]!.provenance.via, 'autodiscovery');
});

test('sitemap fallback when no feed, with a reasonable loc limit', async () => {
  const parsed = parseSitemapLocs(SITEMAP);
  assert.equal(parsed.pages.length, 2);
  const index = parseSitemapLocs(SITEMAP_INDEX);
  assert.equal(index.childSitemaps[0], 'https://example.org/sitemap-pages.xml');
  const store = new MemoryNetworkItemStore();
  const htmlPage = '<html><head><title>A</title><meta name="description" content="page A"></head></html>';
  const ingested = await ingestOpenWebSource({
    url: 'https://example.org/home',
    store,
    maxSitemapUrls: 1,
    fetchImpl: mockFetch({
      'https://example.org/home': {
        status: 200,
        body: '<html><head><title>Home</title></head><body>no feed</body></html>',
      },
      'https://example.org/robots.txt': {
        status: 200,
        body: 'User-agent: *\nAllow: /\nSitemap: https://example.org/sitemap.xml\n',
      },
      'https://example.org/sitemap.xml': { status: 200, body: SITEMAP },
      'https://example.org/a': { status: 200, body: htmlPage },
      'https://example.org/b': { status: 200, body: htmlPage },
    }),
  });
  assert.equal(ingested.discovery.via, 'sitemap');
  assert.equal(ingested.items.length, 1);
  assert.equal(ingested.items[0]!.provenance.via, 'sitemap');
});

test('invalid sitemap does not throw; inaccessible and unsafe URLs are rejected', async () => {
  const discovery = await discoverOpenWebSource({
    url: 'https://example.org/gone',
    fetchImpl: mockFetch({
      'https://example.org/gone': { status: 404, body: 'nope' },
    }),
  });
  assert.equal(discovery.access, 'unavailable');
  const restricted = await discoverOpenWebSource({
    url: 'https://example.org/pay',
    fetchImpl: mockFetch({
      'https://example.org/pay': { status: 401, body: 'login' },
    }),
  });
  assert.equal(restricted.access, 'restricted');
  const bad = await discoverOpenWebSource({ url: 'javascript:alert(1)' });
  assert.equal(bad.access, 'rejected');
  const store = new MemoryNetworkItemStore();
  const invalidMap = await ingestOpenWebSource({
    url: 'https://example.org/home',
    store,
    fetchImpl: mockFetch({
      'https://example.org/home': { status: 200, body: '<html><title>x</title></html>' },
      'https://example.org/robots.txt': { status: 200, body: 'Sitemap: https://example.org/sitemap.xml\n' },
      'https://example.org/sitemap.xml': { status: 200, body: '<not-a-sitemap>' },
    }),
  });
  assert.equal(invalidMap.discovery.sitemaps.length === 0 || invalidMap.items.length === 0, true);
});

test('redirected page uses final URL as base for relative feed', async () => {
  const discovery = await discoverOpenWebSource({
    url: 'https://example.org/old',
    fetchImpl: mockFetch({
      'https://example.org/old': {
        status: 200,
        body: '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>',
        finalUrl: 'https://example.org/new/',
      },
    }),
  });
  assert.equal(discovery.feeds[0]!.url, 'https://example.org/feed.xml');
});

test('robots Disallow skips autodiscovered feed', async () => {
  const store = new MemoryNetworkItemStore();
  const ingested = await ingestOpenWebSource({
    url: 'https://example.org/',
    store,
    fetchImpl: mockFetch({
      'https://example.org/': { status: 200, body: PAGE },
      'https://example.org/robots.txt': {
        status: 200,
        body: 'User-agent: *\nDisallow: /feed.xml\nDisallow: /atom.xml\n',
      },
      'https://example.org/feed.xml': { status: 200, body: RSS },
      'https://example.org/atom.xml': { status: 200, body: RSS },
    }),
  });
  assert.equal(ingested.items.length, 0);
  assert.equal(ingested.records.some((row) => row.reason === 'robots_disallow'), true);
});

test('private-network URL is rejected by ingest', async () => {
  const store = new MemoryNetworkItemStore();
  const result = await ingestSource({
    sourceUrl: 'http://127.0.0.1/feed.xml',
    store,
  });
  assert.equal(result.items.length, 0);
  assert.equal(result.records[0]?.status, 'unavailable');
});

test('search hits index into the same directory and dedup with feeds', async () => {
  const store = new MemoryNetworkItemStore();
  await ingestSource({
    sourceUrl: 'https://example.org/feed.xml',
    store,
    fetchImpl: mockFetch({ 'https://example.org/feed.xml': { status: 200, body: RSS } }),
    via: 'feed',
  });
  const indexed = await indexSearchHits({
    store,
    hits: [
      { title: 'Fusion note', url: 'https://example.org/fusion?utm_source=search', snippet: 'Lab news.' },
      { title: 'Fusion note', url: 'https://example.org/fusion' },
    ],
  });
  const listed = await store.list({ kind: 'content', limit: 20 }, '2026-09-15T00:00:00.000Z');
  const fusion = listed.items.filter((item) => item.content.url === 'https://example.org/fusion');
  assert.equal(fusion.length, 1);
  assert.ok(indexed.length <= 1);
});

test('proposeOpenWebQueries only returns short topical queries, not a Digital Self dump', async () => {
  const queries = await proposeOpenWebQueries({
    selfContext: '已确认：\n- 我叫张三，住在某路 12 号，喜欢核聚变',
    preferenceDirectives: '- [boost] 更想看到类似「核聚变」的内容',
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    chatComplete: async ({ messages }) => {
      const blob = JSON.stringify(messages);
      assert.equal(/12 号/.test(blob), true);
      return { text: '{"queries":["fusion energy progress","public science news"]}' };
    },
  });
  assert.deepEqual(queries, ['fusion energy progress', 'public science news']);
  assert.equal(queries.some((row) => /张三|12 号/.test(row)), false);
});

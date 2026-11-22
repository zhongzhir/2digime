import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowsDefaultSupply,
  classifyDefaultSource,
  classifyResolvedDefaultSource,
  filterDefaultSupply,
} from '../domestic-source-boundary';
import { OPEN_SOURCE_CATALOG } from '../open-source-catalog';
import { headlinesFromRss, fetchNewsHeadlines } from '../news-headlines';
import { cardsFromNewsHeadlines } from '../content-seek';

test('default catalog has no Epoch Times or BBC-family endpoints', () => {
  assert.equal(
    OPEN_SOURCE_CATALOG.some((row) => /bbc|guardian|npr|aljazeera|epoch|ntdtv|framatube/i.test(`${row.id} ${row.url}`)),
    false,
  );
  assert.ok(OPEN_SOURCE_CATALOG.some((row) => row.contentTypes.includes('article')));
});

test('host and publisher identity exclude default supply without guessing intent', () => {
  assert.equal(allowsDefaultSupply({ url: 'https://www.ithome.com/0/1.htm' }), true);
  assert.equal(allowsDefaultSupply({ url: 'https://www.epochtimes.com/gb/26/n.html' }), false);
  assert.equal(classifyDefaultSource({ url: 'https://news.google.com/rss/articles/x', publisher: '大纪元' }).reason, 'epoch_family');
  assert.equal(allowsDefaultSupply({ url: 'https://www.bbc.com/zhongwen/simp/123' }), false);
  assert.equal(allowsDefaultSupply({ url: 'https://news.google.com/rss/articles/x', publisher: 'BBC 中文' }), false);
  assert.equal(allowsDefaultSupply({ url: 'https://news.google.com/rss/articles/x', publisher: '新浪财经' }), false);
  assert.equal(allowsDefaultSupply({ url: 'https://finance.sina.cn/2026-10-02/doc-abc.shtml', publisher: '新浪财经' }), true);
});

test('news cards drop excluded publishers but keep a dated domestic report', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title>
<item><title>嘉兴今日入秋 - 新浪财经</title><link>https://finance.sina.cn/2026-10-02/doc-abc.shtml</link>
<pubDate>Fri, 02 Oct 2026 07:19:37 GMT</pubDate>
<description>嘉兴今日入秋</description>
<source url="https://finance.sina.cn">新浪财经</source></item>
<item><title>境外一条</title><link>https://www.bbc.com/news/world</link>
<pubDate>Fri, 02 Oct 2026 07:20:00 GMT</pubDate>
<source url="https://www.bbc.com">BBC</source></item>
<item><title>大纪元一条</title><link>https://news.google.com/rss/articles/epoch</link>
<source url="https://www.epochtimes.com">大纪元</source></item>
</channel></rss>`;
  const rows = headlinesFromRss(xml, '2026-10-02T08:00:00.000Z');
  const kept = filterDefaultSupply(rows);
  assert.equal(kept.some((row) => row.publisherName === '新浪财经'), true);
  assert.equal(kept.some((row) => /bbc|大纪元/i.test(`${row.publisherName} ${row.url}`)), false);
  const cards = cardsFromNewsHeadlines(rows);
  assert.equal(cards.some((card) => card.publisherDisplayName === '新浪财经'), true);
  assert.equal(cards.some((card) => /bbc|大纪元/i.test(`${card.publisherDisplayName} ${card.url}`)), false);
});

test('fetchNewsHeadlines applies the same host boundary', async () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>允许</title><link>https://www.thepaper.cn/newsDetail_forward_1</link>
<source url="https://www.thepaper.cn">澎湃新闻</source></item>
<item><title>排除</title><link>https://www.voachinese.com/a/x.html</link>
<source url="https://www.voachinese.com">美国之音</source></item>
</channel></rss>`;
  const rows = await fetchNewsHeadlines('今日新闻', async () => ({
    ok: true,
    status: 200,
    text: async () => xml,
  }) as Response);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.publisherName, '澎湃新闻');
});

test('fetchNewsHeadlines never requests Google News', async () => {
  const urls: string[] = [];
  await fetchNewsHeadlines('今日新闻', async (url) => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      text: async () =>
        `<?xml version="1.0"?><rss version="2.0"><channel><item><title>允许</title><link>https://www.ithome.com/0/1.htm</link><source url="https://www.ithome.com">IT之家</source></item></channel></rss>`,
    } as Response;
  });
  assert.ok(urls.length > 0);
  assert.equal(urls.some((url) => /news\.google\.com/i.test(url)), false);
});

test('dated catalog headlines are kept ahead of undated search hits', async () => {
  const rows = await fetchNewsHeadlines(
    '今日新闻',
    async () =>
      ({
        ok: true,
        status: 200,
        text: async () =>
          `<?xml version="1.0"?><rss version="2.0"><channel><item><title>目录有日期</title><link>https://www.ithome.com/0/dated.htm</link><pubDate>Fri, 02 Oct 2026 07:19:37 GMT</pubDate><source url="https://www.ithome.com">IT之家</source></item></channel></rss>`,
      }) as Response,
    new Date('2026-10-03T08:00:00.000Z'),
    undefined,
    async () => [
      { title: '搜索无日期', url: 'https://example.org/undated', snippet: '聚合' },
      { title: '搜索无日期2', url: 'https://example.org/undated2', snippet: '聚合' },
    ],
  );
  assert.equal(rows[0]?.url, 'https://www.ithome.com/0/dated.htm');
  assert.equal(rows[0]?.publishedAt, '2026-10-02T07:19:37.000Z');
  assert.ok(rows.some((row) => row.url === 'https://www.ithome.com/0/dated.htm'));
});

test('resolved source follows the final redirect host', async () => {
  const excluded = await classifyResolvedDefaultSource(
    { url: 'https://example.org/bounce', publisher: '转发' },
    async () => ({ ok: true, status: 200, url: 'https://www.epochtimes.com/gb/n.html' }) as Response,
  );
  assert.equal(excluded.decision, 'exclude');
  assert.equal(excluded.reason, 'epoch_family');
  const kept = await classifyResolvedDefaultSource(
    { url: 'https://example.org/bounce', publisher: 'IT之家' },
    async () => ({ ok: true, status: 200, url: 'https://www.ithome.com/0/1.htm' }) as Response,
  );
  assert.equal(kept.decision, 'allow');
  assert.equal(kept.url, 'https://www.ithome.com/0/1.htm');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCandidateRoles, defaultDiscoverIntent, intentFromModelText } from '../discover-intent';
import { cardsFromNewsHeadlines, seekContent, splitCurrentReports } from '../content-seek';
import { headlinesFromRss } from '../news-headlines';
import type { DiscoverCard } from '../content-discover';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title>
<item><title>嘉兴今日入秋 - 新浪财经</title><link>https://news.google.com/rss/articles/abc</link>
<pubDate>Fri, 02 Oct 2026 07:19:37 GMT</pubDate>
<description>嘉兴今日入秋</description>
<source url="https://finance.sina.cn">新浪财经</source></item>
<item><title>没有日期的条目</title><link>https://news.google.com/rss/articles/nodate</link>
<description>没有 pubDate</description></item>
</channel></rss>`;

test('news rss keeps publisher, publish time, and does not claim the body was read', () => {
  const rows = headlinesFromRss(RSS, '2026-10-02T08:00:00.000Z');
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.publisherName, '新浪财经');
  assert.equal(rows[0]?.publisherUrl, 'https://finance.sina.cn');
  assert.equal(rows[0]?.publishedAt, '2026-10-02T07:19:37.000Z');
  assert.equal(rows[0]?.fetchedAt, '2026-10-02T08:00:00.000Z');
  assert.equal(rows[0]?.bodyRead, false);
  assert.equal(rows[1]?.publishedAt, undefined);
  const cards = cardsFromNewsHeadlines(rows);
  assert.equal(cards[0]?.textOrigin, 'snippet');
  assert.match(cards[0]?.reason || '', /还没有读取正文/);
});

test('today group keeps a dated report and leaves a roundup and a missing date out', () => {
  const report: DiscoverCard = {
    itemId: 'a',
    title: '今天的预报',
    text: '',
    reason: '',
    publishedAt: '2026-10-02T01:00:00.000Z',
  };
  const roundup: DiscoverCard = {
    itemId: 'b',
    title: '本季综述',
    text: '',
    reason: '',
    publishedAt: '2026-10-02T02:00:00.000Z',
  };
  const undated: DiscoverCard = { itemId: 'c', title: '没有日期', text: '', reason: '' };
  const split = splitCurrentReports({
    primary: [report, undated],
    related: [roundup],
    today: '2026-10-02',
  });
  assert.deepEqual(split.todayReports.map((card) => card.itemId), ['a']);
  assert.equal(split.background.some((card) => card.itemId === 'c' && /不能当作当天报道/.test(card.reason)), true);
  assert.equal(split.background.some((card) => card.itemId === 'b'), true);
});

test('a challenge page is an access state, not an unjudged article', async () => {
  const sought = await seekContent({
    query: '今天的地方新闻',
    items: [],
    intent: {
      ...defaultDiscoverIntent('今天的地方新闻'),
      freshness: 'current',
      newsFeed: true,
      requestedMedia: ['article'],
    },
    newsHeadlines: [
      {
        title: '百度安全验证',
        url: 'https://example.org/verify',
        fetchedAt: '2026-10-02T08:00:00.000Z',
        snippet: '请完成安全验证',
        bodyRead: false,
      },
      {
        title: '请登录后继续',
        url: 'https://example.org/login',
        fetchedAt: '2026-10-02T08:00:00.000Z',
        snippet: '登录后继续',
        bodyRead: false,
      },
    ],
    model: { baseUrl: 'https://example.invalid', model: 'm' },
    chatComplete: async () => ({ text: '{"roles":[]}' }),
  });
  assert.equal(sought.unjudgedCards.some((card) => /安全验证|请登录/.test(card.title)), false);
  assert.equal(sought.cards.length, 0);
  assert.equal(sought.accessCards.some((card) => card.accessState === 'challenge'), true);
  assert.equal(sought.accessCards.some((card) => card.accessState === 'login'), true);
});

test('intent newsFeed is only true when the model sets it', () => {
  const on = intentFromModelText('{"mode":"consume","newsFeed":true,"freshness":"current"}', '今天的新闻');
  const off = intentFromModelText('{"mode":"consume","freshness":"unspecified"}', '巴赫');
  assert.equal(on.newsFeed, true);
  assert.equal(off.newsFeed, undefined);
});

test('truncated or empty judgment is retried instead of treated as finished', async () => {
  let calls = 0;
  const judged = await classifyCandidateRoles({
    query: '今天的气象新闻',
    intent: { ...defaultDiscoverIntent('今天的气象新闻'), freshness: 'current', newsFeed: true },
    candidates: [
      {
        id: 'c0',
        title: '近海预报',
        url: 'https://example.org/weather',
        summary: '10月2日预报',
        publishedAt: '2026-10-02T01:00:00.000Z',
      },
    ],
    model: { baseUrl: 'https://example.invalid', model: 'm' },
    chatComplete: async () => {
      calls += 1;
      if (calls === 1) return { text: '{"roles', truncated: true, finishReason: 'length' };
      return { text: JSON.stringify({ roles: [{ id: 'c0', role: 'PRIMARY_CONTENT' }] }) };
    },
  });
  assert.equal(calls, 2);
  assert.equal(judged.roles.get('c0'), 'PRIMARY_CONTENT');
  assert.equal(judged.attempts, 2);
});

test('a current news seek does not promote an undated or commentary item into today', async () => {
  const today = new Date();
  const publishedAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0).toISOString();
  const localDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const sought = await seekContent({
    query: '今天的地方新闻',
    items: [],
    intent: {
      ...defaultDiscoverIntent('今天的地方新闻'),
      freshness: 'current',
      newsFeed: true,
      requestedMedia: ['article'],
    },
    newsHeadlines: [
      {
        title: '本地今天的通报',
        url: 'https://example.org/today-report',
        publisherName: '本地报',
        publishedAt,
        fetchedAt: publishedAt,
        snippet: '一条具体通报',
        bodyRead: false,
      },
      {
        title: '本季综述',
        url: 'https://example.org/roundup',
        publishedAt,
        fetchedAt: publishedAt,
        snippet: '一季回顾',
        bodyRead: false,
      },
    ],
    model: { baseUrl: 'https://example.invalid', model: 'm' },
    chatComplete: async (options) => {
      const user = String(options.messages.find((message) => message.role === 'user')?.content || '');
      const payload = JSON.parse(user) as { candidates: Array<{ id: string; title: string }> };
      return {
        text: JSON.stringify({
          roles: payload.candidates.map((row) => ({
            id: row.id,
            role: /综述/.test(row.title) ? 'COMMENTARY' : 'PRIMARY_CONTENT',
          })),
        }),
      };
    },
  });
  assert.equal(sought.cards.length, 1);
  assert.match(sought.cards[0]?.title || '', /通报/);
  assert.equal(sought.relatedCards.some((card) => /综述/.test(card.title)), true);
  assert.match(sought.notice, /具体报道/);
  assert.equal(localDay.length, 10);
});

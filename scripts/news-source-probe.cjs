// Public endpoints only. No cookies, platform internal APIs or login bypass.
const fs = require('node:fs/promises');
const sources = [
  ['新华社', 'news', 'https://www.news.cn/'],
  ['人民网', 'news', 'http://www.people.com.cn/'],
  ['央视网', 'video/news', 'https://www.cctv.com/'],
  [
    '中国新闻网',
    'news',
    'https://www.chinanews.com.cn/',
    'https://www.chinanews.com.cn/rss/scroll-news.xml',
  ],
  ['中国政府网', 'public', 'https://www.gov.cn/'],
  ['北京市政府', 'public', 'https://www.beijing.gov.cn/'],
  ['证券时报', 'finance', 'https://www.stcn.com/'],
  ['财新', 'finance', 'https://www.caixin.com/'],
  ['36氪', 'PEVC/technology', 'https://36kr.com/', 'https://36kr.com/feed'],
  [
    'IT之家',
    'technology',
    'https://www.ithome.com/',
    'https://www.ithome.com/rss/',
  ],
  ['机器之心', 'AI', 'https://www.jiqizhixin.com/'],
  ['投中网', 'PEVC', 'https://www.chinaventure.com.cn/'],
  ['中国出版传媒商报', 'publishing', 'https://www.cbbr.com.cn/'],
  ['澎湃新闻', 'news/culture', 'https://www.thepaper.cn/'],
  ['少数派', 'article', 'https://sspai.com/', 'https://sspai.com/feed'],
  [
    '阮一峰',
    'independent',
    'https://www.ruanyifeng.com/blog/',
    'https://www.ruanyifeng.com/blog/atom.xml',
  ],
  [
    '机核',
    'culture/audio',
    'https://www.gcores.com/',
    'https://www.gcores.com/rss',
  ],
  [
    '津津乐道',
    'audio',
    'https://www.jinjinledao.org/',
    'https://feeds.jinjinledao.org/all.xml',
  ],
  ['哔哩哔哩', 'video', 'https://www.bilibili.com/'],
  [
    '爱范儿',
    'technology',
    'https://www.ifanr.com/',
    'https://www.ifanr.com/feed',
  ],
];
async function get(url) {
  const start = Date.now();
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': '2digime-source-verification/1.0' },
    });
    const text = (await r.text()).slice(0, 1500000);
    return {
      url,
      status: r.status,
      finalUrl: r.url,
      ms: Date.now() - start,
      bytes: text.length,
      feed: /<rss\b|<feed\b|"version":\s*"https:\/\/jsonfeed/.test(text),
      sitemapXml: /<(?:urlset|sitemapindex)\b/i.test(text),
      jsonLd: text.includes('application/ld+json'),
      feedLinks: [
        ...text.matchAll(/<link\b[^>]*(?:rss|atom|feed\+json)[^>]*>/gi),
      ]
        .map((m) => m[0])
        .slice(0, 5),
      sitemaps: [...text.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]),
      title: (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.slice(
        0,
        160,
      ),
    };
  } catch (e) {
    return {
      url,
      ms: Date.now() - start,
      error: e.code || e.cause?.code || e.name,
    };
  }
}
(async () => {
  const rows = [];
  for (let i = 0; i < sources.length; i += 5) {
    await Promise.all(
      sources.slice(i, i + 5).map(async ([source, type, url, feed]) => {
        const checks = await Promise.all([
          get(url),
          get(new URL('/robots.txt', url).href),
          ...(feed ? [get(feed)] : []),
        ]);
        const declared = checks[1].sitemaps || [];
        const sitemapChecks = await Promise.all(declared.slice(0, 2).map(get));
        rows.push({
          source,
          type,
          url,
          feed: feed || null,
          checks,
          sitemapChecks,
        });
        console.log(source, checks.map((r) => r.status || r.error).join(','));
      }),
    );
  }
  await fs.mkdir('docs/audits/evidence/news-supply-01', { recursive: true });
  await fs.writeFile(
    'docs/audits/evidence/news-supply-01/sources.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        network:
          'Current Windows host; domestic routing and long-term stability not independently established',
        rows,
      },
      null,
      2,
    ),
  );
})();
